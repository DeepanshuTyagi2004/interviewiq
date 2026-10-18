"""The realism block drawn at prep: traits, speech habits, outline with its promises, change stance, validation, and how the
pipeline stores it (a bad plan is dropped and logged, an old blueprint has none)."""
import asyncio
import logging
import random

import pytest

from app.blueprint import pipeline, store
from app.blueprint import prompts as P
from app.blueprint import realism as R
from app.blueprint.models import Blueprint, Realism
from app.blueprint.context import build_context
from app.blueprint.shapes import shape_by_id, shapes_for
from app.blueprint.stages import plan_arc
from app.interviewer.fillers import STAGES
from tests.blueprint.fixtures import request

CLASSIC = ["greeting", "small_talk", "framing", "candidate_intro", "core", "candidate_questions", "wrap_up"]
PERSONAL = {
    "resume_probes": [{"prompt": "Walk me through your resume.", "grounded_in": "Resume", "what_it_tests": "intro"},
                      {"prompt": "How did you build Vibe?", "grounded_in": "Vibe", "what_it_tests": "depth"},
                      {"prompt": "What broke in Split app?", "grounded_in": "Split app", "what_it_tests": "debugging"},
                      {"prompt": "Why a queue in Chatty?", "grounded_in": "Chatty", "what_it_tests": "design"}],
    "round_questions": [{"prompt": "How does the JVM manage memory?", "covers": "Java", "what_it_tests": "x"},
                        {"prompt": "Explain database indexes.", "covers": "databases", "what_it_tests": "x"},
                        {"prompt": "What is a deadlock?", "covers": "operating systems", "what_it_tests": "x"},
                        {"prompt": "How does TCP work?", "covers": "networking", "what_it_tests": "x"}],
}
AREAS = ["Java", "databases", "operating systems", "networking"]
PROJECTS = ["Vibe", "Split app", "Chatty"]


def _realism(seed: int, order=None, areas=AREAS, projects=PROJECTS, minutes: int = 45) -> Realism:
    traits = R.draw_realism_traits(seed, [])
    return R.build_realism(seed, traits, "dsa", order or CLASSIC, areas, projects, minutes)


def _view(minutes: int = 45, order=None, dive: int = 8) -> dict:
    return {"round": {"type": "dsa", "duration_mins": minutes, "deep_dive_mins": dive},
            "arc": [{"phase": p} for p in order or CLASSIC], "personalization": PERSONAL}


def test_the_pools_come_from_the_resume_probes_after_the_first_and_the_round_questions():
    assert R.pools(PERSONAL) == (AREAS, PROJECTS)


def _arc_order(seed: int, shape_id: str = "classic", round_type: str = "dsa") -> list[str]:
    ctx = build_context(request(round_type, round={"type": round_type, "duration_mins": 45}))
    arc, _, _ = plan_arc(ctx, 2, shape=shape_by_id(shape_id), swap_intro=R.swap_intro(seed))
    return [a.phase for a in arc]


def test_the_same_seed_gives_the_same_plan_and_other_seeds_differ():
    assert _realism(7) == _realism(7)
    assert R.swap_intro(7) == R.swap_intro(7)
    plans = [_realism(s, order=_arc_order(s)) for s in range(20)]
    assert len({tuple(sorted(p.traits.items())) for p in plans}) >= 15
    assert len({tuple(part.part for part in p.outline) for p in plans}) >= 2
    assert len({tuple(p.habits.acks) for p in plans}) >= 15


