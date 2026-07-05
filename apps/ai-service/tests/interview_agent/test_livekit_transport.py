import asyncio

from app.interview_agent.transport import LiveKitTransport
from app.interview_agent.types import ArtifactKind


class FakeRoom:
    """Minimal stand-in; the real room is injected only via the `send` callable + handle_incoming."""


def _make():
    sent: list[dict] = []
    async def send(payload: dict) -> None:
        sent.append(payload)
    t = LiveKitTransport(FakeRoom(), send=send)
    return t, sent


def test_say_emits_speaking_and_utterance():
    t, sent = _make()
    asyncio.run(t.say("hello there"))
    types = [m["type"] for m in sent]
    assert types == ["speaking", "interviewer_utterance", "speaking"]
    assert sent[0]["speaking"] is True and sent[2]["speaking"] is False
    assert sent[1]["text"] == "hello there"


def test_answer_message_becomes_next_utterance():
    t, sent = _make()
    async def scenario():
        await t.handle_incoming({"type": "answer", "text": "my answer", "tStart": 1.0, "tEnd": 4.0})
        return await t.next_utterance()
    item = asyncio.run(scenario())
    assert item is not None
    text, timing = item
    assert text == "my answer"
    assert timing.t_start == 1.0 and timing.t_end == 4.0


def test_artifact_snapshot_roundtrips():
    t, _ = _make()
    async def scenario():
        await t.handle_incoming({"type": "artifact", "kind": "code", "content": "def f(): pass", "language": "python"})
        return await t.current_artifact()
    art = asyncio.run(scenario())
    assert art is not None and art.kind == ArtifactKind.CODE
    assert art.content == "def f(): pass" and art.language == "python"


def test_proctor_pause_withholds_next_utterance_until_resume():
    t, sent = _make()
    async def scenario():
        await t.handle_incoming({"type": "proctor", "event": "fullscreen_exit"})
        # an answer arrives while paused; next_utterance must NOT return it yet
        await t.handle_incoming({"type": "answer", "text": "late", "tStart": 0.0, "tEnd": 1.0})
        try:
            await asyncio.wait_for(t.next_utterance(), timeout=0.2)
            returned_while_paused = True
        except asyncio.TimeoutError:
            returned_while_paused = False
        await t.handle_incoming({"type": "proctor", "event": "fullscreen_restored"})
        item = await asyncio.wait_for(t.next_utterance(), timeout=1.0)
        return returned_while_paused, item
    withheld, item = asyncio.run(scenario())
    assert withheld is False, "utterance must be withheld while paused"
    assert item is not None and item[0] == "late"
    kinds = [m["type"] for m in sent]
    assert "pause" in kinds and "acknowledge_violation" in kinds and "resume" in kinds


def test_end_session_emits_ended_with_reason():
    t, sent = _make()
    async def scenario():
        t.set_ended_reason("early_weak")
        await t.end_session()
    asyncio.run(scenario())
    ended = [m for m in sent if m["type"] == "ended"]
    assert ended and ended[0]["reason"] == "early_weak"


def test_answer_arriving_while_paused_is_withheld_until_resume():
    """The exact mid-wait race: next_utterance() is already parked (unpaused) inside the queue
    wait when a pause fires. Under the pre-fix code, an answer arriving after that point is
    enqueued unconditionally and immediately delivered to the already-parked call, bypassing the
    pause. The fix gates on the enqueue side, so the parked call must keep waiting until resume
    flushes the buffered answer through."""
    t, sent = _make()

    async def scenario():
        task = asyncio.ensure_future(t.next_utterance())
        await asyncio.sleep(0)  # let the task start and park on the (currently unpaused) queue
        await t.handle_incoming({"type": "proctor", "event": "fullscreen_exit"})
        await t.handle_incoming({"type": "answer", "text": "late", "tStart": 0.0, "tEnd": 1.0})
        timed_out = False
        try:
            await asyncio.wait_for(asyncio.shield(task), timeout=0.2)
        except asyncio.TimeoutError:
            timed_out = True
        await t.handle_incoming({"type": "proctor", "event": "fullscreen_restored"})
        item = await asyncio.wait_for(task, timeout=1.0)
        return timed_out, item

    timed_out, item = asyncio.run(scenario())
    assert timed_out is True, "answer received mid-wait during a pause must be withheld, not delivered"
    assert item is not None and item[0] == "late"
    kinds = [m["type"] for m in sent]
    assert "pause" in kinds and "resume" in kinds


def test_mark_disconnected_returns_none_promptly():
    t, _ = _make()

    async def scenario():
        t.mark_disconnected()
        return await asyncio.wait_for(t.next_utterance(), timeout=1.0)

    result = asyncio.run(scenario())
    assert result is None


def test_disconnect_while_paused_returns_none_promptly():
    """A candidate who disconnects mid-violation (paused, never resumes) must not hang the interview
    forever: next_utterance() is parked on the pause gate when mark_disconnected() fires, and it must
    return None promptly rather than waiting indefinitely for a resume that will never come."""
    t, sent = _make()

    async def scenario():
        await t.handle_incoming({"type": "proctor", "event": "fullscreen_exit"})
        task = asyncio.ensure_future(t.next_utterance())
        await asyncio.sleep(0)  # let the task start and park on the pause gate
        t.mark_disconnected()
        return await asyncio.wait_for(task, timeout=1.0)

    result = asyncio.run(scenario())
    assert result is None
    kinds = [m["type"] for m in sent]
    assert "pause" in kinds


def test_malformed_incoming_message_does_not_raise():
    t, _ = _make()

    async def scenario():
        await t.handle_incoming({"type": "artifact", "kind": "bogus"})
        await t.handle_incoming({"type": "answer"})
        await t.handle_incoming({"type": "answer", "text": "ok", "tStart": 0.0, "tEnd": 1.0})
        return await asyncio.wait_for(t.next_utterance(), timeout=1.0)

    item = asyncio.run(scenario())
    assert item is not None and item[0] == "ok"
