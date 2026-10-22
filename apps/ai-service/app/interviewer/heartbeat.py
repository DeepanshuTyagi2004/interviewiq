"""Is the voice worker alive? (decided 2026-10-23, for the dev deployment)

The worker is hosted by LiveKit Cloud, away from the HTTP service, and LiveKit offers no way to ask it. So the worker says so itself: once it
has registered with LiveKit it upserts one document (`_id` = agent name) with the time, every `BEAT_EVERY_S`, and the HTTP service reads it.
A worker that LiveKit scaled to zero stops beating and reads as down after `FRESH_FOR_S`. Only the worker process beats, never a round."""
from __future__ import annotations

import asyncio
import logging
import os
import socket
from datetime import datetime, timedelta, timezone

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase

from app.config import Settings

logger = logging.getLogger(__name__)

COLLECTION = "worker_heartbeats"
BEAT_EVERY_S = 15.0
FRESH_FOR_S = 45.0       # three beats: one lost write does not read as down

_tasks: set[asyncio.Task] = set()


async def beat_forever(settings: Settings) -> None:
    """Upsert this worker's heartbeat until the process ends. A failed write is logged and retried on the next beat."""
    client = AsyncIOMotorClient(settings.mongodb_url, serverSelectionTimeoutMS=5000, tz_aware=True)
    coll = client[settings.mongodb_db][COLLECTION]
    name = settings.interviewer_agent_name
    host = f"{socket.gethostname()}:{os.getpid()}"
    while True:
        try:
            await coll.update_one({"_id": name}, {"$set": {"at": datetime.now(timezone.utc), "host": host}}, upsert=True)
        except Exception as exc:  # noqa: BLE001 — a missed beat only makes the worker read as down for a moment
            logger.warning("worker heartbeat failed: %s", exc)
        await asyncio.sleep(BEAT_EVERY_S)


def start_heartbeat(settings: Settings) -> None:
    """Start beating on the running loop, once (LiveKit reports `registered` again after a reconnect)."""
    if _tasks:
        return
    task = asyncio.get_running_loop().create_task(beat_forever(settings), name="worker-heartbeat")
    _tasks.add(task)


async def worker_alive(db: AsyncIOMotorDatabase, agent_name: str, now: datetime | None = None) -> bool:
    """Whether a worker for this agent name has beaten within `FRESH_FOR_S`. Any read error counts as not alive."""
    try:
        doc = await db[COLLECTION].find_one({"_id": agent_name})
    except Exception as exc:  # noqa: BLE001
        logger.warning("worker heartbeat read failed: %s", exc)
        return False
    at = doc.get("at") if doc else None
    if not isinstance(at, datetime):
        return False
    if at.tzinfo is None:
        at = at.replace(tzinfo=timezone.utc)
    return (now or datetime.now(timezone.utc)) - at <= timedelta(seconds=FRESH_FOR_S)