def test_the_outline_order_is_always_the_arcs_and_the_classic_arc_has_two_orders():
    orders = set()
    for seed in range(200):
        arc = _arc_order(seed)
        outline = _realism(seed, order=arc).outline
        assert [p.part for p in outline if p.part != "deep_dive"] == arc
        orders.add(tuple(arc))
        assert R.validate_realism(_realism(seed, order=arc), _view(order=arc)) == []
    assert len(orders) == 2
    assert {o.index("framing") < o.index("candidate_intro") for o in orders} == {True, False}
    # every other shape ignores the swap: its arc is its own order
    for shape in shapes_for("dsa", "dsa"):
        if shape.shape_id != "classic":
            assert {tuple(_arc_order(s, shape.shape_id)) for s in range(50)} == {tuple(_arc_order(0, shape.shape_id))}


def test_the_swap_moves_no_minutes_and_the_core_stays_put():
    ctx = build_context(request("dsa", round={"type": "dsa", "duration_mins": 45}))
    plain, per, dive = plan_arc(ctx, 2, shape=shape_by_id("classic"))
    swapped, per2, dive2 = plan_arc(ctx, 2, shape=shape_by_id("classic"), swap_intro=True)
    assert (per, dive) == (per2, dive2)
    assert sorted((a.phase, a.timebox_mins) for a in plain) == sorted((a.phase, a.timebox_mins) for a in swapped)
    assert [a.phase for a in swapped][:4] == ["greeting", "small_talk", "candidate_intro", "framing"]


def test_traits_are_coherent_and_never_a_combination_to_avoid():
    rng = random.Random(1)
    for _ in range(200):
        t = R.draw_traits(rng, [])
        assert set(t) == set(R.TRAIT_AXES) and all(t[a] in R.TRAIT_AXES[a] for a in t) and R.coherent(t)
    first = R.draw_traits(random.Random(5), [])
    for seed in range(100):
        assert R.draw_traits(random.Random(seed), [first]) != first
    # when only one combination is left, that one is drawn; when none is, any
    combos = [dict(zip(R.COMBO_AXES, c)) for c in R._combos()]
    without_register = lambda t: {a: v for a, v in t.items() if a != "register"}
    assert without_register(R.draw_traits(random.Random(0), combos[1:])) == combos[0]
    assert R.coherent(R.draw_traits(random.Random(0), combos))


def test_incoherent_pairs_are_never_drawn():
    for c in R._combos():
        t = dict(zip(R.TRAIT_AXES, c))
        assert not (t["warmth"] == "very warm" and t["formality"] == "formal")
        assert not (t["warmth"] == "reserved" and t["verbosity"] == "chatty")
    assert not R.coherent({**dict(zip(R.TRAIT_AXES, next(iter(R._combos())))), "warmth": "very warm", "formality": "formal"})


def test_habits_stay_inside_the_curated_vocabulary_and_the_declared_sizes():
    from app.blueprint import speech_vocab as V

    for seed in range(60):
        r = _realism(seed)
        h = r.habits
        assert 5 <= len(h.acks) <= 8 and len(set(h.acks)) == len(h.acks) and set(h.acks) <= set(R.ACKS)
        assert 3 <= len(h.backchannels) <= 4 and set(h.backchannels) <= set(R.BACKCHANNELS)
        assert 3 <= len(h.lead_ins) <= 5 and set(h.lead_ins) <= set(R.LEAD_INS)
        assert list(h.fillers) == list(V.STAGES) == [f"stage{i}" for i in range(len(STAGES))]
        for stage in V.STAGES:
            assert 2 <= len(h.fillers[stage]) <= 3 and set(h.fillers[stage]) <= set(R.FILLER_STAGES[stage])
        assert R.habits_problems(h, r.traits) == []


def test_every_filler_stage_has_five_or_six_wordings():
    assert all(5 <= len(stage) <= 6 and len(set(stage)) == len(stage) for stage in STAGES)


def test_every_dsa_shape_keeps_all_its_parts_and_the_core_in_every_outline():
    for shape in shapes_for("dsa", "dsa"):
        for seed in range(40):
            outline = R.draw_outline(random.Random(seed), "dsa", list(shape.order), AREAS, PROJECTS, 45)
            parts = [p.part for p in outline]
            assert "core" in parts and set(shape.order) <= set(parts) and len(set(parts)) == len(parts)
            assert [p for p in parts if p != "deep_dive"] == list(shape.order)
            assert parts[0] == "greeting" and parts[-1] == "wrap_up"
            assert parts[parts.index("core") + 1] == "deep_dive"


