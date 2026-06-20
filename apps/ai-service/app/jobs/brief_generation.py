"""Brief generation job — staged collect → extract → aggregate pipeline.

For each company+role+level combination (read from interviewiq-api), the pipeline:
  1. Collect: query Perplexity Search for N source URLs.
  2. Extract: run each source through Groq to produce a RawExperience (parallel-capped).
  3. Aggregate: merge all raw experiences into one FinalExperience via Groq.

Both raw_experiences[] and final_experience are stored per brief document. Sequential
across combos with a delay between calls; one failure never aborts the run.

Trigger rules (skipped unless `force`): regenerate when no brief exists, the brief is
older than the staleness window, its query_version != PIPELINE_VERSION, or its status
is failed/insufficient_data. Successful (success) briefs settle until stale.
"""
from __future__ import annotations

import asyncio
import json as _json
import logging
from datetime import timedelta

from pydantic import ValidationError

from app.config import Settings
from app.db import repositories as repo
from app.groq.client import GroqClient, GroqError, build_groq_client, gather_capped
from app.models.brief import (
    DataConfidence,
    FinalExperience,
    GenerationStatus,
    Provenance,
    RawExperience,
    utcnow,
)
from app.perplexity.client import PerplexityClient, PerplexityConfigError, PerplexityError
from app.prompts.extract_source import EXTRACT_SYSTEM, build_extract_prompt
from app.prompts.aggregate_experience import AGGREGATE_SYSTEM, build_aggregate_prompt
from app.jobs.run_store import RUN_STORE
from app.targets import Combination, fetch_combinations

logger = logging.getLogger(__name__)

PIPELINE_VERSION = "v7"


def build_search_queries(combo: "Combination") -> list[str]:
    """India-weighted Perplexity Search query variants for one combo."""
    role = combo.role.replace("-", " ")
    spec = (combo.specialization or "").strip().lower()
    spec_part = "" if spec in ("", "general") else f"{spec} "
    base = f"{combo.company} {spec_part}{role} {combo.level}".strip()
    return [
        f"{base} interview experience India",
        f"{combo.company} {role} interview rounds process India",
        f"{base} interview questions asked India",
    ]


def count_provenance(fe: "FinalExperience") -> tuple[int, int]:
    """Return (evidence_backed_round_count, inferred_round_count) for the final experience."""
    ev = sum(1 for r in fe.rounds if r.provenance == Provenance.EVIDENCE_BACKED)
    return ev, len(fe.rounds) - ev


def derive_status(fe: "FinalExperience") -> tuple["GenerationStatus", "DataConfidence"]:
    """Confidence/status from the evidence-backed ratio — NOT the LLM's self-label."""
    if not fe.rounds:
        return GenerationStatus.INSUFFICIENT_DATA, DataConfidence.LOW
    ev, _ = count_provenance(fe)
    ratio = ev / len(fe.rounds)
    if ratio >= 0.6:
        return GenerationStatus.SUCCESS, DataConfidence.HIGH
    if ratio >= 0.3:
        return GenerationStatus.SUCCESS, DataConfidence.MEDIUM
    return GenerationStatus.INSUFFICIENT_DATA, DataConfidence.LOW


async def needs_regeneration(combo: Combination, settings: Settings) -> bool:
    existing = await repo.get_brief(combo.company, combo.role, combo.level, combo.specialization)
    if existing is None:
        return True
    if existing.get("query_version") != PIPELINE_VERSION:
        return True
    if existing.get("generation_status") in ("failed", "insufficient_data"):
        return True
    # 'success' briefs settle until stale; only failed/insufficient retry on a manual run.
    generated_at = existing.get("generated_at")
    if generated_at is None:
        return True
    return utcnow() - generated_at > timedelta(days=settings.brief_stale_after_days)


