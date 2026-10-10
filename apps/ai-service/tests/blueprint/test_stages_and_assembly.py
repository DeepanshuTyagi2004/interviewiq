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
