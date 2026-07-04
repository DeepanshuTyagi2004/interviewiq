"""Instrumented interview-prep plan generation for the admin observability console.

Mirrors ``pipeline.generate_interview_plan`` (context → cache gate → persona/ladders/probes →
assemble) but records every stage — status, timing, the grounding + input hash, each LLM stage's
system/user prompt and validated output, and the final InterviewPlan — into the keyed
:data:`~app.jobs.pipeline_runs.RUNS` store.

Two deliberate differences from the production path:
- **Cache is bypassed** (the bench always regenerates so every LLM stage is observable).
- **The plan is NOT persisted** to Mongo (a bench run under a synthetic session id must not clobber
  or litter real plans); the result lives only in the run store.

The production ``/interview-plans`` route is untouched.
"""
from __future__ import annotations

import logging

from app.config import Settings
from app.interview_prep.context import build_context
from app.interview_prep.generate import _ladders, _persona, _probes
from app.interview_prep.pipeline import PrepDataError, _assemble_plan
from app.interview_prep.prompts import ladder as ladder_prompt
from app.interview_prep.prompts import persona as persona_prompt
from app.interview_prep.prompts import probes as probes_prompt
from app.interview_prep.schema import GenerateInterviewPlanRequest
from app.jobs.pipeline_runs import RUNS, bind_run, unbind_run
from app.llm.client import LLMError, build_llm_client

logger = logging.getLogger(__name__)

PIPELINE = "interview_prep"
STEP_NAMES = [
    "context_assembly",
    "cache_gate",
    "persona_and_arc",
    "question_ladders",
    "candidate_probes",
    "assemble",
]


def start_interview_prep_run(req: GenerateInterviewPlanRequest, *, source: str = "bench") -> str:
    s = req.session
    round_type = getattr(s.round_type, "value", s.round_type)
    label = f"{s.company}/{s.role}/{s.level} · {round_type}"
    return RUNS.start_run(PIPELINE, source, label, STEP_NAMES)


async def run_interview_prep(req: GenerateInterviewPlanRequest, run_id: str, settings: Settings) -> None:
    """Execute plan generation with per-stage instrumentation into ``RUNS[run_id]``. Never raises."""
    token = bind_run(run_id)
    try:
        # --- context assembly (deterministic) ---
        RUNS.begin_step(run_id, "context_assembly")
        ctx = await build_context(req, settings)
        if not ctx.has_brief_content and not ctx.questions:
            msg = (f"no brief or questions for {ctx.company}/{ctx.role}/{ctx.level}/"
                   f"{ctx.specialization} round={ctx.round_type}")
            RUNS.log(run_id, "ERROR", msg)
            RUNS.end_step(run_id, "context_assembly", "failed", {"error": msg})
            RUNS.finish(run_id, "failed", {"step": "context_assembly", "type": "PrepDataError", "message": msg})
            return
        RUNS.log(run_id, "INFO",
                 f"context: brief={ctx.has_brief_content} questions={len(ctx.questions)} "
                 f"input_hash={ctx.input_hash}")
        RUNS.end_step(run_id, "context_assembly", "ok", {
            "input_hash": ctx.input_hash,
            "has_brief_content": ctx.has_brief_content,
            "question_count": len(ctx.questions),
            "question_slugs": [q.get("slug") for q in ctx.questions],
            "grounding": ctx.grounding,
        })

        # --- cache gate (bench always regenerates) ---
        RUNS.begin_step(run_id, "cache_gate")
        RUNS.log(run_id, "INFO", "bench mode — bypassing cache, regenerating all stages")
        RUNS.end_step(run_id, "cache_gate", "ok", {"bench_bypass": True, "input_hash": ctx.input_hash})

        # --- the three LLM stages (sequential here for clean per-stage timing) ---
        async with build_llm_client(settings, model=settings.prep_llm_model or None) as llm:
            RUNS.begin_step(run_id, "persona_and_arc")
            try:
                persona_and_arc = await _persona(llm, ctx, settings)
            except LLMError as exc:
                _fail_llm(run_id, "persona_and_arc", exc)
                return
            RUNS.end_step(run_id, "persona_and_arc", "ok", {
                "prompt_version": persona_prompt.PERSONA_PROMPT_VERSION,
                "system_prompt": persona_prompt.PERSONA_SYSTEM,
                "user_prompt": persona_prompt.build_persona_prompt(ctx.grounding),
                "output": persona_and_arc.model_dump(),
            })

            RUNS.begin_step(run_id, "question_ladders")
            try:
                ladder_set = await _ladders(llm, ctx, settings)
            except LLMError as exc:
                _fail_llm(run_id, "question_ladders", exc)
                return
            RUNS.end_step(run_id, "question_ladders", "ok", {
                "prompt_version": ladder_prompt.LADDER_PROMPT_VERSION,
                "system_prompt": ladder_prompt.LADDER_SYSTEM,
                "ladder_count": len(ladder_set.ladders),
                "output": ladder_set.model_dump(),
            })

            RUNS.begin_step(run_id, "candidate_probes")
            try:
                probe_set = await _probes(llm, ctx, settings)
            except LLMError as exc:
                _fail_llm(run_id, "candidate_probes", exc)
                return
            RUNS.end_step(run_id, "candidate_probes", "ok", {
                "prompt_version": probes_prompt.PROBES_PROMPT_VERSION,
                "system_prompt": probes_prompt.PROBES_SYSTEM,
                "probe_count": len(probe_set.probes),
                "output": probe_set.model_dump(),
            })

        # --- assemble the final plan (NOT persisted — bench) ---
        # Note: the bench does not run the (best-effort) reserve stage, so it always assembles with
        # an empty reserve — matching production behavior when that call fails or is skipped.
        RUNS.begin_step(run_id, "assemble")
        plan = _assemble_plan(req, ctx, persona_and_arc, ladder_set.ladders, probe_set.probes, [], settings)
        doc = plan.model_dump(by_alias=True, mode="json")
        RUNS.set_result(run_id, doc)
        RUNS.end_step(run_id, "assemble", "ok",
                      {"ladders": len(ladder_set.ladders), "probes": len(probe_set.probes)})
        RUNS.log(run_id, "INFO", "plan assembled (bench — not persisted)")
        RUNS.finish(run_id, "completed")
    except PrepDataError as exc:
        RUNS.log(run_id, "ERROR", str(exc))
        RUNS.finish(run_id, "failed", {"step": "context_assembly", "type": "PrepDataError", "message": str(exc)})
    except Exception as exc:  # noqa: BLE001 — never let a background task die silently
        logger.exception("[prep-run] unexpected failure")
        RUNS.log(run_id, "ERROR", f"unexpected failure: {exc}")
        RUNS.finish(run_id, "failed", {"step": "unknown", "type": type(exc).__name__, "message": str(exc)})
    finally:
        unbind_run(token)


def _fail_llm(run_id: str, step: str, exc: LLMError) -> None:
    RUNS.log(run_id, "ERROR", f"{step} failed: {exc}")
    RUNS.end_step(run_id, step, "failed", {"error": str(exc)})
    RUNS.finish(run_id, "failed", {"step": step, "type": "LLMError", "message": str(exc)})
