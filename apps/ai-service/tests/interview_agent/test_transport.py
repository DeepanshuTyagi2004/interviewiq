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


def test_scripted_transport_allows_explicit_none_entries_mid_script():
    """Task 7: a `None` entry models a mid-interview silence window without ending the script — a
    real utterance can still follow it."""
    t = ScriptedTransport(script=[None, ("hello", UtteranceTiming(0, 2, 0.5))])

    async def go():
        assert await t.next_utterance() is None
        assert (await t.next_utterance())[0] == "hello"
        assert await t.next_utterance() is None   # now genuinely exhausted

    asyncio.run(go())


def test_scripted_transport_seconds_since_activity_default_is_idle():
    t = ScriptedTransport(script=[])
    assert t.seconds_since_activity() == 999.0


def test_scripted_transport_seconds_since_activity_constant_form():
    t = ScriptedTransport(script=[], activity=5.0)
    assert t.seconds_since_activity() == 5.0
    assert t.seconds_since_activity() == 5.0   # constant — every call returns the same value


def test_scripted_transport_seconds_since_activity_list_form_repeats_last():
    t = ScriptedTransport(script=[], activity=[1.0, 2.0, 3.0])
    assert t.seconds_since_activity() == 1.0
    assert t.seconds_since_activity() == 2.0
    assert t.seconds_since_activity() == 3.0
    assert t.seconds_since_activity() == 3.0   # exhausted — last value repeats
    assert t.seconds_since_activity() == 3.0
