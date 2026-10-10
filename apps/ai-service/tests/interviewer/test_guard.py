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


def test_a_distinctive_word_of_the_original_problem_name_is_not_said_when_the_screen_and_the_candidate_never_used_it():
    from tests.interviewer.fixtures import blueprint
    bp = blueprint()
    bp["slots"][0]["problem"]["title"] = "Best Time to Buy and Sell Stock II"
    bp["slots"][0]["problem"]["content"]["statement"] = "Chef runs a spice shop and buys and sells spice over several days."
    guard = LeakGuard(bp)
    assert not guard.check_sentence("Given a list of daily stock prices, return the maximum profit.", current_slot="core-1").ok
    assert guard.check_sentence("Given a list of daily stock prices, return the maximum profit.", current_slot="core-1",
                                candidate_said="so the stock price each day").ok            # they said it first
    assert guard.check_sentence("It is on your screen now; what is your first thought?", current_slot="core-1").ok
    assert guard.check_sentence("What is the time complexity of that?", current_slot="core-1").ok      # a common word is never a leak
    assert guard.check_sentence("Think about the buying and selling on each day.", current_slot="core-1").ok   # words the screen uses


def test_title_words_are_only_policed_while_a_problem_is_current_not_in_the_conversation_parts():
    from tests.interviewer.fixtures import blueprint
    bp = blueprint()
    bp["slots"][1]["problem"]["title"] = "Capacity To Ship Packages Within D Days"
    bp["slots"][1]["problem"]["content"]["statement"] = "A depot loads parcels onto trucks over several days."
    guard = LeakGuard(bp)
    assert guard.check_sentence("When a remote ships a breaking change, how does the shell cope?", current_slot=None).ok     # the projects talk
    assert guard.check_sentence("How many packages does the batch job process?", current_slot=None).ok
    assert not guard.check_sentence("Think of the capacity to ship packages within a number of days.", current_slot="core-2").ok


def test_announcing_the_next_problem_never_names_its_kind_unless_the_candidate_said_it_first():
    g = guard()
    assert not g.check_sentence("Let's do one more, this one's a search problem.", current_slot="core-1").ok
    assert not g.check_sentence("The next problem is a graph one.", current_slot="core-1").ok
    assert not g.check_sentence("Now a dynamic programming question.", current_slot="core-1").ok
    assert g.check_sentence("Let's do one more, it's on your screen.", current_slot="core-1").ok
    assert g.check_sentence("The next problem is a graph one.", current_slot="core-1", candidate_said="so it is a graph").ok
    assert g.check_sentence("Why would a hash map help here?", current_slot="core-1").ok         # talking about their solution is fine


_CHEF = ("Chef runs a spice shop and wants to maximize his earnings by buying and selling a particular spice over a series of days. "
         "On day i the price of the spice is given by the array prices[i]. Chef can perform as many buy-sell transactions as he likes, "
         "but he can hold at most one unit of the spice at any time. Determine the maximum total profit Chef can achieve.")


def _chef_guard() -> LeakGuard:
    from tests.interviewer.fixtures import blueprint
    bp = blueprint()
    bp["slots"][0]["problem"]["content"]["statement"] = _CHEF
    return LeakGuard(bp)


def test_reading_or_paraphrasing_the_problem_statement_aloud_is_blocked():
    g = _chef_guard()
    for line in ("Chef runs a spice shop and wants to maximize his earnings by buying and selling a particular spice over a series of days.",
                 "Given an array of daily prices, he can make as many buy-sell transactions as he likes, but he can hold at most one unit at a time."):
        assert g.check_sentence(line, current_slot="core-1").rule == "statement_read_aloud", line


def test_short_remarks_about_the_statement_and_every_sentence_outside_the_problem_are_fine():
    g = _chef_guard()
    for line in ("Yes, one unit at a time.", "How would you compute the maximum total profit?", "It's on your screen now, take your time.",
                 "Go ahead and tell me what you notice about the prices."):
        assert g.check_sentence(line, current_slot="core-1").ok, line
    # Screen text (sections, notes) may quote the statement; only speech may not.
    assert g.check_text("Chef runs a spice shop and wants to maximize his earnings by buying and selling a particular spice over a series of days.").ok


def test_reading_out_any_problem_even_one_not_yet_shown_or_its_prepared_opening_is_blocked():
    from tests.interviewer.fixtures import blueprint
    bp = blueprint()
    bp["slots"][0]["ask"] = {"opening": "Alright, let's dive in. Given an array of integers representing serial numbers of components, "
                                        "can you write a function that returns true if any serial number appears more than once?",
                             "clarifications": []}
    g = LeakGuard(bp)
    line = "Given an array of integers, determine whether any serial number appears more than once in the list."
    assert g.check_sentence(line, current_slot=None).rule == "statement_read_aloud"        # in the conversation, before the problem is current
    assert g.check_sentence("How was your internship at Dunzo, what did you work on day to day?", current_slot=None).ok


def test_a_boolean_or_null_example_result_does_not_make_the_words_true_false_or_none_unspeakable():
    from tests.interviewer.fixtures import blueprint
    bp = blueprint()
    bp["slots"][0]["problem"]["content"]["examples"] = [{"args": {"nums": [1, 2, 3, 1]}, "expected": True},
                                                        {"args": {"nums": [1, 2, 3, 4]}, "expected": False},
                                                        {"args": {"nums": [5]}, "expected": None}]
    g = LeakGuard(bp)
    for line in ("How would you change it to return the duplicate values rather than just true or false?",
                 "What does your function return when there is nothing, false or none?"):
        assert g.check_sentence(line, current_slot="core-1").ok, line
    assert g.check_sentence("For nums equal to [1, 2, 3, 1] the answer is clear.", current_slot="core-1").rule == "example_read_aloud"
