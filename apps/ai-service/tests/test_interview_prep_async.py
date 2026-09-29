"""Fire-and-poll production plan path: run_plan_async terminal states in the PLAN_RUNS store, plus
the start/poll routes (start returns a pollable run; unknown run 404s).

Same style as test_interview_plan_endpoint — route functions called directly, pipeline mocked."""
import asyncio

import pytest
from fastapi import HTTPException

import app.api.routes as routes
from app.interview_prep import async_runner
from app.interview_prep.async_runner import PLAN_RUNS, run_plan_async
from app.interview_prep.pipeline import PrepDataError
from app.interview_prep.schema import GenerateInterviewPlanRequest
from app.llm.client import LLMError


def _req():
    return GenerateInterviewPlanRequest.model_validate({
        "session": {"sessionId": "s1", "candidateId": "c1", "company": "google",
                    "role": "software-engineer", "level": "sde1", "specialization": "backend",
                    "roundType": "dsa"},
        "jobDescription": {"id": "jd1", "title": "SWE"},
        "candidateProfile": {"skills": ["Python"]},
    })


def test_run_plan_async_completes_and_stores_plan(monkeypatch):
    async def _ok(req, settings):
        return {"sessionId": "s1", "provenance": {"planVersion": "v1", "inputHash": "sha256:abc"}}

    monkeypatch.setattr(async_runner, "generate_interview_plan", _ok)
    run_id = PLAN_RUNS.create()
    asyncio.run(run_plan_async(_req(), run_id, object()))

    rec = PLAN_RUNS.get(run_id)
    assert rec["status"] == "completed"
    assert rec["plan"]["provenance"]["planVersion"] == "v1"
    assert rec["error"] is None


def test_run_plan_async_prepdata_fails_no_data(monkeypatch):
    async def _boom(req, settings):
        raise PrepDataError("no brief or questions")

    monkeypatch.setattr(async_runner, "generate_interview_plan", _boom)
    run_id = PLAN_RUNS.create()
    asyncio.run(run_plan_async(_req(), run_id, object()))

    rec = PLAN_RUNS.get(run_id)
    assert rec["status"] == "failed"
    assert rec["error"]["code"] == "no_data"
    assert rec["plan"] is None


def test_run_plan_async_llmerror_fails_llm(monkeypatch):
    async def _boom(req, settings):
        raise LLMError("model never valid")

    monkeypatch.setattr(async_runner, "generate_interview_plan", _boom)
    run_id = PLAN_RUNS.create()
    asyncio.run(run_plan_async(_req(), run_id, object()))

    rec = PLAN_RUNS.get(run_id)
    assert rec["status"] == "failed"
    assert rec["error"]["code"] == "llm_error"


def test_poll_unknown_run_404():
    with pytest.raises(HTTPException) as ei:
        asyncio.run(routes.interview_plan_run_status("does-not-exist"))
    assert ei.value.status_code == 404


def test_start_creates_pollable_running_run(monkeypatch):
    async def _noop(req, run_id, settings):
        return None

    monkeypatch.setattr(routes, "run_plan_async", _noop)

    async def _scenario():
        out = await routes.start_interview_plan(_req())
        snap = await routes.interview_plan_run_status(out["run_id"])
        await asyncio.sleep(0)  # let the fire-and-forget task finish (no pending-task warning)
        return out, snap

    out, snap = asyncio.run(_scenario())
    assert out["status"] == "running"
    assert snap["run_id"] == out["run_id"]
    assert snap["status"] == "running"
