from types import SimpleNamespace

from app.interviewer.agent import wire_session_events


class FakeSession:
    def __init__(self) -> None:
        self.handlers: dict[str, object] = {}

    def on(self, name: str):
        def register(fn):
            self.handlers[name] = fn
            return fn
        return register


def make_run(heard):
    return SimpleNamespace(on_user_transcript=lambda *a: heard.append(a), on_conversation_item=lambda *a: None,
                           on_agent_state=lambda *a: None, on_user_state=lambda *a: None)


def test_interim_and_final_speech_reaches_the_run_with_its_timestamp():
    heard: list[tuple] = []
    session = FakeSession()
    wire_session_events(session, make_run(heard))
    handler = session.handlers["user_input_transcribed"]
    handler(SimpleNamespace(transcript="so this loop", is_final=False, created_at=1234.5))
    handler(SimpleNamespace(transcript="so this loop is linear", is_final=True, created_at=1236.0))
    assert heard == [("so this loop", False, 1234.5), ("so this loop is linear", True, 1236.0)]


def test_the_session_does_not_answer_before_the_candidates_turn_is_complete():
    """LiveKit's default starts the reply from the interim transcript, before on_user_turn_completed has told the run
    what was said: the run would answer as if the candidate had said nothing and throw their activity digest away."""
    import asyncio

    from livekit.agents import AgentSession

    from app.interviewer.agent import TURN_HANDLING, PlaceholderLLM

    async def build():
        default = AgentSession(llm=PlaceholderLLM()).options.preemptive_generation["enabled"]
        ours = AgentSession(llm=PlaceholderLLM(), turn_handling=TURN_HANDLING).options.preemptive_generation["enabled"]
        return default, ours

    assert asyncio.run(build()) == (True, False)      # LiveKit's default is the trap; ours turns it off
