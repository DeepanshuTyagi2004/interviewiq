"""Instrumented résumé parse for the admin observability console.

Mirrors the synchronous ``POST /resumes/parse`` pipeline (extract → LLM → validate) but records
each step — status, timing, and full-transparency detail (extracted text, the exact prompt, the
LLM's parsed JSON + reasoning, validation outcome, final structured result) — into the keyed
:data:`~app.jobs.pipeline_runs.RUNS` store, which the admin console polls.

The production onboarding route is left untouched; this is a parallel, observable path.
"""
from __future__ import annotations

import logging
import time

from app.config import Settings
from app.jobs.pipeline_runs import RUNS, bind_run, unbind_run
from app.llm.client import LLMError, build_resume_llm_client
from app.models.resume import ParsedResume
from app.prompts.parse_resume import RESUME_SYSTEM, RESUME_VERSION, build_parse_resume_prompt
from app.resume.extract import ResumeExtractError, extract_text
from app.resume.formatting import restore_nesting

logger = logging.getLogger(__name__)

PIPELINE = "resume_parse"
STEP_NAMES = ["received", "extract_text", "llm_request", "llm_response", "validate", "done"]
_PREVIEW_CHARS = 2000


def start_resume_run(filename: str, size_bytes: int, *, source: str = "bench") -> str:
    """Register a résumé-parse run and return its id. The caller then launches
    :func:`run_resume_parse` as a background task."""
    label = f"{filename or 'resume.pdf'} ({size_bytes} bytes)"
    return RUNS.start_run(PIPELINE, source, label, STEP_NAMES)


async def run_resume_parse(pdf_bytes: bytes, filename: str, run_id: str, settings: Settings) -> None:
    """Execute the parse with per-step instrumentation into ``RUNS[run_id]``. Never raises — a
    failure at any step is recorded (step ``failed``, run ``failed``) and later steps become
    ``skipped``."""
    token = bind_run(run_id)
    try:
        RUNS.begin_step(run_id, "received")
        RUNS.log(run_id, "INFO", f"received {len(pdf_bytes)} bytes ({filename})")
        RUNS.end_step(run_id, "received", "ok",
                      {"filename": filename, "size_bytes": len(pdf_bytes)})

        # --- extract text ---
        RUNS.begin_step(run_id, "extract_text")
        try:
            text = extract_text(pdf_bytes)
        except ResumeExtractError as exc:
            RUNS.log(run_id, "ERROR", f"text extraction failed: {exc}")
            RUNS.end_step(run_id, "extract_text", "failed", {"error": str(exc)})
            RUNS.finish(run_id, "failed",
                        {"step": "extract_text", "type": "ResumeExtractError", "message": str(exc)})
            return
        RUNS.log(run_id, "INFO", f"extracted {len(text)} chars of text")
        RUNS.end_step(run_id, "extract_text", "ok",
                      {"char_count": len(text), "text_preview": text[:_PREVIEW_CHARS]})

        # --- build the LLM request (deterministic) ---
        model = settings.resume_llm_model or settings.llm_model
        user_prompt = build_parse_resume_prompt(text)
        RUNS.begin_step(run_id, "llm_request")
        RUNS.end_step(run_id, "llm_request", "ok",
                      {"model": model, "prompt_version": RESUME_VERSION,
                       "system_prompt": RESUME_SYSTEM, "user_prompt": user_prompt})

        # --- call the LLM ---
        RUNS.begin_step(run_id, "llm_response")
        started = time.monotonic()
        try:
            async with build_resume_llm_client(settings) as llm:
                data, reasoning = await llm.complete(RESUME_SYSTEM, user_prompt, label="resume-parse")
        except LLMError as exc:
            RUNS.log(run_id, "ERROR", f"LLM call failed: {exc}")
            RUNS.end_step(run_id, "llm_response", "failed", {"error": str(exc)})
            RUNS.finish(run_id, "failed",
                        {"step": "llm_response", "type": "LLMError", "message": str(exc)})
            return
        latency_ms = int((time.monotonic() - started) * 1000)
        RUNS.log(run_id, "INFO", f"LLM responded in {latency_ms}ms")
        RUNS.end_step(run_id, "llm_response", "ok",
                      {"model": model, "latency_ms": latency_ms,
                       "reasoning": reasoning, "parsed_json": data})

        # --- validate against the ParsedResume schema ---
        RUNS.begin_step(run_id, "validate")
        try:
            parsed = ParsedResume.model_validate(data)
        except Exception as exc:  # noqa: BLE001 — pydantic ValidationError et al.
            RUNS.log(run_id, "ERROR", f"validation failed: {exc}")
            RUNS.end_step(run_id, "validate", "failed", {"error": str(exc)[:1000]})
            RUNS.finish(run_id, "failed",
                        {"step": "validate", "type": "ValidationError", "message": str(exc)[:1000]})
            return
        RUNS.end_step(run_id, "validate", "ok", {"validation_ok": True})

        # --- done (nesting the model flattened is restored from the extracted layout) ---
        result = restore_nesting(parsed, text).model_dump()
        RUNS.begin_step(run_id, "done")
        RUNS.set_result(run_id, result)
        RUNS.end_step(run_id, "done", "ok", {"experience_count": len(result.get("experience", []))})
        RUNS.log(run_id, "INFO", "parse complete")
        RUNS.finish(run_id, "completed")
    except Exception as exc:  # noqa: BLE001 — never let a background task die silently
        logger.exception("[resume-run] unexpected failure")
        RUNS.log(run_id, "ERROR", f"unexpected failure: {exc}")
        RUNS.finish(run_id, "failed", {"step": "unknown", "type": type(exc).__name__, "message": str(exc)})
    finally:
        unbind_run(token)
