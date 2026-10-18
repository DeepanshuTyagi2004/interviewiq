"""The thin LiveKit adapter (spec §3): LiveKit Agents runs speech-to-text, turn-taking, interruptions,
the voice and transcription; InterviewerAgent.llm_node streams InterviewRun.reply() into it, so the
interviewer's own tool handling never costs a second LLM round trip."""
from __future__ import annotations

import logging
from typing import Any, AsyncIterable

from livekit.agents import Agent, AgentSession, JobContext, StopResponse, inference, llm

from app.interviewer.run import InterviewRun

logger = logging.getLogger(__name__)


# LiveKit starts the reply from the interim transcript, before `on_user_turn_completed` runs. This agent needs that hook
# first (it is how the run learns what the candidate said, takes their turn and builds the activity digest), so a reply
# started early would answer as if the candidate had said nothing. No preemptive generation.
# What decides "the candidate has finished" (livekit-agents 1.8.7, checked in the installed source and on a built session, 2026-10-18):
# the session already has LiveKit's built-in Silero VAD and a streaming turn detector (`inference.TurnDetector`, the small local
# "turn-detector-v1-mini" model shipped inside livekit-local-inference, no separate plugin or download; `livekit dev` mode asks the
# LiveKit Inference gateway for the larger v1 and falls back to the local one). It reads the candidate's audio and, once speech stops,
# scores whether the turn is over. The turn then commits after `min_delay` of silence when it sounds finished, and after `max_delay`
# when it does not (probability below the "unlikely" threshold: the server's default was 0.56 in a live round, which read short
# finished replies as unfinished, so INTERVIEWER_EOT_UNLIKELY_THRESHOLD sets it to 0.3, decided 2026-10-18). An earlier note here
# claimed there was no detector and a flat 1.0 s wait; that was wrong, the 1.0 s was the "finished" wait of a detector that was running.
# So the short wait is the knob that decides how soon the reply starts: INTERVIEWER_ENDPOINTING_MIN_DELAY_SECONDS (0.5 s).
# Candidates think aloud and pause mid-sentence; a bare 0.5 s of silence ended their turn in the middle of a thought (a live round
# heard "...and most of the" as a finished answer and replied), which is why the short wait was 1.0 s; the detector is what is now
# trusted to hold those mid-sentence pauses. If cut-offs return, raise the setting (1.0 is the old value) or turn the detector off.
# The long wait is 3 s (decided 2026-10-18): at 6 s a short, finished question the detector misread ("Can we change it?") waited the
# whole ceiling, 8 s from their last word to the reply. It was 6 s because a slow, pausy speaker had five replies thrown away in one
# round when a 4 s ceiling ended their turn mid-sentence ("...didn't provide us granular" / "control over..."): if those cut-offs
# return, raise ENDPOINTING_MAX_DELAY_S.
# Fixed, not "dynamic": dynamic learned the candidate's thinking silences (after a turn the interviewer let pass, while coding)
# as pauses inside a sentence and raised the short wait to the ceiling, so every later reply came a whole ceiling after they stopped.
# TURN_HANDLING is the old baseline (default detector, 1.0 s / 6 s); `build_turn_handling` is what the worker runs.
ENDPOINTING_MAX_DELAY_S = 3.0
TURN_HANDLING: dict[str, Any] = {"preemptive_generation": {"enabled": False},
                                 "endpointing": {"mode": "fixed", "min_delay": 1.0, "max_delay": 6.0}}