async def _collect(perplexity: PerplexityClient, combo: Combination, settings: Settings) -> list[dict]:
    queries = build_search_queries(combo)
    sources = await perplexity.collect_sources(
        queries,
        domains=settings.perplexity_search_domains,
        recency=settings.perplexity_search_recency,
        country=settings.perplexity_search_country,
        context_size=settings.perplexity_search_context_size,
        max_results=settings.collect_max_results,
    )
    return sources[: settings.extract_max_sources]


async def _extract_all(groq: GroqClient, combo: Combination, sources: list[dict],
                       settings: Settings) -> list[RawExperience]:
    label = combo.label()

    async def _one(src: dict) -> RawExperience | None:
        raw = await groq.complete_json(EXTRACT_SYSTEM, build_extract_prompt(label, src))
        if not raw.get("is_interview_experience"):
            return None
        raw.setdefault("url", src.get("url"))
        return RawExperience.model_validate(raw)

    results = await gather_capped([_one(s) for s in sources], settings.extract_concurrency)
    return [r for r in results if isinstance(r, RawExperience) and r.rounds]


async def _aggregate(groq: GroqClient, combo: Combination,
                     raw_experiences: list[RawExperience]) -> FinalExperience:
    payload = _json.dumps([e.model_dump(mode="json") for e in raw_experiences])
    raw = await groq.complete_json(AGGREGATE_SYSTEM, build_aggregate_prompt(combo.label(), payload))
    return FinalExperience.model_validate(raw)


async def generate_one(
    perplexity: PerplexityClient,
    groq: GroqClient,
    combo: Combination,
    settings: Settings,
    *,
    force: bool = False,
) -> dict:
    """Generate (or skip) the brief for one combination via collect -> extract -> aggregate."""
    label = combo.label()
    if not force and not await needs_regeneration(combo, settings):
        logger.info("[brief] %s fresh (v=%s); skipping", label, PIPELINE_VERSION)
        RUN_STORE.record_combo(label, status="skipped")
        return {"combo": label, "status": "skipped"}

    RUN_STORE.record_combo(label, status="running")
    try:
        sources = await _collect(perplexity, combo, settings)
        RUN_STORE.add_combo_request(
            label, prompt=" | ".join(build_search_queries(combo)),
            raw_response=f"{len(sources)} sources collected", citations=[s["url"] for s in sources],
        )
        raw_experiences = await _extract_all(groq, combo, sources, settings)
        final = await _aggregate(groq, combo, raw_experiences)
    except PerplexityConfigError:
        raise
    except (PerplexityError, GroqError, ValueError, ValidationError) as exc:
        logger.warning("[brief] %s FAILED: %s", label, exc)
        failed = _failed_doc(combo, settings, str(exc))
        await repo.upsert_brief(failed)
        RUN_STORE.record_combo(label, status="failed", error=str(exc), stored_doc=_jsonable(failed))
        return {"combo": label, "status": "failed"}

    status, confidence = derive_status(final)
    final.data_confidence = confidence
    doc = _success_doc(combo, final, raw_experiences, sources, settings, status)
    await repo.upsert_brief(doc)
    ev, inf = count_provenance(final)
    logger.info("[brief] %s OK (status=%s, conf=%s, rounds=%d ev=%d inf=%d, raw=%d, sources=%d)",
                label, status.value, confidence.value, len(final.rounds), ev, inf,
                len(raw_experiences), len(sources))
    RUN_STORE.record_combo(label, status=status.value, data_confidence=confidence.value,
                           brief=final.model_dump(mode="json"), stored_doc=_jsonable(doc))
    return {"combo": label, "status": status.value, "data_confidence": confidence.value}


def _jsonable(doc: dict) -> dict:
    """JSON-safe copy of a stored doc for the live snapshot (datetime -> ISO string)."""
    out = dict(doc)
    generated = out.get("generated_at")
    if hasattr(generated, "isoformat"):
        out["generated_at"] = generated.isoformat()
    return out


