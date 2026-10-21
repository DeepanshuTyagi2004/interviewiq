"""Arc timeboxes, LLM stages (with repair), invariants and the candidate-safe briefing (spec §6, §8.3)."""
import asyncio

import pytest

from app.blueprint import assemble as A
from app.blueprint import stages as ST
from app.blueprint.context import build_context
from app.blueprint.models import Blueprint, PersonalizationOut, PersonaStageOut, PlaybookOut
from app.blueprint.policies import policies
from app.blueprint.selection import SlotPlan
from app.blueprint.trace import StageError
from app.blueprint.vocabulary import required_conditions
from tests.blueprint.fixtures import FakeLLM, MemoryTrace, dsa_doc, dsa_key_reply, playbook_reply, request


class _Settings:
    blueprint_concurrency = 2
    blueprint_parallel = 2
    blueprint_quota_retries = 0
    blueprint_transient_retries = 0


PERSONA = {"persona": {"name": "Asha Rao", "seniority": "Senior Engineer", "style": "calm, asks why",
                       "disposition": "patient and encouraging", "opening": "Hi, I'm Asha. How's your day?",
                       "closing": "Thanks for your time today!"},
           "phase_guidance": [{"phase": "greeting", "guidance": "warm hello and name"}]}


@pytest.mark.parametrize("round_type,duration", [("dsa", 45), ("system-design", 60), ("behavioural", 45),
                                                  ("hiring-manager", 45), ("online-assessment", 60), ("dsa", 20)])
def test_arc_always_sums_to_the_duration(round_type, duration):
    ctx = build_context(request(round_type, round={"type": round_type, "duration_mins": duration}))
    arc, per_slot, deep = ST.plan_arc(ctx, 2)
    assert sum(a.timebox_mins for a in arc) == duration
    assert [a.phase for a in arc][0] == "greeting" and arc[-1].phase == "wrap_up"
    assert all(not a.scored for a in arc if a.phase in {"greeting", "small_talk", "framing", "wrap_up"})
    core = next(a.timebox_mins for a in arc if a.phase == "core")
    assert per_slot * 2 + deep == core if round_type == "hiring-manager" else per_slot * 2 <= core


def test_playbook_missing_conditions_get_one_repair_then_policy_defaults():
    ctx = build_context(request())
    conditions = list(required_conditions("dsa"))
    plan = SlotPlan("core-1", "core", 1, "first problem")
    keyed = {"core-1": {"problem": dsa_doc("p"), "answer_key": {"key": dsa_key_reply(), "cache_hit": False}}}
    persona = PersonaStageOut.model_validate(PERSONA)
    pers = PersonalizationOut(level_expectations="Solid fundamentals expected.")
    partial = playbook_reply(conditions[:-1])
    llm = FakeLLM({"playbook": [partial, playbook_reply(conditions)]})
    out = asyncio.run(ST.playbook_stage(ctx, [plan], keyed, persona, pers, 15, llm, MemoryTrace(), _Settings()))
    assert {b.condition for b in out["core-1"].branches} == set(conditions)
    assert "missing branches for conditions" in llm.calls[1][1]
    # Still missing after the repair: the policy default rules fill the gap, marked as backfilled.
    trace = MemoryTrace()
    filled = asyncio.run(ST.playbook_stage(ctx, [plan], keyed, persona, pers, 15, FakeLLM({"playbook": partial}), trace, _Settings()))
    added = [b for b in filled["core-1"].branches if b.notes.startswith("default rule")]
    assert [b.condition for b in added] == conditions[-1:]
    assert any(r.get("backfilled") == conditions[-1:] for r in trace.records)
    # A reply that never even validates still fails the run.
    broken = {"ask": {"opening": "x"}, "branches": []}
    with pytest.raises(StageError) as err:
        asyncio.run(ST.playbook_stage(ctx, [plan], keyed, persona, pers, 15, FakeLLM({"playbook": broken}), MemoryTrace(), _Settings()))
    assert err.value.code == "playbook_failed"


def test_unknown_conditions_and_actions_are_dropped_not_fatal():
    reply = playbook_reply(["stuck"])
    reply["branches"].append({"condition": "made_up", "action": "encourage", "say": "x y z"})
    reply["branches"].append({"condition": "stuck", "action": "dance", "say": "x y z"})
    assert [b.condition for b in PlaybookOut.model_validate(reply).branches] == ["stuck"]


