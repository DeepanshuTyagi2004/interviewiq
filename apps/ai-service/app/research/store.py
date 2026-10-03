"""Persistence for the research pipeline (spec §4.2).

`ResearchStore` is the seam: the runner, tracer, gateway and nodes only talk to it.
`MongoResearchStore` is production; `InMemoryResearchStore` (memory_store.py) backs tests and
`cli --memory`. Both must pass tests/research/test_store_contract.py.

Docs are plain dicts and no `_id` ever leaks out. Updates take Mongo-style dotted paths
(`fields={"nodes.resolve.status": "ok"}` → $set, `inc={...}` → $inc); the in-memory store applies
them the same way."""
from __future__ import annotations

import re
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Protocol

from motor.motor_asyncio import AsyncIOMotorDatabase
from pymongo import ASCENDING, DESCENDING, ReturnDocument
from pymongo.errors import BulkWriteError, DuplicateKeyError, OperationFailure

from app.research.models import ACTIVE_RUN_STATUSES


class DuplicateKey(Exception):
    """An insert violated a unique key; raised identically by both stores."""

RUNS = "research_runs"
ITEMS = "research_items"
SPANS = "research_spans"
EVENTS = "research_events"
PAYLOADS = "research_payloads"
SOURCES = "research_sources"
EXTRACTS = "research_extracts"
COMPANY_STATE = "company_research_state"
DRAFTS = "company_drafts"

LEVEL_RANK: dict[str, int] = {"trace": 0, "debug": 10, "info": 20, "warn": 30, "error": 40}
SPAN_LIST_EXCLUDE: tuple[str, ...] = ("input", "output")


@dataclass(frozen=True)
class EventFilter:
    after_seq: int = 0
    before_seq: int | None = None   # set → newest `limit` events with seq < before_seq (still ascending)
    limit: int = 500
    min_level: str | None = None
    company_id: str | None = None
    node: str | None = None
    type_prefix: str | None = None
    span_id: str | None = None
    q: str | None = None            # case-insensitive substring of `message`


def event_matches(e: dict, flt: EventFilter) -> bool:
    if e["seq"] <= flt.after_seq:
        return False
    if flt.before_seq is not None and e["seq"] >= flt.before_seq:
        return False
    if flt.min_level and e["level_rank"] < LEVEL_RANK[flt.min_level]:
        return False
    if flt.company_id and e.get("company_id") != flt.company_id:
        return False
    if flt.node and e.get("node") != flt.node:
        return False
    if flt.span_id and e.get("span_id") != flt.span_id:
        return False
    if flt.type_prefix and not e["type"].startswith(flt.type_prefix):
        return False
    if flt.q and flt.q.lower() not in e["message"].lower():
        return False
    return True


class ResearchStore(Protocol):
    async def insert_run(self, run: dict) -> None: ...
    async def get_run(self, run_id: str) -> dict | None: ...
    async def update_run(self, run_id: str, *, fields: dict | None = None, inc: dict | None = None) -> dict | None: ...
    async def find_active_run(self) -> dict | None: ...
    async def find_runs_by_status(self, statuses: Iterable[str]) -> list[dict]: ...
    async def list_runs(self, limit: int) -> list[dict]: ...
    async def insert_items(self, items: list[dict]) -> None: ...
    async def list_items(self, run_id: str) -> list[dict]: ...
    async def update_item(self, run_id: str, company_id: str, *, fields: dict | None = None, inc: dict | None = None) -> None: ...
    async def put_span(self, span: dict) -> None: ...
    async def get_span(self, span_id: str) -> dict | None: ...
    async def list_spans(self, run_id: str, company_id: str | None = None) -> list[dict]: ...
    async def insert_events(self, events: list[dict]) -> None: ...
    async def list_events(self, run_id: str, flt: EventFilter) -> list[dict]: ...
    async def max_event_seq(self, run_id: str) -> int: ...
    async def put_payload(self, payload: dict) -> None: ...
    async def get_payload(self, payload_id: str) -> dict | None: ...
    async def upsert_source(self, source: dict) -> None: ...
    async def get_source(self, url: str) -> dict | None: ...
    async def get_extract(self, key: str) -> dict | None: ...
    async def put_extract(self, extract: dict) -> None: ...
    async def upsert_company_state(self, company_id: str, *, fields: dict) -> None: ...
    async def list_company_states(self, company_ids: list[str] | None = None) -> list[dict]: ...
    async def latest_draft(self, company_id: str, *, status: str | None = None) -> dict | None: ...
    async def insert_draft(self, draft: dict) -> None: ...
    async def supersede_pending_drafts(self, company_id: str) -> int: ...
    async def get_draft(self, draft_id: str) -> dict | None: ...
    async def decide_draft(self, draft_id: str, *, status: str, fields: dict) -> bool: ...


