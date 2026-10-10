"""The thin LiveKit adapter (spec §3): LiveKit Agents runs speech-to-text, turn-taking, interruptions,
the voice and transcription; InterviewerAgent.llm_node streams InterviewRun.reply() into it, so the
interviewer's own tool handling never costs a second LLM round trip."""
from __future__ import annotations

from typing import Any, AsyncIterable

from livekit.agents import Agent, AgentSession, JobContext, llm

from app.interviewer.run import InterviewRun


# LiveKit starts the reply from the interim transcript, before `on_user_turn_completed` runs. This agent needs that hook
# first (it is how the run learns what the candidate said, takes their turn and builds the activity digest), so a reply
# started early would answer as if the candidate had said nothing. No preemptive generation.
# Candidates think aloud and pause mid-sentence; LiveKit's default 0.5 s of silence ended their turn in the middle of a thought
# (a live round heard "...and most of the" as a finished answer and replied). A second of silence is still quick for a reply.
TURN_HANDLING: dict[str, Any] = {"preemptive_generation": {"enabled": False},
                                 "endpointing": {"mode": "fixed", "min_delay": 1.0, "max_delay": 4.0}}


class PlaceholderLLM(llm.LLM):
    """The voice pipeline needs an LLM object to schedule replies; InterviewerAgent.llm_node does the work."""

    def chat(self, **kwargs: Any) -> llm.LLMStream:
        raise RuntimeError("InterviewerAgent.llm_node generates every reply; this LLM is never called")


class InterviewerAgent(Agent):
    def __init__(self, run: InterviewRun) -> None:
        super().__init__(instructions="The interviewer's instructions are assembled per turn by InterviewRun.")
        self.run = run
        self._pending_user_text: str | None = None

    async def on_enter(self) -> None:
        self.session.generate_reply()  # the opening turn: the run's greeting

    async def on_user_turn_completed(self, turn_ctx: llm.ChatContext, new_message: llm.ChatMessage) -> None:
        text = new_message.text_content or ""
        self._pending_user_text = text
        self.run.on_user_text(text)

    async def llm_node(self, chat_ctx: llm.ChatContext, tools: list[llm.Tool], model_settings) -> AsyncIterable[str]:
        text, self._pending_user_text = self._pending_user_text, None
        async for sentence in self.run.reply(text):
            yield sentence + " "


class LiveKitSpeaker:
    def __init__(self, session: AgentSession, ctx: JobContext) -> None:
        self.session = session
        self.ctx = ctx

    def reply(self) -> None:
        self.session.generate_reply()

    async def say(self, text: str) -> None:
        await self.session.say(text, allow_interruptions=False).wait_for_playout()

    async def wait_for_playout(self) -> None:
        handle = self.session.current_speech
        if handle is not None:
            await handle.wait_for_playout()

    async def delete_room(self) -> None:
        await self.ctx.delete_room()


def wire_session_events(session: AgentSession, run: InterviewRun) -> None:
    @session.on("conversation_item_added")
    def _item(ev) -> None:
        item = ev.item
        role = getattr(item, "role", None)
        if role == "assistant":
            run.on_conversation_item("assistant", item.text_content or "", bool(getattr(item, "interrupted", False)))

    @session.on("agent_state_changed")
    def _agent(ev) -> None:
        run.on_agent_state(str(ev.new_state))

    @session.on("user_state_changed")
    def _user(ev) -> None:
        run.on_user_state(str(ev.new_state))

    @session.on("user_input_transcribed")
    def _heard(ev) -> None:
        run.on_user_transcript(ev.transcript, bool(ev.is_final), float(ev.created_at))
