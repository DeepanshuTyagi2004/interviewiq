"""Endpoint tests for the /admin/interview-agent/* diagnostics harness (Task A5).

Two testing styles, both from established repo precedent:
  * HTTP round-trips via httpx AsyncClient + ASGITransport, wrapped in ``asyncio.run(...)`` — the
    repo has NO ``asyncio_mode`` (see tests/interview_agent/test_outcome_sink.py), so we never use
    ``@pytest.mark.asyncio``. These drive a REAL (stubbed-brain) background session.
  * a direct handler-coroutine call (like tests/test_interview_plan_endpoint.py) for the 409
    atomic-accept guard, which is deterministic when driven directly instead of racing the brain.
"""
from __future__ import annotations

import asyncio

import pytest
from fastapi import HTTPException
from httpx import ASGITransport, AsyncClient

import app.api.admin as admin_mod
from app.interview_agent.diagnostic_runner import TRANSPORTS
from app.interview_agent.diagnostic_transport import DiagnosticTransport
from app.jobs.agent_sessions import AGENT_SESSIONS
from app.main import app

HEADERS = {"X-Internal-Api-Key": "x"}  # root tests/conftest.py sets INTERNAL_API_KEY="x"
_TERMINAL = {"completed", "failed", "abandoned", "aborted"}


def _client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://t")


def test_run_then_poll_then_atomic_turn(minimal_plan_json):
    async def _body():
        async with _client() as c:
            r = await c.post("/admin/interview-agent/run", json=minimal_plan_json, headers=HEADERS)
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["status"] == "running"
            rid = body["run_id"]

            # poll until the opening parks the session awaiting the candidate
            snap = None
            for _ in range(200):
                snap = (await c.get(f"/admin/interview-agent/runs/{rid}?after=0", headers=HEADERS)).json()
                if snap["status"] == "awaiting_input":
                    break
                await asyncio.sleep(0.02)
            assert snap is not None and snap["status"] == "awaiting_input"

            # a valid turn is accepted (awaiting_input AND inbox empty)
            r2 = await c.post(f"/admin/interview-agent/runs/{rid}/turn",
                              json={"text": "my answer", "advance_seconds": 60}, headers=HEADERS)
            assert r2.status_code == 200 and r2.json()["status"] == "accepted"

            # cleanup: force-end and drive to a terminal state so the bg task never leaks
            r3 = await c.post(f"/admin/interview-agent/runs/{rid}/end", headers=HEADERS)
            assert r3.status_code == 200 and r3.json()["status"] == "accepted"
            for _ in range(200):
                s = (await c.get(f"/admin/interview-agent/runs/{rid}?after=0", headers=HEADERS)).json()
                if s["status"] in _TERMINAL:
                    break
                await asyncio.sleep(0.02)

    asyncio.run(_body())


def test_list_runs_returns_the_started_run(minimal_plan_json):
    async def _body():
        async with _client() as c:
            r = await c.post("/admin/interview-agent/run", json=minimal_plan_json, headers=HEADERS)
            rid = r.json()["run_id"]
            listing = (await c.get("/admin/interview-agent/runs", headers=HEADERS)).json()
            assert any(item["run_id"] == rid for item in listing["runs"])
            await c.post(f"/admin/interview-agent/runs/{rid}/end", headers=HEADERS)
            for _ in range(200):
                s = (await c.get(f"/admin/interview-agent/runs/{rid}?after=0", headers=HEADERS)).json()
                if s["status"] in _TERMINAL:
                    break
                await asyncio.sleep(0.02)

    asyncio.run(_body())


def test_turn_on_unknown_is_404():
    async def _body():
        async with _client() as c:
            r = await c.post("/admin/interview-agent/runs/nope/turn", json={"text": "x"}, headers=HEADERS)
            assert r.status_code == 404

    asyncio.run(_body())


