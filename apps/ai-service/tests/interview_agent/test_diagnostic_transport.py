import asyncio

import pytest

from app.jobs.agent_sessions import AgentSessionStore
from app.interview_agent.diagnostic_transport import (
    DiagnosticTransport, DiagnosticSessionAborted,
)


def test_turn_advances_clock_and_returns_timing():
    store = AgentSessionStore(); store.start("r", {}, label="x")
    t = DiagnosticTransport("r", store)

    async def scenario():
        t.submit_turn("hello", artifact=None, advance_seconds=60.0)
        text, timing = await t.next_utterance()
        assert text == "hello"
        assert timing.t_start == 0.0 and timing.t_end == 60.0
        t.submit_turn("again", artifact=None, advance_seconds=30.0)
        _, timing2 = await t.next_utterance()
        assert timing2.t_start == 60.0 and timing2.t_end == 90.0  # accumulates

    asyncio.run(scenario())


def test_silence_returns_none_and_raises_activity():
    store = AgentSessionStore(); store.start("r", {}, label="x")
    t = DiagnosticTransport("r", store)

    async def scenario():
        t.submit_silence(advance_seconds=50.0)
        got = await t.next_utterance()
        assert got is None
        assert t.seconds_since_activity() >= 45.0

    asyncio.run(scenario())


def test_sticky_artifact_retained_until_replaced():
    store = AgentSessionStore(); store.start("r", {}, label="x")
    t = DiagnosticTransport("r", store)

    async def scenario():
        t.submit_turn("a", artifact={"kind": "code", "content": "x=1"}, advance_seconds=10)
        await t.next_utterance()
        art = await t.current_artifact()
        assert art is not None and art.content == "x=1"
        t.submit_turn("b", artifact=None, advance_seconds=10)   # no new artifact
        await t.next_utterance()
        art2 = await t.current_artifact()
        assert art2 is not None and art2.content == "x=1"       # retained (sticky)

    asyncio.run(scenario())


def test_end_sentinel_raises_aborted():
    store = AgentSessionStore(); store.start("r", {}, label="x")
    t = DiagnosticTransport("r", store)

    async def scenario():
        t.submit_end()
        with pytest.raises(DiagnosticSessionAborted):
            await t.next_utterance()

    asyncio.run(scenario())


def test_say_appends_transcript_and_status_flip():
    store = AgentSessionStore(); store.start("r", {}, label="x")
    t = DiagnosticTransport("r", store)

    async def scenario():
        await t.say("welcome")
        assert store.snapshot("r", 0)["transcript"][-1] == {"speaker": "interviewer", "text": "welcome"}
        # next_utterance sets awaiting_input while blocked
        fut = asyncio.ensure_future(t.next_utterance())
        await asyncio.sleep(0.01)
        assert store.status_of("r") == "awaiting_input"
        t.submit_turn("hi", None, 10); await fut
        assert store.status_of("r") == "running"

    asyncio.run(scenario())