def test_hiring_manager_personalization_requires_resume_probes():
    ctx = build_context(request("hiring-manager", round={"type": "hiring-manager"}))
    empty = {"rapport_hooks": [], "resume_probes": [], "level_expectations": "Owns delivery end to end."}
    with pytest.raises(StageError):
        asyncio.run(ST.personalization_stage(ctx, FakeLLM({"personalization": empty}), MemoryTrace(), _Settings()))


def _blueprint(ctx, style="calm, asks why") -> Blueprint:
    persona = PersonaStageOut.model_validate({**PERSONA, "persona": {**PERSONA["persona"], "style": style}})
    arc, per_slot, _ = ST.plan_arc(ctx, 2)
    conditions = list(required_conditions("dsa"))
    plans, keyed, playbooks = [], {}, {}
    for i, (sid, kind) in enumerate([("core-1", "core"), ("core-2", "core"), ("reserve-harder", "reserve"), ("reserve-alternate", "reserve")], 1):
        plans.append(SlotPlan(sid, kind, i, "x"))
        key = dsa_key_reply()
        key["reference_solution"]["verified_against_examples"] = True
        keyed[sid] = {"problem": dsa_doc(f"problem-{i}", title=f"Rotting Oranges {i}"), "answer_key": {"key": key, "cache_hit": False}}
        playbooks[sid] = PlaybookOut.model_validate(playbook_reply(conditions))
    slots = A.build_slots(plans, keyed, playbooks, per_slot)
    return Blueprint(blueprint_id="b", session_id="s1", candidate_id="c1", version=1, status="current", input_hash="h",
                     run_id="r", created_at="t", round=A.round_view(ctx, 0), persona=persona.persona, arc=arc,
                     personalization=PersonalizationOut(level_expectations="Solid fundamentals expected."),
                     slots=slots, policies=policies(), evaluation=A.evaluation(ctx),
                     briefing=A.briefing(ctx, persona, slots), provenance={})


def test_a_complete_blueprint_passes_every_invariant():
    ctx = build_context(request())
    checks = A.invariants(ctx, _blueprint(ctx))
    assert [c for c in checks if not c["passed"]] == []


def test_briefing_never_names_a_problem_topic_or_difficulty():
    ctx = build_context(request())
    bp = _blueprint(ctx, style="loves hard rotting oranges questions")
    assert bp.briefing.interviewer_style == "Senior Engineer"   # the leaking style line is dropped
    assert bp.briefing.format == "45-minute coding interview with a shared editor"
    bp.briefing.interviewer_style = "asks hard questions"
    failed = {c["check"] for c in A.invariants(ctx, bp) if not c["passed"]}
    assert failed == {"briefing_leak"}


def test_invariants_catch_missing_coverage_and_bad_timeboxes():
    ctx = build_context(request())
    bp = _blueprint(ctx)
    bp.slots[0].branches = bp.slots[0].branches[:3]
    bp.arc[0].timebox_mins += 5
    failed = {c["check"] for c in A.invariants(ctx, bp) if not c["passed"]}
    assert {"condition_coverage", "arc_timeboxes"} <= failed


def test_interviewer_names_vary_by_session_and_are_reproducible():
    assert ST.name_options("session-1") == ST.name_options("session-1")
    assert len({tuple(ST.name_options(f"s{i}")) for i in range(10)}) > 1
    assert len(set(ST.name_options("x"))) == 4


def test_a_round_with_no_stated_length_is_forty_five_minutes_whatever_its_type():
    from app.blueprint.context import MOCK_ROUND_MINUTES

    assert MOCK_ROUND_MINUTES == 45
    for round_type in ("dsa", "online-assessment", "system-design", "lld", "behavioural", "hiring-manager"):
        ctx = build_context(request(round_type, round={"type": round_type, "duration_mins": None}))
        assert ctx.duration_mins == 45
        arc, _, _ = ST.plan_arc(ctx, 1)
        assert sum(a.timebox_mins for a in arc) == 45


