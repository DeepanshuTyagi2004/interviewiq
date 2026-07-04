import asyncio

from app.interview_agent.transport import ScriptedTransport
from app.interview_agent.types import UtteranceTiming


def test_scripted_transport_replays_then_ends():
    t = ScriptedTransport(script=[("hello", UtteranceTiming(0, 2, 0.5)), ("world", UtteranceTiming(2, 4, 0.5))])

    async def go():
        assert (await t.next_utterance())[0] == "hello"
        assert (await t.next_utterance())[0] == "world"
        assert await t.next_utterance() is None      # exhausted → silence/disconnect
        await t.say("bye")
        await t.end_session()

    asyncio.run(go())
    assert t.said == ["bye"]
    assert t.ended is True