def test_get_unknown_run_is_404():
    async def _body():
        async with _client() as c:
            r = await c.get("/admin/interview-agent/runs/nope?after=0", headers=HEADERS)
            assert r.status_code == 404

    asyncio.run(_body())


def test_end_unknown_run_is_404():
    async def _body():
        async with _client() as c:
            r = await c.post("/admin/interview-agent/runs/nope/end", headers=HEADERS)
            assert r.status_code == 404

    asyncio.run(_body())


def test_missing_internal_key_is_401(minimal_plan_json):
    async def _body():
        async with _client() as c:
            r = await c.post("/admin/interview-agent/run", json=minimal_plan_json)
            assert r.status_code == 401

    asyncio.run(_body())


def test_turn_atomic_guard_409(minimal_plan_json):
    """The atomic double-submit guard, tested deterministically via the handler coroutine (no race
    with the background brain). Rejected with 409 when status != awaiting_input, AND when the inbox
    is non-empty even though status is awaiting_input."""
    rid = "guard-rid"
    AGENT_SESSIONS.start(rid, minimal_plan_json, label="guard")  # store default status = "running"
    TRANSPORTS[rid] = DiagnosticTransport(rid, AGENT_SESSIONS)

    # branch 1: status "running" (a submit is already in flight) -> 409
    with pytest.raises(HTTPException) as ei:
        asyncio.run(admin_mod.submit_agent_turn(rid, {"text": "x"}))
    assert ei.value.status_code == 409

    # branch 2: awaiting_input but inbox not drained yet -> still 409 (the AND-guard)
    AGENT_SESSIONS.set_status(rid, "awaiting_input")
    TRANSPORTS[rid].submit_turn(text="already queued", artifact=None, advance_seconds=60)
    with pytest.raises(HTTPException) as ei2:
        asyncio.run(admin_mod.submit_agent_turn(rid, {"text": "x"}))
    assert ei2.value.status_code == 409


def test_turn_with_null_advance_seconds_is_accepted_not_wedged(minimal_plan_json):
    """Regression: an explicit ``advance_seconds: null`` must fall back to the 60.0 default and be
    accepted — it must NOT 500 on ``float(None)`` AFTER the status flip, leaving the session wedged
    in "running" with an empty inbox (unrecoverable except by force-end)."""
    rid = "null-adv-rid"
    AGENT_SESSIONS.start(rid, minimal_plan_json, label="null-adv")
    AGENT_SESSIONS.set_status(rid, "awaiting_input")  # parked, inbox empty -> a turn is acceptable
    TRANSPORTS[rid] = DiagnosticTransport(rid, AGENT_SESSIONS)

    out = asyncio.run(admin_mod.submit_agent_turn(rid, {"text": "x", "advance_seconds": None}))
    assert out == {"status": "accepted"}
    # NOT wedged: the turn was actually enqueued (inbox non-empty) and status advanced to running.
    assert AGENT_SESSIONS.status_of(rid) == "running"
    assert TRANSPORTS[rid].inbox_empty() is False


def test_turn_with_non_numeric_advance_seconds_is_400_and_stays_awaiting(minimal_plan_json):
    """A non-numeric advance_seconds is rejected with 400 BEFORE the status flip, so the session is
    left cleanly awaiting_input with an empty inbox (retryable), not wedged."""
    rid = "bad-adv-rid"
    AGENT_SESSIONS.start(rid, minimal_plan_json, label="bad-adv")
    AGENT_SESSIONS.set_status(rid, "awaiting_input")
    TRANSPORTS[rid] = DiagnosticTransport(rid, AGENT_SESSIONS)

    with pytest.raises(HTTPException) as ei:
        asyncio.run(admin_mod.submit_agent_turn(rid, {"text": "x", "advance_seconds": "soon"}))
    assert ei.value.status_code == 400
    assert AGENT_SESSIONS.status_of(rid) == "awaiting_input"  # untouched
    assert TRANSPORTS[rid].inbox_empty() is True              # nothing enqueued
