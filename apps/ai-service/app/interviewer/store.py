"""Storage for live interviews (spec §9): one run per session (final plan, ledgers, checkpoint), one
doc per turn (the decision trace), one per director brief, and evidence notes per item and signal.
No scores. Account deletion purges all four (POST /users/purge)."""
from __future__ import annotations

from typing import Any

from pymongo import ASCENDING
from pymongo.errors import DuplicateKeyError

from app.db.mongo import get_db

LIVE_RUNS = "live_runs"
LIVE_TURNS = "live_turns"
LIVE_BRIEFS = "live_briefs"
LIVE_EVIDENCE = "live_evidence"


async def ensure_live_indexes(db) -> None:
    await db[LIVE_RUNS].create_index([("session_id", ASCENDING)], name="session_id", unique=True)
    await db[LIVE_TURNS].create_index([("session_id", ASCENDING), ("seq", ASCENDING)], name="session_seq", unique=True)
    await db[LIVE_BRIEFS].create_index([("session_id", ASCENDING), ("at", ASCENDING)], name="session_at")
    await db[LIVE_EVIDENCE].create_index([("session_id", ASCENDING), ("item_id", ASCENDING), ("signal", ASCENDING)],
                                         name="session_item_signal", unique=True)
    for name in (LIVE_RUNS, LIVE_TURNS, LIVE_BRIEFS, LIVE_EVIDENCE):
        await db[name].create_index([("candidate_id", ASCENDING)], name="candidate_id")


class MongoStore:
    async def load_run(self, session_id: str) -> dict[str, Any] | None:
        return await get_db()[LIVE_RUNS].find_one({"session_id": session_id}, {"_id": 0})

    async def start_run(self, doc: dict[str, Any]) -> None:
        try:
            await get_db()[LIVE_RUNS].insert_one(dict(doc))
        except DuplicateKeyError:
            pass

    async def save_checkpoint(self, session_id: str, data: dict[str, Any]) -> None:
        await get_db()[LIVE_RUNS].update_one({"session_id": session_id}, {"$set": data})

    async def append_turn(self, doc: dict[str, Any]) -> None:
        await get_db()[LIVE_TURNS].insert_one(dict(doc))

    async def max_seq(self, session_id: str) -> int:
        """The highest turn number stored for the session (0 if none): a restart numbers new turns after it."""
        doc = await get_db()[LIVE_TURNS].find_one({"session_id": session_id}, {"seq": 1, "_id": 0}, sort=[("seq", -1)])
        return int(doc["seq"]) if doc else 0

    async def update_turn(self, session_id: str, seq: int, patch: dict[str, Any]) -> None:
        await get_db()[LIVE_TURNS].update_one({"session_id": session_id, "seq": seq}, {"$set": patch})

    async def append_brief(self, doc: dict[str, Any]) -> None:
        await get_db()[LIVE_BRIEFS].insert_one(dict(doc))

    async def upsert_evidence(self, session_id: str, candidate_id: str, notes: list[dict[str, Any]]) -> None:
        for note in notes:
            await get_db()[LIVE_EVIDENCE].update_one(
                {"session_id": session_id, "item_id": note["item_id"], "signal": note["signal"]},
                {"$set": {"candidate_id": candidate_id},
                 "$push": {"observations": {"text": note["observation"], "turn_ids": note.get("turn_ids", [])}}},
                upsert=True)

    async def finalize_run(self, session_id: str, patch: dict[str, Any]) -> None:
        await get_db()[LIVE_RUNS].update_one({"session_id": session_id}, {"$set": patch})

    async def turns(self, session_id: str) -> list[dict[str, Any]]:
        return [d async for d in get_db()[LIVE_TURNS].find({"session_id": session_id}, {"_id": 0}).sort("seq", ASCENDING)]

    async def briefs(self, session_id: str) -> list[dict[str, Any]]:
        return [d async for d in get_db()[LIVE_BRIEFS].find({"session_id": session_id}, {"_id": 0}).sort("at", ASCENDING)]


class MemoryStore:
    """The same interface in memory, for tests and the simulator."""

    def __init__(self) -> None:
        self.runs: dict[str, dict[str, Any]] = {}
        self.turns: list[dict[str, Any]] = []
        self.briefs: list[dict[str, Any]] = []
        self.evidence: list[dict[str, Any]] = []

    async def load_run(self, session_id):
        return self.runs.get(session_id)

    async def start_run(self, doc):
        self.runs.setdefault(doc["session_id"], dict(doc))

    async def save_checkpoint(self, session_id, data):
        self.runs.setdefault(session_id, {"session_id": session_id}).update(data)

    async def append_turn(self, doc):
        self.turns.append(dict(doc))

    async def max_seq(self, session_id):
        return max((t["seq"] for t in self.turns if t["session_id"] == session_id), default=0)

    async def update_turn(self, session_id, seq, patch):
        for turn in self.turns:
            if turn["session_id"] == session_id and turn["seq"] == seq:
                turn.update(patch)

    async def append_brief(self, doc):
        self.briefs.append(dict(doc))

    async def upsert_evidence(self, session_id, candidate_id, notes):
        self.evidence += [{**n, "session_id": session_id, "candidate_id": candidate_id} for n in notes]

    async def finalize_run(self, session_id, patch):
        self.runs.setdefault(session_id, {"session_id": session_id}).update(patch)


async def purge(candidate_id: str | None, session_ids: list[str]) -> dict[str, int]:
    names = {"deleted_live_runs": LIVE_RUNS, "deleted_live_turns": LIVE_TURNS,
             "deleted_live_briefs": LIVE_BRIEFS, "deleted_live_evidence": LIVE_EVIDENCE}
    clauses: list[dict[str, Any]] = []
    if candidate_id:
        clauses.append({"candidate_id": candidate_id})
    if session_ids:
        clauses.append({"session_id": {"$in": session_ids}})
    if not clauses:
        return {key: 0 for key in names}
    db = get_db()
    out = {}
    for key, name in names.items():
        out[key] = (await db[name].delete_many({"$or": clauses})).deleted_count
    return out
