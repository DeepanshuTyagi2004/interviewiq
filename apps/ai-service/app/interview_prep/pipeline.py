"""Interview-prep pipeline orchestration (Pipeline 1).

build context → compute input hash → if a stored plan for this session has the same input hash,
return it unchanged (skip ALL LLM calls) → else generate the four parts (persona, ladders, probes,
reserve), assemble the plan, persist it (one per session, idempotent upsert), and return it.

The stored/returned doc is the camelCase wire shape from the contract (interviewiq-infra
openapi.yaml), so the backend consumes it as-is.
"""
from __future__ import annotations

import logging

from app import obs
from app.config import Settings
from app.db import repositories as repo
from app.interview_prep.context import PrepContext, build_context
from app.interview_prep.generate import generate_plan_parts
from app.interview_prep.prompts import ladder as ladder_prompt
from app.interview_prep.prompts import persona as persona_prompt
from app.interview_prep.prompts import probes as probes_prompt
from app.interview_prep.schema import (
    GenerateInterviewPlanRequest,
    InterviewPlan,
    PlanProvenance,
)
from app.models.brief import utcnow

logger = logging.getLogger(__name__)


class PrepDataError(RuntimeError):
    """No brief content AND no questions for this JD — nothing to ground a plan in (maps to 422)."""


def _assemble_plan(req: GenerateInterviewPlanRequest, ctx: PrepContext,
                   persona_and_arc, ladders, probes_list, reserve_ladders,
                   settings: Settings) -> InterviewPlan:
    session = req.session
    provenance = PlanProvenance(
        plan_version=settings.prep_plan_version,
        persona_prompt_version=persona_prompt.PERSONA_PROMPT_VERSION,
        ladder_prompt_version=ladder_prompt.LADDER_PROMPT_VERSION,
        probes_prompt_version=probes_prompt.PROBES_PROMPT_VERSION,
        brief_generated_at=ctx.brief_generated_at,
        profile_hash=ctx.profile_hash,
        input_hash=ctx.input_hash,
        model=settings.prep_llm_model or settings.llm_model,   # the model plan-gen actually used
        generated_at=utcnow(),
    )
    return InterviewPlan(
        session_id=session.session_id,
        candidate_id=session.candidate_id,
        company=session.company,
        role=session.role,
        level=session.level,
        specialization=session.specialization,
        round_type=session.round_type,
        provenance=provenance,
        persona=persona_and_arc.persona,
        round_arc=persona_and_arc.round_arc,
        question_ladders=ladders,
        candidate_probes=probes_list,
        red_flag_watchlist=ctx.red_flags,
        reserve=reserve_ladders,
    )


async def generate_interview_plan(req: GenerateInterviewPlanRequest, settings: Settings) -> dict:
    """Return the plan doc (camelCase). Cache-gated on the input hash. Raises PrepDataError (→422)
    when there's nothing to build from, or LLMError (→502) when generation fails."""
    with obs.span("interview_prep.pipeline", session_id=req.session.session_id) as sp:
        ctx = await build_context(req, settings)
        sp.update(metadata={"input_hash": ctx.input_hash})

        if not ctx.has_brief_content and not ctx.questions:
            raise PrepDataError(
                f"no brief or questions for {ctx.company}/{ctx.role}/{ctx.level}/"
                f"{ctx.specialization} round={ctx.round_type}")

        # Cache gate: identical fused inputs → return the stored plan, no LLM calls.
        existing = await repo.get_plan(req.session.session_id)
        if existing and (existing.get("provenance") or {}).get("inputHash") == ctx.input_hash:
            logger.info("[prep] cache hit for session %s (input_hash=%s) — skipping LLM",
                        req.session.session_id, ctx.input_hash)
            sp.update(output={"cached": True})
            return existing

        persona_and_arc, ladders, probes_list, reserve_ladders = await generate_plan_parts(ctx, settings)
        plan = _assemble_plan(req, ctx, persona_and_arc, ladders, probes_list, reserve_ladders, settings)
        doc = plan.model_dump(by_alias=True, mode="json")
        await repo.upsert_plan(doc)
        logger.info("[prep] plan generated for session %s (ladders=%d probes=%d input_hash=%s)",
                    req.session.session_id, len(ladders), len(probes_list), ctx.input_hash)
        sp.update(output={"cached": False, "ladders": len(ladders), "probes": len(probes_list)})
        return doc