def test_every_interviewer_is_a_man():
    """Decided 2026-10-16: every interviewer is male, with a different name each round."""
    from app.blueprint.prompts import INTERVIEWER_NAMES
    from app.interviewer.voices import persona_gender

    assert len(INTERVIEWER_NAMES) >= 30
    assert [n for n in INTERVIEWER_NAMES if persona_gender({"name": n}) != "male"] == []
    from app.blueprint import prompts as P

    assert "he is a man" in P.persona_prompt({}, ["greeting"], ["Arjun Nair"]).lower()


def test_a_candidate_never_gets_an_interviewer_name_they_have_had_before():
    from app.blueprint.prompts import INTERVIEWER_NAMES

    pool = list(INTERVIEWER_NAMES)
    assert ST.name_options("s1", k=1, exclude=set(pool[:-1])) == [pool[-1]]
    assert len(ST.name_options("s1", k=1, exclude=set(pool))) == 1          # every name used: any name, never none


@pytest.mark.parametrize("duration", [30, 35, 40, 45])
def test_a_two_problem_coding_round_gives_the_first_problem_fifteen_minutes_and_the_arc_sums_to_the_length(duration):
    from app.blueprint.shapes import shapes_for

    ctx = build_context(request("dsa", round={"type": "dsa", "duration_mins": duration}))
    for shape in [None, *shapes_for("dsa", "dsa")]:
        arc, per_slot, _ = ST.plan_arc(ctx, 2, shape=shape)
        assert sum(a.timebox_mins for a in arc) == duration
        assert per_slot >= ST.MIN_FIRST_PROBLEM_MINS
        assert next(a.timebox_mins for a in arc if a.phase == "core") >= per_slot  # the first problem fits inside the core


def test_at_thirty_minutes_the_second_problem_is_a_bonus_not_a_share_of_the_core():
    ctx = build_context(request("dsa", round={"type": "dsa", "duration_mins": 30}))
    arc, per_slot, _ = ST.plan_arc(ctx, 2)
    core = next(a.timebox_mins for a in arc if a.phase == "core")
    assert per_slot == 15 and core == 19 and per_slot * 2 > core
    plans = [SlotPlan("core-1", "core", 1, "first problem"), SlotPlan("core-2", "core", 2, "second problem")]
    assert "only if the first goes well" in ST.time_plan(ctx, plans, per_slot, 6, 0, core)
    # At 45 minutes both problems fit the core, so the plan makes no such caveat.
    ctx45 = build_context(request("dsa", round={"type": "dsa", "duration_mins": 45}))
    arc45, per45, _ = ST.plan_arc(ctx45, 2)
    core45 = next(a.timebox_mins for a in arc45 if a.phase == "core")
    assert per45 * 2 <= core45
    assert "only if" not in ST.time_plan(ctx45, plans, per45, 6, 0, core45)


def test_a_single_problem_round_and_a_design_round_keep_their_equal_shares():
    ctx = build_context(request("dsa", round={"type": "dsa", "duration_mins": 30}))
    arc, per_slot, _ = ST.plan_arc(ctx, 1)
    assert per_slot == next(a.timebox_mins for a in arc if a.phase == "core")
    hm = build_context(request("hiring-manager", round={"type": "hiring-manager", "duration_mins": 30}))
    arc, per_slot, deep = ST.plan_arc(hm, 2)
    core = next(a.timebox_mins for a in arc if a.phase == "core")
    assert per_slot * 2 + deep == core


def _mixed_ctx(minutes: int):
    rnd = {"type": "dsa", "name": "Coding + Leadership Principles", "topics": ["Arrays", "Leadership Principles"], "problems": [],
           "difficulty": "medium", "duration_mins": minutes}
    ctx = build_context(request(round=rnd))
    assert ctx.culture and ctx.family == "dsa"
    return ctx


@pytest.mark.parametrize("minutes", [30, 35, 40, 45])
def test_a_coding_round_with_a_behavioural_part_keeps_the_first_problem_at_fifteen_minutes_by_asking_fewer_questions(minutes):
    from app.blueprint import selection as S
    from app.blueprint.assemble import expected_slots
    from app.blueprint.context import culture_minutes

    ctx = _mixed_ctx(minutes)
    kept = S.culture_cores(ctx)
    assert kept == {30: 1, 35: 2, 40: 2, 45: 2}[minutes]
    assert expected_slots(ctx) == (1 + kept, 3)          # one coding problem + the kept questions; two coding reserves and a spare question
    specs = [s.slot_id for s in S.slot_specs(ctx)]
    assert [s for s in specs if s.startswith("culture-") and s != "culture-reserve"] == [f"culture-{n}" for n in range(1, kept + 1)]
    arc, per_slot, deep = ST.plan_arc(ctx, 1, kept)
    core = next(a.timebox_mins for a in arc if a.phase == "core")
    each = culture_minutes(core, kept)
    assert sum(a.timebox_mins for a in arc) == minutes
    assert per_slot >= ST.MIN_FIRST_PROBLEM_MINS and each >= 4
    assert per_slot + kept * each == core                       # the core is filled exactly: the question minutes left go to the problem
    assert deep == 0


