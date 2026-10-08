"""Data access for the two collections.

- `experiences`: first-party paste-in submissions (capture only — no processing now).
- `interview_briefs`: briefs, one per JD = (company, role, level, specialization).

Datetimes are stored as native BSON dates so range queries/sorts work. Enums as strings.
"""
from __future__ import annotations

import re

from datetime import datetime

from pymongo import UpdateOne

from app.db.mongo import (
    EXPERIENCES,
    INTERVIEW_BRIEFS,
    INTERVIEW_QUESTIONS,
    get_db,
)
from app.models.experience import RawExperience


def _experience_doc(exp: RawExperience) -> dict:
    doc = exp.model_dump(mode="json")
    doc["posted_at"] = exp.posted_at
    doc["scraped_at"] = exp.scraped_at
    return doc


# --- experiences (paste-in capture) ---------------------------------------------

async def upsert_experiences(experiences: list[RawExperience]) -> int:
    """Upsert by source_url (dedup). Returns the number of NEW documents inserted."""
    if not experiences:
        return 0
    ops = [
        UpdateOne({"source_url": exp.source_url}, {"$setOnInsert": _experience_doc(exp)}, upsert=True)
        for exp in experiences
    ]
    result = await get_db()[EXPERIENCES].bulk_write(ops, ordered=False)
    return result.upserted_count


async def paginate_experiences(
    company: str, role: str, level: str, page: int, size: int
) -> tuple[int, list[dict]]:
    query = {"company": company, "role": role, "level": level}
    coll = get_db()[EXPERIENCES]
    total = await coll.count_documents(query)
    cursor = coll.find(query).sort("scraped_at", -1).skip((page - 1) * size).limit(size)
    return total, [_with_id(d) async for d in cursor]


# --- interview_briefs (one per JD: company, role, level, specialization) ---------

def _brief_key(doc: dict) -> dict:
    return {
        "company": doc["company"], "role": doc["role"],
        "level": doc["level"], "specialization": doc["specialization"],
    }


async def upsert_brief(doc: dict) -> dict:
    """Replace the brief for (company, role, level, specialization) — one per JD."""
    await get_db()[INTERVIEW_BRIEFS].replace_one(_brief_key(doc), doc, upsert=True)
    return doc


async def get_brief(company: str, role: str, level: str, specialization: str) -> dict | None:
    doc = await get_db()[INTERVIEW_BRIEFS].find_one(
        {"company": company, "role": role, "level": level, "specialization": specialization}
    )
    return _with_id(doc) if doc else None


async def list_brief_summaries() -> list[dict]:
    """Status summary for every brief (no content) — operational monitoring."""
    projection = {
        "company": 1, "role": 1, "level": 1, "specialization": 1,
        "generated_at": 1, "data_confidence": 1, "generation_status": 1, "query_version": 1,
    }
    cursor = get_db()[INTERVIEW_BRIEFS].find({}, projection).sort("generated_at", -1)
    return [_with_id(d) async for d in cursor]


async def clear_briefs() -> int:
    """Delete ALL interview briefs (destructive admin reset). Returns the number removed."""
    res = await get_db()[INTERVIEW_BRIEFS].delete_many({})
    return res.deleted_count


async def prune_briefs(valid_keys: set[tuple]) -> int:
    """Delete briefs whose (company, role, level, specialization) isn't in the current catalogue
    — removes orphans left by removed companies or a changed key shape. Returns # deleted.
    Caller MUST pass a non-empty set (else this would wipe everything)."""
    if not valid_keys:
        return 0
    coll = get_db()[INTERVIEW_BRIEFS]
    removed = 0
    proj = {"company": 1, "role": 1, "level": 1, "specialization": 1}
    async for d in coll.find({}, proj):
        key = (d.get("company"), d.get("role"), d.get("level"), d.get("specialization"))
        if key not in valid_keys:
            await coll.delete_one({"_id": d["_id"]})
            removed += 1
    return removed


def _question_key(doc: dict) -> dict:
    return {"round_type": doc["round_type"], "slug": doc["slug"]}


async def upsert_question(doc: dict) -> dict:
    """Replace the question for (round_type, slug) — idempotent re-collection."""
    await get_db()[INTERVIEW_QUESTIONS].replace_one(_question_key(doc), doc, upsert=True)
    return doc


async def clear_questions() -> int:
    res = await get_db()[INTERVIEW_QUESTIONS].delete_many({})
    return res.deleted_count


def _question_filter(round_type: str | None, company: str | None, difficulty: str | None,
                     content_status: str | None = None, topic: str | None = None) -> dict:
    q: dict = {}
    if round_type:
        q["round_type"] = round_type
    if company:
        q["company_tags"] = company.lower()
    if difficulty:
        q["difficulty"] = difficulty.lower()
    if content_status:
        # Records collected before content existed have no field at all: treat them as "none".
        q["content_status"] = {"$in": [None, "none"]} if content_status == "none" else content_status
    if topic:
        q["topic_tags"] = {"$regex": re.escape(topic.strip()), "$options": "i"}
    return q


