"""Mongo persistence for blueprints, blueprint runs (with their diagnostic trace) and the answer-key
cache (spec §11), plus the bank reads selection needs.

- `blueprint_runs`: one doc per run, the full stage trace included. At most one *running* run per
  session (partial unique index). Expires `blueprint_run_retention_days` after it ends, unless it is
  the run behind a session's current blueprint (`expires_at` unset while kept).
- `interview_blueprints`: one doc per version per session; the highest `current` one is live.
  Immutable once written; a re-prep writes the next version and supersedes the previous.
- `answer_keys`: per problem + content hash + key version. Shared, no user data.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from pymongo import ASCENDING, DESCENDING, ReturnDocument
from pymongo.errors import DuplicateKeyError

from app.db.mongo import INTERVIEW_QUESTIONS, get_db

logger = logging.getLogger(__name__)

RUNS = "blueprint_runs"
BLUEPRINTS = "interview_blueprints"
ANSWER_KEYS = "answer_keys"


def now() -> datetime:
    return datetime.now(timezone.utc)


def iso(dt: datetime | None = None) -> str:
    return (dt or now()).isoformat()


async def ensure_blueprint_indexes(db) -> None:
    runs = db[RUNS]
    await runs.create_index([("run_id", ASCENDING)], name="run_id", unique=True)
    await runs.create_index([("session_id", ASCENDING)], name="one_running_per_session", unique=True,
                            partialFilterExpression={"status": "running", "session_id": {"$type": "string"}})
    await runs.create_index([("created_at", DESCENDING)], name="created_at")
    await runs.create_index([("candidate_id", ASCENDING)], name="candidate_id")
    await runs.create_index([("expires_at", ASCENDING)], name="expires_at_ttl", expireAfterSeconds=0)
    bps = db[BLUEPRINTS]
    await bps.create_index([("session_id", ASCENDING), ("version", DESCENDING)], name="session_version", unique=True,
                           partialFilterExpression={"session_id": {"$type": "string"}})
    await bps.create_index([("candidate_id", ASCENDING), ("status", ASCENDING)], name="candidate_status")
    await db[ANSWER_KEYS].create_index([("key_id", ASCENDING)], name="key_id", unique=True)
    await db[ANSWER_KEYS].create_index([("round_type", ASCENDING), ("slug", ASCENDING)], name="round_slug")
    # The old InterviewPlan collection is gone with its architecture.
    if "interview_plans" in await db.list_collection_names():
        await db.drop_collection("interview_plans")


# ================================================================ runs

class RunAlreadyActive(Exception):
    def __init__(self, run_id: str):
        super().__init__(run_id)
        self.run_id = run_id


async def insert_run(doc: dict) -> None:
    """Insert a new running run. Raises RunAlreadyActive (with the live run's id) when this session
    already has one: the API never needs two, and a duplicate start is answered with the live run."""
    try:
        await get_db()[RUNS].insert_one(dict(doc))
    except DuplicateKeyError:
        live = await get_db()[RUNS].find_one({"session_id": doc.get("session_id"), "status": "running"}, {"run_id": 1})
        raise RunAlreadyActive(live["run_id"] if live else "") from None


async def update_run(run_id: str, patch: dict) -> None:
    await get_db()[RUNS].update_one({"run_id": run_id}, {"$set": {**patch, "updated_at": iso()}})


async def finish_run(run_id: str, status: str, patch: dict, retention_days: int, keep: bool = False) -> None:
    """Terminal transition. Only a still-running run is finished (a cancel that won the race stays)."""
    expires = None if keep else now() + timedelta(days=retention_days)
    await get_db()[RUNS].update_one(
        {"run_id": run_id, "status": "running"},
        {"$set": {**patch, "status": status, "ended_at": iso(), "updated_at": iso(), "keep": keep, "expires_at": expires}},
    )


async def get_run(run_id: str, *, full: bool = True) -> dict | None:
    projection = {"_id": 0} if full else {"_id": 0, "request": 0, "stages.detail": 0, "stages.llm_calls": 0, "blueprint": 0}
    return await get_db()[RUNS].find_one({"run_id": run_id}, projection)


async def list_runs(filters: dict, limit: int, before: str | None) -> list[dict]:
    q: dict = {}
    for field in ("status", "trigger", "candidate_id", "session_id"):
        if filters.get(field):
            q[field] = filters[field]
    if filters.get("company"):
        q["company_key"] = _key(filters["company"])
    if filters.get("round_type"):
        q["round_type"] = filters["round_type"]
    created: dict = {}
    if filters.get("from"):
        created["$gte"] = filters["from"]
    if filters.get("to"):
        created["$lte"] = filters["to"]
    if before:
        created["$lt"] = before
    if created:
        q["created_at"] = created
    projection = {"_id": 0, "request": 0, "stages.detail": 0, "stages.llm_calls": 0, "blueprint": 0}
    cursor = get_db()[RUNS].find(q, projection).sort("created_at", DESCENDING).limit(limit)
    return [d async for d in cursor]


async def release_kept_run(run_id: str | None, retention_days: int) -> None:
    """The run behind a superseded blueprint starts its retention clock."""
    if run_id:
        await get_db()[RUNS].update_one({"run_id": run_id, "keep": True},
                                        {"$set": {"keep": False, "expires_at": now() + timedelta(days=retention_days)}})


async def recover_interrupted_runs(retention_days: int, run_timeout_seconds: float) -> int:
    """At startup: fail runs left `running` longer than the run timeout allows. Those can't be alive in
    any process (the timeout would have ended them). Younger running runs may belong to another
    replica, so they are left alone; if they are orphans, the API's reconcile timeout cancels them."""
    cutoff = iso(now() - timedelta(seconds=run_timeout_seconds + 60))
    result = await get_db()[RUNS].update_many(
        {"status": "running", "created_at": {"$lt": cutoff}},
        {"$set": {"status": "failed", "error": {"code": "interrupted", "message": "the AI service restarted during this run"},
                  "ended_at": iso(), "updated_at": iso(), "expires_at": now() + timedelta(days=retention_days)}},
    )
    return result.modified_count


# ================================================================ blueprints

async def current_blueprint(session_id: str) -> dict | None:
    return await get_db()[BLUEPRINTS].find_one({"session_id": session_id, "status": "current"}, {"_id": 0},
                                               sort=[("version", DESCENDING)])


async def blueprint_version(session_id: str, version: int) -> dict | None:
    return await get_db()[BLUEPRINTS].find_one({"session_id": session_id, "version": version}, {"_id": 0})


async def list_versions(session_id: str) -> list[dict]:
    cursor = get_db()[BLUEPRINTS].find({"session_id": session_id},
                                       {"_id": 0, "version": 1, "status": 1, "created_at": 1, "run_id": 1, "input_hash": 1,
                                        "input_parts": 1}).sort("version", DESCENDING)
    return [d async for d in cursor]


async def next_version(session_id: str) -> int:
    last = await get_db()[BLUEPRINTS].find_one({"session_id": session_id}, {"version": 1}, sort=[("version", DESCENDING)])
    return int(last["version"]) + 1 if last else 1


async def save_current_blueprint(doc: dict) -> dict | None:
    """Insert a new current version and supersede the previous current one. Returns the superseded
    doc (for its run's retention), or None."""
    db = get_db()[BLUEPRINTS]
    await db.insert_one(dict(doc))
    previous = await db.find_one_and_update(
        {"session_id": doc["session_id"], "status": "current", "version": {"$lt": doc["version"]}},
        {"$set": {"status": "superseded", "superseded_at": iso()}},
        sort=[("version", DESCENDING)], return_document=ReturnDocument.BEFORE, projection={"_id": 0, "run_id": 1, "version": 1},
    )
    # Anything older than that is already superseded; make it so even after a crash mid-write.
    await db.update_many({"session_id": doc["session_id"], "status": "current", "version": {"$lt": doc["version"]}},
                         {"$set": {"status": "superseded", "superseded_at": iso()}})
    return previous


async def active_slugs_for_candidate(candidate_id: str, exclude_session: str | None) -> set[str]:
    """Problem slugs in this user's other current blueprints (two booked rounds never share a question)."""
    q: dict = {"candidate_id": candidate_id, "status": "current"}
    if exclude_session:
        q["session_id"] = {"$ne": exclude_session}
    out: set[str] = set()
    async for doc in get_db()[BLUEPRINTS].find(q, {"slots.problem.slug": 1}):
        for slot in doc.get("slots") or []:
            slug = (slot.get("problem") or {}).get("slug")
            if slug:
                out.add(slug)
    return out


async def persona_names_for_candidate(candidate_id: str, exclude_session: str | None) -> set[str]:
    """The interviewer names this user has had in their other rounds, any version: a new interviewer every round."""
    q: dict = {"candidate_id": candidate_id}
    if exclude_session:
        q["session_id"] = {"$ne": exclude_session}
    out: set[str] = set()
    async for doc in get_db()[BLUEPRINTS].find(q, {"persona.name": 1}):
        name = ((doc.get("persona") or {}).get("name") or "").strip()
        if name:
            out.add(name)
    return out


async def recent_shapes_for_candidate(candidate_id: str, exclude_session: str | None, limit: int = 2) -> list[str]:
    """The round shapes of this user's latest rounds in other sessions, newest first, one per session, so the next
    round never repeats one of them. A blueprint from before shapes existed counts as classic."""
    q: dict = {"candidate_id": candidate_id, "session_id": {"$nin": [exclude_session, None]} if exclude_session else {"$ne": None}}
    out: list[str] = []
    seen: set[str] = set()
    async for doc in get_db()[BLUEPRINTS].find(q, {"session_id": 1, "shape_id": 1}).sort("created_at", -1):
        sid = doc.get("session_id")
        if sid in seen:
            continue
        seen.add(sid)
        out.append(doc.get("shape_id") or "classic")
        if len(out) >= limit:
            break
    return out


async def shape_for_session(session_id: str) -> str | None:
    """The shape an earlier blueprint of this session used: a re-prep keeps it, so the candidate's round does not change shape."""
    doc = await get_db()[BLUEPRINTS].find_one({"session_id": session_id}, {"shape_id": 1}, sort=[("created_at", -1)])
    return (doc.get("shape_id") or "classic") if doc else None


async def recent_traits_for_candidate(candidate_id: str, exclude_session: str | None, limit: int = 2) -> list[dict[str, str]]:
    """The persona trait combinations of this user's latest rounds in other sessions, newest first, one per session, so the next
    round never repeats one of them (a round whose plan was dropped still counts: its persona had them). A blueprint from before
    the realism block has none and counts for nothing."""
    q: dict = {"candidate_id": candidate_id, "session_id": {"$nin": [exclude_session, None]} if exclude_session else {"$ne": None}}
    out: list[dict[str, str]] = []
    seen: set[str] = set()
    async for doc in get_db()[BLUEPRINTS].find(q, {"session_id": 1, "realism.traits": 1, "realism_traits": 1}).sort("created_at", -1):
        sid = doc.get("session_id")
        if sid in seen:
            continue
        seen.add(sid)
        traits = doc.get("realism_traits") or (doc.get("realism") or {}).get("traits")
        if traits:
            out.append(traits)
        if len(seen) >= limit:
            break
    return out


async def recent_habits_for_candidate(candidate_id: str, exclude_session: str | None, limit: int = 2) -> list[dict]:
    """The speech habits of this user's latest rounds in other sessions, newest first, one per session, so the next interviewer shares few
    phrases with either (a round whose plan was dropped still counts: its persona said them). A blueprint from before the habits were kept
    counts for nothing."""
    q: dict = {"candidate_id": candidate_id, "session_id": {"$nin": [exclude_session, None]} if exclude_session else {"$ne": None}}
    out: list[dict] = []
    seen: set[str] = set()
    async for doc in get_db()[BLUEPRINTS].find(q, {"session_id": 1, "realism.habits": 1, "realism_habits": 1}).sort("created_at", -1):
        sid = doc.get("session_id")
        if sid in seen:
            continue
        seen.add(sid)
        habits = doc.get("realism_habits") or (doc.get("realism") or {}).get("habits")
        if habits:
            out.append(habits)
        if len(seen) >= limit:
            break
    return out


async def habits_for_session(session_id: str) -> dict | None:
    """The speech habits an earlier blueprint of this session drew, for a re-prep to keep (None when there are none)."""
    doc = await get_db()[BLUEPRINTS].find_one({"session_id": session_id}, {"realism.habits": 1, "realism_habits": 1}, sort=[("created_at", -1)])
    doc = doc or {}
    return doc.get("realism_habits") or (doc.get("realism") or {}).get("habits") or None


async def realism_for_session(session_id: str) -> dict | None:
    """The seed and traits an earlier blueprint of this session drew (`{"seed": int, "traits": dict | None}`): a re-prep keeps both,
    like the shape, even when that blueprint's plan was dropped. None for a blueprint from before the realism block."""
    doc = await get_db()[BLUEPRINTS].find_one({"session_id": session_id},
                                              {"realism.seed": 1, "realism.traits": 1, "realism_seed": 1, "realism_traits": 1},
                                              sort=[("created_at", -1)])
    doc = doc or {}
    realism = doc.get("realism") or {}
    seed = doc.get("realism_seed") if isinstance(doc.get("realism_seed"), int) else realism.get("seed")
    if not isinstance(seed, int):
        return None
    return {"seed": seed, "traits": doc.get("realism_traits") or realism.get("traits") or None}


# ================================================================ answer keys

def answer_key_id(round_type: str, slug: str, content_hash: str | None, key_version: str) -> str:
    return f"{round_type}:{slug}:{content_hash or '-'}:{key_version}"


async def get_answer_key(key_id: str) -> dict | None:
    return await get_db()[ANSWER_KEYS].find_one({"key_id": key_id}, {"_id": 0})


async def save_answer_key(doc: dict) -> None:
    await get_db()[ANSWER_KEYS].replace_one({"key_id": doc["key_id"]}, doc, upsert=True)


async def answer_keys_for(round_type: str, slug: str) -> list[dict]:
    cursor = get_db()[ANSWER_KEYS].find({"round_type": round_type, "slug": slug}, {"_id": 0}).sort("created_at", DESCENDING)
    return [d async for d in cursor]


# ================================================================ bank reads

def pool_projection(round_types: list[str]) -> dict:
    """DSA content is large and selection never reads it; behavioural and design content is small, and selection
    needs it (the company a question names, its principle, whether a named design problem designs its title)."""
    if set(round_types) <= {"dsa", "online-assessment"}:
        return {"_id": 0, "content": 0, "content_error": 0}
    return {"_id": 0, "content_error": 0}


async def bank_pool(round_types: list[str], status: str, categories: list[str] | None = None) -> list[dict]:
    """Every usable problem for these round types (content included except for DSA, see pool_projection)."""
    q: dict = {"round_type": {"$in": round_types}, "content_status": status, "content": {"$ne": None}}
    if categories:
        q["category"] = {"$in": categories}
    cursor = get_db()[INTERVIEW_QUESTIONS].find(q, pool_projection(round_types))
    return [d async for d in cursor]


async def bank_problem(round_type: str, slug: str) -> dict | None:
    return await get_db()[INTERVIEW_QUESTIONS].find_one({"round_type": round_type, "slug": slug}, {"_id": 0})


# ================================================================ purge (account deletion)

async def purge(candidate_id: str | None, session_ids: list[str]) -> dict:
    """Remove a deleted account's blueprints and runs (bench runs included). Idempotent."""
    clauses: list[dict] = []
    if candidate_id:
        clauses.append({"candidate_id": candidate_id})
    if session_ids:
        clauses.append({"session_id": {"$in": session_ids}})
    if not clauses:
        return {"deleted_blueprints": 0, "deleted_runs": 0}
    q = {"$or": clauses}
    bps = await get_db()[BLUEPRINTS].delete_many(q)
    runs = await get_db()[RUNS].delete_many(q)
    return {"deleted_blueprints": bps.deleted_count, "deleted_runs": runs.deleted_count}


def _key(text: str) -> str:
    import re
    return re.sub(r"[^a-z0-9]+", "", (text or "").lower())


company_key = _key