def _extra_ctx(minutes: int):
    rnd = {"type": "dsa", "name": "DSA and puzzles", "topics": ["Data structures", "Puzzles"], "problems": [],
           "difficulty": "medium", "duration_mins": minutes}
    ctx = build_context(request(round=rnd))
    assert ctx.extra_part
    return ctx


@pytest.mark.parametrize("minutes", [30, 35, 40, 45])
def test_a_coding_round_with_an_extra_part_gives_the_first_problem_fifteen_minutes_and_the_extra_part_the_rest(minutes):
    from app.blueprint.selection import SlotPlan

    ctx = _extra_ctx(minutes)
    arc, per_slot, deep = ST.plan_arc(ctx, 2)
    core = next(a.timebox_mins for a in arc if a.phase == "core")
    assert sum(a.timebox_mins for a in arc) == minutes
    plans = [SlotPlan("core-1", "core", 1, "first"), SlotPlan("core-2", "core", 2, "second")]
    if minutes == 45:
        # The floor is for the shorter lengths (decided 2026-10-18, final review I7): 45 keeps the pre-change split, two 11-minute problems and a
        # 12-minute deep dive, and the second problem is not a bonus.
        assert (per_slot, deep, core) == (11, 12, 34)
        assert ST.bonus_slots(plans, {p.slot_id: per_slot for p in plans}, core, deep) == set()
        return
    assert per_slot >= ST.MIN_FIRST_PROBLEM_MINS and deep > 0
    assert per_slot + deep <= core                              # the first problem and the extra part fit; the second problem is a bonus
    assert ST.bonus_slots(plans, {p.slot_id: per_slot for p in plans}, core, deep) == {"core-2"}


def test_bonus_slots_are_only_problems_the_core_does_not_hold():
    from app.blueprint.selection import SlotPlan

    plans = [SlotPlan("core-1", "core", 1, "a"), SlotPlan("core-2", "core", 2, "b"), SlotPlan("reserve-alternate", "reserve", 3, "c")]
    assert ST.bonus_slots(plans, {p.slot_id: 15 for p in plans}, 19, 0) == {"core-2"}
    assert ST.bonus_slots(plans, {p.slot_id: 17 for p in plans}, 34, 0) == set()        # 45 minutes: both fit, as before
    assert ST.bonus_slots(plans[:1], {"core-1": 15}, 10, 0) == set()                    # the first problem is never a bonus


def test_the_slot_carries_the_bonus_flag_and_an_old_blueprint_without_it_reads_false():
    from app.blueprint.models import Slot

    plan = SlotPlan("core-2", "core", 2, "second")
    keyed = {"core-2": {"problem": dsa_doc("p"), "answer_key": {"key": dsa_key_reply(), "cache_hit": False}}}
    pbs = {"core-2": PlaybookOut.model_validate(playbook_reply(list(required_conditions("dsa"))))}
    assert A.build_slots([plan], keyed, pbs, {"core-2": 15}, {"core-2"})[0].bonus is True
    slot = A.build_slots([plan], keyed, pbs, {"core-2": 15})[0]
    assert slot.bonus is False
    old = {k: v for k, v in slot.model_dump().items() if k != "bonus"}
    assert Slot.model_validate(old).bonus is False


def _both_ctx(minutes: int):
    rnd = {"type": "dsa", "name": "Coding + Leadership Principles", "topics": ["Arrays", "Leadership Principles", "your projects"],
           "problems": [], "difficulty": "medium", "duration_mins": minutes}
    ctx = build_context(request(round=rnd))
    return ctx