def test_promises_are_drawn_from_the_pools_one_to_three_areas_and_one_or_two_projects():
    seen_counts = set()
    for seed in range(80):
        dive = next(p for p in R.draw_outline(random.Random(seed), "dsa", CLASSIC, AREAS, PROJECTS, 45) if p.part == "deep_dive")
        kinds = [R._promise(x) for x in dive.promises]
        areas = [n for k, n in kinds if k == "fundamentals"]
        projects = [n for k, n in kinds if k == "projects"]
        assert 1 <= len(areas) <= 3 and set(areas) <= set(AREAS) and len(set(areas)) == len(areas)
        assert 1 <= len(projects) <= 2 and set(projects) <= set(PROJECTS)
        seen_counts.add((len(areas), len(projects)))
    assert len(seen_counts) >= 4
    # a shorter round promises fewer areas
    for seed in range(40):
        dive = next(p for p in R.draw_outline(random.Random(seed), "dsa", CLASSIC, AREAS, PROJECTS, 30) if p.part == "deep_dive")
        assert sum(1 for x in dive.promises if x.startswith("fundamentals:")) <= 2


def test_no_pools_means_no_deep_dive_and_a_promise_names_what_the_round_holds():
    assert "deep_dive" not in [p.part for p in R.draw_outline(random.Random(1), "dsa", CLASSIC, [], [], 45)]
    only = R.draw_outline(random.Random(1), "dsa", CLASSIC, ["Java"], [], 45)
    assert [p.promises for p in only if p.part == "deep_dive"] == [["fundamentals:Java"]]


def test_the_change_stance_follows_the_firmness():
    for firmness, (low, high) in {"soft": (1, 1), "normal": (1, 2), "firm": (2, 3)}.items():
        seen = {R.change_stance({"firmness": firmness}, random.Random(s)).refusals_prior for s in range(60)}
        assert seen == set(range(low, high + 1))
        assert R.change_stance({"firmness": firmness}).refusals_prior == low
        assert R.change_stance({"firmness": firmness}).firmness == firmness


def test_a_built_plan_is_valid_for_every_seed_and_shape():
    for shape in shapes_for("dsa", "dsa"):
        for seed in range(25):
            order = list(shape.order)
            assert R.validate_realism(_realism(seed, order=order), _view(order=order)) == []
    for minutes in (30, 35, 40, 45):
        assert R.validate_realism(_realism(3, minutes=minutes), _view(minutes=minutes)) == []
    assert R.validate_realism(_realism(3, areas=[], projects=[]), _view(dive=0)) == []


def test_validation_rejects_an_area_that_is_not_in_the_pool():
    r = _realism(4)
    dive = next(p for p in r.outline if p.part == "deep_dive")
    dive.promises.append("fundamentals:Cooking")
    assert any("Cooking" in p for p in R.validate_realism(r, _view()))
    dive.promises[-1] = "projects:Unknown project"
    assert any("Unknown project" in p for p in R.validate_realism(r, _view()))


def test_validation_rejects_a_missing_core_or_a_dropped_part_and_a_bad_order():
    r = _realism(4)
    r.outline = [p for p in r.outline if p.part != "core"]
    assert any("core" in p for p in R.validate_realism(r, _view()))
    r = _realism(4)
    r.outline = [p for p in r.outline if p.part != "framing"]
    assert any("framing" in p for p in R.validate_realism(r, _view()))
    r = _realism(4)
    r.outline.reverse()
    assert R.validate_realism(r, _view())


