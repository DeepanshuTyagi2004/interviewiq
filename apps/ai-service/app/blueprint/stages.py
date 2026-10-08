"""Stages 4-6 (LLM): persona + arc guidance, personalization, and one playbook per slot."""
from __future__ import annotations

import re

from app.blueprint import fundamentals as F
from app.blueprint import prompts as P
from app.blueprint import selection as S
from app.blueprint.context import Context
from app.blueprint.llm import run_all, structured
from app.blueprint.models import ArcPhase, Branch, Expectations, PersonalizationOut, PersonaStageOut, PlaybookOut, Signal
from app.blueprint.selection import SlotPlan
from app.blueprint.trace import RunTrace, StageError
from app.blueprint.vocabulary import (ACTIONS, DEFAULT_BRANCHES, PINNED_ACTIONS, UNSCORED_PHASES, family,
                                      required_conditions, slot_round_type)
from app.config import Settings

# ---------------------------------------------------------------- arc (deterministic timeboxes)


def culture_minutes(core_mins: int) -> int:
    """Minutes per behavioural question inside a technical round (a mixed round's behavioural part)."""
    return 8 if core_mins >= 40 else 6


def plan_arc(ctx: Context, core_slots: int, culture_slots: int = 0) -> tuple[list[ArcPhase], int, int]:
    """Phases and minutes that always sum to the round duration. Returns (arc, minutes per technical core
    slot, minutes reserved for the resume deep-dive in hiring-manager rounds). Behavioural questions in a
    mixed round take culture_minutes() each out of the core first."""
    d = ctx.duration_mins
    if ctx.round_type == "online-assessment":
        fixed = {"greeting": 1, "framing": 1, "wrap_up": 1}
    else:
        intro = 3 if ctx.family == "behavioural" else 2
        fixed = {"greeting": 1, "small_talk": 2, "framing": 1, "candidate_intro": intro, "candidate_questions": 4, "wrap_up": 1}
    # Short rounds give up small talk and candidate questions before the core shrinks below 10 minutes.
    for phase in ("small_talk", "candidate_questions", "candidate_intro"):
        if d - sum(fixed.values()) >= 10:
            break
        fixed.pop(phase, None)
    core = max(1, d - sum(fixed.values()))
    # The hiring-manager deep-dive (resume probes and the round's own questions) gets two shares: in a real HM
    # round the projects take most of the time, the stock HR questions much less.
    hm = ctx.round_type == "hiring-manager"
    # A design round whose own text is about fundamentals ("core subjects, DBMS, OOP": TCS, Infosys) spends most of
    # its core on them: the one design problem is a warm-up, not the round.
    fundamentals_led = ctx.extra_part and ctx.family == "lld"
    shares = core_slots + (2 if hm or fundamentals_led else 1 if ctx.extra_part else 0)
    culture = culture_slots * culture_minutes(core) if culture_slots else 0
    per_slot = max(1, (core - culture) // max(1, shares))
    deep_dive = core - culture - per_slot * core_slots if hm or ctx.extra_part else 0
    order = ("greeting", "small_talk", "framing", "candidate_intro", "core", "candidate_questions", "wrap_up")
    arc = [ArcPhase(phase=p, timebox_mins=core if p == "core" else fixed[p], scored=p not in UNSCORED_PHASES)
           for p in order if p == "core" or p in fixed]
    return arc, per_slot, deep_dive


# ---------------------------------------------------------------- persona


def _round_view(ctx: Context) -> dict:
    req = ctx.request
    brief = req.company_brief
    return {
        "company": req.session.company, "role": req.session.role, "level": ctx.level_label,
        "round_type": ctx.round_type, "round_name": req.round.name if req.round else None,
        "duration_mins": ctx.duration_mins, "format": ctx.format_label,
        "interviewer_style_notes": brief.interviewer_style_notes if brief else None,
        "company_patterns": brief.company_specific_patterns if brief else None,
        "jd_title": req.job_description.title,
    }


def name_options(seed: str, k: int = 4) -> list[str]:
    """A reproducible shortlist of interviewer names for this session (variety across sessions)."""
    import hashlib
    import random
    rng = random.Random(int(hashlib.sha256(f"persona:{seed}".encode()).hexdigest()[:16], 16))
    return rng.sample(list(P.INTERVIEWER_NAMES), k)


async def persona_stage(ctx: Context, arc: list[ArcPhase], llm, trace: RunTrace, settings: Settings,
                        seed: str = "", time_plan: str = "") -> PersonaStageOut:
    phases = [a.phase for a in arc]
    view = {**_round_view(ctx), **({"time_plan": time_plan} if time_plan else {}),
            "phase_minutes": {a.phase: a.timebox_mins for a in arc}}
    out = await structured(llm, trace, "persona", "persona", P.PERSONA_SYSTEM,
                           # One seeded name, not a shortlist: offered four, the model picked men's names ~80% of
                           # the time; the pool is balanced, so the seeded pick is too.
                           P.persona_prompt(view, phases, name_options(seed or ctx.company, k=1)),
                           PersonaStageOut, settings)
    guidance = {g.phase: g.guidance for g in out.phase_guidance}
    for a in arc:
        a.guidance = guidance.get(a.phase, "")
    return out


# ---------------------------------------------------------------- personalization


def _profile_view(ctx: Context) -> dict:
    return ctx.request.candidate_profile.model_dump(mode="json", exclude_none=True, exclude_defaults=True)


# A round question that is really another coding problem ("Implement a function that checks whether a binary tree
# is balanced"): the slots hold the round's coding; round questions cover its other topics.
_CODING_ASK = re.compile(r"\b(?:write|implement|code)\s+(?:a\s+|an\s+)?(?:\w+\s+){0,2}?(?:function|method|program|algorithm)\b"
                         r"|\bgiven an? (?:array|string|list|binary tree|tree|linked list|matrix|graph|integer array)\b"
                         r"|\bsubarray\b|\blinked list\b|\bleetcode\b", re.I)


def coding_round_questions(out: PersonalizationOut) -> list[str]:
    return [q.prompt for q in out.round_questions if _CODING_ASK.search(q.prompt)]


def time_plan(ctx: Context, plans: list[SlotPlan], per_slot: int, culture_mins: int, deep_dive: int) -> str:
    """How the core phase is spent, for the persona's framing and core guidance (never shown to the candidate)."""
    from app.blueprint.vocabulary import is_culture_slot
    culture = sum(1 for p in plans if p.kind == "core" and is_culture_slot(p.slot_id))
    main = sum(1 for p in plans if p.kind == "core" and not is_culture_slot(p.slot_id))
    parts = ([f"{culture} behavioural question(s) first, about {culture_mins} min each"] if culture else []) + \
            [f"{main} main question(s), about {per_slot} min each"] + \
            ([f"then {deep_dive} min of questions on the candidate's projects and the round's other topics"] if deep_dive else [])
    return "; ".join(parts)


async def personalization_stage(ctx: Context, llm, trace: RunTrace, settings: Settings,
                                planned: list[str] | None = None, seed: str = "") -> PersonalizationOut:
    needs_probes = ctx.round_type == "hiring-manager"
    wants_questions = needs_probes or ctx.extra_part
    rnd = ctx.request.round
    view = {**_round_view(ctx), "level": ctx.level,
            # Internal only (never shown to the candidate): what the round's own description says it covers.
            "round_topics": list(rnd.topics) if rnd else [], "round_notes": (rnd.format or "") if rnd else "",
            "questions_already_planned": list(planned or [])}
    if wants_questions:
        text = " ".join([rnd.name or "", rnd.format or "", *rnd.topics]) if rnd else ""
        view["fundamentals_pool"] = F.pool(F.topics_named(text, ctx.request.candidate_profile.skills), ctx.level,
                                           seed or ctx.company)

    def check(out: PersonalizationOut) -> list[str]:
        problems = ["resume_probes needs at least one entry for a hiring-manager round"] if needs_probes and not out.resume_probes else []
        if ctx.extra_part and not out.round_questions:
            problems.append("round_questions needs 2-4 entries: the round's topics and notes name parts its problems don't cover")
        coding = coding_round_questions(out) if wants_questions else []
        if coding:
            problems.append("round_questions must not be coding or algorithm problems (the round's slots hold those): "
                            + " | ".join(c[:90] for c in coding) + ". Ask about the round's other topics instead "
                            "(fundamentals_pool, the candidate's projects, HR checks)")
        return problems

    out = await structured(llm, trace, "personalization", "personalization", P.PERSONALIZATION_SYSTEM,
                           P.personalization_prompt(view, _profile_view(ctx), needs_probes, wants_questions), PersonalizationOut,
                           settings, check=check)
    # Round questions belong only where the round has time for them; elsewhere they contradicted the slots.
    return out if wants_questions else out.model_copy(update={"round_questions": []})


# ---------------------------------------------------------------- playbooks

def fill_missing(out: PlaybookOut, answer_key: dict) -> PlaybookOut:
    """Expectations and evaluation signals a model left out, taken from the answer key (marked by their wording)."""
    key = (answer_key or {}).get("key") or {}
    update: dict = {}
    if out.expectations is None:
        points = [str(x) for x in (key.get("must_cover") or key.get("key_insights") or [])][:4]
        update["expectations"] = Expectations(must_show=points or ["A clear, specific answer that addresses the question"],
                                              strong_signals=[str(x) for x in (key.get("key_insights") or [])][:3], weak_signals=[])
    if not out.evaluation_signals:
        update["evaluation_signals"] = [Signal(signal="clear communication", observe="Explains their thinking clearly and responds to the interviewer's nudges."),
                                        Signal(signal="covers the key points", observe="Addresses the must-show points of this question.")]
    return out.model_copy(update=update) if update else out


def backfill_branches(out: PlaybookOut, conditions: list[str]) -> PlaybookOut:
    """Add the policy default rule for every required condition the playbook still lacks."""
    covered = {b.condition for b in out.branches}
    added = []
    for condition in conditions:
        if condition in covered:
            continue
        action, say, notes = DEFAULT_BRANCHES[condition]
        added.append(Branch(condition=condition, action=action, say=say, notes=("default rule (backfilled)" + (f": {notes}" if notes else ""))))
    return out.model_copy(update={"branches": [*out.branches, *added]})


def pin_actions(out: PlaybookOut) -> tuple[PlaybookOut, list[str]]:
    """Replace a branch whose action contradicts policy (e.g. seen_before that doesn't switch questions)
    with the default rule. Returns the playbook and the conditions that were replaced."""
    branches, pinned = [], []
    for b in out.branches:
        want = PINNED_ACTIONS.get(b.condition)
        if want and b.action != want:
            action, say, _notes = DEFAULT_BRANCHES[b.condition]
            branches.append(Branch(condition=b.condition, action=action, say=say, notes="policy rule (pinned action)"))
            pinned.append(b.condition)
        else:
            branches.append(b)
    return out.model_copy(update={"branches": branches}), pinned


def _unprefix(text: str, name: str) -> str:
    """Drop a leading "Name:" the model sometimes writes before a spoken line."""
    names = "|".join(re.escape(n) for n in {name, name.split()[0]} if n)
    return re.sub(rf"^\s*(?:{names})\s*:\s*", "", text) if names else text


def _finish(text: str) -> str:
    """A spoken line that trails into a colon ("Let's look at the constraints:") ends as a sentence."""
    stripped = text.rstrip()
    return stripped[:-1].rstrip() + "." if stripped.endswith(":") else text


def tidy_speech(out: PlaybookOut, persona_name: str) -> PlaybookOut:
    ask = out.ask.model_copy(update={"opening": _finish(_unprefix(out.ask.opening, persona_name))})
    branches = []
    for b in out.branches:
        say = _finish(_unprefix(b.say, persona_name))
        if b.condition == "seen_before":
            # The playbook can't know which reserve the interviewer will move to, and named the wrong one.
            say = DEFAULT_BRANCHES["seen_before"][1]
        branches.append(b.model_copy(update={"say": say}))
    return out.model_copy(update={"ask": ask, "branches": branches})


def _spoken_text(out: PlaybookOut) -> str:
    parts = [out.ask.opening, *(f"{c.question} {c.answer}" for c in out.ask.clarifications),
             *(h.hint for h in out.hint_ladder), *(b.say for b in out.branches), *out.probes, *out.follow_ups,
             *(out.expectations.must_show if out.expectations else []), *(out.expectations.strong_signals if out.expectations else []),
             *(f"{s.signal} {s.observe}" for s in out.evaluation_signals)]
    return " ".join(parts)


# Word-only brackets ("[project name]", "<name>") and a lone X/Y/Z ("you mentioned X"); code such as [1, 2, 3],
# Map<String, Integer> or "the X-axis" is left alone.
_PLACEHOLDER = re.compile(r"\[[A-Za-z][A-Za-z _'-]{1,39}\]|(?<!\w)<[A-Za-z][A-Za-z _'-]{1,39}>|\{[A-Za-z][A-Za-z _'-]{1,39}\}"
                          r"|(?<![\w'/-])[XYZ](?![\w'/-])")


def _placeholders(out: PlaybookOut) -> list[str]:
    """Template slots left in lines the interviewer speaks ("Earlier you mentioned X", "[project name]")."""
    spoken = [out.ask.opening, *(c.answer for c in out.ask.clarifications), *(b.say for b in out.branches)]
    found = []
    for line in spoken:
        found += [m.group(0) for m in _PLACEHOLDER.finditer(line or "")]
    return found


# "Thanks for sharing your background, Imran." The candidate's name is never in the data, so a name after a
# greeting or thanks is invented; strip it (", Java." after "Thanks for sharing" is rare and reads fine without).
_INVENTED_NAME = re.compile(r"((?:Thanks|Thank you|Great|Nice|Hi|Hello|Welcome)\b[^.!?\n]*?),\s+[A-Z][a-z]{2,}(?=\s*[.!?,])")


def drop_invented_names(text: str) -> str:
    return _INVENTED_NAME.sub(r"\1", text)


def scrub_placeholders(out: PlaybookOut) -> PlaybookOut:
    """A repaired or backfilled playbook skips the repair check: a branch line that still carries a template slot
    ("you mentioned X") is replaced by the policy default for its condition."""
    branches = []
    for b in out.branches:
        if _PLACEHOLDER.search(b.say) and b.condition in DEFAULT_BRANCHES:
            action, say, _ = DEFAULT_BRANCHES[b.condition]
            b = b.model_copy(update={"action": action if b.condition not in PINNED_ACTIONS else b.action, "say": say,
                                     "notes": "default rule (placeholder replaced)"})
        branches.append(b)
    branches = [b.model_copy(update={"say": drop_invented_names(b.say)}) for b in branches]
    ask = out.ask.model_copy(update={"opening": drop_invented_names(out.ask.opening)})
    if _PLACEHOLDER.search(ask.opening):
        ask = ask.model_copy(update={"opening": _PLACEHOLDER.sub("that", ask.opening)})
    return out.model_copy(update={"branches": branches, "ask": ask, "probes": out.probes[:5], "follow_ups": out.follow_ups[:4]})


def _candidate_view(ctx: Context) -> dict:
    """What the playbook may assume about the candidate: a few facts, nothing invented beyond them."""
    d = ctx.request.candidate_profile.model_dump(mode="json", exclude_none=True)
    view = {
        "level": d.get("level") or ctx.level, "years_experience": d.get("years_experience"), "headline": d.get("headline"),
        "projects": [p.get("name") for p in d.get("projects") or [] if p.get("name")][:3],
        "experience": [" at ".join(x for x in (e.get("title"), e.get("company")) if x) for e in d.get("experience") or []][:3],
        "education": [" ".join(x for x in (e.get("degree"), e.get("field"), e.get("institution")) if x)
                      for e in d.get("education") or []][:1],
    }
    return {k: v for k, v in view.items() if v not in (None, "", [])}


_PROBLEM_FIELDS = {
    "dsa": ("statement", "input_format", "output_format", "constraints", "examples", "hints", "follow_ups", "edge_cases",
            "common_mistakes", "what_it_tests"),
    "system-design": ("prompt", "clarifying_questions", "functional_requirements", "non_functional_requirements",
                      "scale_assumptions", "deep_dives", "follow_ups", "what_it_tests"),
    "lld": ("prompt", "requirements", "entities", "sample_api", "evaluation_mode", "follow_ups", "what_it_tests"),
    "behavioural": ("question", "competency", "what_it_tests", "follow_up_probes", "principle", "deep_dive_guidance"),
}


def _key_summary(answer_key: dict) -> dict:
    key = dict(answer_key.get("key") or {})
    sol = key.pop("reference_solution", None)
    if sol:
        key["reference_solution"] = {"entry_point": sol.get("entry_point"), "verified_against_examples": sol.get("verified_against_examples")}
    return key


def playbook_view(ctx: Context, plan: SlotPlan, problem: dict, answer_key: dict, persona: PersonaStageOut,
                  personalization: PersonalizationOut, timebox: int) -> dict:
    content = problem.get("content") or {}
    fields = _PROBLEM_FIELDS.get(family(slot_round_type(ctx.round_type, plan.slot_id)), ())
    if not S.tied_to_company(problem, ctx):
        # A generic question's "principle" is often another company's (the bank generator's habit).
        fields = tuple(f for f in fields if f != "principle")
    return {
        "persona": {"name": persona.persona.name, "style": persona.persona.style, "disposition": persona.persona.disposition},
        "round": {"type": ctx.round_type, "level": ctx.level, "level_label": ctx.level_label, "company": ctx.company,
                  "level_expectations": personalization.level_expectations},
        "candidate": _candidate_view(ctx),
        "slot": {"kind": plan.kind, "purpose": plan.purpose, "timebox_mins": timebox},
        "problem": {"title": problem.get("title"), "difficulty": problem.get("difficulty"),
                    **{f: content.get(f) for f in fields if content.get(f) not in (None, "", [])}},
        "answer_key": _key_summary(answer_key),
    }


async def playbook_stage(ctx: Context, plans: list[SlotPlan], keyed: dict[str, dict], persona: PersonaStageOut,
                         personalization: PersonalizationOut, per_slot: int | dict[str, int], llm, trace: RunTrace,
                         settings: Settings) -> dict[str, PlaybookOut]:
    def conditions_for(plan: SlotPlan) -> list[str]:
        return list(required_conditions(slot_round_type(ctx.round_type, plan.slot_id)))

    def check_for(problem: dict, conditions: list[str]):
        foreign = S.foreign_terms(ctx, problem)

        def check(out: PlaybookOut) -> list[str]:
            covered = {b.condition for b in out.branches}
            missing = [c for c in conditions if c not in covered]
            problems = [f"missing branches for conditions: {', '.join(missing)}"] if missing else []
            absent = [n for n, v in (("expectations", out.expectations), ("evaluation_signals", out.evaluation_signals)) if not v]
            if absent:
                problems.append(f"missing sections: {', '.join(absent)} (return the complete object)")
            # Placeholders ("you mentioned X") are replaced deterministically by scrub_placeholders: a repair round
            # for them spent two calls per slot on a budget where each call costs a minute.
            named = S.mentions(_spoken_text(out), foreign)
            if named:
                problems.append(f"names {', '.join(sorted(named))}, but this interview is for {ctx.company}: adapt the "
                                f"question to {ctx.company} or keep it company-neutral")
            return problems
        return check

    import asyncio
    sem = asyncio.Semaphore(settings.blueprint_parallel)

    async def one(plan: SlotPlan) -> tuple[str, PlaybookOut]:
        item = keyed[plan.slot_id]
        conditions = conditions_for(plan)
        timebox = per_slot.get(plan.slot_id, 0) if isinstance(per_slot, dict) else per_slot
        view = playbook_view(ctx, plan, item["problem"], item["answer_key"], persona, personalization, timebox)
        async with sem:
            try:
                out = await structured(llm, trace, "playbooks", f"playbook:{plan.slot_id}", P.PLAYBOOK_SYSTEM,
                                       P.playbook_prompt(view, conditions, list(ACTIONS)), PlaybookOut, settings,
                                       check=check_for(item["problem"], conditions), fail_code="playbook_failed")
            except StageError as exc:
                # A playbook that is complete except for a few conditions gets the default rules for them.
                if not isinstance(exc.partial, PlaybookOut):
                    raise
                out = backfill_branches(exc.partial, conditions)
                trace.llm("playbooks", {"label": f"backfill:{plan.slot_id}", "attempt": 0, "valid": True,
                                        "backfilled": [b.condition for b in out.branches if b.notes.startswith("default rule")],
                                        "validation_errors": []})
        out = fill_missing(out, item["answer_key"])
        out, pinned = pin_actions(scrub_placeholders(tidy_speech(out, persona.persona.name)))
        if pinned:
            trace.llm("playbooks", {"label": f"pinned:{plan.slot_id}", "attempt": 0, "valid": True, "pinned": pinned,
                                    "validation_errors": []})
        return plan.slot_id, out

    return dict(await run_all([one(p) for p in plans]))