def build_turn_handling(settings: Any) -> dict[str, Any]:
    """The turn handling for a session: the turn detector with the configured short wait, or, when INTERVIEWER_TURN_DETECTOR is off or
    the detector cannot be built, no detector and a flat 1.0 s wait after the speech-to-text's end of speech. Never raises: a round
    must not fail to start over turn-taking."""
    fallback = {"preemptive_generation": {"enabled": False}, "turn_detection": "stt",
                "endpointing": {"mode": "fixed", "min_delay": 1.0, "max_delay": ENDPOINTING_MAX_DELAY_S}}
    if not getattr(settings, "interviewer_turn_detector", True):
        logger.warning("INTERVIEWER_TURN_DETECTOR is off: replies start a flat 1.0 s after the speech-to-text's end of speech")
        return fallback
    try:
        threshold = float(getattr(settings, "interviewer_eot_unlikely_threshold", 0.0) or 0.0)
        # LiveKit logs a warning that the server's default is calibrated: lowered on purpose, see the setting.
        detector = inference.TurnDetector(unlikely_threshold=threshold) if threshold > 0 else inference.TurnDetector()
    except Exception as exc:  # noqa: BLE001 - a missing model or native library must not break a round
        logger.warning("the turn detector could not be loaded (%s); replies start a flat 1.0 s after the end of speech", exc)
        return fallback
    min_delay = float(getattr(settings, "interviewer_endpointing_min_delay_seconds", 0.5))
    return {"preemptive_generation": {"enabled": False}, "turn_detection": detector,
            "endpointing": {"mode": "fixed", "min_delay": min_delay, "max_delay": ENDPOINTING_MAX_DELAY_S}}


def turn_latency_line(user: dict[str, Any] | None, reply: dict[str, Any]) -> str | None:
    """One log line for a reply, from LiveKit's own per-turn metrics (seconds, as ChatMessage.metrics carries them): what the pipeline spent
    between the candidate's last word and the first audio. None when the reply never started playing (interrupted before any audio).
    end-of-speech -> first audio (e2e) is the delay the candidate feels; the stages before the model are endpointing (end_of_turn),
    the final transcript (stt_final) and our own turn bookkeeping (turn_hook); then first_text is the model's first sentence leaving
    run.reply, to_tts the first sentence reaching the voice and tts_ttfb the voice's first audio after that."""
    if "e2e_latency" not in reply and "tts_node_ttfb" not in reply:
        return None
    user = user or {}
    stages = (("endpointing", user.get("end_of_turn_delay")), ("stt_final", user.get("transcription_delay")),
              ("turn_hook", user.get("on_user_turn_completed_delay")), ("first_text", reply.get("llm_node_ttft")),
              ("to_tts", reply.get("llm_node_ttfs")), ("tts_ttfb", reply.get("tts_node_ttfb")), ("e2e", reply.get("e2e_latency")))
    parts = [f"{name} {int(value * 1000)} ms" for name, value in stages if isinstance(value, (int, float)) and value >= 0]
    p, threshold = user.get("eot_probability"), user.get("eot_threshold")
    if isinstance(p, (int, float)) and isinstance(threshold, (int, float)):
        parts.append(f"eot {p:.2f} ({'finished' if p >= threshold else 'unfinished'} at {threshold:.2f})")
    return "reply latency: " + ", ".join(parts) if parts else None


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
        # The interviewer may be in the room long before the candidate: it greets only once the round has started (their browser said
        # hello) and they are in the room, so it never speaks to an empty room.
        await self.run.begun.wait()
        await self.run.candidate_in_room.wait()
        self.session.generate_reply()  # the opening turn: the run's greeting

    async def on_user_turn_completed(self, turn_ctx: llm.ChatContext, new_message: llm.ChatMessage) -> None:
        if not self.run.begun.is_set():
            # The interviewer listens from the moment it is in the room, but the round starts with the browser's hello. A turn that
            # completes before that must not be answered as if the round were running: the greeting that follows is the reply.
            raise StopResponse()
        text = new_message.text_content or ""
        self._pending_user_text = text
        self.run.on_user_text(text)
        if self.run.skip_reply(text):
            # "Okay." after "give it a read" asks for nothing: a real interviewer lets them get on with it. The turn is recorded;
            # the reply is not generated.
            self._pending_user_text = None
            raise StopResponse()

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

    def backchannel(self, text: str) -> None:
        """"Mm-hmm." while the candidate is mid-thought: not waited on, cut off the moment they go on, and never added to the
        conversation (no conversation_item_added, so the run never records it as a turn)."""
        self.session.say(text, allow_interruptions=True, add_to_chat_ctx=False)

    async def wait_for_playout(self) -> None:
        handle = self.session.current_speech
        if handle is not None:
            await handle.wait_for_playout()

    async def delete_room(self) -> None:
        await self.ctx.delete_room()