async def query_questions(round_type: str | None = None, company: str | None = None,
                          difficulty: str | None = None, limit: int = 100, *,
                          content_status: str | None = None, topic: str | None = None,
                          include_content: bool = False) -> list[dict]:
    projection = {"_id": 0} if include_content else {"_id": 0, "content": 0}
    cursor = get_db()[INTERVIEW_QUESTIONS].find(
        _question_filter(round_type, company, difficulty, content_status, topic), projection).limit(limit)
    return [doc async for doc in cursor]


async def count_questions_matching(round_type: str | None = None, company: str | None = None,
                                   difficulty: str | None = None, *, content_status: str | None = None,
                                   topic: str | None = None) -> int:
    """True total matching the filter, ignoring the page limit — for 'showing N of TOTAL'."""
    return await get_db()[INTERVIEW_QUESTIONS].count_documents(
        _question_filter(round_type, company, difficulty, content_status, topic))


async def question_stats() -> dict:
    """Counts per round type and content status: {"rounds": {"dsa": {"none": 12, "verified": 3}}, "total": 15}."""
    rounds: dict[str, dict[str, int]] = {}
    total = 0
    cursor = get_db()[INTERVIEW_QUESTIONS].aggregate([
        {"$group": {"_id": {"round_type": "$round_type", "status": {"$ifNull": ["$content_status", "none"]}}, "n": {"$sum": 1}}},
    ])
    async for row in cursor:
        rt, status = row["_id"]["round_type"], row["_id"]["status"]
        rounds.setdefault(rt, {})[status] = row["n"]
        total += row["n"]
    return {"rounds": rounds, "total": total}


async def questions_needing_content(round_type: str | None, content_version: str, limit: int | None, force: bool) -> list[dict]:
    """Index records whose content is missing, failed or from another prompt version (all of them when forced)."""
    q: dict = {}
    if round_type:
        q["round_type"] = round_type
    if not force:
        q["$or"] = [{"content_status": {"$in": [None, "none", "failed"]}}, {"content_version": {"$ne": content_version}}]
    cursor = get_db()[INTERVIEW_QUESTIONS].find(q, {"_id": 0, "content": 0}).sort([("round_type", 1), ("slug", 1)])
    if limit:
        cursor = cursor.limit(limit)
    return [doc async for doc in cursor]


_PROVEN_ONLY = ("dsa", "online-assessment")


class UnverifiedContentError(ValueError):
    """Raised instead of saving content that has not passed its checks."""


async def update_question_content(round_type: str, slug: str, patch: dict) -> None:
    """Partial update, so a concurrent collection replacing index fields is never clobbered.

    Guarantee: content is only ever stored when it passed its checks. DSA content requires status
    `verified`; any round's content requires `verified` or `generated`; everything else (a failure, a
    withdrawal) stores no content at all."""
    if patch.get("content") is not None:
        status = patch.get("content_status")
        allowed = ("verified",) if round_type in _PROVEN_ONLY else ("verified", "generated")
        if status not in allowed:
            raise UnverifiedContentError(f"refusing to save {round_type}/{slug} content with status {status!r}")
    await get_db()[INTERVIEW_QUESTIONS].update_one({"round_type": round_type, "slug": slug}, {"$set": patch})


async def brief_rounds() -> list[dict]:
    """Every brief's company and rounds (type, difficulty, topics, problems) for the briefs collector."""
    projection = {"_id": 0, "company": 1, "final_experience.rounds.type": 1, "final_experience.rounds.difficulty": 1,
                  "final_experience.rounds.topics": 1, "final_experience.rounds.problems": 1}
    return [doc async for doc in get_db()[INTERVIEW_BRIEFS].find({}, projection)]


async def stored_states(collection_version: str) -> dict[tuple[str, str], dict]:
    """{(round_type, slug): {"source_hash", "enrichment_status"}} for records at this version."""
    cur = get_db()[INTERVIEW_QUESTIONS].find(
        {"collection_version": collection_version},
        {"_id": 0, "round_type": 1, "slug": 1, "source_hash": 1, "enrichment_status": 1})
    return {(d["round_type"], d["slug"]):
            {"source_hash": d.get("source_hash"), "enrichment_status": d.get("enrichment_status")}
            async for d in cur}


def _with_id(doc: dict | None) -> dict:
    if doc and "_id" in doc:
        doc["id"] = str(doc.pop("_id"))
    return doc


# Re-exported for callers that need the raw collection name / connection elsewhere.
__all__ = [
    "upsert_experiences",
    "paginate_experiences",
    "upsert_brief",
    "get_brief",
    "list_brief_summaries",
    "upsert_question",
    "clear_questions",
    "query_questions",
    "stored_states",
    "question_stats",
    "UnverifiedContentError",
    "questions_needing_content",
    "update_question_content",
    "brief_rounds",
]
