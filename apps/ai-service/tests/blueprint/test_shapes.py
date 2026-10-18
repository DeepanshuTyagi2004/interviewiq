"""Round shapes: order and style of the conversation around the coding, never its minutes."""
import asyncio

from app.blueprint import pipeline, store
from app.blueprint import prompts as P
from app.blueprint.context import Context, build_context
from app.blueprint.shapes import choose_shape, shape_by_id, shapes_for
from app.blueprint.stages import plan_arc
from tests.blueprint.fixtures import request


def _ctx(round_type: str = "dsa", duration_mins: int = 45) -> Context:
    return build_context(request(round_type, round={"type": round_type, "duration_mins": duration_mins}))


def test_every_dsa_shape_keeps_the_round_length_and_the_coding_minutes():
    ctx = _ctx(round_type="dsa", duration_mins=45)
    classic, per_slot, _ = plan_arc(ctx, 2)
    core = next(a.timebox_mins for a in classic if a.phase == "core")
    for shape in shapes_for("dsa", "dsa"):
        arc, slot_mins, _ = plan_arc(ctx, 2, shape=shape)
        assert sum(a.timebox_mins for a in arc) == 45 and slot_mins == per_slot
        assert next(a.timebox_mins for a in arc if a.phase == "core") == core
        assert [a.phase for a in arc] == [p for p in shape.order if p in {a.phase for a in arc}]


def test_straight_in_puts_the_introduction_after_the_coding_with_its_styles():
    arc, _, _ = plan_arc(_ctx(round_type="dsa", duration_mins=45), 2, shape=shape_by_id("straight_in"))
    assert [a.phase for a in arc] == ["greeting", "framing", "core", "candidate_intro", "candidate_questions", "wrap_up"]
    assert {a.phase: a.style for a in arc}["candidate_intro"] == "after_coding"


def test_a_short_round_that_dropped_a_shifted_phase_keeps_the_classic_minutes():
    ctx = _ctx(round_type="dsa", duration_mins=15)            # small talk and the questions are dropped: brisk's shift is not applied
    brisk = [(a.phase, a.timebox_mins) for a in plan_arc(ctx, 1, shape=shape_by_id("brisk"))[0]]
    assert brisk == [(a.phase, a.timebox_mins) for a in plan_arc(ctx, 1)[0]] and sum(m for _, m in brisk) == 15


def test_the_shape_is_seeded_varies_and_avoids_the_last_ones():
    a = choose_shape("s1", "dsa", "dsa")
    assert a == choose_shape("s1", "dsa", "dsa")
    assert len({choose_shape(f"s{i}", "dsa", "dsa").shape_id for i in range(30)}) >= 4
    assert choose_shape("s1", "dsa", "dsa", exclude={a.shape_id}).shape_id != a.shape_id
    assert choose_shape("x", "online-assessment", "dsa").shape_id == "classic"
    assert shape_by_id(None).shape_id == shape_by_id("gone").shape_id == "classic"


def test_the_persona_prompt_names_the_shape():
    text = P.persona_prompt({"company": "x"}, ["greeting"], ["Arjun Mehta"], shape_about="brisk and to the point")
    assert "The round's shape: brisk and to the point." in text


def test_a_candidate_never_gets_the_shape_of_their_last_two_rounds(monkeypatch):
    async def recent(candidate_id, exclude_session, limit=2):
        return ["classic", "brisk"]

    async def none(session_id):
        return None
    monkeypatch.setattr(store, "recent_shapes_for_candidate", recent)
    monkeypatch.setattr(store, "shape_for_session", none)
    for i in range(20):
        shape = asyncio.run(pipeline.pick_shape(_ctx(), f"s{i}", "cand", f"s{i}"))
        assert shape.shape_id not in ("classic", "brisk")


def test_a_re_prepared_blueprint_keeps_its_sessions_shape(monkeypatch):
    async def same(session_id):
        return "projects_first"
    monkeypatch.setattr(store, "shape_for_session", same)
    assert asyncio.run(pipeline.pick_shape(_ctx(), "s1", "cand", "s1")).shape_id == "projects_first"


def test_a_bench_run_chooses_a_shape_without_the_store(monkeypatch):
    async def boom(*a, **k):
        raise AssertionError("bench runs do not read the store")
    monkeypatch.setattr(store, "shape_for_session", boom)
    monkeypatch.setattr(store, "recent_shapes_for_candidate", boom)
    assert asyncio.run(pipeline.pick_shape(_ctx(), "run-1", "cand", None)).shape_id in {s.shape_id for s in shapes_for("dsa", "dsa")}


def test_every_shape_keeps_the_round_length_at_short_durations_for_dsa_and_behavioural():
    for round_type in ("dsa", "behavioural"):
        for minutes in (15, 20, 30, 45):
            ctx = _ctx(round_type=round_type, duration_mins=minutes)
            for shape in shapes_for(round_type, ctx.family):
                arc, _, _ = plan_arc(ctx, 1, shape=shape)
                assert sum(a.timebox_mins for a in arc) == minutes, (round_type, minutes, shape.shape_id, [(a.phase, a.timebox_mins) for a in arc])
