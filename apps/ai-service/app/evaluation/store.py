"""Mongo persistence for evaluation runs and round evaluations (spec §11.1, §11.2). Mirrors `app/blueprint/store.py`.

- `evaluation_runs`: one doc per run (request, status, error, result, raw grader outputs). At most one *running* run per session
  (partial unique index). Expires `evaluation_run_retention_days` after it ends.
- `round_evaluations`: one doc per version per session, immutable once written; a dispute writes the next version. Holds the report
  plus everything a dispute needs to recompute (merged and raw grades, synthesis, adjustments, pass mark).
Account deletion purges both (POST /users/purge).
"""
from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta, timezone

from pymongo import ASCENDING, DESCENDING
from pymongo.errors import DuplicateKeyError

from app.db.mongo import get_db

logger = logging.getLogger(__name__)

RUNS = "evaluation_runs"
EVALUATIONS = "round_evaluations"


def now() -> datetime:
    return datetime.now(timezone.utc)


def iso(dt: datetime | None = None) -> str:
    return (dt or now()).isoformat()


async def ensure_evaluation_indexes(db) -> None:
    runs = db[RUNS]
    await runs.create_index([("run_id", ASCENDING)], name="run_id", unique=True)
    await runs.create_index([("session_id", ASCENDING)], name="one_running_per_session", unique=True,
                            partialFilterExpression={"status": "running", "session_id": {"$type": "string"}})
    await runs.create_index([("created_at", DESCENDING)], name="created_at")
    await runs.create_index([("candidate_id", ASCENDING)], name="candidate_id")
    await runs.create_index([("expires_at", ASCENDING)], name="expires_at_ttl", expireAfterSeconds=0)
    evs = db[EVALUATIONS]
    await evs.create_index([("session_id", ASCENDING), ("version", DESCENDING)], name="session_version", unique=True)
    await evs.create_index([("candidate_id", ASCENDING)], name="candidate_id")


# ================================================================ runs

class RunAlreadyActive(Exception):
    def __init__(self, run_id: str):
        super().__init__(run_id)
        self.run_id = run_id


async def insert_run(doc: dict) -> None:
    """Insert a new running run; raises RunAlreadyActive (with the live run's id) when the session already has one."""
    try:
        await get_db()[RUNS].insert_one(dict(doc))
    except DuplicateKeyError:
        live = await get_db()[RUNS].find_one({"session_id": doc.get("session_id"), "status": "running"}, {"run_id": 1})
        raise RunAlreadyActive(live["run_id"] if live else "") from None


async def update_run(run_id: str, patch: dict) -> None:
    await get_db()[RUNS].update_one({"run_id": run_id}, {"$set": {**patch, "updated_at": iso()}})


async def finish_run(run_id: str, status: str, patch: dict, retention_days: int) -> None:
    """Terminal transition. Only a still-running run is finished (a cancel that won the race stays)."""
    await get_db()[RUNS].update_one(
        {"run_id": run_id, "status": "running"},
        {"$set": {**patch, "status": status, "ended_at": iso(), "updated_at": iso(),
                  "expires_at": now() + timedelta(days=retention_days)}},
    )


async def get_run(run_id: str, *, full: bool = True) -> dict | None:
    projection = {"_id": 0} if full else {"_id": 0, "request": 0, "raw": 0, "arithmetic": 0}
    return await get_db()[RUNS].find_one({"run_id": run_id}, projection)


async def list_runs(filters: dict, limit: int, before: str | None) -> list[dict]:
    q: dict = {}
    for field in ("status", "trigger", "candidate_id", "session_id", "outcome", "round_type"):
        if filters.get(field):
            q[field] = filters[field]
    if filters.get("company"):
        q["company"] = {"$regex": f"^{re.escape(str(filters['company']).strip())}$", "$options": "i"}   # case-insensitive, whole name
    created: dict = {}
    if filters.get("from"):
        created["$gte"] = filters["from"]
    if filters.get("to"):
        created["$lte"] = filters["to"]
    if before:
        created["$lt"] = before
    if created:
        q["created_at"] = created
    cursor = get_db()[RUNS].find(q, {"_id": 0, "request": 0, "raw": 0, "arithmetic": 0}).sort("created_at", DESCENDING).limit(limit)
    return [d async for d in cursor]


async def recover_interrupted_runs(retention_days: int, run_timeout_seconds: float) -> int:
    """At startup: fail runs left `running` longer than the run timeout allows (they cannot be alive in any process)."""
    cutoff = iso(now() - timedelta(seconds=run_timeout_seconds + 60))
    result = await get_db()[RUNS].update_many(
        {"status": "running", "created_at": {"$lt": cutoff}},
        {"$set": {"status": "failed", "error": {"code": "interrupted", "message": "the AI service restarted during this run", "transient": True},
                  "ended_at": iso(), "updated_at": iso(), "expires_at": now() + timedelta(days=retention_days)}},
    )
    return result.modified_count


# ================================================================ live data (read only)

async def load_live(session_id: str) -> tuple[dict | None, list[dict], list[dict]]:
    """The finished live round: its run doc, turns (by seq) and the director's evidence notes."""
    from app.interviewer import store as live

    db = get_db()
    run = await db[live.LIVE_RUNS].find_one({"session_id": session_id}, {"_id": 0})
    turns = [d async for d in db[live.LIVE_TURNS].find({"session_id": session_id}, {"_id": 0}).sort("seq", ASCENDING)]
    evidence = [d async for d in db[live.LIVE_EVIDENCE].find({"session_id": session_id}, {"_id": 0})]
    return run, turns, evidence


# ================================================================ evaluations

async def current_evaluation(session_id: str, version: int | None = None) -> dict | None:
    q: dict = {"session_id": session_id}
    if version:
        q["version"] = version
    return await get_db()[EVALUATIONS].find_one(q, {"_id": 0}, sort=[("version", DESCENDING)])


async def next_version(session_id: str) -> int:
    last = await get_db()[EVALUATIONS].find_one({"session_id": session_id}, {"version": 1}, sort=[("version", DESCENDING)])
    return int(last["version"]) + 1 if last else 1


async def save_evaluation(doc: dict) -> None:
    """Insert one immutable version (`session_id` + `version` is unique)."""
    await get_db()[EVALUATIONS].insert_one(dict(doc))


# ================================================================ purge (account deletion)

async def purge(candidate_id: str | None, session_ids: list[str]) -> dict:
    """Remove a deleted account's evaluation runs and round evaluations. Idempotent."""
    clauses: list[dict] = []
    if candidate_id:
        clauses.append({"candidate_id": candidate_id})
    if session_ids:
        clauses.append({"session_id": {"$in": session_ids}})
    if not clauses:
        return {"deleted_evaluations": 0, "deleted_evaluation_runs": 0}
    q = {"$or": clauses}
    evs = await get_db()[EVALUATIONS].delete_many(q)
    runs = await get_db()[RUNS].delete_many(q)
    return {"deleted_evaluations": evs.deleted_count, "deleted_evaluation_runs": runs.deleted_count}
