import asyncio
from app.interview_agent.transport import LiveKitTransport
from app.interview_agent.types import UtteranceTiming


class FakeRoom: ...


def _make(speak=None):
    sent = []
    async def send(p): sent.append(p)
    return LiveKitTransport(FakeRoom(), send=send, speak=speak), sent


def test_push_utterance_enqueues_and_next_utterance_returns_it():
    t, _ = _make()
    async def scenario():
        t.push_utterance("spoken answer", UtteranceTiming(1.0, 4.0, 0.5))
        return await t.next_utterance()
    text, timing = asyncio.run(scenario())
    assert text == "spoken answer"
    assert timing.time_to_first_word_s == 0.5


def test_push_utterance_withheld_while_paused_then_flushed_on_resume():
    t, _ = _make()
    async def scenario():
        await t.handle_incoming({"type": "proctor", "event": "fullscreen_exit"})   # pause
        t.push_utterance("during pause", UtteranceTiming(0.0, 1.0, 0.0))
        try:
            await asyncio.wait_for(t.next_utterance(), timeout=0.2)
            got_while_paused = True
        except asyncio.TimeoutError:
            got_while_paused = False
        await t.handle_incoming({"type": "proctor", "event": "fullscreen_restored"})  # resume flushes
        item = await asyncio.wait_for(t.next_utterance(), timeout=1.0)
        return got_while_paused, item
    withheld, item = asyncio.run(scenario())
    assert withheld is False
    assert item[0] == "during pause"


def test_say_invokes_speak_hook_and_still_emits_three_messages():
    spoken = []
    async def speak(text): spoken.append(text)
    t, sent = _make(speak=speak)
    asyncio.run(t.say("please introduce yourself"))
    assert [m["type"] for m in sent] == ["speaking", "interviewer_utterance", "speaking"]
    assert spoken == ["please introduce yourself"]


def test_say_without_speak_hook_still_works():
    t, sent = _make(speak=None)
    asyncio.run(t.say("no audio"))
    assert [m["type"] for m in sent] == ["speaking", "interviewer_utterance", "speaking"]


def test_send_candidate_utterance_emits_expected_message():
    t, sent = _make()
    asyncio.run(t.send_candidate_utterance("my answer"))
    assert sent == [{"type": "candidate_utterance", "text": "my answer"}]
