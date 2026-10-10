"""The interviewer worker (spec §3): `python -m app.interviewer.worker dev` (or `start`). Explicit
dispatch only (agent name `interviewer`): the API dispatches it into `interview-{sessionId}` with
metadata {"session_id": …}. One interviewer per room; a restarted worker resumes from the checkpoint."""
from __future__ import annotations

import asyncio
import dataclasses
import json
import logging
from typing import Any

from livekit import rtc
from livekit.agents import AgentSession, JobContext, WorkerOptions, cli, room_io
from livekit.plugins import deepgram

from app.blueprint import store as bp_store
from app.config import Settings, get_settings
from app.db import mongo
from app.interviewer.agent import TURN_HANDLING, InterviewerAgent, LiveKitSpeaker, PlaceholderLLM, wire_session_events
from app.interviewer.api_client import ApiClient
from app.interviewer.llm import build_chats
from app.interviewer.protocol import WORKSPACE_TOPIC, agent_message
from app.interviewer.run import InterviewRun, RunDeps
from app.interviewer.store import MongoStore
from app.interviewer.talker import Pacing
from app.interviewer.voices import build_tts, tts_voice
from app.interviewer.workspace import WorkspaceBridge

logger = logging.getLogger(__name__)
ROOM_PREFIX = "interview-"
_REQUIRED = {"livekit_url": "LIVEKIT_URL", "livekit_api_key": "LIVEKIT_API_KEY", "livekit_api_secret": "LIVEKIT_API_SECRET",
             "deepgram_api_key": "DEEPGRAM_API_KEY", "openrouter_api_key": "OPENROUTER_API_KEY", "mongodb_url": "MONGODB_URL",
             "api_base_url": "API_BASE_URL", "internal_api_key": "INTERNAL_API_KEY"}


def missing_live_settings(settings: Any) -> list[str]:
    return [env for attr, env in _REQUIRED.items() if not getattr(settings, attr, "")]


def session_id_from(job_metadata: str | None, room_name: str | None) -> str | None:
    try:
        data = json.loads(job_metadata or "")
        if isinstance(data, dict) and data.get("session_id"):
            return str(data["session_id"])
    except json.JSONDecodeError:
        pass
    if room_name and room_name.startswith(ROOM_PREFIX) and len(room_name) > len(ROOM_PREFIX):
        return room_name[len(ROOM_PREFIX):]
    return None


def _is_agent(participant) -> bool:
    return getattr(participant, "kind", None) == rtc.ParticipantKind.PARTICIPANT_KIND_AGENT


async def _cannot_start(ctx: JobContext, api: ApiClient, session_id: str) -> None:
    """The round can't begin: tell the browser, record it, free the room. Every step is best-effort so one
    failure (an unknown session, an API outage) never stops the others or crashes the job."""
    message = agent_message({"type": "session.ending", "reason": "technical",
                             "message": "Your interviewer couldn't start. Please try again later."})
    try:
        await ctx.room.local_participant.send_text(json.dumps(message), topic=WORKSPACE_TOPIC)
    except Exception as exc:  # noqa: BLE001
        logger.warning("could not tell the browser the interview can't start: %s", exc)
    try:
        await api.end(session_id, "technical", {})
    except Exception as exc:  # noqa: BLE001 - the API's sweep is the backstop
        logger.warning("could not end session %s in the API: %s", session_id, exc)
    try:
        await ctx.delete_room()
    except Exception as exc:  # noqa: BLE001
        logger.warning("could not delete the room: %s", exc)


async def entrypoint(ctx: JobContext) -> None:
    settings = get_settings()
    session_id = session_id_from(ctx.job.metadata, ctx.room.name)
    if session_id is None:
        logger.warning("job for room %r has no session id; ignoring", ctx.room.name)
        return
    api = ApiClient(settings.api_base_url, settings.internal_api_key)
    talker, talker_fallback, director = build_chats(settings)
    try:
        # Join first and listen at once: the browser says hello the moment it sees us, long before the blueprint
        # and context have loaded, and LiveKit drops a stream that has no handler yet. The bridge holds what
        # arrives until the run exists.
        await ctx.connect()
        if any(_is_agent(p) for p in ctx.room.remote_participants.values()):
            logger.warning("another interviewer is already in %s; leaving", ctx.room.name)
            return
        bridge = WorkspaceBridge(ctx.room)
        bridge.attach()
        await mongo.connect(settings)
        blueprint = await bp_store.current_blueprint(session_id)
        if blueprint is None:
            logger.error("no current blueprint for session %s", session_id)
            await _cannot_start(ctx, api, session_id)
            return
        context = await api.context(session_id)

        store = MongoStore()
        hedge_s = settings.interviewer_talker_timeout_seconds
        pacing = dataclasses.replace(Pacing.scaled(hedge_s), deadline_s=settings.interviewer_talker_deadline_seconds)
        run = InterviewRun(RunDeps(blueprint=blueprint, context=context, talker_chat=talker, director_chat=director,
                                   workspace=bridge, api=api, store=store, first_token_timeout_s=hedge_s,
                                   fallback_chat=talker_fallback, pacing=pacing))
        voice = tts_voice(settings, blueprint.get("persona"))
        session = AgentSession(
            stt=deepgram.STT(model="nova-3", language="en-IN", api_key=settings.deepgram_api_key,
                             mip_opt_out=settings.deepgram_mip_opt_out),
            tts=build_tts(voice, settings.deepgram_api_key, settings.deepgram_mip_opt_out),
            llm=PlaceholderLLM(),
            turn_handling=TURN_HANDLING,
        )
        run.speaker = LiveKitSpeaker(session, ctx)
        wire_session_events(session, run)

        @ctx.room.on("participant_disconnected")
        def _left(participant) -> None:
            if not _is_agent(participant):
                run.on_candidate_left()

        @ctx.room.on("participant_connected")
        def _back(participant) -> None:
            if not _is_agent(participant):
                run.on_candidate_back()

        await run.start(await store.load_run(session_id))
        await bridge.start_handling(run.on_web_message)
        if run.ended_run is not None:
            logger.info("session %s had already finished; repeating its ending", session_id)
            await run.reaffirm_end()
            return
        # close_on_disconnect=False: a page refresh drops the candidate for a few seconds and LiveKit would close
        # the interviewer's session with them. The run decides what an absence means (a violation, then "technical").
        await session.start(agent=InterviewerAgent(run), room=ctx.room,
                            room_options=room_io.RoomOptions(close_on_disconnect=False))
        ticker = asyncio.create_task(run.tick_forever())
        try:
            await run.finished.wait()
        finally:
            ticker.cancel()
            await session.aclose()
    finally:
        await talker.aclose()
        if talker_fallback is not None:
            await talker_fallback.aclose()
        await director.aclose()
        await api.aclose()
        await mongo.close()


def build_worker_options(settings: Settings) -> WorkerOptions:
    """Creds come from Settings (the .env is loaded by pydantic, not exported to os.environ)."""
    return WorkerOptions(entrypoint_fnc=entrypoint, agent_name=settings.interviewer_agent_name,
                         ws_url=settings.livekit_url, api_key=settings.livekit_api_key, api_secret=settings.livekit_api_secret)


def main() -> None:
    settings = get_settings()
    missing = missing_live_settings(settings)
    if missing:
        raise SystemExit(f"interviewer worker: set {', '.join(missing)} in apps/ai-service/.env")
    cli.run_app(build_worker_options(settings))


if __name__ == "__main__":
    main()
