"""Question-set collection orchestrator — granular incremental, fail-safe, resumable.

Strategy (per record, per run):
  1. Collect raw records from all live sources (each source fail-safe; network failure -> []).
  2. Compute source_hash for each record.
  3. Load stored states (round_type, slug) → {source_hash, enrichment_status} for this collection_version.
  4. Per record, decide action:
     - SKIP:    stored hash matches AND enrichment_status == "enriched" AND not force
     - UPSERT_ONLY (DSA):  stamp version/time, upsert, no enrich
     - ENRICH:  SD/LLD — enrich then upsert
     - CANCELLED: RUN_STORE.is_cancelled() → record counts["cancelled"], break
  5. Return summary counts.

Tracked runs reuse the global RUN_STORE (scrape and collect never run at once), so the
existing /admin/scrape/status feed shows progress. Stage result is recorded under the
'question_collection' key."""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from app.config import Settings
from app.db import repositories as repo
from app.llm.client import build_llm_client
from app.questions.collectors import dsa as dsa_collector
from app.questions.collectors.system_design import collect_system_design
from app.questions.collectors.lld import collect_lld
from app.questions.enrich import enrich_one
from app.questions.hashing import compute_source_hash
from app.questions.merge import merge_dsa
from app.questions.models import QuestionRecord
from app.jobs.run_store import RUN_STORE
from app.models.brief import RoundType

logger = logging.getLogger(__name__)

_DSA_ENRICH = False   # DSA records are deterministic; no LLM enrich pass


async def _collect_dsa(settings: Settings) -> list[QuestionRecord]:
    """Collect all DSA sources (each independently fail-safe)."""
    snehasishroy = await dsa_collector.collect_snehasishroy(settings)
    neetcode = await dsa_collector.collect_neetcode(settings)
    kaggle = await dsa_collector.collect_kaggle(settings)
    return merge_dsa([snehasishroy, neetcode, kaggle])


async def collect_questions(settings: Settings, *, force: bool = False) -> dict:
    stamp = datetime.now(timezone.utc).isoformat()
    counts = {"dsa": 0, "system-design": 0, "lld": 0, "total": 0,
              "unchanged": 0, "skipped": 0, "enriched": 0, "cancelled": 0}

    # 1. Collect
    dsa_records = await _collect_dsa(settings)
    sd_records = await collect_system_design(settings)
    lld_records = await collect_lld(settings)
    all_records = [*dsa_records, *sd_records, *lld_records]

    # 2. Stamp source hashes
    for r in all_records:
        r.source_hash = compute_source_hash(r)

    # 3. Load stored states (used for skip decisions)
    stored = await repo.stored_states(settings.collection_version)

    # 4. Process each record
    llm = build_llm_client(settings)
    try:
        for r in all_records:
            if RUN_STORE.is_cancelled():
                counts["cancelled"] += 1
                continue

            r.collection_version = settings.collection_version
            r.last_synced = stamp

            key = (r.round_type.value, r.slug)
            state = stored.get(key)

            if r.round_type == RoundType.DSA:
                # DSA: deterministic, no LLM. Skip if hash matches; otherwise just upsert.
                if state and state.get("source_hash") == r.source_hash and not force:
                    counts["unchanged"] += 1
                    counts["dsa"] += 1
                    counts["total"] += 1
                    continue
                await repo.upsert_question(r.model_dump(mode="json"))
                counts["dsa"] += 1
                counts["total"] += 1
            else:
                # SD/LLD: need LLM enrich.
                already_enriched = (
                    state
                    and state.get("source_hash") == r.source_hash
                    and state.get("enrichment_status") == "enriched"
                    and not force
                )
                if already_enriched:
                    counts["skipped"] += 1
                    rt = r.round_type.value
                    counts[rt] = counts.get(rt, 0) + 1
                    counts["total"] += 1
                    continue
                r = await enrich_one(llm, r)
                await repo.upsert_question(r.model_dump(mode="json"))
                counts["enriched"] += 1
                rt = r.round_type.value
                counts[rt] = counts.get(rt, 0) + 1
                counts["total"] += 1
    finally:
        await llm.aclose()

    logger.info("[questions] collected %s", counts)
    return counts


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
