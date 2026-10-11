"""The interviewer worker (spec §3): `python -m app.interviewer.worker dev` (or `start`). Explicit
dispatch only (agent name `interviewer`): the API dispatches it into `interview-{sessionId}` with
metadata {"session_id": …}. One interviewer per room; a restarted worker resumes from the checkpoint."""
from __future__ import annotations

import asyncio
import dataclasses
import json
import logging
import time
from typing import Any, Callable

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
WAIT_FOR_CANDIDATE_S = 15 * 60   # a waiting interviewer leaves after this long with no candidate (spec 2026-10-11 §4.3)
ENTRY_GRACE_S = 60.0             # a candidate who is in the room when that wait ends gets this long more for their hello
BLUEPRINT_CHECK_S = 30.0         # while it waits, the interviewer checks this often that its blueprint is still the current one
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


def watch_candidate(room, run) -> None:
    """Keep `run.candidate_in_room` true exactly while a candidate (anyone who is not an interviewer) is in the room. Once the
    round has started the run is also told when the candidate leaves or comes back (an absence counts against them); before
    that nothing is, because they had not begun."""
    def others(leaving=None) -> bool:
        gone = getattr(leaving, "identity", None)
        return any(not _is_agent(p) and getattr(p, "identity", None) != gone for p in room.remote_participants.values())

    run.set_candidate_in_room(others())

    @room.on("participant_connected")
    def _back(participant) -> None:
        if _is_agent(participant):
            return
        run.set_candidate_in_room(True)
        if run.begun.is_set():
            run.on_candidate_back()

    @room.on("participant_disconnected")
    def _left(participant) -> None:
        if _is_agent(participant):
            return
        run.set_candidate_in_room(others(leaving=participant))
        if run.begun.is_set():
            run.on_candidate_left()


class StageClock:
    """One log line per stage of the start-up, in milliseconds since the job was received (spec 2026-10-11 §7)."""

    def __init__(self, session_id: str, now: Callable[[], float] = time.monotonic) -> None:
        self.session_id, self._now = session_id, now
        self._t0 = now()
        self._seen: set[str] = set()

    def mark(self, stage: str) -> None:
        if stage in self._seen:
            return
        self._seen.add(stage)
        logger.info("interviewer stage %s at %d ms (session %s)", stage, int((self._now() - self._t0) * 1000), self.session_id)


async def blueprint_changed(session_id: str, loaded: dict[str, Any]) -> bool:
    """The blueprint was re-prepared while the interviewer waited (the reconcile job does that until 30 minutes before the slot).
    A failed lookup is not a change: the wait goes on."""
    try:
        current = await bp_store.current_blueprint(session_id)
    except Exception as exc:  # noqa: BLE001 - a database blip must not end a waiting interviewer
        logger.warning("could not check the blueprint of session %s: %s", session_id, exc)
        return False
    return current is not None and (current.get("blueprint_id"), current.get("version")) != (loaded.get("blueprint_id"), loaded.get("version"))


async def begin_when_candidate_arrives(*, bridge, run, store, session_id: str, blueprint: dict[str, Any],
                                       wait_s: float = WAIT_FOR_CANDIDATE_S, on_hello: Callable[[], None] | None = None,
                                       check_every_s: float = BLUEPRINT_CHECK_S, candidate_present: Callable[[], bool] = lambda: False,
                                       grace_s: float = ENTRY_GRACE_S) -> str:
    """Hold the round until the candidate's browser says hello, then start it. Returns "started"; "ended" (this interview had
    already finished); "nobody" (no hello within `wait_s`); or "changed" (the blueprint was re-prepared while waiting).

    A finished interview is ended again at once, whether or not anyone arrives: reporting its end must not wait for a candidate.
    While waiting the blueprint is re-checked every `check_every_s`, so a re-prepared one is noticed before the candidate is in
    the room. A candidate who is in the room when the wait ends gets `grace_s` more for their hello (they are just arriving)."""
    saved = await store.load_run(session_id)
    if saved and saved.get("ended_at"):
        await run.start(saved)
        return "ended"
    loop = asyncio.get_running_loop()
    deadline = loop.time() + wait_s
    arrived = False
    while not arrived and (left := deadline - loop.time()) > 0:
        arrived = await bridge.wait_ready(min(check_every_s, left))
        if not arrived and await blueprint_changed(session_id, blueprint):
            return "changed"
    if not arrived and candidate_present():
        arrived = await bridge.wait_ready(grace_s)
    if not arrived:
        return "nobody"
    if on_hello is not None:
        on_hello()
    if await blueprint_changed(session_id, blueprint):
        return "changed"
    await run.start(saved)
    return "ended" if run.ended_run is not None else "started"


