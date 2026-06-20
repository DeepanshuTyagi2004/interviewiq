"""Brief generation job — Perplexity-driven, sequential.

For each company+role+level combination (read from interviewiq-api), call Perplexity
once, validate the JSON against the brief schema (retry once re-emphasising JSON),
and upsert one brief document. Sequential with a delay between calls; one failure
never aborts the run.

Trigger rules (skipped unless `force`): regenerate when no brief exists, the brief is
older than the staleness window, or its query_version != current BRIEF_QUERY_VERSION.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
from datetime import timedelta

from pydantic import ValidationError

from app.config import Settings
from app.db import repositories as repo
from app.models.brief import (
    DataConfidence,
    FinalExperience,
    GenerationStatus,
    PerplexityBriefV2,
    Provenance,
    RawExperience,
    utcnow,
)
from app.perplexity.client import PerplexityClient, PerplexityConfigError, PerplexityError
from app.prompts.brief_query import BRIEF_QUERY_VERSION
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
    if existing.get("query_version") != BRIEF_QUERY_VERSION:
        return True
    # Re-attempt weak briefs on the next MANUAL run (scheduler/startup auto-run is off, so
    # this never auto-retries on a timer). Anything below high confidence — failed, low, or
    # medium — gets another shot at richer data; only solid high-confidence briefs are skipped.
    if existing.get("generation_status") == "failed":
        return True
    if existing.get("data_confidence") in ("low", "medium"):
        return True
    generated_at = existing.get("generated_at")
    if generated_at is None:
        return True
    return utcnow() - generated_at > timedelta(days=settings.brief_stale_after_days)


async def generate_one(
    perplexity: PerplexityClient,
    combo: Combination,
    settings: Settings,
    *,
    force: bool = False,
) -> dict:
    """Generate (or skip) the brief for one combination. Returns a result dict.
    Raises PerplexityConfigError (bad key) so the caller can abort the whole job."""
    label = combo.label()
    if not force and not await needs_regeneration(combo, settings):
        logger.info("[brief] %s fresh (v=%s); skipping", label, BRIEF_QUERY_VERSION)
        RUN_STORE.record_combo(label, status="skipped")
        return {"combo": label, "status": "skipped"}

    RUN_STORE.record_combo(label, status="running")
    try:
        content, citations, raw_text = await _query_and_validate(perplexity, combo)
    except PerplexityConfigError:
        raise  # unrecoverable — abort the job
    except (PerplexityError, ValueError, ValidationError) as exc:
        logger.warning("[brief] %s FAILED: %s", label, exc)
        failed = _failed_doc(combo, settings, str(exc))
        await repo.upsert_brief(failed)
        RUN_STORE.record_combo(label, status="failed", error=str(exc), stored_doc=_jsonable(failed))
        return {"combo": label, "status": "failed"}

    # Perplexity gathers the experiences AND produces the consolidated round-by-round process in
    # one call — that IS the consolidation, including a realistic best-estimate loop (kept at
    # data_confidence=low) when real reports are sparse. Every citation is shown as a source.
    trusted = list(dict.fromkeys(citations))
    scored_sources = [{"url": u, "confidence": "medium"} for u in trusted]

    confidence = content.consolidated_process.data_confidence
    status = (
        GenerationStatus.INSUFFICIENT_DATA
        if confidence == DataConfidence.LOW
        else GenerationStatus.SUCCESS
    )
    doc = _success_doc(combo, content, trusted, raw_text, settings, status,
                       fabricated=False, scored_sources=scored_sources)
    await repo.upsert_brief(doc)
    logger.info(
        "[brief] %s OK (confidence=%s, status=%s, sources=%d)",
        label, confidence.value, status.value, len(citations),
    )
    RUN_STORE.record_combo(
        label,
        status=status.value,
        data_confidence=confidence.value,
        brief=content.model_dump(mode="json"),
        stored_doc=_jsonable(doc),
    )
    return {"combo": label, "status": status.value, "data_confidence": confidence.value}


_MAX_RAW_RESPONSE = 6000  # cap raw response captured for the UI (full text still hits Perplexity)


def parse_json(content: str) -> dict:
    """Extract JSON from Perplexity text, tolerating ```json fences / preamble (grab the
    outermost {...}) and trailing commas before } or ]. Raises ValueError if none found."""
    content = content.strip()
    candidates = [content]
    start, end = content.find("{"), content.rfind("}")
    if start != -1 and end > start:
        candidates.append(content[start : end + 1])
    for cand in candidates:
        for attempt in (cand, re.sub(r",(\s*[}\]])", r"\1", cand)):
            try:
                return json.loads(attempt)
            except json.JSONDecodeError:
                pass
    raise ValueError(f"no valid JSON found. First 500 chars: {content[:500]!r}")


def _try_validate(text: str) -> PerplexityBriefV2 | None:
    """Parse + validate Perplexity's text into a brief; None on any parse/schema failure."""
    try:
        return PerplexityBriefV2.model_validate(parse_json(text))
    except (ValueError, ValidationError):
        return None


async def _query_and_validate(
    perplexity: PerplexityClient, combo: Combination
) -> tuple[PerplexityBriefV2, list[str], str]:
    label = combo.label()
    # JD is intentionally NOT sent to Perplexity — only company/role/level (+ role descriptors)
    # drive the interview-experience search.

    # Pass 1: Perplexity → direct parse.
    prompt, text, citations = await perplexity.query_interview_intelligence(
        combo.company, combo.role, combo.level,
        specialization=combo.specialization, title=combo.title,
    )
    RUN_STORE.add_combo_request(label, prompt=prompt, raw_response=text[:_MAX_RAW_RESPONSE], citations=citations)
    brief = _try_validate(text)
    if brief is not None:
        return brief, citations, text

    # Pass 2: Perplexity retry with JSON emphasis → direct parse.
    logger.info("[brief] %s invalid JSON; retrying Perplexity with JSON emphasis", label)
    prompt, text2, citations2 = await perplexity.query_interview_intelligence(
        combo.company, combo.role, combo.level, specialization=combo.specialization,
        title=combo.title, emphasize_json=True,
    )
    RUN_STORE.add_combo_request(label, prompt=prompt, raw_response=text2[:_MAX_RAW_RESPONSE], citations=citations2)
    brief = _try_validate(text2)
    if brief is not None:
        return brief, citations2, text2

    # Both passes returned unparseable JSON — fail this combo (caught by generate_one).
    raise ValueError("Perplexity returned invalid JSON on both attempts")


def _jsonable(doc: dict) -> dict:
    """JSON-safe copy of a stored doc for the live snapshot (datetime -> ISO string)."""
    out = dict(doc)
    generated = out.get("generated_at")
    if hasattr(generated, "isoformat"):
        out["generated_at"] = generated.isoformat()
    return out


def _success_doc(combo, content, sources, raw_text, settings, status,
                 *, fabricated=False, scored_sources=None) -> dict:
    return {
        "company": combo.company,
        "role": combo.role,
        "level": combo.level,
        "specialization": combo.specialization,
        "generated_at": utcnow(),
        "query_version": BRIEF_QUERY_VERSION,
        "perplexity_model": settings.perplexity_model,
        "experiences": [e.model_dump(mode="json") for e in content.experiences],
        "consolidated_process": content.consolidated_process.model_dump(mode="json"),
        # displayed source links = trusted (high/medium) citations only
        "sources": sources,
        # full scored list [{url, confidence}] for transparency (low ones dropped from `sources`)
        "scored_sources": scored_sources or [],
        "raw_response": raw_text,
        # true => the round-by-round was INFERRED (expected loop), not from real reports; always low
        "fabricated_richness": fabricated,
        "data_confidence": content.consolidated_process.data_confidence.value,
        "generation_status": status.value,
    }


def _failed_doc(combo, settings, error: str) -> dict:
    return {
        "company": combo.company,
        "role": combo.role,
        "level": combo.level,
        "specialization": combo.specialization,
        "generated_at": utcnow(),
        "query_version": BRIEF_QUERY_VERSION,
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

    processed = 0
    for i, combo in enumerate(combos, start=1):
        if RUN_STORE.is_cancelled():
            logger.info("[brief] stop requested — halting after %d/%d", processed, len(combos))
            break
        logger.info("[brief] (%d/%d) %s", i, len(combos), combo.label())
        result = await generate_one(perplexity, combo, settings)
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