@pytest.mark.parametrize("minutes", [30, 35, 40, 45])
def test_a_coding_round_with_both_a_behavioural_and_an_extra_part_keeps_every_part_it_names_at_its_minimum(minutes):
    from app.blueprint import selection as S
    from app.blueprint.context import MIN_CULTURE_MINS, MIN_EXTRA_MINS, culture_minutes

    ctx = _both_ctx(minutes)
    assert ctx.culture and (ctx.extra_part is (minutes > 30))              # at 30 minutes the extra part does not fit and is dropped
    kept = S.culture_cores(ctx)
    arc, per_slot, deep = ST.plan_arc(ctx, 1, kept)
    core = next(a.timebox_mins for a in arc if a.phase == "core")
    each = culture_minutes(core, kept, ctx.extra_part, minutes < 45)
    assert sum(a.timebox_mins for a in arc) == minutes
    assert per_slot >= ST.MIN_FIRST_PROBLEM_MINS or minutes == 45          # 45 minutes keeps the pre-change split (below)
    if minutes == 45:
        assert (kept, each, per_slot, deep) == (2, 6, 11, 11)
    assert kept >= 1 and each >= MIN_CULTURE_MINS
    assert deep == 0 or deep >= MIN_EXTRA_MINS                              # a present extra part has its minimum
    assert (deep > 0) == ctx.extra_part                                      # and a dropped one has no time
    assert per_slot + kept * each + deep <= core
    # The briefing's format line names exactly the parts the plan has.
    assert ("behavioural questions" in ctx.format_label) is True
    assert ("projects and fundamentals" in ctx.format_label) is ctx.extra_part


def test_the_both_parts_round_at_30_and_35_has_the_exact_split():
    from app.blueprint import selection as S
    at30, at35 = _both_ctx(30), _both_ctx(35)
    assert (S.culture_cores(at30), ST.plan_arc(at30, 1, 1)[1:]) == (1, (15, 0))
    assert (S.culture_cores(at35), ST.plan_arc(at35, 1, 1)[1:]) == (1, (15, 4))     # 15 + one 5-minute question + 4 for the extra part = the 24-minute core


DESIGN_ROUNDS = [("lld", "Machine coding", "Machine coding + behavioural"), ("system-design", "System design", "System design + behavioural")]


def _design_ctx(round_type: str, minutes: int, behavioural: bool, extra: bool):
    name = {"lld": "Machine coding", "system-design": "System design"}[round_type] + (" + behavioural" if behavioural else "")
    topics = (["Behavioural"] if behavioural else []) + (["your projects"] if extra else []) + ["Scaling"]
    return build_context(request(round_type, round={"type": round_type, "name": name, "topics": topics, "problems": [],
                                                    "difficulty": "medium", "duration_mins": minutes}))


@pytest.mark.parametrize("round_type", ["lld", "system-design"])
@pytest.mark.parametrize("behavioural,extra", [(True, False), (False, True), (True, True)])
@pytest.mark.parametrize("minutes", [30, 35, 40, 45])
def test_a_design_round_gives_its_main_problem_fifteen_minutes_and_keeps_every_part_it_names_at_its_minimum(round_type, behavioural, extra, minutes):
    from app.blueprint import selection as S
    from app.blueprint.context import MIN_CULTURE_MINS, MIN_EXTRA_MINS, culture_minutes

    ctx = _design_ctx(round_type, minutes, behavioural, extra)
    assert ctx.culture is behavioural
    fundamentals_led = ctx.extra_part and ctx.family == "lld"                 # its design problem is a warm-up: no floor (below)
    kept = S.culture_cores(ctx)
    arc, per_slot, deep = ST.plan_arc(ctx, 1, kept)
    core = next(a.timebox_mins for a in arc if a.phase == "core")
    floor = minutes < 45                                                          # 45 minutes keeps the pre-change split (decided 2026-10-18)
    each = culture_minutes(core, kept, ctx.extra_part, floor, fundamentals_led) if kept else 0
    assert sum(a.timebox_mins for a in arc) == minutes
    if not fundamentals_led and floor:
        assert per_slot >= ST.MIN_FIRST_PROBLEM_MINS
    if not floor:
        shares = 1 + (2 if fundamentals_led else 1 if extra else 0)
        assert kept == (2 if behavioural else 0) and each == (6 if behavioural else 0)
        assert per_slot == (core - kept * each) // shares and deep == (core - kept * each - per_slot if extra else 0)
    assert (kept == 0) is (not behavioural) and (kept == 0 or (kept >= 1 and each >= MIN_CULTURE_MINS))
    assert deep == 0 or deep >= MIN_EXTRA_MINS
    assert (deep > 0) == ctx.extra_part
    assert per_slot + kept * each + deep <= core
    assert ("behavioural questions" in ctx.format_label) is behavioural
    assert ("projects and fundamentals" in ctx.format_label) is ctx.extra_part
    if not extra and behavioural:
        assert per_slot + kept * each == core                      # one problem and no extra part: the core is filled exactly


