"""LiveKit Agents worker hosting the interview brain over a real room (sub-project A: data-channel text)."""
from __future__ import annotations

import asyncio
import json
import logging
from typing import TYPE_CHECKING

from livekit import rtc
from livekit.agents import AutoSubscribe
from livekit.plugins import deepgram

from app.config import Settings, get_settings
from app.db import mongo
from app.db import repositories as repo
from app.interview_agent import llm_ops, voice
from app.interview_agent.outcome_sink import post_outcome
from app.interview_agent.session import run_session
from app.interview_agent.transport import LiveKitTransport
from app.llm.client import LLMError, build_llm_client

if TYPE_CHECKING:
    from app.interview_agent.types import SessionOutcome

logger = logging.getLogger(__name__)

ROOM_PREFIX = "interview-"


def session_id_from_room(name: str | None) -> str | None:
    if not name or not name.startswith(ROOM_PREFIX):
        return None
    sid = name[len(ROOM_PREFIX):]
    return sid or None


async def run_interview(ctx, settings: Settings) -> SessionOutcome | None:
    """Testable core: sessionId -> plan -> brain over LiveKitTransport -> post outcome. Returns the outcome or None."""
    session_id = session_id_from_room(ctx.room.name)
    if session_id is None:
        logger.warning("Room %r is not an interview room — ignoring", ctx.room.name)
        return None
    plan = await repo.get_plan(session_id)
    if plan is None:
        logger.warning("No InterviewPlan for session %s — aborting", session_id)
        return None

    async def send(payload: dict) -> None:
        await ctx.room.local_participant.publish_data(json.dumps(payload).encode("utf-8"))

    persona = plan.get("persona") or {}

    async def _infer_gender(name: str) -> str | None:
        # Only reached when persona.gender is absent/unknown AND a name exists — new plans (Task 4)
        # usually carry gender directly, but a freshly-generated persona can still have a name with no
        # recognized gender, so this client CAN be built even for new plans. Short-circuit on an empty
        # name so we don't pay for a client + LLM call with nothing to classify.
        if not (name or "").strip():
            return None
        infer_llm = build_llm_client(settings, model=settings.interview_scorer_model or None)
        try:
            return await llm_ops.infer_gender(name, infer_llm, settings)
        except LLMError as exc:
            # Cosmetic path (persona voice only) — never let a transient LLM failure abort session
            # start. select_voice falls back to DEFAULT_VOICE when this returns None.
            logger.warning("[iv] gender inference failed (%s) — using default voice", exc)
            return None
        finally:
            await infer_llm.aclose()

    voice_model = await voice.select_voice(persona, infer=_infer_gender)
    tts = deepgram.TTS(model=voice_model, api_key=settings.deepgram_api_key)
    _source, speak = await voice.publish_agent_audio(ctx.room, tts)
    transport = LiveKitTransport(ctx.room, send=send, speak=speak)

    # wire inbound data-channel messages to the transport (real room only; fake room in tests skips this)
    _wire_data_received(ctx.room, transport)

    stt = deepgram.STT(model="nova-3", language="en", api_key=settings.deepgram_api_key)
    _pump_tasks: set[asyncio.Task] = set()
    _pumped: set[str] = set()

    def _start_pump(track) -> None:
        if getattr(track, "kind", None) != rtc.TrackKind.KIND_AUDIO:
            return
        sid = getattr(track, "sid", None) or str(id(track))
        if sid in _pumped:
            return  # already pumping this track (caught by both the scan and the event)
        _pumped.add(sid)
        task = asyncio.create_task(voice.pump_stt(track, transport, stt))
        _pump_tasks.add(task)
        task.add_done_callback(_pump_tasks.discard)

    on = getattr(ctx.room, "on", None)
    if on is not None:
        @on("track_subscribed")
        def _on_track(track, *_args, **_kwargs):
            _start_pump(track)

    # The candidate's mic is usually ALREADY subscribed by the time we reach here — the worker joins
    # a room where the candidate has already published, so `track_subscribed` fired during
    # `ctx.connect()` / the `await`s above, before the handler existed, and was missed. Without this
    # scan, STT never starts and the brain only ever hears silence ("sorry, I didn't catch that").
    for participant in getattr(ctx.room, "remote_participants", {}).values():
        for pub in getattr(participant, "track_publications", {}).values():
            track = getattr(pub, "track", None)
            if track is not None:
                _start_pump(track)

    outcome = await run_session(transport, plan, settings)
    if outcome is not None:
        # run_session's `finally` already called transport.end_session() (teardown-only, see
        # transport.LiveKitTransport) BEFORE returning here, so it never knew the real end reason.
        # This worker owns the authoritative `ended` message — post the outcome first, then tell the
        # client the real reason.
        await post_outcome(settings, outcome)
        await send({"type": "ended", "reason": outcome.ended_reason.value})
    return outcome


