import pytest

from app.evaluation.score import (
    Adjustment, AdjustmentInputs, PartScore, adjustments, compute, majority, merge_score,
    needs_tiebreak, part_shares, unscorable_reason, verdict_for,
)

DSA_KEYS = ["understanding", "approach", "code_correctness", "code_quality", "testing", "complexity", "communication"]


def dsa(score=8.0, met=True, **over):
    areas = {k: score for k in DSA_KEYS}
    areas.update(over)
    return PartScore("p1", "dsa", 1.0, areas, met)


def total(x):
    return round(sum(a.delta for a in adjustments(x)), 4)


def test_merge_mean_within_gap():
    assert merge_score(6, 7, None) == 6.5
    assert not needs_tiebreak(6, 7.5)


def test_merge_median_on_gap():
    assert merge_score(4, 7, 6) == 6
    with pytest.raises(ValueError):
        merge_score(4, 7, None)


def test_majority():
    assert majority("a", "a") == "a"
    assert majority("a", "b", "b") == "b"


def test_hint_penalties():
    assert total(AdjustmentInputs(hint_steps_by_problem={"p": [1, 2]})) == -0.35
    assert total(AdjustmentInputs(hint_steps_by_problem={"p": [3, 3, 2]})) == -0.8


def test_hint_floor_is_per_problem():
    assert total(AdjustmentInputs(hint_steps_by_problem={"a": [3, 3], "b": [3, 3]})) == -1.6


def test_change_requests_very_high():
    assert total(AdjustmentInputs(change_requests=2, change_granted=True)) == -2.5


def test_bug_adjustments():
    assert total(AdjustmentInputs(pointed_out_bugs=5)) == -0.3
    assert total(AdjustmentInputs(self_found_bugs=5)) == 0.2


def test_bonus_cap():
    x = AdjustmentInputs(beyond_level=True, bonus_solved=True, end_questions_bonus=0.2, self_found_bugs=2)
    r = compute([dsa(5.0)], adjustments(x), 7.0, "dsa", False)
    assert r.bonus_total == 0.5
    assert r.score == 5.5


def test_proctor_flat_three_per_event():
    # owner decision 2026-10-21: -3 x weight each, no escalation, no free first event; away_overstay is not a proctor line
    x = AdjustmentInputs(proctor=[{"kind": "tab_hidden", "weight": 1}, {"kind": "window_blur", "weight": 1},
                                  {"kind": "external_display", "weight": 1}, {"kind": "away_overstay", "weight": 1}])
    assert total(x) == -9.0
    assert total(AdjustmentInputs(proctor=[{"kind": "fullscreen_exit", "weight": 0.5}])) == -1.5


def test_away_overstay_is_three():
    assert total(AdjustmentInputs(away_overstays=[{}])) == -3.0


def test_conduct_warning_is_one():
    assert total(AdjustmentInputs(conduct_warnings=[{"kind": "warning"}])) == -1.0


def test_abuse_is_seven_auto_fail_and_floors_at_one():
    adj = adjustments(AdjustmentInputs(abuse=[{"turn_id": 4, "at": 1.0}]))
    assert [(a.kind, a.label, a.delta) for a in adj] == [("conduct_abuse", "Abusive language", -7.0)]
    r = compute([dsa(8.0)], adj, 7.0, "dsa", True)
    assert r.outcome == "auto_fail" and r.score == 1.0
    assert compute([dsa(1.0)], adjustments(AdjustmentInputs(abuse=[{}], away_overstays=[{}])), 7.0, "dsa", True).score == 1.0


def test_conduct_paste_overstay():
    x = AdjustmentInputs(conduct_warnings=[{"kind": "warning"}, {"kind": "final_warning"}],
                         pastes=[{}], away_overstays=[{}, {}])
    assert total(x) == -1.0 - 1.0 - 1.0 - 3.0 - 3.0


def test_cap_applied():
    r = compute([dsa(7.6, met=False)], [], 7.0, "dsa", False)
    assert r.base == 7.6
    assert r.score == 6.5
    assert r.cap == "Capped at 6.5: the solution didn't reach working logic"
    assert r.outcome == "below_pass"


def test_cap_not_reported_when_not_binding():
    r = compute([dsa(5.0, met=False)], [], 7.0, "dsa", False)
    assert r.cap is None and r.score == 5.0


def test_passed_and_clamp():
    assert compute([dsa(9.5)], [Adjustment("bonus_solved", "x", 0.3)], 7.0, "dsa", False).outcome == "passed"
    assert compute([dsa(1.0)], [Adjustment("x", "x", -3.0)], 7.0, "dsa", False).score == 1.0


def test_verdict_bands():
    assert verdict_for(8.6, 7.0) == "Strong Hire"
    assert verdict_for(6.8, 7.0) == "Lean No Hire"
    assert verdict_for(4.9, 7.0) == "Strong No Hire"
    assert verdict_for(7.0, 7.0) == "Lean Hire"
    assert verdict_for(7.5, 7.0) == "Hire"
    assert verdict_for(5.0, 7.0) == "No Hire"


def test_auto_fail():
    r = compute([dsa(8.0)], [], 7.0, "dsa", True)
    assert r.outcome == "auto_fail" and r.verdict == "No Hire"


def test_unscorable():
    assert unscorable_reason("technical", 30, 30, False, True)
    assert unscorable_reason("completed", 30, 3, True, True) is None
    assert unscorable_reason("completed", 30, 10, False, True)
    assert unscorable_reason("completed", 30, 25, False, False)
    assert unscorable_reason("completed", 30, 25, False, True) is None


