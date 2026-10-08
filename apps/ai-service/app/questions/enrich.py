"""LLM enrichment for SD/LLD questions. A failure marks the record enrich_failed and
keeps it raw — never aborts the run (mirrors the brief pipeline's per-source isolation).
Bounded concurrency is handled in the orchestrator (question_collection.py) via gather_capped."""
from __future__ import annotations

import logging

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
        patch = {k: data[k] for k in _FIELDS if k in data and data[k] not in (None, "", [])}
        merged = {**record.model_dump(), **patch, "enrichment_status": "enriched"}
        return QuestionRecord.model_validate(merged)  # Validate new metadata before saving.
    except Exception as exc:  # noqa: BLE001 — one bad enrich must not abort the run
        logger.warning("[questions] enrich failed for %s (%s)", record.slug, exc)
        record.enrichment_status = "enrich_failed"
        return record
