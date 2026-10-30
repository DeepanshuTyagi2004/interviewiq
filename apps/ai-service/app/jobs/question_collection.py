"""Question-bank collection: live fetch from all sources, GRANULAR incremental + resumable.

Mongo is the durable resume ledger. Each source collector is fail-safe (returns [] on
failure). Every record carries a source_hash; a re-run loads the stored state of all
current-version records once and processes ONLY items that are new, source-changed, or
not-yet-enriched — the unit of skip is one question. Records upsert per-item, so a
crash/cancel keeps finished work. Bump COLLECTION_VERSION or pass force=True to redo all."""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from app.config import Settings
from app.db import repositories as repo
from app.llm.client import gather_capped
from app.questions.collectors import dsa as dsa_collector
from app.questions.collectors.behavioural import collect_behavioural
from app.questions.collectors.briefs import collect_brief_problems
from app.questions.collectors.lld import collect_lld
from app.questions.collectors.system_design import collect_system_design
from app.questions.collectors.vendored_design import collect_vendored_design
from app.models.brief import RoundType
from app.questions.enrich import enrich_one
from app.questions.hashing import compute_source_hash
from app.questions.merge import merge_dsa
from app.questions.models import QuestionRecord
from app.jobs.run_store import RUN_STORE

logger = logging.getLogger(__name__)


def _stamp() -> str:
    return datetime.now(timezone.utc).isoformat()


def build_llm_client(settings: Settings):
    """Enrichment runs Groq first (GROQ_MODEL_NAME, then the fallbacks), like research and scoring; the
    label output is small, so a modest budget keeps each call to a few seconds."""
    from app.llm.research_client import ResearchLLMClient

    return ResearchLLMClient(settings, deadline_seconds=settings.question_content_deadline_seconds,
                             groq_stage_seconds=settings.question_content_groq_stage_seconds, max_output_tokens=1024)


async def _store(rec: QuestionRecord, settings: Settings, stamp: str) -> None:
    rec.collection_version = settings.collection_version
    rec.last_synced = stamp
    await repo.upsert_question(rec.model_dump(mode="json"))


async def collect_questions(settings: Settings, *, force: bool = False) -> dict:
    stamp = _stamp()
    counts = {"dsa": 0, "system-design": 0, "lld": 0, "behavioural": 0, "hiring-manager": 0, "online-assessment": 0, "unchanged": 0,
              "enriched": 0, "enrich_failed": 0, "skipped": 0, "cancelled": 0}
    stored = await repo.stored_states(settings.collection_version)

    # DSA + behavioural — granular & enrich-free: metadata is known at collection time,
    # so write directly, skipping only items whose source_hash is unchanged.
    direct = merge_dsa([
        await dsa_collector.collect_snehasishroy(settings),
        await dsa_collector.collect_liquidslr(settings),
        await dsa_collector.collect_neetcode(settings),
        await dsa_collector.collect_kaggle(settings),
    ])
    direct += await collect_behavioural(settings)
    direct += await collect_brief_problems(settings)
    for r in direct:
        r.source_hash = compute_source_hash(r)
        counts[r.round_type.value] += 1
        st = stored.get((r.round_type.value, r.slug))
        if not force and st and st["source_hash"] == r.source_hash:
            counts["unchanged"] += 1
            continue
        await _store(r, settings, stamp)

    # SD/LLD — stamp source hashes BEFORE gathering (plan: source_hash set before gather_capped).
    seeds = [*await collect_system_design(settings), *collect_vendored_design(settings, RoundType.SYSTEM_DESIGN),
             *await collect_lld(settings), *collect_vendored_design(settings, RoundType.LLD)]
    for s in seeds:
        s.source_hash = compute_source_hash(s)
        counts[s.round_type.value] += 1

    llm = build_llm_client(settings)
    try:
        statuses = await gather_capped(
            [_process_seed(llm, s, settings, stamp, stored, force) for s in seeds],
            settings.question_enrich_concurrency)
    finally:
        await llm.aclose()
    for st in statuses:
        if st in counts:
            counts[st] += 1

    counts["total"] = len(direct) + len(seeds)
    logger.info("[questions] collection done: %s", counts)
    return counts


async def _process_seed(llm, seed: QuestionRecord, settings: Settings, stamp: str,
                        stored: dict, force: bool) -> str:
    st = stored.get((seed.round_type.value, seed.slug))
    if not force and st and st["source_hash"] == seed.source_hash and st["enrichment_status"] == "enriched":
        return "skipped"
    if RUN_STORE.is_cancelled():
        return "cancelled"
    rec = await enrich_one(llm, seed)          # never raises; sets enriched|enrich_failed
    rec.source_hash = seed.source_hash         # preserve across enrichment
    await _store(rec, settings, stamp)
    return rec.enrichment_status               # "enriched" | "enrich_failed"


async def execute_tracked_collection(settings: Settings, run_id: str, *, force: bool = False) -> dict:
    """RUN_STORE-tracked wrapper, mirroring brief_generation.execute_tracked_run."""
    RUN_STORE.set_stage("question_collection")
    try:
        counts = await collect_questions(settings, force=force)
        RUN_STORE.record_stage_result("question_collection", counts)
        RUN_STORE.finish("completed")
        return counts
    except Exception as exc:  # noqa: BLE001
        logger.exception("Question collection failed")
        RUN_STORE.finish("failed", error=str(exc))
        raise
