"""What the interviewer already said: the same thing is not said again, the same thing put differently is."""
from app.interviewer.said import NEUTRAL_LINES, SaidTracker

ASK = "Can you walk me through how you would approach this?"


def tracker(*sentences, turn="1"):
    said = SaidTracker()
    for s in sentences:
        said.add(s, turn)
    return said


def test_the_same_sentence_is_a_repeat_whatever_its_case_or_punctuation():
    said = tracker(ASK)
    assert said.repeat_of(ASK) == ASK
    assert said.repeat_of("can you walk me through how you would approach this") == ASK


def test_a_near_duplicate_is_a_repeat():
    assert tracker(ASK).repeat_of("Can you walk me through how you would approach this one?") == ASK


def test_the_same_thing_put_differently_is_not():
    said = tracker(ASK)
    assert said.repeat_of("How would you go about solving this, step by step?") is None
    assert said.repeat_of("Talk me through your thinking before you write any code.") is None


def test_a_similar_question_about_something_else_is_not():
    said = tracker("What is the time complexity of this solution?")
    assert said.repeat_of("What is the space complexity of this solution?") is None


def test_short_acknowledgements_are_never_a_repeat():
    said = tracker("Got it.", "Right, okay.")
    assert said.repeat_of("Got it.") is None and said.repeat_of("Right, okay.") is None


def test_it_remembers_the_whole_interview_not_a_window():
    said = tracker(ASK)
    for i in range(200):
        said.add(f"Question number {i} is about a completely different part of the work.", str(i + 2))
    assert said.repeat_of(ASK) == ASK


def test_an_interrupted_turn_may_be_said_again():
    said = tracker(ASK, "Take your time with it, there is no rush at all.", turn="3")
    said.add("A sentence from an earlier turn that was heard in full.", "2")
    said.forget("3")
    assert said.repeat_of(ASK) is None
    assert said.repeat_of("A sentence from an earlier turn that was heard in full.") is not None


def test_a_resumed_interview_remembers_what_was_said_before_the_crash():
    said = SaidTracker()
    said.seed([f"{ASK} Take your time with it, there is no rush at all."])
    assert said.repeat_of(ASK) == ASK
    assert said.repeat_of("Take your time with it, there is no rush at all.") is not None


def test_the_fallback_line_rotates_and_starts_with_the_original():
    said = SaidTracker()
    lines = [said.neutral() for _ in range(len(NEUTRAL_LINES) + 1)]
    assert lines[0] == "What do you think?" and lines[0] == lines[-1]
    assert all(a != b for a, b in zip(lines, lines[1:]))