def _update_doc(fields: dict | None, inc: dict | None) -> dict:
    doc: dict = {}
    if fields:
        doc["$set"] = fields
    if inc:
        doc["$inc"] = inc
    return doc


def _is_duplicate_error(exc: Exception) -> bool:
    """Check if exception is a duplicate key error (code 11000)."""
    if isinstance(exc, DuplicateKeyError):
        return True
    if isinstance(exc, BulkWriteError):
        return any(e['code'] == 11000 for e in exc.details.get('writeErrors', []))
    return False


class MongoResearchStore:
    def __init__(self, db: AsyncIOMotorDatabase):
        self._db = db

    # --- runs ---
    async def insert_run(self, run: dict) -> None:
        try:
            await self._db[RUNS].insert_one(dict(run))   # copy: insert_one adds _id to the dict it is given
        except DuplicateKeyError as exc:
            raise DuplicateKey(str(exc)) from exc

    async def get_run(self, run_id: str) -> dict | None:
        return await self._db[RUNS].find_one({"run_id": run_id}, {"_id": 0})

    async def update_run(self, run_id: str, *, fields: dict | None = None, inc: dict | None = None) -> dict | None:
        upd = _update_doc(fields, inc)
        if not upd:
            return await self.get_run(run_id)
        return await self._db[RUNS].find_one_and_update(
            {"run_id": run_id}, upd, projection={"_id": 0}, return_document=ReturnDocument.AFTER,
        )

    async def find_active_run(self) -> dict | None:
        return await self._db[RUNS].find_one(
            {"status": {"$in": sorted(ACTIVE_RUN_STATUSES)}}, {"_id": 0}, sort=[("created_at", DESCENDING)],
        )

    async def find_runs_by_status(self, statuses: Iterable[str]) -> list[dict]:
        cur = self._db[RUNS].find({"status": {"$in": list(statuses)}}, {"_id": 0}).sort("created_at", ASCENDING)
        return await cur.to_list(None)

    async def list_runs(self, limit: int) -> list[dict]:
        cur = self._db[RUNS].find({}, {"_id": 0, "targets": 0}).sort("created_at", DESCENDING).limit(limit)
        return await cur.to_list(None)

    # --- items ---
    async def insert_items(self, items: list[dict]) -> None:
        if items:
            # Check for duplicates within batch
            seen: set[tuple[str, str]] = set()
            for item in items:
                key = (item["run_id"], item["company_id"])
                if key in seen:
                    raise DuplicateKey(f"duplicate item (run_id, company_id) within batch: {key}")
                seen.add(key)
            # Check for duplicates in stored items
            for run_id in {i["run_id"] for i in items}:
                company_ids = [i["company_id"] for i in items if i["run_id"] == run_id]
                existing = await self._db[ITEMS].find_one(
                    {"run_id": run_id, "company_id": {"$in": company_ids}}
                )
                if existing:
                    raise DuplicateKey(f"duplicate item (run_id, company_id): ({run_id}, {existing['company_id']})")
            # Write only if no duplicates found
            try:
                await self._db[ITEMS].insert_many([dict(i) for i in items])
            except (DuplicateKeyError, BulkWriteError) as exc:
                if _is_duplicate_error(exc):
                    raise DuplicateKey(str(exc)) from exc
                raise

    async def list_items(self, run_id: str) -> list[dict]:
        return await self._db[ITEMS].find({"run_id": run_id}, {"_id": 0}).sort("position", ASCENDING).to_list(None)

    async def update_item(self, run_id: str, company_id: str, *, fields: dict | None = None, inc: dict | None = None) -> None:
        upd = _update_doc(fields, inc)
        if upd:
            await self._db[ITEMS].update_one({"run_id": run_id, "company_id": company_id}, upd)

    # --- spans ---
    async def put_span(self, span: dict) -> None:
        await self._db[SPANS].replace_one({"span_id": span["span_id"]}, dict(span), upsert=True)

    async def get_span(self, span_id: str) -> dict | None:
        return await self._db[SPANS].find_one({"span_id": span_id}, {"_id": 0})

    async def list_spans(self, run_id: str, company_id: str | None = None) -> list[dict]:
        q: dict = {"run_id": run_id}
        if company_id:
            q["company_id"] = company_id
        projection = {"_id": 0, **{k: 0 for k in SPAN_LIST_EXCLUDE}}
        return await self._db[SPANS].find(q, projection).sort("started_at", ASCENDING).to_list(None)

    # --- events ---
    async def insert_events(self, events: list[dict]) -> None:
        if events:
            # Check for duplicates within batch
            seen: set[tuple[str, int]] = set()
            for event in events:
                key = (event["run_id"], event["seq"])
                if key in seen:
                    raise DuplicateKey(f"duplicate event (run_id, seq) within batch: {key}")
                seen.add(key)
            # Check for duplicates in stored events
            for run_id in {e["run_id"] for e in events}:
                seqs = [e["seq"] for e in events if e["run_id"] == run_id]
                existing = await self._db[EVENTS].find_one(
                    {"run_id": run_id, "seq": {"$in": seqs}}
                )
                if existing:
                    raise DuplicateKey(f"duplicate event (run_id, seq): ({run_id}, {existing['seq']})")
            # Write only if no duplicates found
            try:
                await self._db[EVENTS].insert_many([dict(e) for e in events], ordered=False)
            except (DuplicateKeyError, BulkWriteError) as exc:
                if _is_duplicate_error(exc):
                    raise DuplicateKey(str(exc)) from exc
                raise

    async def list_events(self, run_id: str, flt: EventFilter) -> list[dict]:
        seq: dict = {"$gt": flt.after_seq}
        if flt.before_seq is not None:
            seq["$lt"] = flt.before_seq
        q: dict = {"run_id": run_id, "seq": seq}
        if flt.min_level:
            q["level_rank"] = {"$gte": LEVEL_RANK[flt.min_level]}
        if flt.company_id:
            q["company_id"] = flt.company_id
        if flt.node:
            q["node"] = flt.node
        if flt.span_id:
            q["span_id"] = flt.span_id
        if flt.type_prefix:
            q["type"] = {"$regex": "^" + re.escape(flt.type_prefix)}
        if flt.q:
            q["message"] = {"$regex": re.escape(flt.q), "$options": "i"}
        newest_first = flt.before_seq is not None
        cur = self._db[EVENTS].find(q, {"_id": 0}).sort("seq", DESCENDING if newest_first else ASCENDING).limit(flt.limit)
        rows = await cur.to_list(None)
        return list(reversed(rows)) if newest_first else rows

    async def max_event_seq(self, run_id: str) -> int:
        doc = await self._db[EVENTS].find_one({"run_id": run_id}, {"seq": 1, "_id": 0}, sort=[("seq", DESCENDING)])
        return doc["seq"] if doc else 0

    # --- payloads / sources / extracts ---
    async def put_payload(self, payload: dict) -> None:
        try:
            await self._db[PAYLOADS].insert_one(dict(payload))
        except DuplicateKeyError as exc:
            raise DuplicateKey(str(exc)) from exc

    async def get_payload(self, payload_id: str) -> dict | None:
        return await self._db[PAYLOADS].find_one({"payload_id": payload_id}, {"_id": 0})

    async def upsert_source(self, source: dict) -> None:
        doc = dict(source)
        kinds = doc.pop("kinds", [])
        await self._db[SOURCES].update_one(
            {"url": doc["url"]}, {"$set": doc, "$addToSet": {"kinds": {"$each": kinds}}}, upsert=True,
        )

    async def get_source(self, url: str) -> dict | None:
        return await self._db[SOURCES].find_one({"url": url}, {"_id": 0})

    async def get_extract(self, key: str) -> dict | None:
        return await self._db[EXTRACTS].find_one({"key": key}, {"_id": 0})

    async def put_extract(self, extract: dict) -> None:
        await self._db[EXTRACTS].replace_one({"key": extract["key"]}, dict(extract), upsert=True)

    # --- company research state / drafts ---
    async def upsert_company_state(self, company_id: str, *, fields: dict) -> None:
        await self._db[COMPANY_STATE].update_one(
            {"company_id": company_id}, {"$set": {**fields, "company_id": company_id}}, upsert=True,
        )

    async def list_company_states(self, company_ids: list[str] | None = None) -> list[dict]:
        q = {} if company_ids is None else {"company_id": {"$in": company_ids}}
        return await self._db[COMPANY_STATE].find(q, {"_id": 0}).to_list(None)

    async def latest_draft(self, company_id: str, *, status: str | None = None) -> dict | None:
        q: dict = {"company_id": company_id}
        if status:
            q["status"] = status
        return await self._db[DRAFTS].find_one(q, {"_id": 0}, sort=[("version", DESCENDING)])

    async def insert_draft(self, draft: dict) -> None:
        try:
            await self._db[DRAFTS].insert_one(dict(draft))
        except DuplicateKeyError as exc:
            raise DuplicateKey(str(exc)) from exc

    async def supersede_pending_drafts(self, company_id: str) -> int:
        res = await self._db[DRAFTS].update_many(
            {"company_id": company_id, "status": "pending_review"}, {"$set": {"status": "superseded"}},
        )
        return res.modified_count

    async def get_draft(self, draft_id: str) -> dict | None:
        return await self._db[DRAFTS].find_one({"draft_id": draft_id}, {"_id": 0})

    async def decide_draft(self, draft_id: str, *, status: str, fields: dict) -> bool:
        """pending_review → approved|rejected, atomically; False when the draft was not pending."""
        res = await self._db[DRAFTS].update_one(
            {"draft_id": draft_id, "status": "pending_review"}, {"$set": {**fields, "status": status}},
        )
        return res.modified_count == 1


