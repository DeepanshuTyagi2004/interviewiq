"""Stage 2 (LLM, via the structured wrapper): four independent, schema-validated calls —
(a) persona + opening/closing + round arc, (b) per-question ladders, (c) candidate probes, and
(d) the extension reserve (a few extra, harder ladders for Pipeline 2's EXTEND path).

They run concurrently with the existing `gather_capped` helper (concurrency from settings). Each
call and the overall stage are wrapped in an obs span. Each call goes through
`complete_structured`, so it validates-and-repairs against its target model and raises `LLMError`
if it never produces valid data — `gather_capped` captures that as `None`. A plan needs
persona/ladders/probes, so we re-raise `LLMError` if any of those three is missing; reserve is
best-effort and defaults to an empty list on failure.
"""
from __future__ import annotations

import logging

from app import obs
from app.config import Settings
from app.interview_prep.context import PrepContext
from app.interview_prep.prompts import ladder as ladder_prompt
from app.interview_prep.prompts import persona as persona_prompt
from app.interview_prep.prompts import probes as probes_prompt
from app.interview_prep.schema import (
    CandidateProbe,
    LadderSet,
    PersonaAndArc,
    ProbeSet,
    QuestionLadder,
    ReserveSet,
)
from app.llm.client import LLMClient, LLMError, build_llm_client, gather_capped
from app.llm.structured import complete_structured

logger = logging.getLogger(__name__)


def _seed_questions(ctx: PrepContext) -> list[dict]:
    """Thin seed records the ladder prompt turns into ladders (metadata only, never full text)."""
    return [
        {"slug": q.get("slug"), "title": q.get("title"), "url": q.get("url"),
         "difficulty": q.get("difficulty"), "topic_tags": q.get("topic_tags") or []}
        for q in ctx.questions
    ]


async def _persona(llm: LLMClient, ctx: PrepContext, settings: Settings) -> PersonaAndArc:
    with obs.span("interview_prep.persona", round_type=ctx.round_type):
        return await complete_structured(
            llm, persona_prompt.PERSONA_SYSTEM,
            persona_prompt.build_persona_prompt(ctx.grounding),
            PersonaAndArc, max_repairs=settings.prep_max_repairs, label="prep-persona")


async def _ladders(llm: LLMClient, ctx: PrepContext, settings: Settings) -> LadderSet:
    with obs.span("interview_prep.ladders", round_type=ctx.round_type, seeds=len(ctx.questions)):
        return await complete_structured(
            llm, ladder_prompt.LADDER_SYSTEM,
            ladder_prompt.build_ladder_prompt(ctx.grounding, _seed_questions(ctx)),
            LadderSet, max_repairs=settings.prep_max_repairs, label="prep-ladders")


async def _probes(llm: LLMClient, ctx: PrepContext, settings: Settings) -> ProbeSet:
    with obs.span("interview_prep.probes", round_type=ctx.round_type):
        return await complete_structured(
            llm, probes_prompt.PROBES_SYSTEM,
            probes_prompt.build_probes_prompt(ctx.grounding, ctx.profile),
            ProbeSet, max_repairs=settings.prep_max_repairs, label="prep-probes")


async def _reserve(llm: LLMClient, ctx: PrepContext, settings: Settings) -> ReserveSet:
    from app.interview_prep.prompts import reserve as reserve_prompt
    with obs.span("interview_prep.reserve", round_type=ctx.round_type):
        return await complete_structured(
            llm, reserve_prompt.RESERVE_SYSTEM,
            reserve_prompt.build_reserve_prompt(ctx.grounding, n=2),
            ReserveSet, max_repairs=settings.prep_max_repairs, label="prep-reserve")


async def generate_plan_parts(
    ctx: PrepContext, settings: Settings
) -> tuple[PersonaAndArc, list[QuestionLadder], list[CandidateProbe], list[QuestionLadder]]:
    """Run the four calls concurrently and return their validated content. Raises LLMError if any of
    the three REQUIRED parts fails (a plan needs persona/ladders/probes; reserve is best-effort)."""
    with obs.span("interview_prep.generate", input_hash=ctx.input_hash):
        async with build_llm_client(settings, model=settings.prep_llm_model or None) as llm:
            results = await gather_capped(
                [_persona(llm, ctx, settings),
                 _ladders(llm, ctx, settings),
                 _probes(llm, ctx, settings),
                 _reserve(llm, ctx, settings)],
                settings.prep_concurrency,
            )

    persona_res, ladder_res, probe_res, reserve_res = results
    missing = [name for name, res in zip(("persona", "ladders", "probes"), results[:3]) if res is None]
    if missing:
        raise LLMError(f"interview plan generation failed for: {', '.join(missing)}")
    reserve_ladders = reserve_res.ladders if reserve_res is not None else []
    return persona_res, ladder_res.ladders, probe_res.probes, reserve_ladders
