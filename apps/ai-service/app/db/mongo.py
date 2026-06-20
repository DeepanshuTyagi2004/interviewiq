"""MongoDB connection (Motor, async).

Fails fast at startup if MongoDB is unreachable. Creates the required indexes on
startup — these are not optional, the pipeline's queries depend on them.
"""
from __future__ import annotations

import logging

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from pymongo import ASCENDING

from app.config import Settings

logger = logging.getLogger(__name__)

EXPERIENCES = "experiences"
INTERVIEW_BRIEFS = "interview_briefs"

_client: AsyncIOMotorClient | None = None
_db: AsyncIOMotorDatabase | None = None


async def connect(settings: Settings) -> AsyncIOMotorDatabase:
    global _client, _db
    # tz_aware=True so datetimes come back UTC-aware and compare cleanly with our utcnow().
    _client = AsyncIOMotorClient(settings.mongodb_url, serverSelectionTimeoutMS=5000, tz_aware=True)
    try:
        await _client.admin.command("ping")
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(
            f"Cannot reach MongoDB at the configured MONGODB_URI: {exc}. Refusing to start."
        ) from exc
    _db = _client[settings.mongodb_db]
    await ensure_indexes(_db)
    logger.info("Connected to MongoDB (db=%s)", settings.mongodb_db)
    return _db


async def ensure_indexes(db: AsyncIOMotorDatabase) -> None:
    # Drives both the pending-extraction scan and the per-combination brief query.
    await db[EXPERIENCES].create_index(
        [
            ("company", ASCENDING),
            ("role", ASCENDING),
            ("level", ASCENDING),
            ("processing_status", ASCENDING),
            ("posted_at", ASCENDING),
        ],
        name="company_role_level_status_posted",
    )
    # source_url unique -> re-scrapes upsert instead of duplicating.
    await db[EXPERIENCES].create_index([("source_url", ASCENDING)], name="source_url", unique=True)
    # Drop the superseded 3-field unique index if it lingers from an older deploy — it
    # would reject the 2nd/3rd specialization at the same level. Best-effort.
    try:
        await db[INTERVIEW_BRIEFS].drop_index("company_role_level")
    except Exception:  # noqa: BLE001 — index absent on a fresh DB; nothing to drop
        pass
    # One brief per JD = (company, role, level, specialization).
    await db[INTERVIEW_BRIEFS].create_index(
        [("company", ASCENDING), ("role", ASCENDING), ("level", ASCENDING), ("specialization", ASCENDING)],
        name="company_role_level_specialization",
        unique=True,
    )
    # For querying stale briefs (older than N days).
    await db[INTERVIEW_BRIEFS].create_index([("generated_at", ASCENDING)], name="generated_at")


async def ping() -> bool:
    """Health-check helper. Never raises."""
    if _client is None:
        return False
    try:
        await _client.admin.command("ping")
        return True
    except Exception as exc:  # noqa: BLE001
        logger.warning("MongoDB ping failed: %s", exc)
        return False


def get_db() -> AsyncIOMotorDatabase:
    if _db is None:
        raise RuntimeError("MongoDB not initialised — connect() must run at startup.")
    return _db


async def close() -> None:
    global _client, _db
    if _client is not None:
        _client.close()
    _client = None
    _db = None
