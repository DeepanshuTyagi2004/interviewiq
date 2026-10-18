"""Decision-gate log: one document per gated LLM call (what Jev said vs what the LLM did)."""
from __future__ import annotations

import copy
from datetime import datetime
from typing import TYPE_CHECKING, Literal, Protocol

from bson import ObjectId
from pymongo import ASCENDING, DESCENDING
from pymongo.errors import OperationFailure

if TYPE_CHECKING:
    from app.gates.core import Gate
    from app.llm.decisions import DecisionsClient

COLLECTION = "decision_gate_log"


class GateLog(Protocol):
    async def insert(self, doc: dict) -> str | None: ...
    async def update(self, record_id: str, fields: dict) -> None: ...
    async def find(self, stage: str, *, limit: int, since: datetime | None = None) -> list[dict]: ...


class MongoGateLog:
    def _col(self):
        from app.db.mongo import get_db
        return get_db()[COLLECTION]

    async def insert(self, doc: dict) -> str | None:
        res = await self._col().insert_one(dict(doc))
        return str(res.inserted_id)

    async def update(self, record_id: str, fields: dict) -> None:
        await self._col().update_one({"_id": ObjectId(record_id)}, {"$set": fields})

    async def find(self, stage: str, *, limit: int, since: datetime | None = None) -> list[dict]:
        query: dict = {"stage": stage}
        if since is not None:
            query["created_at"] = {"$gte": since}
        cursor = self._col().find(query).sort("created_at", DESCENDING).limit(limit)
        return [d async for d in cursor]


class MemoryGateLog:
    def __init__(self) -> None:
        self.docs: list[dict] = []

    async def insert(self, doc: dict) -> str | None:
        self.docs.append(copy.deepcopy(doc))
        return str(len(self.docs) - 1)

    async def update(self, record_id: str, fields: dict) -> None:
        doc = self.docs[int(record_id)]
        for path, value in fields.items():
            parts = path.split(".")
            node = doc
            for part in parts[:-1]:
                if part not in node:
                    node[part] = {}
                nxt = node[part]
                if not isinstance(nxt, dict):  # Mongo refuses $set through a non-document
                    raise ValueError(f"cannot create field in non-document element at path {path!r}")
                node = nxt
            node[parts[-1]] = value

    async def find(self, stage: str, *, limit: int, since: datetime | None = None) -> list[dict]:
        rows = [d for d in self.docs if d.get("stage") == stage
                and (since is None or d["created_at"] >= since)]
        rows.sort(key=lambda d: d["created_at"], reverse=True)
        return rows[:limit]


TTL_INDEX = "created_at_ttl"


async def ensure_gate_log_indexes(db, ttl_days: int) -> None:
    col = db[COLLECTION]
    await col.create_index([("stage", ASCENDING), ("created_at", ASCENDING)], name="stage_created_at")
    seconds = ttl_days * 86400
    try:
        await col.create_index([("created_at", ASCENDING)], name=TTL_INDEX, expireAfterSeconds=seconds)
    except OperationFailure:
        # DECISION_GATE_LOG_TTL_DAYS changed since the index was built: createIndex refuses
        # (IndexOptionsConflict), collMod updates the TTL in place (same as research's _ttl_index).
        await db.command("collMod", COLLECTION, index={"name": TTL_INDEX, "expireAfterSeconds": seconds})


_UNSET = object()


def build_gate(settings, stage: Literal["research_window", "brief_source", "key_review"], *,
               log: GateLog | None = None, client: "DecisionsClient | None" = _UNSET) -> "Gate":  # type: ignore[assignment]
    from app.gates.core import Gate, GateMode
    from app.llm.decisions import shared_decisions_client
    if client is _UNSET:
        client = shared_decisions_client(settings)
    return Gate(
        stage,
        mode=GateMode(getattr(settings, f"{stage}_gate_mode")),
        skip_below=float(getattr(settings, f"{stage}_gate_skip_below")),
        client=client,
        log=log if log is not None else MongoGateLog(),
        # Just above one request's timeout (a timeout is never retried); a slow status retry is cut off here.
        ask_timeout_seconds=float(getattr(settings, "decisions_timeout_seconds", 8.0)) + 1.0,
        audit_rate=float(getattr(settings, f"{stage}_gate_audit_rate", 0.0)),
    )