async def session_is_live(api: ApiClient, session_id: str) -> bool:
    """Whether the API has the round as LIVE_IN_PROGRESS (the candidate went live) rather than still PREP_READY. If it cannot
    say, the answer is no: the API's sweep ends a stuck live round, and ending one on a guess is worse than waiting for it."""
    try:
        return (await api.context(session_id)).get("status") == "LIVE_IN_PROGRESS"
    except Exception as exc:  # noqa: BLE001
        logger.warning("could not ask whether session %s is live: %s", session_id, exc)
        return False


async def end_without_round(outcome: str, *, ctx, run, api: ApiClient, session_id: str) -> None:
    """The round did not start: how the job ends, by what `begin_when_candidate_arrives` returned."""
    if outcome == "ended":
        logger.info("session %s had already finished; repeating its ending", session_id)
        await run.reaffirm_end()
    elif outcome == "changed":
        logger.info("the blueprint for %s was re-prepared while the interviewer waited; leaving for a fresh interviewer", session_id)
        ctx.shutdown("blueprint re-prepared")        # the next go-live or nudge dispatches one that loads the new blueprint
    elif await session_is_live(api, session_id):
        # They went live and never arrived (a closed tab, a crashed browser): the round is over, as if they had left it.
        logger.info("no candidate came to %s although the round was live; ending it as technical", ctx.room.name)
        await _cannot_start(ctx, api, session_id)
    else:
        logger.info("no candidate came to %s; leaving", ctx.room.name)
        await ctx.delete_room()                      # the round was only warmed up: the session stays PREP_READY


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
    clock = StageClock(session_id)
    clock.mark("job_received")
    api = ApiClient(settings.api_base_url, settings.internal_api_key)
    talker, talker_fallback, director = build_chats(settings)
    try:
        # Join first and listen at once: the browser says hello the moment it sees us, long before the blueprint
        # and context have loaded, and LiveKit drops a stream that has no handler yet. The bridge holds what
        # arrives until the run exists.
        await ctx.connect()
        clock.mark("room_joined")
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
        clock.mark("context_loaded")

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

        @session.on("agent_state_changed")
        def _first_audio(ev) -> None:
            if str(ev.new_state) == "speaking" and run.begun.is_set():
                clock.mark("first_audio")

        watch_candidate(ctx.room, run)

        # The interviewer is in the room with its speech connections up while the round waits for the candidate's first
        # hello. What the browser sends before the round starts is held by the run, never lost. close_on_disconnect=False:
        # a page refresh drops the candidate for a few seconds and LiveKit would close the session with them; the run
        # decides what an absence means (a violation, then "technical").
        await bridge.start_handling(run.on_web_message)
        await session.start(agent=InterviewerAgent(run), room=ctx.room,
                            room_options=room_io.RoomOptions(close_on_disconnect=False))
        clock.mark("session_started")
        ticker: asyncio.Task | None = None
        try:
            outcome = await begin_when_candidate_arrives(
                bridge=bridge, run=run, store=store, session_id=session_id, blueprint=blueprint, on_hello=lambda: clock.mark("hello"),
                candidate_present=lambda: any(not _is_agent(p) for p in ctx.room.remote_participants.values()))
            if outcome != "started":
                await end_without_round(outcome, ctx=ctx, run=run, api=api, session_id=session_id)
                return
            clock.mark("begin")
            ticker = asyncio.create_task(run.tick_forever())
            await run.finished.wait()
        finally:
            if ticker is not None:
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
