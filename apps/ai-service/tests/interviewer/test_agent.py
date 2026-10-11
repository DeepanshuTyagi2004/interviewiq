"""The interviewer agent holds its greeting until the round has started."""
import asyncio
from types import SimpleNamespace

import pytest
from livekit.agents import StopResponse

from app.interviewer.agent import InterviewerAgent


def _entering(begun: bool, in_room: bool):
    run = SimpleNamespace(begun=asyncio.Event(), candidate_in_room=asyncio.Event())
    if begun:
        run.begun.set()
    if in_room:
        run.candidate_in_room.set()
    asked: list[int] = []
    agent = SimpleNamespace(run=run, session=SimpleNamespace(generate_reply=lambda: asked.append(1)))
    return run, agent, asked


def test_the_greeting_waits_for_the_round_to_start():
    async def go():
        run, agent, asked = _entering(begun=False, in_room=True)
        entering = asyncio.create_task(InterviewerAgent.on_enter(agent))
        await asyncio.sleep(0.01)
        assert asked == [] and not entering.done()      # the interviewer is in the room, but the round has not started
        run.begun.set()
        await asyncio.wait_for(entering, 1)
        return asked

    assert asyncio.run(go()) == [1]


def test_the_greeting_waits_for_the_candidate_to_be_in_the_room_even_once_the_round_has_started():
    async def go():
        run, agent, asked = _entering(begun=True, in_room=False)
        entering = asyncio.create_task(InterviewerAgent.on_enter(agent))
        await asyncio.sleep(0.01)
        assert asked == [] and not entering.done()      # nobody to greet: the interviewer says nothing
        run.candidate_in_room.set()
        await asyncio.wait_for(entering, 1)
        return asked

    assert asyncio.run(go()) == [1]


def test_the_greeting_is_said_once_both_are_true_and_not_before_either():
    async def go():
        run, agent, asked = _entering(begun=False, in_room=False)
        entering = asyncio.create_task(InterviewerAgent.on_enter(agent))
        for event in (run.candidate_in_room, run.begun):
            await asyncio.sleep(0.01)
            assert asked == []
            event.set()
        await asyncio.wait_for(entering, 1)
        return asked

    assert asyncio.run(go()) == [1]


def test_a_candidate_turn_before_the_round_starts_is_not_answered_and_one_after_it_is():
    async def go():
        heard: list[str] = []
        run = SimpleNamespace(begun=asyncio.Event(), on_user_text=heard.append)
        agent = SimpleNamespace(run=run, _pending_user_text=None)
        message = SimpleNamespace(text_content="Hi, can you hear me?")
        with pytest.raises(StopResponse):          # the greeting that follows is the reply; no reply to an unstarted round
            await InterviewerAgent.on_user_turn_completed(agent, None, message)
        assert heard == [] and agent._pending_user_text is None
        run.begun.set()
        await InterviewerAgent.on_user_turn_completed(agent, None, message)
        return heard, agent._pending_user_text

    assert asyncio.run(go()) == (["Hi, can you hear me?"], "Hi, can you hear me?")
