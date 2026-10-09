from app.interviewer.guard import LeakGuard
from tests.interviewer.fixtures import blueprint


def guard() -> LeakGuard:
    return LeakGuard(blueprint())


def test_lets_ordinary_interviewer_speech_through():
    assert guard().check_sentence("Nice, what's the complexity of that loop?", current_slot="core-1").ok


def test_blocks_reference_solution_code_in_speech_and_in_code_inserts():
    g = guard()
    spoken = "You could write for i, x in enumerate(nums): if target - x in seen: return [seen[target - x], i]."
    assert g.check_sentence(spoken, current_slot="core-1").rule == "solution_code"
    assert g.check_code("for i, x in enumerate(nums):\n    if target - x in seen:\n        return [seen[target - x], i]").rule == "solution_code"
    assert g.check_code("print(pair_sum([1, 2], 3))  # expect [0, 1]").ok


def test_blocks_reading_the_current_examples_aloud():
    g = guard()
    assert g.check_sentence("For nums equal to [2, 7, 11, 15] the answer is clear.", current_slot="core-1").rule == "example_read_aloud"
    assert g.check_sentence("For nums equal to [2, 7, 11, 15] the answer is clear.", current_slot=None).ok


def test_blocks_problem_names_unless_the_candidate_said_them_first():
    g = guard()
    assert g.check_sentence("This is the classic Pair Sum problem.", current_slot="core-1").rule == "name_or_topic"
    assert g.check_sentence("Yes, it's like pair sum.", current_slot="core-1", candidate_said="isn't this just pair sum?").ok
    assert g.check_sentence("Next up is Island Count.", current_slot="core-1").rule == "name_or_topic"


def test_blocks_difficulty_labels():
    assert guard().check_sentence("Don't worry, this one is an easy problem.", current_slot="core-1").rule == "difficulty"
    assert guard().check_sentence("That's a hard question to answer quickly, take your time.", current_slot="core-1").rule == "difficulty"


def test_screen_text_is_checked_for_solutions_names_and_difficulty():
    from tests.interviewer.fixtures import REFERENCE
    g = guard()
    assert g.check_text(REFERENCE).rule == "solution_code"
    assert g.check_text("This is the Pair Sum problem").rule == "name_or_topic"
    assert g.check_text("Yes, like pair sum.", candidate_said="isn't this pair sum?").ok
    assert g.check_text("An easy problem").rule == "difficulty"
    assert g.check_text("Values may repeat, and the array can be empty.").ok
