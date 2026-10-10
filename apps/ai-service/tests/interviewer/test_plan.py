from app.interviewer.plan import MIN_BACKGROUND_TURNS, MIN_TURNS, build_items, format_args, layout_for, problem_payload, reserve_slots, reveal_text, round_seconds, slot_by_id, wire_ids
from tests.interviewer.fixtures import blueprint, context


def test_items_follow_the_arc_with_core_problems_in_order():
    items = build_items(blueprint())
    assert [(i.item_id, i.kind) for i in items] == [
        ("greeting", "phase"), ("candidate_intro", "phase"), ("core-1", "slot"), ("core-2", "slot"),
        ("candidate_questions", "phase"), ("wrap_up", "phase")]
    assert items[2].max_seconds == 1200 and items[0].max_seconds == 60
    assert [s["slot_id"] for s in reserve_slots(blueprint())] == ["reserve-alternate"]


def test_the_problem_payload_is_candidate_safe():
    payload = problem_payload(slot_by_id(blueprint(), "core-1"), "Problem 1")
    assert payload["type"] == "panel.show_problem" and payload["label"] == "Problem 1"
    assert payload["examples"][0] == {"input": "nums = [2, 7, 11, 15]\ntarget = 9", "output": "[0, 1]", "explanation": "2 + 7 = 9"}
    flat = str(payload)
    for secret in ("Pair Sum", "medium", "hash map", "seen[x]", "constraints", "hint"):
        assert secret not in flat


def test_reveal_texts_and_round_length():
    slot = slot_by_id(blueprint(), "core-1")
    assert reveal_text(slot, "constraints") == "2 <= len(nums) <= 10^4\nexactly one answer"
    assert reveal_text(slot, "format") == "Input: nums: list[int], target: int\nOutput: list[int] of two indices"
    assert reveal_text(slot, "hint") is None
    assert round_seconds(blueprint(), context()) == 3600
    assert format_args({"s": "eceba"}) == 's = "eceba"'


def _wire_slot(slot_id, kind, order):
    return {"slot_id": slot_id, "kind": kind, "order": order}


def test_wire_ids_are_the_kind_and_its_position_so_they_never_carry_a_word_from_the_blueprint():
    bp = {"slots": [_wire_slot("culture-2", "core", 2), _wire_slot("core-1", "core", 1), _wire_slot("reserve-harder", "reserve", 4),
                    _wire_slot("reserve-alternate", "reserve", 3), _wire_slot("culture-reserve", "reserve", 5)]}
    assert wire_ids(bp) == {"core-1": "core-1", "culture-2": "core-2", "reserve-alternate": "reserve-1",
                            "reserve-harder": "reserve-2", "culture-reserve": "reserve-3"}


def test_wire_ids_are_stable_for_a_blueprint_so_a_restarted_worker_agrees_with_the_browser():
    bp = {"slots": [_wire_slot("core-1", "core", 1), _wire_slot("reserve-harder", "reserve", 2)]}
    assert wire_ids(bp) == wire_ids({"slots": list(reversed(bp["slots"]))})


def test_the_room_is_conversation_only_until_a_problem_needs_the_editor_and_again_for_the_closing():
    bp = blueprint()
    items = {i.item_id: i for i in build_items(bp)}
    assert [layout_for(bp, items[k]) for k in ("greeting", "candidate_intro", "core-1", "core-2", "candidate_questions", "wrap_up")] == [
        "talk", "talk", "work", "work", "talk", "talk"]


def test_a_behavioural_question_or_a_culture_slot_is_a_conversation_not_an_editor():
    bp = blueprint()
    bp["slots"][1]["slot_id"] = "culture-2"
    bp["slots"][0]["problem"]["round_type"] = "behavioural"
    items = build_items(bp)
    by_id = {i.item_id: i for i in items}
    assert layout_for(bp, by_id["culture-2"]) == "talk" and layout_for(bp, by_id["core-1"]) == "talk"


def test_design_and_low_level_design_problems_use_the_work_area_for_the_board_and_editor():
    bp = blueprint()
    for round_type in ("system-design", "lld", "dsa", "online-assessment"):
        bp["slots"][0]["problem"]["round_type"] = round_type
        item = next(i for i in build_items(bp) if i.item_id == "core-1")
        assert layout_for(bp, item) == "work"


def test_the_resume_and_projects_deep_dive_is_a_plan_item_after_the_problems_and_before_the_questions():
    bp = blueprint()
    bp["round"]["deep_dive_mins"] = 7
    items = build_items(bp)
    assert [i.item_id for i in items] == ["greeting", "candidate_intro", "core-1", "core-2", "deep_dive", "candidate_questions", "wrap_up"]
    deep = next(i for i in items if i.item_id == "deep_dive")
    assert deep.kind == "phase" and deep.max_seconds == 7 * 60
    assert layout_for(bp, deep) == "talk"
    assert [i.item_id for i in build_items(blueprint())] == ["greeting", "candidate_intro", "core-1", "core-2", "candidate_questions", "wrap_up"]


def test_background_phases_need_real_exchanges_before_the_interviewer_may_move_on():
    assert MIN_TURNS["deep_dive"] >= 3 and MIN_TURNS["small_talk"] >= 1 and MIN_TURNS["candidate_questions"] >= 1
    assert MIN_BACKGROUND_TURNS >= 5            # greeting to intro, counted together before the coding


def test_the_resume_probes_are_shared_out_so_the_introduction_and_the_deep_dive_never_ask_the_same_one():
    from app.interviewer.plan import deep_dive_probes, intro_probes

    a, b, c = ({"prompt": f"probe {n}"} for n in "abc")
    assert intro_probes({"resume_probes": [a, b, c]}) == [a] and deep_dive_probes({"resume_probes": [a, b, c]}) == [b, c]
    assert intro_probes({"resume_probes": [a]}) == [] and deep_dive_probes({"resume_probes": [a]}) == [a]      # one probe: kept for the deep dive
    assert intro_probes({}) == [] and deep_dive_probes({}) == []