def test_part_shares_unknown_minutes():
    s = part_shares({"a": 20, "b": None, "c": None}, 40)
    assert s["b"] == s["c"] == 10 / 40 and s["a"] == 0.5
    assert part_shares({"a": 10, "b": 30}, 40) == {"a": 0.25, "b": 0.75}


def test_practical_theory_split():
    r = compute([dsa(8.0, complexity=4.0)], [], 7.0, "dsa", False)
    assert r.practical == 8.0
    assert r.theory == pytest.approx(6.7)


def test_behavioural_has_no_practical():
    p = PartScore("b", "behavioural", 1.0, {"structure": 7, "ownership": 7}, True)
    r = compute([p], [], 7.0, "behavioural", False)
    assert r.practical is None and r.theory == 7.0


# ---- final-review fixes (Module 04)



def test_must_have_judged_on_the_main_part_only():
    # C1: problem 1 solved, problem 2 given but unfinished: the main part (the first core one) met the must-have, no cap
    p1 = PartScore("core-1", "dsa", 0.5, {k: 8.0 for k in DSA_KEYS}, True)
    p2 = PartScore("core-2", "dsa", 0.5, {k: 4.0 for k in DSA_KEYS}, False)
    r = compute([p1, p2], [], 6.5, "dsa", False)
    assert r.cap is None and r.score == 6.0
    # the main part missed it: capped even though a later part met it
    r = compute([PartScore("core-1", "dsa", 0.5, {k: 9.0 for k in DSA_KEYS}, False),
                 PartScore("core-2", "dsa", 0.5, {k: 9.0 for k in DSA_KEYS}, True)], [], 6.5, "dsa", False)
    assert r.cap and r.score == 6.0


def test_behavioural_must_have_met_by_any_part():
    from app.evaluation.weights import FAMILIES
    keys = [a.key for a in FAMILIES["behavioural"]]
    parts = [PartScore(f"b{i}", "behavioural", 1 / 3, {k: 8.0 for k in keys}, i == 2) for i in range(3)]
    assert compute(parts, [], 6.5, "behavioural", False).cap is None
    none = [PartScore(f"b{i}", "behavioural", 1 / 3, {k: 8.0 for k in keys}, False) for i in range(3)]
    assert compute(none, [], 6.5, "behavioural", False).cap


def test_bonus_part_never_moves_the_base_or_the_cap():
    main = PartScore("core-1", "dsa", 1.0, {k: 8.0 for k in DSA_KEYS}, True)
    half = PartScore("core-2", "dsa", 0.4, {k: 3.0 for k in DSA_KEYS}, False, bonus=True)
    alone = compute([main], [], 6.5, "dsa", False)
    both = compute([main, half], [], 6.5, "dsa", False)
    assert both.base == alone.base == 8.0 and both.cap is None and both.score == alone.score
    assert both.practical == alone.practical and both.theory == alone.theory


def test_tiebreak_gap_is_rounded():
    # M7: 6.8 - 5.3 is 1.5000000000000004 in floats: no tiebreak at exactly the gap
    assert not needs_tiebreak(6.8, 5.3) and merge_score(6.8, 5.3, None) == pytest.approx(6.05)
    assert needs_tiebreak(6.8, 5.2)


def test_adjustment_notes_name_the_problem_and_the_event():
    # M4: no part id and no ledger kind on a line the candidate reads
    x = AdjustmentInputs(hint_steps_by_problem={"core-1": [1]},
                         proctor=[{"kind": "tab_hidden", "weight": 1}, {"kind": "tab_hidden", "weight": 1},
                                  {"kind": "fullscreen_exit", "weight": 1}, {"kind": "share_stopped", "weight": 1}])
    out = adjustments(x, {"core-1": "Pair Sum"})
    hint = next(a for a in out if a.kind == "hint")
    assert hint.note == "Pair Sum"
    notes = [(a.note, a.event_kind) for a in out if a.kind == "proctor"]
    assert notes == [("Switched tabs", "tab_hidden"), ("Switched tabs", "tab_hidden"), ("Left fullscreen", "fullscreen_exit"), ("Stopped screen share", "share_stopped")]
    assert next(a for a in adjustments(AdjustmentInputs(hint_steps_by_problem={"core-9": [2]}))).note == ""


def test_swapped_first_problem_is_not_the_main_part_for_the_cap():
    # owner decision 2026-10-18: the abandoned problem keeps its share but the replacement is the main part
    gone = PartScore("core-1", "dsa", 0.5, {k: 6.0 for k in DSA_KEYS}, False, swapped=True)
    solved = PartScore("core-2", "dsa", 0.5, {k: 9.0 for k in DSA_KEYS}, True)
    r = compute([gone, solved], [], 6.5, "dsa", False)
    assert r.cap is None and r.base == 7.5
    without = compute([solved], [], 6.5, "dsa", False)
    assert r.score < without.score                                         # the abandoned share pulls the base down
    # the replacement missing the must-have still caps
    assert compute([gone, PartScore("core-2", "dsa", 0.5, {k: 9.0 for k in DSA_KEYS}, False)], [], 6.5, "dsa", False).cap
    # every main problem swapped: the last one decides
    both = compute([gone, PartScore("core-2", "dsa", 0.5, {k: 9.0 for k in DSA_KEYS}, True, swapped=True)], [], 6.5, "dsa", False)
    assert both.cap is None