@pytest.mark.parametrize("behavioural", [False, True])
@pytest.mark.parametrize("minutes", [30, 35, 40, 45])
def test_a_fundamentals_led_design_round_keeps_its_warm_up_split_at_every_length(behavioural, minutes):
    """The design problem is a warm-up and the fundamentals the main part (TCS, Infosys): no 15-minute floor, the pre-change split."""
    from app.blueprint import selection as S

    ctx = _design_ctx("lld", minutes, behavioural, True)
    assert ctx.extra_part and S.culture_cores(ctx) == (2 if behavioural else 0)       # nothing dropped, nothing shrunk
    arc, per_slot, deep = ST.plan_arc(ctx, 1, S.culture_cores(ctx))
    core = next(a.timebox_mins for a in arc if a.phase == "core")
    culture = 2 * (8 if core >= 40 else 6) if behavioural else 0
    assert sum(a.timebox_mins for a in arc) == minutes
    assert per_slot == (core - culture) // 3 and deep == core - culture - per_slot       # one share to the problem, two to the fundamentals
    assert deep >= 2 * per_slot - 1 and deep >= 4 and (not behavioural or culture // 2 >= 4)   # every part at least its minimum
    if not behavioural:
        assert (minutes, per_slot, deep) == {30: (30, 6, 13), 35: (35, 8, 16), 40: (40, 9, 20), 45: (45, 11, 23)}[minutes]


@pytest.mark.parametrize("round_type", ["lld", "system-design"])
def test_design_rounds_whose_equal_split_already_gives_the_main_problem_fifteen_minutes_are_unchanged(round_type):
    from app.blueprint.context import culture_minutes

    for minutes in (40, 45):                                          # behavioural part only
        ctx = _design_ctx(round_type, minutes, True, False)
        arc, per_slot, _ = ST.plan_arc(ctx, 1, 2)
        core = next(a.timebox_mins for a in arc if a.phase == "core")
        normal = 8 if core >= 40 else 6
        assert culture_minutes(core, 2, False, True) == normal and per_slot == core - 2 * normal and per_slot >= 15
    if round_type == "system-design":                                 # extra part only: two shares at 45 minutes
        ctx = _design_ctx(round_type, 45, False, True)
        arc, per_slot, deep = ST.plan_arc(ctx, 1)
        core = next(a.timebox_mins for a in arc if a.phase == "core")
        assert per_slot == core // 2 and deep == core - per_slot


# ------------------------------------------------------------------ final review wave (decided 2026-10-18)

# (behavioural questions kept, core minutes, main problem minutes, extra part minutes) per round kind and length. 45 minutes is the pre-change split
# of every kind (the floor is below 45 only); 30, 35 and 40 are what the floor gave when it was written and must not move.
_SPLITS = {
    ("plain", 30): (0, 19, 15, 0), ("plain", 35): (0, 24, 15, 0), ("plain", 40): (0, 29, 15, 0), ("plain", 45): (0, 34, 17, 0),
    ("extra", 30): (0, 19, 15, 4), ("extra", 35): (0, 24, 15, 9), ("extra", 40): (0, 29, 15, 14), ("extra", 45): (0, 34, 11, 12),
    ("mixed", 30): (1, 19, 15, 0), ("mixed", 35): (2, 24, 16, 0), ("mixed", 40): (2, 29, 17, 0), ("mixed", 45): (2, 34, 22, 0),
    ("both", 30): (1, 19, 15, 0), ("both", 35): (1, 24, 15, 4), ("both", 40): (2, 29, 15, 4), ("both", 45): (2, 34, 11, 11),
    ("system-design", 30): (1, 19, 15, 0), ("system-design", 35): (2, 24, 16, 0), ("system-design", 40): (2, 29, 17, 0), ("system-design", 45): (2, 34, 22, 0),
    ("system-design+extra", 30): (0, 19, 15, 4), ("system-design+extra", 35): (0, 24, 15, 9), ("system-design+extra", 40): (0, 29, 15, 14),
    ("system-design+extra", 45): (0, 34, 17, 17),
    ("system-design+both", 30): (1, 19, 15, 0), ("system-design+both", 35): (1, 24, 15, 4), ("system-design+both", 40): (2, 29, 15, 4),
    ("system-design+both", 45): (2, 34, 11, 11),
    ("lld", 30): (1, 19, 15, 0), ("lld", 35): (2, 24, 16, 0), ("lld", 40): (2, 29, 17, 0), ("lld", 45): (2, 34, 22, 0),
    ("lld+extra", 30): (0, 19, 6, 13), ("lld+extra", 35): (0, 24, 8, 16), ("lld+extra", 40): (0, 29, 9, 20), ("lld+extra", 45): (0, 34, 11, 23),
    ("lld+both", 30): (2, 19, 2, 5), ("lld+both", 35): (2, 24, 4, 8), ("lld+both", 40): (2, 29, 5, 12), ("lld+both", 45): (2, 34, 7, 15),
}


@pytest.mark.parametrize("kind,minutes", sorted(_SPLITS))
def test_the_first_problem_floor_is_below_45_minutes_only_and_45_keeps_the_pre_change_split_of_every_round_kind(kind, minutes):
    """Final review I7: an extra-part coding round at 45 minutes lost its second problem to the floor; every 45-minute round keeps the old split."""
    from app.blueprint import selection as S
    from app.blueprint.context import has_problem_floor

    if kind in ("plain", "extra", "mixed", "both"):
        ctx = {"plain": lambda m: build_context(request("dsa", round={"type": "dsa", "duration_mins": m})), "extra": _extra_ctx, "mixed": _mixed_ctx,
               "both": _both_ctx}[kind](minutes)
        slots = 2 if kind in ("plain", "extra") else 1
    else:
        base, _, part = kind.partition("+")
        ctx = _design_ctx(base, minutes, part in ("", "both"), part in ("extra", "both"))        # "system-design" alone is its behavioural-part round
        slots = 1
    assert has_problem_floor(ctx.round_type, ctx.family, minutes) is (minutes < 45 and ctx.family in ("dsa", "lld", "system-design"))
    kept = S.culture_cores(ctx)
    arc, per_slot, deep = ST.plan_arc(ctx, slots, kept) if slots == 1 else ST.plan_arc(ctx, slots)
    core = next(a.timebox_mins for a in arc if a.phase == "core")
    assert sum(a.timebox_mins for a in arc) == minutes
    assert (kept, core, per_slot, deep) == _SPLITS[(kind, minutes)]
    if kind == "extra" and minutes == 45:
        from app.blueprint.selection import SlotPlan
        plans = [SlotPlan("core-1", "core", 1, "first"), SlotPlan("core-2", "core", 2, "second")]
        assert ST.bonus_slots(plans, {p.slot_id: per_slot for p in plans}, core, deep) == set()          # the second problem is not a bonus


def test_global_signals_by_round_type_keep_todays_lists():
    from app.blueprint.policies import global_signals
    common = ["communication", "receptiveness", "composure"]
    dsa = [s["signal"] for s in global_signals("dsa")]
    assert dsa == ["problem_understanding", "approach", "coding", "testing", "complexity", *common]
    assert [s["signal"] for s in global_signals("online-assessment")] == dsa
    behavioural = [s["signal"] for s in global_signals("behavioural")]
    assert behavioural == ["structure", "ownership", "impact", "self_awareness", *common]
    assert global_signals("hiring-manager") == global_signals("behavioural")


def test_global_signals_for_design_rounds_keep_todays_lists():
    from app.blueprint.policies import global_signals
    common = ["communication", "receptiveness", "composure"]
    assert [s["signal"] for s in global_signals("system-design")] == ["requirements", "design", "trade_offs", "scale_and_failure", *common]
    assert [s["signal"] for s in global_signals("lld")] == ["modelling", "design_quality", "extensibility", "code", *common]