def _success_doc(combo, final, raw_experiences, sources, settings, status) -> dict:
    ev, inf = count_provenance(final)
    fe = final.model_dump(mode="json")
    fe["evidence_backed_round_count"] = ev
    fe["inferred_round_count"] = inf
    return {
        "company": combo.company,
        "role": combo.role,
        "level": combo.level,
        "specialization": combo.specialization,
        "generated_at": utcnow(),
        "query_version": PIPELINE_VERSION,
        "raw_experiences": [e.model_dump(mode="json") for e in raw_experiences],
        "final_experience": fe,
        "sources": [s["url"] for s in sources],
        "data_confidence": final.data_confidence.value,
        "generation_status": status.value,
        "models": {
            "search": settings.perplexity_model,
            "extract": settings.groq_model,
            "aggregate": settings.groq_model,
        },
    }


def _failed_doc(combo, settings, error: str) -> dict:
    return {
        "company": combo.company,
        "role": combo.role,
        "level": combo.level,
        "specialization": combo.specialization,
        "generated_at": utcnow(),
        "query_version": PIPELINE_VERSION,
        "perplexity_model": settings.perplexity_model,
        "brief": None,
        "sources": [],
        "data_confidence": None,
        "generation_status": GenerationStatus.FAILED.value,
        "error": error[:1000],
    }


async def run_brief_generation(perplexity: PerplexityClient, settings: Settings) -> dict:
    """Generate briefs for all combinations, sequentially, with a delay between calls."""
    combos = await fetch_combinations(settings)
    counts = {"success": 0, "insufficient_data": 0, "failed": 0, "skipped": 0}
    if not combos:
        logger.warning("[brief] no combinations to process")
        return {"combinations": 0, **counts}

    groq = build_groq_client(settings)
    processed = 0
    for i, combo in enumerate(combos, start=1):
        if RUN_STORE.is_cancelled():
            logger.info("[brief] stop requested — halting after %d/%d", processed, len(combos))
            break
        logger.info("[brief] (%d/%d) %s", i, len(combos), combo.label())
        result = await generate_one(perplexity, groq, combo, settings)
        counts[result["status"]] = counts.get(result["status"], 0) + 1
        processed += 1
        if i < len(combos):
            await asyncio.sleep(settings.brief_inter_call_delay_seconds)

    # Prune only on a COMPLETE run — a stopped run hasn't visited every combo, so its
    # set is partial and must not delete briefs it simply didn't reach this time.
    if not RUN_STORE.is_cancelled():
        valid = {(c.company, c.role, c.level, c.specialization) for c in combos}
        pruned = await repo.prune_briefs(valid)
        if pruned:
            logger.info("[brief] pruned %d stale brief(s) not in the current catalogue", pruned)

    logger.info("[brief] run complete: %s (processed %d/%d)", counts, processed, len(combos))
    return {"combinations": len(combos), **counts}


async def execute_tracked_run(perplexity: PerplexityClient, settings: Settings, run_id: str) -> dict:
    """Run brief generation under RUN_STORE tracking (powers the live admin console)."""
    logger.info("=== brief generation run %s starting ===", run_id)
    try:
        RUN_STORE.set_stage("brief_generation")
        result = await run_brief_generation(perplexity, settings)
        RUN_STORE.record_stage_result(
            "brief_generation", {k: v for k, v in result.items() if isinstance(v, int)}
        )
        RUN_STORE.finish("cancelled" if RUN_STORE.is_cancelled() else "completed")
        logger.info("=== brief generation run %s done: %s ===", run_id, result)
        return result
    except Exception as exc:  # noqa: BLE001 — record failure for the live view, then re-raise
        logger.exception("=== brief generation run %s failed ===", run_id)
        RUN_STORE.finish("failed", error=str(exc))
        raise


async def any_combination_missing_brief(settings: Settings) -> bool:
    """Used on startup: true if at least one JD target has no brief yet."""
    for combo in await fetch_combinations(settings):
        if await repo.get_brief(combo.company, combo.role, combo.level, combo.specialization) is None:
            return True
    return False
