"""The echo rule: a first sentence that only gives the candidate's answer back to them is dropped when the turn has more to say."""
import asyncio

import pytest

from app.interviewer.predicates import echoes
from tests.interviewer.fakes import say
from tests.interviewer.test_talker import _turn_text, collect, make

ANSWER = ("Mostly splitting the work so three of us didn't block each other. Each person owned one remote end to end, "
          "and I owned the host shell and the shared contracts between them.")


@pytest.mark.parametrize("sentence", [
    "So you split the work between three people, each owning one remote, and you kept the shared contracts.",
    "You owned the host shell and the shared contracts between the remotes.",
])
def test_a_sentence_that_gives_their_answer_back_is_an_echo(sentence):
    assert echoes(sentence, ANSWER)


@pytest.mark.parametrize("sentence", [
    "Did that split hold up, or did the contracts bite you at some point?",               # a question
    "Tell me more about how the shared contracts between the remotes were owned.",         # a request
    "But the shared contracts between the remotes must have needed a version, each owned by someone.",   # a correction
    "Actually, each remote owned one contract and the host shell owned the rest.",
    "Three people owning one remote end to end is the same split we use, with two owners per contract.",   # a new number
    "That's a classic one.",
    "Okay.",
])
def test_a_question_a_request_a_correction_or_a_new_fact_is_not_an_echo(sentence):
    assert not echoes(sentence, ANSWER)


def test_what_they_asked_is_never_echoed_back_because_it_is_answered():
    assert not echoes("Each remote owns one contract and the host shell owns the shared contracts.", "Who owns the shared contracts between the remotes?")


def test_an_echo_that_has_more_after_it_is_dropped_and_the_rest_is_said():
    turn, *_ = make([say(*_turn_text("So you split the work between three people, each owning one remote, and you kept the shared contracts. "
                                      "Did the split hold up?"))])
    spoken = asyncio.run(collect(turn, echo_of=ANSWER))
    assert spoken == ["Did the split hold up?"] and [b["rule"] for b in turn.last.blocked] == ["echo"]


def test_an_echo_that_is_the_whole_reply_is_kept_because_an_empty_turn_is_worse():
    turn, *_ = make([say("So you split the work between three people, each owning one remote, and you kept the shared contracts.")])
    spoken = asyncio.run(collect(turn, echo_of=ANSWER))
    assert spoken == ["So you split the work between three people, each owning one remote, and you kept the shared contracts."]
    assert turn.last.blocked == []


def test_without_the_candidates_words_nothing_is_dropped():
    turn, *_ = make([say(*_turn_text("So you split the work between three people, each owning one remote. Did the split hold up?"))])
    assert len(asyncio.run(collect(turn))) == 2


# ---- fix round 1

def test_an_echo_is_kept_when_every_sentence_after_it_is_blocked():
    echo = "So you split the work between three people, each owning one remote, and you kept the shared contracts."
    turn, *_ = make([say(echo, "Someone from the team will be in touch about next steps.")])
    spoken = asyncio.run(collect(turn, echo_of=ANSWER))
    assert spoken == [echo] and [b["rule"] for b in turn.last.blocked] == ["next_steps_promise"]


TRACE = ("On 3 minus 5 times 2 the signed push keeps the subtraction through the multiplication: the star pops minus 5 and pushes minus 10, "
         "so the sum is minus 7.")


def test_a_confirmation_after_a_reported_trace_survives_when_its_echo_is_dropped():
    turn, *_ = make([say(*_turn_text("That's correct, the signed push is why the subtraction carries through the multiplication and the sum is minus 7. "
                                      "What does it cost in time and space?"))])
    spoken = asyncio.run(collect(turn, echo_of=TRACE, trace_reported=True))
    assert spoken == ["That's correct.", "What does it cost in time and space?"]
    assert turn.last.repaired[-1][1] == "That's correct."


def test_without_a_reported_trace_the_whole_echo_goes_including_its_confirmation():
    turn, *_ = make([say(*_turn_text("That's correct, the signed push is why the subtraction carries through the multiplication and the sum is minus 7. "
                                      "What does it cost in time and space?"))])
    assert asyncio.run(collect(turn, echo_of=TRACE)) == ["What does it cost in time and space?"]