def test_validation_rejects_an_outline_whose_order_differs_from_the_arc():
    r = _realism(4, order=CLASSIC)
    arc = list(CLASSIC)
    arc[2], arc[3] = arc[3], arc[2]
    assert any("differ from the arc" in p for p in R.validate_realism(r, _view(order=arc)))


def test_validation_rejects_a_round_length_out_of_range():
    for minutes in (15, 29, 46, 60):
        assert any("round length" in p for p in R.validate_realism(_realism(4), _view(minutes=minutes)))
    assert any("round length" in p for p in R.validate_realism(_realism(4), {**_view(), "round": {"type": "dsa"}}))


def test_validation_rejects_bad_traits_habits_and_stance():
    r = _realism(4)
    r.traits = {**r.traits, "warmth": "very warm", "formality": "formal"}
    assert any("incoherent" in p for p in R.validate_realism(r, _view()))
    r = _realism(4)
    r.traits = {**r.traits, "pace": "frantic"}
    assert any("frantic" in p for p in R.validate_realism(r, _view()))
    r = _realism(4)
    r.habits.acks = ["Right.", "Sure.", "Wonderful!", "Got it.", "Okay."]
    assert any("acks" in p for p in R.validate_realism(r, _view()))
    r = _realism(4)
    r.habits.backchannels = ["Mm-hmm."]
    assert any("backchannels" in p for p in R.validate_realism(r, _view()))
    r = _realism(4)
    r.habits.fillers["stage0"] = ["Whatever."] * 3
    assert any("stage0" in p for p in R.validate_realism(r, _view()))
    r = _realism(4)
    r.change.refusals_prior = 9
    assert any("refusals_prior" in p for p in R.validate_realism(r, _view()))
    r = _realism(4)
    r.change.firmness = "soft" if r.traits["firmness"] != "soft" else "firm"
    assert any("firmness" in p for p in R.validate_realism(r, _view()))


def test_a_deep_dive_with_no_time_set_aside_is_invalid():
    assert any("deep dive" in p for p in R.validate_realism(_realism(4), _view(dive=0)))


def test_an_invalid_plan_is_stored_as_none_and_logged():
    log = logging.getLogger(pipeline.logger.name)
    records: list[logging.LogRecord] = []
    handler = logging.Handler()
    handler.emit = records.append                                # type: ignore[method-assign]
    log.addHandler(handler)
    try:
        bad = _realism(4)
        bad.change.refusals_prior = 9
        none, record = pipeline.realism_or_none(lambda: bad, _view(), 4)
        assert none is None and record["kept"] is False and any("refusals_prior" in p for p in record["problems"])
        assert pipeline.realism_or_none(lambda: _realism(4), _view(), 4)[0] is not None
    finally:
        log.removeHandler(handler)
    assert len(records) == 1 and records[0].levelno == logging.WARNING and "realism plan dropped" in records[0].getMessage()


def test_an_old_blueprint_has_no_realism_and_the_block_round_trips():
    assert Blueprint.model_fields["realism"].default is None
    r = _realism(11)
    assert Realism.model_validate(r.model_dump(mode="json")) == r
    assert r.seed >= 0 and isinstance(r.seed, int)


def test_the_persona_prompt_is_told_the_traits():
    traits = R.draw_realism_traits(2, [])
    text = P.persona_prompt({"company": "x"}, ["greeting"], ["Arjun Mehta"], traits=traits)
    assert "Your traits: " in text and f"pace {traits['pace']}" in text and "consistent with them" in text
    assert "Your traits" not in P.persona_prompt({"company": "x"}, ["greeting"], ["Arjun Mehta"])


