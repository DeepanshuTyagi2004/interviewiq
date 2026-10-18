from app.interviewer.guard import LeakGuard
from tests.interviewer.fixtures import blueprint

B0 = "/private/tmp/claude-501/-Users-salescode-Desktop-project-interviewiq/6acd6004-ecd3-44d1-b862-1bf228efd57b/scratchpad/ops/b0/struggler_gives_up.json"


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


def test_everyday_interviewer_phrasing_in_a_prepared_opening_does_not_make_it_unspeakable():
    """A live round's second problem opened with "...tell me how you'd approach it", so every later "tell me how you'd start"
    was blocked as reading a problem aloud and the interviewer fell back to a vague line."""
    from tests.interviewer.fixtures import blueprint
    bp = blueprint()
    bp["slots"][1]["ask"] = {"opening": "Take a moment with the workshop schedule, then tell me how you'd approach it.", "clarifications": []}
    g = LeakGuard(bp)
    for line in ("When you're ready, tell me how you'd approach it.", "Partial is genuinely okay, tell me how you'd start, even roughly."):
        assert g.check_sentence(line, current_slot="core-1").ok, line
    assert g.check_sentence("Take a moment with the workshop schedule and the prerequisites listed for it.",
                            current_slot="core-1").rule == "statement_read_aloud"


def test_confirming_a_guess_and_then_explaining_why_it_works_completes_the_insight_but_a_plain_confirmation_does_not():
    """b0 struggler_gives_up: "Moving both pointers after a hit is exactly that — it saves you from re-scanning the same right pointer
    for every value of j." passed: its words were the candidate's own and not in the key insights, so no word count caught it."""
    g = LeakGuard(blueprint())
    said = "My guess is that leaving j in place means k keeps walking over the same values, so it's repeated work."
    slot = "core-1"
    explained = ("Moving both pointers after a hit is exactly that, it saves you from re-scanning because you remember every earlier "
                 "value of the middle index.")
    assert not g.check_insight(explained, current_slot=slot, candidate_said=said, hint_step=1, last_said=said).ok
    for fine in ("Right, that's correct.", "Exactly, that works.", "Yes, that is exactly what I was after.",
                 "That's right, and it saves time.", "Exactly that. Now, how would the code change?"):
        assert g.check_insight(fine, current_slot=slot, candidate_said=said).ok, fine


def test_saying_the_problem_requires_something_its_text_does_not_say_is_blocked_but_a_requirement_it_states_is_not():
    """b0 strong_fresher: "the problem asks for O of 1 extra space" turned a follow-up into a requirement the statement does not have."""
    g = guard()
    claim = "Right, the problem asks for O of 1 extra space. One thing though, the problem expects O of 1 extra space."
    assert not g.check_requirement(claim, current_slot="core-1").ok
    assert g.check_requirement(claim, current_slot="core-1").rule == "requirement_invented"
    assert g.check_requirement("The problem asks for two indices.", current_slot="core-1").ok            # the output format says so
    assert g.check_requirement("Can you do it in constant extra space?", current_slot="core-1").ok         # a follow-up question is fine
    bp = blueprint()
    bp["slots"][0]["problem"]["content"]["statement"] += " Use O(1) extra space."
    assert LeakGuard(bp).check_requirement("The problem asks for O of 1 extra space.", current_slot="core-1").ok


def test_explaining_after_confirming_needs_a_hint_new_words_after_the_cue_and_a_key_insight_term():
    """Polish review finding 5: the cue words themselves used to count as new words."""
    g = guard()
    said = "I scan once and keep a map of what I have seen."
    for fine in ("That's correct, which means the loop runs at most n times. How would you test it?",
                 "That's right, which means we are done with the first problem."):
        assert g.check_insight(fine, current_slot="core-1", candidate_said=said, hint_step=1, last_said=said).ok, fine
    # the b0 struggler line: after hints, the interviewer explained what the candidate said they could not
    real = LeakGuard(__import__("json").load(open(B0))["blueprint"]) if __import__("os").path.exists(B0) else None
    if real is not None:
        last = ("Honestly sir, I'm still relying on the set to remove duplicates, so I haven't really thought about why both should move. "
                "My guess is that after finding a hit, leaving j in place means k keeps walking over the same values for that j, so it's just "
                "doing repeated work for nothing. But I couldn't tell you exactly what it saves in terms of complexity.")
        line = "Moving both pointers after a hit is exactly that \u2014 it saves you from re-scanning the same right pointer for every value of j."
        assert not real.check_insight(line, current_slot="core-2", candidate_said=last, hint_step=1, last_said=last).ok
        assert real.check_insight(line, current_slot="core-2", candidate_said=last, hint_step=0, last_said=last).ok


# ------------------------------------------------------------------ final review wave (decided 2026-10-18)

def test_no_fixed_wording_is_blocked_as_reading_a_prepared_opening_that_begins_with_the_interviewers_own_lead_in():
    """C1: "Alright, let's dive into the coding now." was blocked as statement_read_aloud because the prep-written opening began "Alright, let's
    dive into a classic shipping problem...": the retry then asked a question and the run put the problem up after it."""
    from app.interviewer.lines import BRIDGE_POOLS, LINES
    for lead in ("Alright, let's dive into", "Let's dive into", "Let's get into", "Okay, let's get into", "So, let's jump into"):
        bp = blueprint()
        bp["slots"][0]["ask"] = {"opening": f"{lead} a classic shipping problem. A warehouse ships parcels in order, one trip a day, and wants the smallest "
                                            "capacity that gets every parcel out in time.", "clarifications": []}
        g = LeakGuard(bp)
        for key, pool in {**LINES, **BRIDGE_POOLS}.items():
            for text in pool:
                assert g.check_sentence(text, current_slot="core-1").rule != "statement_read_aloud", (lead, key, text)
        assert g.check_sentence("Alright, let's dive into the coding now.", current_slot=None).ok          # an old wording is fine too
    # the lead-in is cut, the statement part of the opening still counts as the statement
    assert g.check_sentence("A warehouse ships parcels in order, one trip a day, and wants the smallest capacity that gets every parcel out in time.",
                            current_slot=None).rule == "statement_read_aloud"
