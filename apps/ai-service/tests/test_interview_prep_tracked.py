"""Instrumented interview-prep run: terminal state + per-stage statuses, with context/stages/
assembly stubbed (no LLM, no Mongo)."""
import asyncio
import types

import pytest

import app.interview_prep.tracked_pipeline as tp
from app.interview_prep.schema import GenerateInterviewPlanRequest
from app.llm.client import LLMError


def _req() -> GenerateInterviewPlanRequest:
    return GenerateInterviewPlanRequest.model_validate({
        "session": {"sessionId": "11111111-1111-1111-1111-111111111111",
                    "candidateId": "22222222-2222-2222-2222-222222222222",
                    "company": "acme", "role": "software-engineer", "level": "sde1",
                    "specialization": "backend", "roundType": "dsa"},
        "jobDescription": {"id": "33333333-3333-3333-3333-333333333333",
                           "title": "SDE1", "description": "Build things", "techStack": "Java"},
        "candidateProfile": {"fullName": "Asha", "skills": ["Java"]},
    })


class _Ctx:
    company = "acme"
    role = "software-engineer"
    level = "sde1"
    specialization = "backend"
    round_type = "dsa"
    has_brief_content = True
    questions = [{"slug": "two-sum"}]
    input_hash = "sha256:abc"
    grounding = {"company": "acme", "round": "dsa"}


class _FakeLLM:
    async def __aenter__(self):
        return self

    async def __aexit__(self, *_a):
        return False


class _Dumpable:
    def __init__(self, d):
        self._d = d

    def model_dump(self, **_kw):
        return self._d


def _install_happy_stubs(monkeypatch):
    async def _ctx(_req, _settings):
        return _Ctx()

    async def _persona(_llm, _ctx, _s):
        return _Dumpable({"persona": {"name": "Ravi"}, "round_arc": [{"phase": "core"}]})

    async def _ladders(_llm, _ctx, _s):
        obj = _Dumpable({"ladders": [{"q": 1}, {"q": 2}]})
        obj.ladders = [{"q": 1}, {"q": 2}]
        return obj

    async def _probes(_llm, _ctx, _s):
        obj = _Dumpable({"probes": [{"p": 1}]})
        obj.probes = [{"p": 1}]
        return obj

    monkeypatch.setattr(tp, "build_context", _ctx)
    monkeypatch.setattr(tp, "_persona", _persona)
    monkeypatch.setattr(tp, "_ladders", _ladders)
    monkeypatch.setattr(tp, "_probes", _probes)
    monkeypatch.setattr(tp, "build_llm_client", lambda s, *, model=None: _FakeLLM())
    monkeypatch.setattr(tp, "_assemble_plan", lambda *a, **k: _Dumpable(
        {"sessionId": "bench", "questionLadders": [{"q": 1}], "candidateProbes": [{"p": 1}]}))


def _statuses(run_id):
    snap = tp.RUNS.snapshot(run_id)
    return snap, {s["name"]: s["status"] for s in snap["steps"]}


def test_prep_run_happy(monkeypatch):
    _install_happy_stubs(monkeypatch)
    req = _req()
    run_id = tp.start_interview_prep_run(req)
    asyncio.run(tp.run_interview_prep(req, run_id, types.SimpleNamespace(prep_llm_model="")))

    snap, statuses = _statuses(run_id)
    assert snap["status"] == "completed"
    assert statuses == {"context_assembly": "ok", "cache_gate": "ok", "persona_and_arc": "ok",
                        "question_ladders": "ok", "candidate_probes": "ok", "assemble": "ok"}
    assert snap["result"]["questionLadders"]
    ctx_step = next(s for s in snap["steps"] if s["name"] == "context_assembly")
    assert ctx_step["detail"]["input_hash"] == "sha256:abc"
    assert ctx_step["detail"]["question_count"] == 1
    persona = next(s for s in snap["steps"] if s["name"] == "persona_and_arc")
    assert persona["detail"]["output"]["persona"]["name"] == "Ravi"


def test_prep_run_no_data_fails_at_context(monkeypatch):
    class _Empty:
        company = "acme"
        role = "software-engineer"
        level = "sde1"
        specialization = "backend"
        round_type = "dsa"
        has_brief_content = False
        questions = []
        input_hash = "sha256:x"
        grounding = {}

    async def _ctx(_req, _settings):
        return _Empty()

    monkeypatch.setattr(tp, "build_context", _ctx)
    req = _req()
    run_id = tp.start_interview_prep_run(req)
    asyncio.run(tp.run_interview_prep(req, run_id, types.SimpleNamespace(prep_llm_model="")))

    snap, statuses = _statuses(run_id)
    assert snap["status"] == "failed"
    assert snap["error"]["step"] == "context_assembly"
    assert statuses["context_assembly"] == "failed"
    assert statuses["assemble"] == "skipped"


def test_prep_run_llm_failure_fails_at_persona(monkeypatch):
    _install_happy_stubs(monkeypatch)

    async def _boom(_llm, _ctx, _s):
        raise LLMError("all keys cooling")

    monkeypatch.setattr(tp, "_persona", _boom)
    req = _req()
    run_id = tp.start_interview_prep_run(req)
    asyncio.run(tp.run_interview_prep(req, run_id, types.SimpleNamespace(prep_llm_model="")))

    snap, statuses = _statuses(run_id)
    assert snap["status"] == "failed"
    assert snap["error"]["step"] == "persona_and_arc"
    assert statuses["persona_and_arc"] == "failed"
    assert statuses["question_ladders"] == "skipped"
    assert statuses["candidate_probes"] == "skipped"
    assert statuses["assemble"] == "skipped"