def test_traits_never_clash_with_the_round_shape():
    for shape_id, banned in R.SHAPE_EXCLUDES.items():
        for seed in range(150):
            t = R.draw_realism_traits(seed, [], shape_id)
            assert R.fits_shape(t, shape_id) and R.coherent(t)
            assert all(t[axis] not in levels for axis, levels in banned.items())
    assert {R.draw_realism_traits(s, [], "chat_first")["warmth"] for s in range(100)} == {"friendly", "very warm"}
    assert {R.draw_realism_traits(s, [], "straight_in")["pace"] for s in range(100)} == {"brisk", "even"}
    assert {R.draw_realism_traits(s, [], "resume_opener")["pace"] for s in range(200)} == {"brisk", "even", "unhurried"}
    r = _realism(4)
    r.traits = {**r.traits, "warmth": "reserved", "pace": "brisk", "formality": "neutral", "verbosity": "normal"}
    view = {**_view(), "shape_id": "chat_first"}
    assert any("clash" in p for p in R.validate_realism(r, view))
    assert not any("clash" in p for p in R.validate_realism(r, _view()))


def test_with_traits_the_persona_prompt_has_one_source_of_manner():
    traits = R.draw_realism_traits(2, [], "chat_first")
    text = P.persona_prompt({"company": "x"}, ["greeting"], ["Arjun Mehta"], shape_about="a longer, warm chat first", traits=traits)
    assert "Write a persona whose manner fits it" not in text and "brisk and direct" not in text
    assert "The round's structure: a longer, warm chat first." in text and "Your traits: " in text
    plain = P.persona_prompt({"company": "x"}, ["greeting"], ["Arjun Mehta"], shape_about="a longer, warm chat first")
    assert "Write a persona whose manner fits it" in plain


def test_a_hiring_manager_or_behavioural_round_promises_no_projects():
    for round_type in ("hiring-manager", "behavioural"):
        areas, projects = R.pools(PERSONAL, round_type)
        assert areas == AREAS and projects == []
        outline = R.draw_outline(random.Random(1), "behavioural", CLASSIC, areas, projects, 45)
        assert not any(x.startswith("projects:") for p in outline for x in p.promises)
        r = _realism(4, projects=PROJECTS)             # a plan that does promise projects is invalid for that round
        view = _view()
        view["round"] = {**view["round"], "type": round_type}
        assert any("project" in p for p in R.validate_realism(r, view))
    assert R.pools(PERSONAL, "dsa")[1] == PROJECTS


def test_project_names_drop_sources_and_shorten_long_values():
    for generic in ("Resume", "resume", "GitHub profile", "LinkedIn", "my GitHub", "LeetCode profile", "Coding profile", "Education", ""):
        assert R.project_name(generic) is None, generic
    assert R.project_name("GitHub: Vibe") == "Vibe" and R.project_name("Resume project: Split app") == "Split app"
    assert R.project_name("Vibe") == "Vibe" and R.project_name("GitHub Analyzer") == "GitHub Analyzer"
    assert R.project_name("Split app - a bill splitter built with Spring Boot and React") == "Split app"
    assert R.project_name("Vibe (Next.js, Postgres)") == "Vibe"
    assert R.project_name("Chat server: websockets, redis and a lot of other things") == "Chat server"
    assert R.project_name("An extremely long project name that never ends and cannot be shortened") is None
    personal = {"resume_probes": [{"prompt": "Tell me about yourself please.", "grounded_in": "Resume"},
                                  {"prompt": "Tell me about Vibe please.", "grounded_in": "Resume"},
                                  {"prompt": "Tell me about it please.", "grounded_in": "GitHub profile"},
                                  {"prompt": "Tell me about Split please.", "grounded_in": "Split app - bill splitter, Spring"},
                                  {"prompt": "Tell me about split again.", "grounded_in": "split APP"}]}
    assert R.pools(personal, "dsa") == ([], ["Split app"])


