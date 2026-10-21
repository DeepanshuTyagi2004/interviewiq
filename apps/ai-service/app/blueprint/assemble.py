"""Stage 8, assemble and validate (spec §6 stage 8, §8.3): build the blueprint, the candidate-safe
briefing and provenance, and check every invariant before anything is stored."""
from __future__ import annotations

import re

from app.blueprint import prompts as P
from app.blueprint.context import Context
from app.blueprint.models import ArcPhase, Blueprint, Briefing, PersonalizationOut, PersonaStageOut, PlaybookOut, Policies, Slot
from app.blueprint.policies import global_signals
from app.blueprint.selection import SlotPlan, behavioural_cores, coding_cores, culture_cores
from app.blueprint.topics import canon
from app.blueprint.vocabulary import UNSCORED_PHASES, is_culture_slot, required_conditions, slot_round_type

_DIFFICULTY_WORDS = ("easy", "medium", "hard")
EXPECTED_SLOTS = {
    "dsa": (2, 2), "online-assessment": (2, 2), "system-design": (1, 1), "lld": (1, 1),
    "behavioural": (4, 3), "hiring-manager": (3, 2),
}


def expected_slots(ctx: Context) -> tuple[int, int]:
    """(core, reserve). A mixed round keeps one technical core (DSA drops its second problem) and adds two
    behavioural cores and a behavioural spare."""
    core, reserve = EXPECTED_SLOTS.get(ctx.round_type, (1, 1))
    if coding_cores(ctx) == 1:
        core = 1
    if ctx.round_type == "behavioural":
        core = behavioural_cores(ctx)
    if not ctx.culture:
        return core, reserve
    return 1 + culture_cores(ctx), reserve + 1


def _leak_terms(slots: list[Slot]) -> set[str]:
    terms: set[str] = set(_DIFFICULTY_WORDS)
    for s in slots:
        p = s.problem
        for value in (p.title, p.slug.split("/")[-1].replace("-", " ")):
            if value and len(value) >= 4:
                terms.add(value.lower())
        topics = canon([*(p.content.get("patterns") or [])]) | canon([p.title])
        terms |= {t.replace("-", " ") for t in topics}
    return terms


def _leaks(text: str, terms: set[str]) -> list[str]:
    low = text.lower()
    return sorted(t for t in terms if re.search(r"(?<![a-z0-9])" + re.escape(t) + r"(?![a-z0-9])", low))


def briefing(ctx: Context, persona: PersonaStageOut, slots: list[Slot]) -> Briefing:
    """Interviewer, format and duration only. A style line that happens to name a topic, a problem or a
    difficulty is dropped to the seniority alone; the invariant check below confirms nothing leaks."""
    terms = _leak_terms(slots)
    style = f"{persona.persona.seniority} · {persona.persona.style}"
    if _leaks(style, terms):
        style = persona.persona.seniority
    return Briefing(interviewer_name=persona.persona.name, interviewer_style=style,
                    format=f"{ctx.duration_mins}-minute {ctx.format_label}", duration_mins=ctx.duration_mins)


def build_slots(plans: list[SlotPlan], keyed: dict[str, dict], playbooks: dict[str, PlaybookOut],
                per_slot: int | dict[str, int], bonus: set[str] | frozenset[str] = frozenset()) -> list[Slot]:
    slots = []
    for plan in plans:
        item = keyed[plan.slot_id]
        problem = item["problem"]
        pb = playbooks[plan.slot_id]
        slots.append(Slot(
            slot_id=plan.slot_id, kind=plan.kind, order=plan.order, purpose=plan.purpose,
            timebox_mins=per_slot.get(plan.slot_id, 0) if isinstance(per_slot, dict) else per_slot,
            bonus=plan.slot_id in bonus,
            problem={"round_type": problem["round_type"], "slug": problem["slug"], "title": problem.get("title", problem["slug"]),
                     "difficulty": problem.get("difficulty"), "content_hash": problem.get("content_hash"),
                     "content": problem.get("content") or {}},
            answer_key=item["answer_key"], ask=pb.ask, hint_ladder=pb.hint_ladder, branches=pb.branches,
            probes=pb.probes, follow_ups=pb.follow_ups, expectations=pb.expectations,
            evaluation_signals=pb.evaluation_signals,
        ))
    return slots


