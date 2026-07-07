"""Integration tests for the diagnostic runner.

Covers: terminal_status mapping, capacity enforcement, and force-end -> "aborted". Plain sync tests
that drive a full in-process run_session behind a DiagnosticTransport via asyncio.run (repo
convention — NOT pytest-asyncio). The stubs replicate tests/interview_agent/test_session.py's
``_install_stubs`` so run_session never builds a real LLM client or hits the network."""
from __future__ import annotations

import asyncio

import pytest

import app.interview_agent.llm_ops as ops
import app.interview_agent.session as sess
from app.interview_agent import diagnostic_runner as dr
from app.interview_agent.types import PacingDirective, TurnClass
from app.jobs.agent_sessions import AGENT_SESSIONS

_TERMINAL = {"completed", "failed", "abandoned", "aborted"}


def _install_stubs(monkeypatch, *, classify=TurnClass.ANSWER, competency=0.8, directive=None,
                   opening_intent="ready"):
    """Replicated from tests/interview_agent/test_session.py: monkeypatch every llm_ops call and
    stub sess.build_llm_client -> None so run_session runs fully in-process with no network."""
    async def fake_classify(llm, settings, *, round_type, active_item_summary, last_text):
        return classify, None

    async def fake_classify_opening(llm, settings, *, last_text):
        return opening_intent

    async def fake_grade(llm, settings, *, rubric, question, answer, artifact=None):
        return competency, 0.7

    async def fake_generate(llm, settings, *, action, persona, active_item, transcript_tail, extra):
        return f"[{action}]"

    async def fake_judge(llm, settings, *, gate, rolling, transcript_summary):
        return directive or PacingDirective.CONTINUE

    async def fake_derive(llm, settings, *, round_type, topic, grounding):
        return {"questionSlug": "derived", "basePrompt": "derived q", "rubric": []}

    monkeypatch.setattr(ops, "classify_turn", fake_classify)
    monkeypatch.setattr(ops, "classify_opening_turn", fake_classify_opening)
    monkeypatch.setattr(ops, "grade_answer", fake_grade)
    monkeypatch.setattr(ops, "generate_line", fake_generate)
    monkeypatch.setattr(ops, "judge_pacing", fake_judge)
    monkeypatch.setattr(ops, "derive_ladder", fake_derive)
    # avoid building a real network client
    monkeypatch.setattr(sess, "build_llm_client", lambda settings, model=None: None)


@pytest.fixture(autouse=True)
def _isolate_store():
    """AGENT_SESSIONS is a process-wide singleton; clear it around each test so active_count() and
    status_of() only reflect the session(s) this test started."""
    AGENT_SESSIONS._runs.clear()
    AGENT_SESSIONS._tasks.clear()
    yield
    AGENT_SESSIONS._runs.clear()
    AGENT_SESSIONS._tasks.clear()


async def _drain(run_id, tries=100, delay=0.02):
    for _ in range(tries):
        if AGENT_SESSIONS.status_of(run_id) in _TERMINAL:
            return
        await asyncio.sleep(delay)


def test_terminal_status_mapping():
    assert dr.terminal_status("abandoned") == "abandoned"
    assert dr.terminal_status("aborted_technical") == "aborted"
    assert dr.terminal_status("natural_complete") == "completed"
    assert dr.terminal_status("early_weak") == "completed"
    assert dr.terminal_status("time_ceiling") == "completed"
    assert dr.terminal_status(None) == "completed"


def test_capacity_enforced(monkeypatch, minimal_plan, test_settings):
    _install_stubs(monkeypatch)
    monkeypatch.setattr(dr, "MAX_ACTIVE_SESSIONS", 1)

    async def body():
        rid, t = dr.start_agent_session(minimal_plan, test_settings, label="x")
        with pytest.raises(dr.TooManyActiveSessions):
            dr.start_agent_session(minimal_plan, test_settings, label="y")
        t.submit_end()  # wind the first one down so we don't leak the task
        await _drain(rid)
        assert AGENT_SESSIONS.status_of(rid) in _TERMINAL

    asyncio.run(body())


def test_force_end_yields_aborted(monkeypatch, minimal_plan, test_settings):
    _install_stubs(monkeypatch)

    async def body():
        rid, t = dr.start_agent_session(minimal_plan, test_settings, label="x")
        await asyncio.sleep(0.05)  # let the opening run to its first next_utterance await
        t.submit_end()
        for _ in range(50):
            if AGENT_SESSIONS.status_of(rid) == "aborted":
                break
            await asyncio.sleep(0.02)
        assert AGENT_SESSIONS.status_of(rid) == "aborted"

    asyncio.run(body())
