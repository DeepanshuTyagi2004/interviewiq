import asyncio
import json

from livekit import rtc

from app.config import get_settings
from app.interview_agent import worker
from app.interview_agent.types import EndedReason, SessionOutcome


def test_session_id_from_room_parses_prefix():
    assert worker.session_id_from_room("interview-abc-123") == "abc-123"
    assert worker.session_id_from_room("lobby") is None


class FakeParticipant:
    def __init__(self):
        self.published: list[dict] = []

    async def publish_data(self, data, *a, **k):
        self.published.append(json.loads(bytes(data).decode("utf-8")))

    async def publish_track(self, track, options, *a, **k):
        pass


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
    """Also covers Fix 1: the worker must publish the authoritative `ended` message itself, carrying
    the REAL outcome reason, AFTER post_outcome has run. The outcome below uses a non-natural reason
    (EARLY_WEAK) — under the old (pre-fix) code, LiveKitTransport.end_session() always emitted
    "natural_complete" regardless of the real outcome, so this assertion would fail under that
    behavior."""
    calls = {}
    plan = {"sessionId": "s-1", "roundType": "dsa", "questionLadders": [], "reserve": []}
    room = FakeRoom("interview-s-1")

    async def fake_get_plan(sid):
        calls["get_plan"] = sid
        return plan

    async def fake_run_session(transport, p, settings):
        calls["run_session"] = (type(transport).__name__, p)
        return SessionOutcome("s-1", EndedReason.EARLY_WEAK, 0.7, [], [], True, 0, [], 1200.0)

    async def fake_post_outcome(settings, outcome):
        calls["post_outcome"] = outcome.session_id
        # Snapshot what's been published so far — must be empty, i.e. post_outcome runs BEFORE
        # the authoritative "ended" message goes out (order: post_outcome then ended).
        calls["published_before_post_outcome"] = list(room.local_participant.published)
        return True

    monkeypatch.setattr(worker.repo, "get_plan", fake_get_plan)
    monkeypatch.setattr(worker, "run_session", fake_run_session)
    monkeypatch.setattr(worker, "post_outcome", fake_post_outcome)

    ctx = FakeCtx(room)
    outcome = asyncio.run(worker.run_interview(ctx, get_settings()))

    assert calls["get_plan"] == "s-1"
    assert calls["run_session"][0] == "LiveKitTransport"
    assert calls["run_session"][1] is plan
    assert calls["post_outcome"] == "s-1"
    assert outcome is not None and outcome.session_id == "s-1"

    assert calls["published_before_post_outcome"] == []
    assert {"type": "ended", "reason": "early_weak"} in room.local_participant.published


def test_wire_data_received_registers_disconnect_handler():
    """Fix 2: the disconnect wiring was dead in production before this fix — nothing registered a
    handler for the room's disconnect events, so mark_disconnected() was only ever reachable from
    tests. Verify _wire_data_received actually registers one (or both, wired defensively) of
    "participant_disconnected" / "disconnected" and that invoking it flips the transport's
    disconnected flag."""
    room = FakeRoom("interview-s-1")

    async def send(payload):
        pass

    transport = worker.LiveKitTransport(room, send=send)

    worker._wire_data_received(room, transport)

    disconnect_handlers = [
        room._handlers[event]
        for event in ("participant_disconnected", "disconnected")
        if event in room._handlers
    ]
    assert disconnect_handlers, "expected a disconnect handler to be registered"
    assert not transport._disconnected.is_set()

    for handler in disconnect_handlers:
        handler()  # simulate the event firing (candidate leaves / room tears down)

    assert transport._disconnected.is_set()


class FakeTrack:
    def __init__(self, kind):
        self.kind = kind


def test_run_interview_wires_tts_speak_and_stt_pump_on_track_subscribed(monkeypatch):
    """Task 4: run_interview must (a) publish agent audio + inject the resulting `speak` hook into the
    transport handed to run_session, and (b) register a track_subscribed handler that starts
    voice.pump_stt for the candidate's audio track."""
    calls = {}
    plan = {"sessionId": "s-1", "roundType": "dsa", "questionLadders": [], "reserve": []}
    room = FakeRoom("interview-s-1")

    class FakeSTT:
        pass

    class FakeTTS:
        pass

    class FakeDeepgram:
        def STT(self, **kwargs):
            calls["stt_kwargs"] = kwargs
            return FakeSTT()

        def TTS(self, **kwargs):
            calls["tts_kwargs"] = kwargs
            return FakeTTS()

    fake_deepgram = FakeDeepgram()
    fake_source = object()

    async def fake_speak(text):
        pass

    async def fake_publish_agent_audio(room_arg, tts_arg):
        calls["publish_agent_audio"] = (room_arg, tts_arg)
        return fake_source, fake_speak

    async def fake_pump_stt(track, transport, stt):
        calls["pump_stt"] = (track, transport, stt)

    async def fake_get_plan(sid):
        return plan

    async def fake_run_session(transport, p, settings):
        calls["run_session_transport"] = transport
        return SessionOutcome("s-1", EndedReason.EARLY_WEAK, 0.7, [], [], True, 0, [], 1200.0)

    async def fake_post_outcome(settings, outcome):
        return True

    monkeypatch.setattr(worker, "deepgram", fake_deepgram)
    monkeypatch.setattr(worker.voice, "publish_agent_audio", fake_publish_agent_audio)
    monkeypatch.setattr(worker.voice, "pump_stt", fake_pump_stt)
    monkeypatch.setattr(worker.repo, "get_plan", fake_get_plan)
    monkeypatch.setattr(worker, "run_session", fake_run_session)
    monkeypatch.setattr(worker, "post_outcome", fake_post_outcome)

    ctx = FakeCtx(room)
    outcome = asyncio.run(worker.run_interview(ctx, get_settings()))

    assert outcome is not None
    assert "publish_agent_audio" in calls

    transport = calls["run_session_transport"]
    assert transport.__class__.__name__ == "LiveKitTransport"
    assert transport._speak is not None

    assert "track_subscribed" in room._handlers
    handler = room._handlers["track_subscribed"]
    fake_track = FakeTrack(rtc.TrackKind.KIND_AUDIO)

    async def fire_and_wait():
        handler(fake_track)  # schedules asyncio.create_task(...) — needs a running loop
        await asyncio.sleep(0)

    asyncio.run(fire_and_wait())

    assert "pump_stt" in calls
    pumped_track, pumped_transport, pumped_stt = calls["pump_stt"]
    assert pumped_track is fake_track
    assert pumped_transport is transport
    assert isinstance(pumped_stt, FakeSTT)


def test_run_interview_aborts_cleanly_when_no_plan(monkeypatch):
    async def no_plan(sid): return None
    async def fake_run_session(*a, **k): raise AssertionError("must not run the brain without a plan")
    monkeypatch.setattr(worker.repo, "get_plan", no_plan)
    monkeypatch.setattr(worker, "run_session", fake_run_session)

    ctx = FakeCtx(FakeRoom("interview-missing"))
    outcome = asyncio.run(worker.run_interview(ctx, get_settings()))
    assert outcome is None
