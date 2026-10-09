from app.interviewer.plan import build_items, format_args, problem_payload, reserve_slots, reveal_text, round_seconds, slot_by_id, wire_ids
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
