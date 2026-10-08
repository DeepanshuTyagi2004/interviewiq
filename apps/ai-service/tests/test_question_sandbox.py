"""The reference-solution sandbox: passes correct code, reports wrong answers and errors, stops runaway code."""
from app.questions.content.sandbox import run_reference

TWO_SUM = "def two_sum(nums, target):\n    seen = {}\n    for i, n in enumerate(nums):\n        if target - n in seen:\n            return [seen[target - n], i]\n        seen[n] = i\n    return []\n"


def test_correct_solution_passes_every_test_and_tuples_equal_lists():
    tests = [{"args": {"nums": [2, 7, 11, 15], "target": 9}, "expected": [0, 1]}, {"args": {"nums": [3, 3], "target": 6}, "expected": (0, 1)}, {"args": {"nums": [1], "target": 5}, "expected": []}]
    verdict = run_reference(TWO_SUM, "two_sum", tests)
    assert verdict.all_passed and verdict.passed == 3 and verdict.failures == []


def test_wrong_expected_and_raised_errors_are_reported_per_test():
    tests = [{"args": {"nums": [2, 7], "target": 9}, "expected": [1, 0]}, {"args": {"nums": None, "target": 1}, "expected": []}]
    verdict = run_reference(TWO_SUM, "two_sum", tests)
    assert verdict.ran and not verdict.all_passed and verdict.failed == 2
    assert verdict.failures[0]["got"] == [0, 1] and "TypeError" in verdict.failures[1]["error"]


def test_runaway_code_times_out_and_missing_entry_point_crashes_cleanly():
    verdict = run_reference("def spin(n):\n    while True:\n        pass\n", "spin", [{"args": {"n": 1}, "expected": 1}], timeout_seconds=2, cpu_seconds=1)
    assert verdict.ran and verdict.failed == 1 and "timed out" in (verdict.error or "") or "crashed" in (verdict.error or "")
    verdict = run_reference("x = 1\n", "missing", [{"args": {}, "expected": 1}])
    assert verdict.ran and verdict.error and "crashed" in verdict.error


def test_no_tests_means_nothing_ran():
    assert run_reference(TWO_SUM, "two_sum", []).ran is False
