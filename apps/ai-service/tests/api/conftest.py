"""Fixtures for the /admin/interview-agent endpoint tests.

The endpoints spin up a REAL diagnostic session (``start_agent_session`` →
``asyncio.create_task(_run(...))`` → ``run_session``), which would otherwise build an LLM client
and call the model. We stub the brain exactly like
``tests/interview_agent/test_session.py::_install_stubs`` so the background task runs entirely
in-process with no network. The stubbing patches the *module attributes*
(``app.interview_agent.llm_ops`` funcs + ``session.build_llm_client``) — session.py resolves them
via the module at call time, so the patches take effect inside the background task.
"""
from __future__ import annotations

import pytest

import app.interview_agent.session as sess
import app.interview_agent.llm_ops as ops
from app.interview_agent.diagnostic_runner import TRANSPORTS
from app.interview_agent.types import PacingDirective, TurnClass
from app.jobs.agent_sessions import AGENT_SESSIONS

# The minimal, already-JSON-serializable plan (mirror of test_session.py:14-23).
PLAN = {
    "sessionId": "s1", "candidateId": "c1", "roundType": "dsa",
    "persona": {"name": "Ada", "opening": "hi", "closing": "bye"},
    "questionLadders": [
        {"questionSlug": "q1", "basePrompt": "b1", "followUps": ["f1"], "hints": ["h1"],
         "rubric": [{"criterion": "c", "weight": 1.0}]},
        {"questionSlug": "q2", "basePrompt": "b2", "followUps": [], "hints": [], "rubric": []},
    ],
    "reserve": [{"questionSlug": "r1", "basePrompt": "hard bonus", "rubric": []}],
}


@pytest.fixture
def minimal_plan_json() -> dict:
    """A fresh copy per test — the request body for POST /interview-agent/run."""
    import copy
    return copy.deepcopy(PLAN)


@pytest.fixture(autouse=True)
def _stub_brain(monkeypatch):
    """Stub every LLM op + the client builder so a started session never hits the network, then
    clear the shared in-memory stores so sessions never leak across tests (the store's active cap
    would otherwise trip a 429 in a later /run)."""
    async def fake_classify(llm, settings, *, round_type, active_item_summary, last_text):
        return TurnClass.ANSWER, None

    async def fake_classify_opening(llm, settings, *, last_text):
        return "ready"

    async def fake_grade(llm, settings, *, rubric, question, answer, artifact=None):
        return 0.8, 0.7

    async def fake_generate(llm, settings, *, action, persona, active_item, transcript_tail, extra):
        return f"[{action}]"

    async def fake_judge(llm, settings, *, gate, rolling, transcript_summary):
        return PacingDirective.CONTINUE

    async def fake_derive(llm, settings, *, round_type, topic, grounding):
        return {"questionSlug": "derived", "basePrompt": "derived q", "rubric": []}

    monkeypatch.setattr(ops, "classify_turn", fake_classify)
    monkeypatch.setattr(ops, "classify_opening_turn", fake_classify_opening)
    monkeypatch.setattr(ops, "grade_answer", fake_grade)
    monkeypatch.setattr(ops, "generate_line", fake_generate)
    monkeypatch.setattr(ops, "judge_pacing", fake_judge)
    monkeypatch.setattr(ops, "derive_ladder", fake_derive)
    monkeypatch.setattr(sess, "build_llm_client", lambda settings, model=None: None)

    yield

    # test isolation: drop any sessions/transports this test created (each asyncio.run() below
    # already drove its background task to a terminal state or had it cancelled on loop close).
    AGENT_SESSIONS._runs.clear()
    AGENT_SESSIONS._tasks.clear()
    TRANSPORTS.clear()