def _wire_data_received(room, transport: LiveKitTransport) -> None:
    """Register the room's data_received handler → transport.handle_incoming, plus the disconnect
    signal(s) that unblock a transport parked on the pause gate or the answer queue. Verified against
    livekit-rtc 1.6.x (installed package + context7 /livekit/python-sdks docs): Room.on(event) is an
    EventEmitter-style decorator (callback=None -> returns a decorator); "data_received" delivers a
    `DataPacket` with a `.data: bytes` field; "participant_disconnected" fires when a remote
    participant (the candidate) leaves the room; "disconnected" fires when the room itself tears down.
    Either can be how the candidate goes away, so both are wired defensively to mark_disconnected."""
    on = getattr(room, "on", None)
    if on is None:
        return

    background_tasks: set[asyncio.Task] = set()

    @on("data_received")
    def _on_data(data_packet):  # DataPacket(data: bytes, kind, participant, topic) — livekit-rtc 1.6.x
        try:
            payload = json.loads(bytes(data_packet.data).decode("utf-8"))
        except Exception:  # noqa: BLE001
            return
        # Keep a handle so the task isn't GC'd mid-flight; drop it from the set once it's done.
        task = asyncio.create_task(transport.handle_incoming(payload))
        background_tasks.add(task)
        task.add_done_callback(background_tasks.discard)

    def _on_disconnect(*_args, **_kwargs) -> None:
        transport.mark_disconnected()

    for event in ("participant_disconnected", "disconnected"):
        try:
            on(event)(_on_disconnect)
        except Exception:  # noqa: BLE001 - defensive; a room lacking these events must not break wiring
            logger.debug("could not register %r handler on room", event)


async def entrypoint(ctx) -> None:
    """LiveKit Agents entrypoint. Automatic dispatch: this worker joins every room; non-interview
    rooms are rejected here, before paying any Mongo connect/index cost (run_interview would reject
    them too, but only after that connect)."""
    if session_id_from_room(ctx.room.name) is None:
        logger.warning("Room %r is not an interview room — ignoring", ctx.room.name)
        return
    settings = get_settings()
    await mongo.connect(settings)
    try:
        await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)
        await run_interview(ctx, settings)
    finally:
        await mongo.close()


def build_worker_options(settings: Settings):
    """WorkerOptions wired with our LiveKit creds. LiveKit Agents otherwise reads
    LIVEKIT_URL/API_KEY/API_SECRET from os.environ — but our creds live in `.env` (loaded by
    pydantic Settings, NOT exported to the process env), so we pass them explicitly here."""
    from livekit.agents import WorkerOptions  # verified via context7 (/livekit/agents) + local package

    return WorkerOptions(
        entrypoint_fnc=entrypoint,
        ws_url=settings.livekit_url,
        api_key=settings.livekit_api_key,
        api_secret=settings.livekit_api_secret,
    )


def main() -> None:
    from livekit.agents import cli

    cli.run_app(build_worker_options(get_settings()))


if __name__ == "__main__":
    main()