def test_a_re_prep_keeps_the_sessions_traits_unless_they_no_longer_fit():
    kept = R.draw_realism_traits(3, [], "chat_first")
    with pytest.MonkeyPatch.context() as mp:
        async def boom(*a, **k):
            raise AssertionError("a kept plan does not read the store")
        mp.setattr(store, "recent_traits_for_candidate", boom)
        assert asyncio.run(pipeline.pick_traits(99, "chat_first", "c1", "s1", kept)) == kept

        async def recent(candidate_id, exclude_session, limit=2):
            return [kept]
        mp.setattr(store, "recent_traits_for_candidate", recent)
        clash = {**kept, "warmth": "reserved", "pace": "brisk", "formality": "neutral", "verbosity": "normal"}
        fresh = asyncio.run(pipeline.pick_traits(99, "chat_first", "c1", "s1", clash))
        assert fresh != clash and fresh != kept and R.fits_shape(fresh, "chat_first")
        assert asyncio.run(pipeline.pick_traits(99, "chat_first", "c1", "s1", None)) == fresh
        assert asyncio.run(pipeline.pick_traits(99, "chat_first", "c1", None, None)) == R.draw_realism_traits(99, [], "chat_first")


def test_a_re_prep_reads_both_the_seed_and_the_traits_of_the_session():
    with pytest.MonkeyPatch.context() as mp:
        async def earlier(session_id):
            return {"seed": 777, "traits": {"pace": "even"}}

        async def none(session_id):
            return None
        mp.setattr(store, "realism_for_session", earlier)
        assert asyncio.run(pipeline.pick_realism("s1")) == (777, {"pace": "even"})
        mp.setattr(store, "realism_for_session", none)
        seed, kept = asyncio.run(pipeline.pick_realism("s1"))
        assert 0 <= seed < 2 ** 63 and kept is None
        assert asyncio.run(pipeline.pick_realism(None))[1] is None


def test_a_build_that_raises_falls_back_to_none_with_a_trace_record_and_a_log():
    log = logging.getLogger(pipeline.logger.name)
    records: list[logging.LogRecord] = []
    handler = logging.Handler()
    handler.emit = records.append                                # type: ignore[method-assign]
    log.addHandler(handler)
    try:
        def boom():
            raise ValueError("no pools")
        realism, record = pipeline.realism_or_none(boom, _view(), 42)
    finally:
        log.removeHandler(handler)
    assert realism is None and record["kept"] is False and record["seed"] == 42
    assert record["problems"] == ["build failed: ValueError: no pools"]
    assert len(records) == 1 and "build failed" in records[0].getMessage()
    ok, record = pipeline.realism_or_none(lambda: _realism(4), _view(), 4)
    assert ok is not None and record == {"kept": True, "seed": 4, "problems": []}


# Real probe values seen in rehearsal blueprints: profile field paths and section names, not project names.
REAL_VALUES = ("experience.summary", "projects[0].stack", "projects", "experience summary", "Projects section", "Work experience",
               "Project: Vibe", "github.com/u/vibe", "Internship", "https://github.com/u/vibe", "education[0].degree", "skills")
PROFILE_PROJECTS = ["Vibe", "Split app", "Chat server - websockets, redis and more"]


def test_a_field_path_resolves_to_the_profile_projects_own_name_and_other_paths_promise_nothing():
    assert R.project_name("projects[0].stack", PROFILE_PROJECTS) == "Vibe"
    assert R.project_name("projects[1]", PROFILE_PROJECTS) == "Split app"
    assert R.project_name("projects[2].summary", PROFILE_PROJECTS) == "Chat server"
    assert R.project_name("projects[9].stack", PROFILE_PROJECTS) is None            # no such project
    assert R.project_name("projects[0].stack", []) is None                          # a profile with no projects
    for value in ("experience.summary", "projects", "experience summary", "Projects section", "Work experience", "Internship",
                  "github.com/u/vibe", "https://github.com/u/vibe", "education[0].degree", "skills"):
        assert R.project_name(value, PROFILE_PROJECTS) is None, value
    # a value naming one of the profile's projects gives the profile's spelling; a prefix is dropped
    assert R.project_name("Project: Vibe", PROFILE_PROJECTS) == "Vibe" and R.project_name("the split APP project", PROFILE_PROJECTS) == "Split app"
    assert R.project_name("Some other thing", PROFILE_PROJECTS) is None


