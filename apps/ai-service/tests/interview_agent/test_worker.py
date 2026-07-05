import asyncio

from app.config import get_settings
from app.interview_agent import worker
from app.interview_agent.types import EndedReason, SessionOutcome


def test_session_id_from_room_parses_prefix():
    assert worker.session_id_from_room("interview-abc-123") == "abc-123"
    assert worker.session_id_from_room("lobby") is None


class FakeParticipant:
    async def publish_data(self, *a, **k): pass


class FakeRoom:
    def __init__(self, name):
        self.name = name
        self.local_participant = FakeParticipant()
        self._handlers = {}
    def on(self, event):
        def deco(fn): self._handlers[event] = fn; return fn
        return deco


class FakeCtx:
    def __init__(self, room):
        self.room = room
    async def connect(self, *a, **k): pass


def test_run_interview_loads_plan_runs_brain_and_posts_outcome(monkeypatch):
    calls = {}
    plan = {"sessionId": "s-1", "roundType": "dsa", "questionLadders": [], "reserve": []}

    async def fake_get_plan(sid):
        calls["get_plan"] = sid
        return plan

    async def fake_run_session(transport, p, settings):
        calls["run_session"] = (type(transport).__name__, p)
        return SessionOutcome("s-1", EndedReason.NATURAL_COMPLETE, 0.7, [], [], True, 0, [], 1200.0)

    async def fake_post_outcome(settings, outcome):
        calls["post_outcome"] = outcome.session_id
        return True

    monkeypatch.setattr(worker.repo, "get_plan", fake_get_plan)
    monkeypatch.setattr(worker, "run_session", fake_run_session)
    monkeypatch.setattr(worker, "post_outcome", fake_post_outcome)

    ctx = FakeCtx(FakeRoom("interview-s-1"))
    outcome = asyncio.run(worker.run_interview(ctx, get_settings()))

    assert calls["get_plan"] == "s-1"
    assert calls["run_session"][0] == "LiveKitTransport"
    assert calls["run_session"][1] is plan
    assert calls["post_outcome"] == "s-1"
    assert outcome is not None and outcome.session_id == "s-1"


def test_run_interview_aborts_cleanly_when_no_plan(monkeypatch):
    async def no_plan(sid): return None
    async def fake_run_session(*a, **k): raise AssertionError("must not run the brain without a plan")
    monkeypatch.setattr(worker.repo, "get_plan", no_plan)
    monkeypatch.setattr(worker, "run_session", fake_run_session)

    ctx = FakeCtx(FakeRoom("interview-missing"))
    outcome = asyncio.run(worker.run_interview(ctx, get_settings()))
    assert outcome is None
