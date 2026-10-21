"""The echo rule: a first sentence that only gives the candidate's answer back to them is dropped when the turn has more to say."""
import asyncio

import pytest

from app.interviewer.predicates import echoes, restates_candidate
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


def test_an_echo_that_is_the_whole_reply_becomes_a_short_acknowledgement_never_the_echo():
    turn, *_ = make([say("So you split the work between three people, each owning one remote, and you kept the shared contracts.")])
    spoken = asyncio.run(collect(turn, echo_of=ANSWER))
    assert spoken == ["Okay."] and [b["rule"] for b in turn.last.blocked] == ["echo"]


def test_without_the_candidates_words_nothing_is_dropped():
    turn, *_ = make([say(*_turn_text("So you split the work between three people, each owning one remote. Did the split hold up?"))])
    assert len(asyncio.run(collect(turn))) == 2


# ---- fix round 1

def test_an_echo_becomes_an_acknowledgement_when_every_sentence_after_it_is_blocked():
    echo = "So you split the work between three people, each owning one remote, and you kept the shared contracts."
    turn, *_ = make([say(echo, "Someone from the team will be in touch about next steps.")])
    spoken = asyncio.run(collect(turn, echo_of=ANSWER))
    assert spoken == ["Okay."] and [b["rule"] for b in turn.last.blocked] == ["next_steps_promise", "echo"]


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


# ---- restating the candidate in other words (live round 781a1f0a, turns 9/14/41/43/54/56)

def test_restates_candidate():
    assert restates_candidate("Okay, so you owned it end to end.", "I own it end to end.")
    assert restates_candidate("So the schema is holding past conversations plus the live stream.",
                              "The schema was to keep the past conversations and ongoing for streaming via WebSocket.")
    assert restates_candidate("Ah, got it \u2014 so the device holds it and retries until the server acknowledges.",
                              "Uh, they get stored on device and the acknowledgment gets sent to the server if there is it. If they haven't, we send it back.")
    assert restates_candidate("So you're a 2026 graduate, and you've been at Salescode for about a year and a half on the Experience Portal and the AI sales agent.",
                              "So I'm a twenty twenty six graduate from Bennett and I've been working with Salescode from past one point five years on the experience portal and AI sales agent.")
    assert not restates_candidate("So Relay controls one device from another \u2014 what did you personally build in it?", "Relay was autonomous agent for controlling different devices from other devices.")
    assert not restates_candidate("So let's look at the next part of your work.", "I own it end to end.")


def test_a_follow_up_that_asks_about_the_candidates_own_detail_is_not_a_restatement():
    """"So tell me about ..." reuses the candidate's nouns but asks for more; blocking it left the interviewer nothing to say (final review,
    live round 781a1f0a)."""
    said = "We built the Flipkart queue consumers and the Redis retries for the device messages."
    assert not restates_candidate("So tell me about the Flipkart queue consumers.", said)
    assert not restates_candidate("So let us talk about your Redis retries.", said)
    assert not restates_candidate("Okay, so let's go into the Redis retries and the queue consumers.", said)
    assert not restates_candidate("So describe the Flipkart queue consumers and the Redis retries.", said)
    assert restates_candidate("So the Flipkart queue consumers handle the Redis retries.", said)


# ---- live round c8e70bb8: the acknowledgement that only says back what they said (A1-A4)

TURN14 = "So the user queries get queued to a background service worker where the query and the current state of the website is taken and sent to Open AI API."


def test_current_event_and_point_are_not_negations():
    assert echoes("Gotcha \u2014 so the query plus the current site state goes to OpenAI", TURN14)
    assert not echoes("Gotcha \u2014 so the query didn't include the current site state", TURN14)
    assert not echoes("Gotcha \u2014 so the query isn't sent with the current site state", TURN14)


@pytest.mark.parametrize("sentence,said", [
    ("Sure, Vibe it is.", "Okay, so can we discuss Vibe?"),
    ("Okay, DP it is.", "This looks like a DP problem."),
    ("Sliding window.", "Okay, on closer inspection, I think it's a sliding window problem."),
    ("So a single number per position.", "Uh, at each memo, I will store the maximum count till that."),
    ("So the query and the current state go to the model, and the returned code gets applied on the E2B instance and rendered back.",
     "that a pair response with a new with some new code that we directly change in E2B instance and render that outcome to the user directly."),
])
def test_a_first_sentence_that_restates_them_is_held_and_an_acknowledgement_stands_in(sentence, said):
    turn, *_ = make([say(sentence)])
    assert asyncio.run(collect(turn, echo_of=said)) == ["Okay."]
    turn, *_ = make([say(sentence, "Tell me what it does.")])
    spoken = asyncio.run(collect(turn, echo_of=said))
    if sentence.startswith("So a single"):
        assert spoken == [sentence, "Tell me what it does."]        # a lone paraphrase with no shared word is only dropped as the whole turn
    else:
        assert spoken == ["Tell me what it does."]


@pytest.mark.parametrize("sentence,said", [
    ("That trace checks out.", "that's my trace"),
    ("Good to meet you.", "Hello, nice to meet you."),
    ("So tell me about the Redis retries.", "we retry with backoff and queue"),
    ("Sure, go ahead.", "let me trace it"),
])
def test_a_short_real_reply_is_not_taken_for_a_restatement(sentence, said):
    turn, *_ = make([say(sentence)])
    assert asyncio.run(collect(turn, echo_of=said)) == [sentence]


def test_a_question_that_builds_on_the_statement_before_it_is_not_a_repeat():
    turn, *_ = make([say("A single number per position is the memo you describe.", "How would you use that number per position to build the final answer?")])
    assert len(asyncio.run(collect(turn))) == 2 and turn.last.blocked == []


@pytest.mark.parametrize("sentence", ["So the lookup is constant time, which helps.", "So that brings the cost down to linear.",
                                      "So we need to handle duplicates carefully."])
def test_a_so_statement_with_nothing_of_theirs_is_not_held(sentence):
    said = "I would use a hash map to store the values I have already seen."
    turn, *_ = make([say(sentence, "What about empty input?")])
    assert asyncio.run(collect(turn, echo_of=said)) == [sentence, "What about empty input?"]
    turn, *_ = make([say(sentence)])
    expected = ["Okay."] if len(sentence.split()) <= 7 else [sentence]      # only a lone paraphrase of seven words or fewer
    assert asyncio.run(collect(turn, echo_of=said)) == expected