def test_without_the_profile_a_field_path_a_section_or_a_link_is_no_project_name():
    for value in REAL_VALUES:
        name = R.project_name(value)
        assert name in (None, "Vibe"), (value, name)           # only "Project: Vibe" yields a name (prefix stripped)
    assert R.project_name("Project: Vibe") == "Vibe"
    assert R.project_name("projects[0].stack") is None and R.project_name("experience.summary") is None


def test_probes_grounded_in_field_paths_promise_the_resolved_project_or_none():
    personal = {"resume_probes": [{"prompt": "Tell me about yourself please.", "grounded_in": "experience.summary"},
                                  {"prompt": "How did you build it please?", "grounded_in": "projects[0].stack"},
                                  {"prompt": "What about your work please?", "grounded_in": "experience.summary"},
                                  {"prompt": "And the other one please?", "grounded_in": "projects[1]"}]}
    assert R.pools(personal, "dsa", PROFILE_PROJECTS) == ([], ["Vibe", "Split app"])
    assert R.pools(personal, "dsa", []) == ([], [])
    assert R.pools(personal, "dsa") == ([], [])
    plan = R.build_realism(1, R.draw_realism_traits(1, []), "dsa", CLASSIC, ["Java"], R.pools(personal, "dsa", [])[1], 45)
    assert [p.promises for p in plan.outline if p.part == "deep_dive"] == [["fundamentals:Java"]]        # no project promised
    view = {**_view(), "personalization": personal, "profile_projects": PROFILE_PROJECTS}
    bad = R.build_realism(1, R.draw_realism_traits(1, []), "dsa", CLASSIC, [], ["projects[0].stack"], 45)
    assert any("projects[0].stack" in p for p in R.validate_realism(bad, view))
    good = R.build_realism(1, R.draw_realism_traits(1, []), "dsa", CLASSIC, [], ["Vibe"], 45)
    assert R.validate_realism(good, view) == []


class _Cursor:
    def __init__(self, docs):
        self.docs = docs

    def sort(self, *a, **k):
        return self

    def __aiter__(self):
        async def gen():
            for d in self.docs:
                yield d
        return gen()


class _Coll:
    def __init__(self, docs):
        self.docs = docs

    async def find_one(self, q, projection=None, sort=None):
        return self.docs[0] if self.docs else None

    def find(self, q, projection=None):
        return _Cursor(self.docs)


def test_a_dropped_plan_still_stores_its_seed_and_traits_for_a_re_prep():
    traits = R.draw_realism_traits(5, [])
    dropped = {"session_id": "s1", "realism": None, "realism_seed": 5, "realism_traits": traits}
    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(store, "get_db", lambda: {store.BLUEPRINTS: _Coll([dropped])})
        assert asyncio.run(store.realism_for_session("s1")) == {"seed": 5, "traits": traits}
        assert asyncio.run(store.recent_traits_for_candidate("c1", "other")) == [traits]
        # a kept plan (and an older stored one) still reads from the block
        kept = {"session_id": "s1", "realism": {"seed": 8, "traits": traits}}
        mp.setattr(store, "get_db", lambda: {store.BLUEPRINTS: _Coll([kept])})
        assert asyncio.run(store.realism_for_session("s1")) == {"seed": 8, "traits": traits}
        mp.setattr(store, "get_db", lambda: {store.BLUEPRINTS: _Coll([{"session_id": "s1"}])})
        assert asyncio.run(store.realism_for_session("s1")) is None
        assert asyncio.run(store.recent_traits_for_candidate("c1", "other")) == []
    assert Blueprint.model_fields["realism_seed"].default is None and Blueprint.model_fields["realism_traits"].default is None