EOT_LISTENER = "_iq_eot_listener"


def watch_turn_detector() -> bool:
    """Let a session hear the turn detector's end-of-turn scores. livekit-agents 1.8.7 reports each new score (probability, the
    "unlikely" threshold) only to a private hook on AgentActivity and a DEBUG log line; there is no public session event yet, and
    switching LiveKit's logger to DEBUG would flood the worker's output. So the hook is wrapped once, and the score goes to the
    listener its session carries (`wire_session_events` sets it). Without the scores a short finished turn waiting the whole
    ENDPOINTING_MAX_DELAY_S cannot be explained (2026-10-18: seven of twelve replies in one round waited the 3 s ceiling).
    Returns False, and changes nothing, when the hook is not where it was."""
    try:
        from livekit.agents.voice.agent_activity import AgentActivity
        original = AgentActivity.on_eot_prediction
    except Exception:  # noqa: BLE001 - another livekit version: no scores, nothing else changes
        return False
    if getattr(original, "_iq_wrapped", False):
        return True

    def on_eot_prediction(self, ev) -> None:
        try:
            listener = getattr(getattr(self, "_session", None), EOT_LISTENER, None)
            if listener is not None:
                listener(float(ev.probability), float(ev.threshold))
        except Exception:  # noqa: BLE001 - a score must never cost the candidate their turn
            logger.debug("could not record the turn detector's score", exc_info=True)
        original(self, ev)

    on_eot_prediction._iq_wrapped = True  # type: ignore[attr-defined]
    AgentActivity.on_eot_prediction = on_eot_prediction  # type: ignore[method-assign]
    return True


def wire_session_events(session: AgentSession, run: InterviewRun) -> None:
    last_user_metrics: dict[str, Any] = {}
    last_eot: dict[str, float] = {}

    def _eot(probability: float, threshold: float) -> None:
        # Each pause gets a score; the last one before the turn commits is the one that chose the short or the long wait.
        last_eot.update(eot_probability=probability, eot_threshold=threshold)

    try:
        setattr(session, EOT_LISTENER, _eot)
    except Exception:  # noqa: BLE001 - a session that takes no attributes just has no scores
        pass

    @session.on("conversation_item_added")
    def _item(ev) -> None:
        item = ev.item
        role = getattr(item, "role", None)
        if role == "user":
            last_user_metrics.clear()
            last_user_metrics.update(getattr(item, "metrics", None) or {})
            last_user_metrics.update(last_eot)
            last_eot.clear()
        if role == "assistant":
            try:
                line = turn_latency_line(dict(last_user_metrics), dict(getattr(item, "metrics", None) or {}))
                if line:
                    logger.info(line)
            except Exception:  # noqa: BLE001 - a log line must never cost the candidate their reply
                logger.debug("could not format the reply latency", exc_info=True)
            timings = {**last_user_metrics, **(getattr(item, "metrics", None) or {})}      # stored on the turn (run.turn_timings)
            last_user_metrics.clear()
            run.on_conversation_item("assistant", item.text_content or "", bool(getattr(item, "interrupted", False)), timings)

    @session.on("agent_state_changed")
    def _agent(ev) -> None:
        run.on_agent_state(str(ev.new_state))

    @session.on("user_state_changed")
    def _user(ev) -> None:
        run.on_user_state(str(ev.new_state))

    @session.on("user_input_transcribed")
    def _heard(ev) -> None:
        run.on_user_transcript(ev.transcript, bool(ev.is_final), float(ev.created_at))
