"""Question-set collection orchestrator. DSA: snehasishroy tarball + vendored
neetcode/kaggle, merged by slug (deterministic). SD/LLD: vendored seed lists + one
LLM enrich pass each. Everything upserts into interview_questions.

Tracked runs reuse the global RUN_STORE (scrape and collect never run at once), so the
existing /admin/scrape/status feed shows progress. Stage result is recorded under the
'question_collection' key."""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone

from app.config import Settings
from app.db import repositories as repo
from app.llm.client import build_llm_client
from app.questions.collectors import dsa as dsa_collector
from app.questions.collectors.design import load_data_file, load_seed_questions
from app.questions.enrich import enrich_all
from app.questions.github import GithubFetchError, fetch_repo_files
from app.questions.merge import merge_dsa
from app.questions.models import QuestionRecord
from app.jobs.run_store import RUN_STORE
from app.models.brief import RoundType

logger = logging.getLogger(__name__)

_SNEHASISHROY = ("snehasishroy", "leetcode-companywise-interview-questions", "master")


def _collect_dsa(files: dict[str, bytes], settings: Settings) -> list[QuestionRecord]:
    snehasishroy = dsa_collector.collect_snehasishroy(files)
    neetcode = dsa_collector.parse_neetcode(json.loads(load_data_file(settings, "neetcode_150.json")))
    kaggle = dsa_collector.parse_kaggle(load_data_file(settings, "leetcode_kaggle.csv"))
    return merge_dsa([snehasishroy, neetcode, kaggle])


def _collect_design(settings: Settings) -> tuple[list[QuestionRecord], list[QuestionRecord]]:
    sd = load_seed_questions(json.loads(load_data_file(settings, "system_design.json")), RoundType.SYSTEM_DESIGN)
    lld = load_seed_questions(json.loads(load_data_file(settings, "lld.json")), RoundType.LLD)
    return sd, lld


async def collect_questions(settings: Settings) -> dict:
    # DSA (deterministic). A GitHub failure degrades to vendored-only rather than aborting.
    try:
        files = await fetch_repo_files(*_SNEHASISHROY, settings)
    except GithubFetchError as exc:
        logger.warning("[questions] snehasishroy unavailable (%s) — DSA from vendored sources only", exc)
        files = {}
    dsa_records = _collect_dsa(files, settings)

    # SD/LLD: seed + LLM enrich.
    sd_records, lld_records = _collect_design(settings)
    llm = build_llm_client(settings)
    try:
        enriched = await enrich_all(llm, [*sd_records, *lld_records], settings.question_enrich_concurrency)
    finally:
        await llm.aclose()

    all_records = [*dsa_records, *enriched]
    stamp = datetime.now(timezone.utc).isoformat()
    counts = {"dsa": 0, "system-design": 0, "lld": 0}
    for r in all_records:
        r.collection_version = settings.collection_version
        r.last_synced = stamp
        await repo.upsert_question(r.model_dump())
        counts[r.round_type.value] = counts.get(r.round_type.value, 0) + 1
    counts["total"] = len(all_records)
    logger.info("[questions] collected %s", counts)
    return counts


async def execute_tracked_collection(settings: Settings, run_id: str) -> dict:
    """RUN_STORE-tracked wrapper, mirroring brief_generation.execute_tracked_run."""
    RUN_STORE.set_stage("question_collection")
    try:
        counts = await collect_questions(settings)
        RUN_STORE.record_stage_result("question_collection", counts)
        RUN_STORE.finish("completed")
        return counts
    except Exception as exc:  # noqa: BLE001
        logger.exception("Question collection failed")
        RUN_STORE.finish("failed", error=str(exc))
        raise
