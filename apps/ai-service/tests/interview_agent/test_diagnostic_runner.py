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


async def _wait_for(cond, tries=400, delay=0.01):
    for _ in range(tries):
        if cond():
            return True
        await asyncio.sleep(delay)
    return False


def test_opening_folds_into_turn0_and_main_turns_carry_steps(monkeypatch, minimal_plan, test_settings):
    """S2-2: opening replies fold into the seeded turn 0 (kind 'opening', carrying an
    ``opening_classify`` step) — NO empty 'main' turns before the first question. The first real
    answer opens turn 1 (kind 'main') with classify/grade/pacing/route/action steps; an in-scope
    pivot opens turn 2 with a real ``scope`` step (status 'ok', not skipped) and a nested ``derive``
    step, and the action/derive steps carry their ``llm_label``."""
    _install_stubs(monkeypatch, opening_intent="ready", competency=0.8)

    # First main turn = ANSWER; second = an in-scope pivot ("dynamic programming" is DSA-scope) so
    # the route lands on PIVOT_DERIVE and the `derive` step is emitted.
    calls = {"n": 0}

    async def seq_classify(llm, settings, *, round_type, active_item_summary, last_text):
        calls["n"] += 1
        if calls["n"] == 1:
            return TurnClass.ANSWER, None
        return TurnClass.PIVOT_REQUEST, "dynamic programming"
    monkeypatch.setattr(ops, "classify_turn", seq_classify)

    async def body():
        rid, t = dr.start_agent_session(minimal_plan, test_settings, label="fold")
        # 4 opening turns (GREET, 2x RAPPORT, ORIENT), then the first real answer, then the pivot.
        for txt in ("hi", "from pune", "coep", "ready when you are"):
            t.submit_turn(txt, artifact=None, advance_seconds=30.0)
        t.submit_turn("here is my answer to the first question", artifact=None, advance_seconds=30.0)
        t.submit_turn("can we do a dynamic programming question instead", artifact=None, advance_seconds=30.0)

        # Both main turns processed once the driver is back to awaiting_input with 3 turns open
        # (opening + 2 main). awaiting_input only re-arms after the pivot turn fully processed.
        ok = await _wait_for(lambda: AGENT_SESSIONS.status_of(rid) == "awaiting_input"
                             and len(AGENT_SESSIONS.snapshot(rid, 0)["turns"]) >= 3)
        assert ok, "pivot turn was not fully processed in time"

        turns = AGENT_SESSIONS.snapshot(rid, 0)["turns"]

        # Opening folded into turn 0 — no empty 'main' turns opened for the opening exchanges.
        assert turns[0]["kind"] == "opening"
        assert any(s["name"] == "opening_classify" for s in turns[0]["steps"])
        assert len(turns) == 3   # exactly: opening, first answer, pivot

        # First real answer -> turn 1, kind 'main', full step set; scope skipped, grade run.
        assert turns[1]["kind"] == "main"
        assert [s["name"] for s in turns[1]["steps"]] == [
            "classify", "scope", "grade", "pacing", "route", "action"]
        assert _step(turns[1], "scope")["status"] == "skipped"
        assert _step(turns[1], "grade")["status"] == "ok"

        # Pivot -> turn 2: scope is a real 'ok' step (not skipped), grade skipped, derive nested.
        assert turns[2]["kind"] == "main"
        assert _step(turns[2], "scope")["status"] == "ok"
        assert _step(turns[2], "grade")["status"] == "skipped"
        assert _step(turns[2], "action")["llm_label"] == "iv-converse"
        assert _step(turns[2], "action")["status"] == "ok"
        assert _step(turns[2], "derive")["llm_label"] == "iv-derive"
        assert _step(turns[2], "derive")["status"] == "ok"

        t.submit_end()
        await _drain(rid)

    asyncio.run(body())


def _step(turn, name):
    return next(s for s in turn["steps"] if s["name"] == name)


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
