"""LiveKit Agents worker hosting the interview brain over a real room (sub-project A: data-channel text)."""
from __future__ import annotations

import asyncio
import json
import logging

from app.config import Settings, get_settings
from app.db import mongo
from app.db import repositories as repo
from app.interview_agent.outcome_sink import post_outcome
from app.interview_agent.session import run_session
from app.interview_agent.transport import LiveKitTransport

logger = logging.getLogger(__name__)

ROOM_PREFIX = "interview-"


def session_id_from_room(name: str | None) -> str | None:
    if not name or not name.startswith(ROOM_PREFIX):
        return None
    sid = name[len(ROOM_PREFIX):]
    return sid or None


async def run_interview(ctx, settings: Settings):
    """Testable core: sessionId -> plan -> brain over LiveKitTransport -> post outcome. Returns the outcome or None."""
    session_id = session_id_from_room(ctx.room.name)
    if session_id is None:
        logger.warning("Room %r is not an interview room — ignoring", getattr(ctx.room, "name", None))
        return None
    plan = await repo.get_plan(session_id)
    if plan is None:
        logger.warning("No InterviewPlan for session %s — aborting", session_id)
        return None

    async def send(payload: dict) -> None:
        await ctx.room.local_participant.publish_data(json.dumps(payload).encode("utf-8"))

    transport = LiveKitTransport(ctx.room, send=send)

    # wire inbound data-channel messages to the transport (real room only; fake room in tests skips this)
    _wire_data_received(ctx.room, transport)

    outcome = await run_session(transport, plan, settings)
    if outcome is not None:
        transport.set_ended_reason(outcome.ended_reason.value)
        await post_outcome(settings, outcome)
    return outcome


def _wire_data_received(room, transport: LiveKitTransport) -> None:
    """Register the room's data_received handler → transport.handle_incoming. Verified against
    livekit-rtc 1.6.x: Room.on("data_received") is an EventEmitter-style decorator (callback=None ->
    returns a decorator), the handler receives a single `DataPacket` with a `.data: bytes` field."""
    on = getattr(room, "on", None)
    if on is None:
        return

    @on("data_received")
    def _on_data(data_packet):  # DataPacket(data: bytes, kind, participant, topic) — livekit-rtc 1.6.x
        try:
            payload = json.loads(bytes(data_packet.data).decode("utf-8"))
        except Exception:  # noqa: BLE001
            return
        asyncio.create_task(transport.handle_incoming(payload))


async def entrypoint(ctx) -> None:
    """LiveKit Agents entrypoint. Automatic dispatch: this worker joins every room; non-interview
    rooms are ignored by run_interview."""
    settings = get_settings()
    await mongo.connect(settings)
    try:
        await ctx.connect()  # defaults to AutoSubscribe.SUBSCRIBE_ALL; audio handling deferred to sub-project D
        await run_interview(ctx, settings)
    finally:
        await mongo.close()


def main() -> None:
    from livekit.agents import WorkerOptions, cli  # verified via context7 (/livekit/agents) + local package

    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint))


if __name__ == "__main__":
    main()