def invariants(ctx: Context, bp: Blueprint) -> list[dict]:
    """Every check, pass or fail, with the reason (shown in diagnostics)."""
    checks: list[dict] = []

    def check(name: str, ok: bool, detail: str = "") -> None:
        checks.append({"check": name, "passed": bool(ok), "detail": detail})

    want_core, want_reserve = expected_slots(ctx)
    core = [s for s in bp.slots if s.kind == "core"]
    reserve = [s for s in bp.slots if s.kind == "reserve"]
    check("slot_counts", len(core) == want_core and len(reserve) == want_reserve,
          f"core {len(core)}/{want_core}, reserve {len(reserve)}/{want_reserve}")
    slugs = [s.problem.slug for s in bp.slots]
    check("unique_problems", len(set(slugs)) == len(slugs), ", ".join(slugs))
    check("problem_content", all(s.problem.content for s in bp.slots), "every slot carries its problem content")
    gaps = {s.slot_id: sorted(set(required_conditions(slot_round_type(ctx.round_type, s.slot_id)))
                              - {b.condition for b in s.branches}) for s in bp.slots}
    gaps = {k: v for k, v in gaps.items() if v}
    check("condition_coverage", not gaps, "; ".join(f"{k}: {', '.join(v)}" for k, v in gaps.items()) or "all conditions covered")
    check("answer_keys", all(s.answer_key.get("key") for s in bp.slots), "every slot has an answer key")
    if ctx.family == "dsa":
        unverified = [s.slot_id for s in bp.slots if not is_culture_slot(s.slot_id)
                      and not ((s.answer_key.get("key") or {}).get("reference_solution") or {}).get("verified_against_examples")]
        check("dsa_keys_verified", not unverified, ", ".join(unverified) or "every reference solution reproduces its examples")
    short = [s.slot_id for s in bp.slots if len(s.hint_ladder) < 3]
    check("hint_ladders", not short, ", ".join(short) or "3+ steps everywhere")
    phases = [a.phase for a in bp.arc]
    check("arc_phases", {"greeting", "core", "wrap_up"} <= set(phases), ", ".join(phases))
    total = sum(a.timebox_mins for a in bp.arc)
    check("arc_timeboxes", abs(total - ctx.duration_mins) <= 1, f"{total} of {ctx.duration_mins} minutes")
    wrong_scoring = [a.phase for a in bp.arc if (a.phase in UNSCORED_PHASES) == a.scored]
    check("arc_scoring", not wrong_scoring, ", ".join(wrong_scoring) or "greeting, small talk, framing and wrap-up are unscored")
    if ctx.round_type == "hiring-manager":
        check("resume_probes", bool(bp.personalization.resume_probes), f"{len(bp.personalization.resume_probes)} probes")
    ungrounded = [h.line for h in bp.personalization.rapport_hooks if not h.source.strip()] + \
                 [p.prompt for p in bp.personalization.resume_probes if not p.grounded_in.strip()]
    check("personalization_grounded", not ungrounded, "; ".join(ungrounded)[:300] or "every hook and probe names its source")
    leaks = _leaks(" ".join([bp.briefing.interviewer_name, bp.briefing.interviewer_style, bp.briefing.format]), _leak_terms(bp.slots))
    check("briefing_leak", not leaks, ", ".join(leaks) or "no topic, problem or difficulty in the briefing")
    check("policies_version", bool(bp.policies.version), bp.policies.version)
    return checks


def provenance(trace_models: list[str], ctx: Context, seed: str, keyed: dict[str, dict], policies: Policies, run_id: str) -> dict:
    hits = sum(1 for v in keyed.values() if v["answer_key"].get("cache_hit"))
    return {
        "models": sorted(set(m for m in trace_models if m)),
        "prompt_versions": {"answer_key": P.KEY_VERSION, "answer_key_extras": P.EXTRAS_KEY_VERSION, "persona": P.PERSONA_VERSION,
                            "personalization": P.PERSONALIZATION_VERSION, "playbook": P.PLAYBOOK_VERSION},
        "policy_version": policies.version, "key_version": P.key_version(ctx.round_type, P.level_band(ctx.level)),
        "selection_seed": seed,
        "answer_key_hits": hits, "answer_key_misses": len(keyed) - hits, "run_id": run_id,
    }


def evaluation(ctx: Context) -> dict:
    return {"global_signals": global_signals(ctx.round_type),
            "note": "Factors to collect during the interview. The score formula is a product decision, not part of the blueprint."}


def round_view(ctx: Context, deep_dive_mins: int) -> dict:
    req = ctx.request
    return {"type": ctx.round_type, "duration_mins": ctx.duration_mins, "company": req.session.company,
            "role": req.session.role, "level": ctx.level_label, "level_canonical": ctx.level,
            "specialization": req.session.specialization, "source": req.round.source if req.round else "brief",
            "name": req.round.name if req.round else None, "format": ctx.format_label,
            "difficulty_target": ctx.difficulty_target, "deep_dive_mins": deep_dive_mins}


def personalization_or_empty(p: PersonalizationOut | None) -> PersonalizationOut:
    return p or PersonalizationOut(level_expectations="Expectations follow the round's level.")


__all__ = ["ArcPhase", "briefing", "build_slots", "invariants", "provenance", "evaluation", "round_view"]
