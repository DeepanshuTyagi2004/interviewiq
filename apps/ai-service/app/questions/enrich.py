"""LLM enrichment for SD/LLD questions. One call per question, bounded concurrency
(reuses gather_capped). A failure marks the record enrich_failed and keeps it raw —
never aborts the run (mirrors the brief pipeline's per-source isolation)."""
from __future__ import annotations

import logging

from app.llm.client import gather_capped
from app.prompts.enrich_question import ENRICH_SYSTEM, build_enrich_prompt
from app.questions.models import QuestionRecord

logger = logging.getLogger(__name__)

# Fields the enricher may set, per round flavour. Lists go through QuestionRecord validators.
_FIELDS = ("company_tags", "level_tags", "topic_tags", "components_tested", "patterns_tested",
           "entities_involved", "category", "domain", "evaluation_mode", "assess",
           "estimated_duration_mins")


async def enrich_one(llm, record: QuestionRecord) -> QuestionRecord:
    try:
        data = await llm.complete_json(
            ENRICH_SYSTEM,
            build_enrich_prompt(record), label=f"enrich:{record.slug}")
    except Exception as exc:  # noqa: BLE001 — one bad enrich must not abort the run
        logger.warning("[questions] enrich failed for %s (%s)", record.slug, exc)
        record.enrichment_status = "enrich_failed"
        return record
    patch = {k: data[k] for k in _FIELDS if k in data and data[k] not in (None, "")}
    merged = record.model_copy(update={**patch, "enrichment_status": "enriched"})
    return QuestionRecord.model_validate(merged.model_dump())  # re-run validators on patched lists


async def enrich_all(llm, records: list[QuestionRecord], limit: int) -> list[QuestionRecord]:
    results = await gather_capped([enrich_one(llm, r) for r in records], limit)
    # gather_capped maps a raised coro to None; fall back to the original raw record.
    return [res if res is not None else rec for res, rec in zip(results, records)]
