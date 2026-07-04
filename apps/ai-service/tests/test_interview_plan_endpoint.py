"""/interview-plans route: error mapping (PrepDataError->422, LLMError->502) + happy pass-through.

Called directly with the Depends/HTTP layer bypassed and the pipeline mocked — same style as
test_resume_parse / test_questions_endpoints.
"""
import asyncio

import pytest
from fastapi import HTTPException

import app.api.routes as routes
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


def test_route_happy_passthrough(monkeypatch):
    async def _ok(req, settings):
        return {"sessionId": "s1", "roundType": "dsa"}

    monkeypatch.setattr(routes, "generate_interview_plan", _ok)
    out = asyncio.run(routes.generate_plan(_req()))
    assert out["sessionId"] == "s1"


def test_route_prepdata_maps_422(monkeypatch):
    async def _boom(req, settings):
        raise PrepDataError("no brief or questions")

    monkeypatch.setattr(routes, "generate_interview_plan", _boom)
    with pytest.raises(HTTPException) as ei:
        asyncio.run(routes.generate_plan(_req()))
    assert ei.value.status_code == 422


def test_route_llmerror_maps_502(monkeypatch):
    async def _boom(req, settings):
        raise LLMError("model never valid")

    monkeypatch.setattr(routes, "generate_interview_plan", _boom)
    with pytest.raises(HTTPException) as ei:
        asyncio.run(routes.generate_plan(_req()))
    assert ei.value.status_code == 502