async def ensure_research_indexes(db: AsyncIOMotorDatabase, *, ttl_days: int) -> None:
    await db[RUNS].create_index([("run_id", ASCENDING)], name="run_id", unique=True)
    await db[RUNS].create_index([("status", ASCENDING), ("created_at", DESCENDING)], name="status_created")
    await db[ITEMS].create_index([("run_id", ASCENDING), ("company_id", ASCENDING)], name="run_company", unique=True)
    await db[SPANS].create_index([("span_id", ASCENDING)], name="span_id", unique=True)
    await db[SPANS].create_index(
        [("run_id", ASCENDING), ("company_id", ASCENDING), ("started_at", ASCENDING)], name="run_company_started",
    )
    await db[EVENTS].create_index([("run_id", ASCENDING), ("seq", ASCENDING)], name="run_seq", unique=True)
    await db[PAYLOADS].create_index([("payload_id", ASCENDING)], name="payload_id", unique=True)
    await db[SOURCES].create_index([("url", ASCENDING)], name="url", unique=True)
    await db[EXTRACTS].create_index([("key", ASCENDING)], name="key", unique=True)
    await db[COMPANY_STATE].create_index([("company_id", ASCENDING)], name="company_id", unique=True)
    await db[DRAFTS].create_index([("draft_id", ASCENDING)], name="draft_id", unique=True)
    await db[DRAFTS].create_index([("company_id", ASCENDING), ("version", DESCENDING)], name="company_version", unique=True)
    seconds = ttl_days * 86_400
    await _ttl_index(db, EVENTS, "ts", seconds)
    await _ttl_index(db, PAYLOADS, "created_at", seconds)


async def _ttl_index(db: AsyncIOMotorDatabase, coll: str, field_name: str, seconds: int) -> None:
    name = f"{field_name}_ttl"
    try:
        await db[coll].create_index([(field_name, ASCENDING)], name=name, expireAfterSeconds=seconds)
    except OperationFailure:
        # RESEARCH_TRACE_TTL_DAYS changed since the index was built: createIndex refuses, collMod updates in place.
        await db.command("collMod", coll, index={"name": name, "expireAfterSeconds": seconds})
