import asyncio
import time

from app.interviewer.addressed import classify_by_rules, classify_by_model, lean, answers_checkin, AddressedState
from app.interviewer.lines import LINES


def rules(text, last="Here's your first question. Give it a read.", reading=False, typing=False, armed=False, on_problem=True):
    return classify_by_rules(text, last_line=last, reading=reading, typing=typing, ask_armed=armed, on_problem=on_problem)


SILENT = ("thinking_aloud", "reading_problem")


def test_ask_button_and_quick_question_are_for_the_interviewer():
    assert rules("so the zero case", armed=True) == "to_interviewer"
    assert rules("quick question, can the string be empty") == "to_interviewer"


def test_reading_aloud_is_reading():
    assert rules("given a numeric string determine the number of ways", reading=True) == "reading_problem"


def test_answer_to_an_interviewer_question_is_for_the_interviewer():
    assert rules("I'd use a hash map", last="How would you store the counts?") == "to_interviewer"


def test_direct_requests_are_for_the_interviewer():
    for t in ("can you repeat that", "could you explain the second example", "is it okay if I use Java", "should I handle negatives", "sorry, what was that"):
        assert rules(t) == "to_interviewer", t


def test_self_talk_is_thinking():
    for t in ("hmm let me think", "so if I take the first two digits", "wait, that double counts", "okay so maybe I start from the end"):
        assert rules(t) == "thinking_aloud", t
    assert rules("now the loop over the string", typing=True) == "thinking_aloud"


def test_a_self_question_is_not_placed_by_rules():
    assert rules("and what could zero decode to?") is None


def test_lean():
    assert lean("what could zero decode to?", since_problem_s=20) == "unclear"  # a question never falls to silence
    assert lean("the string has digits only", since_problem_s=20, overlaps_problem=True) == "reading_problem"
    assert lean("the string has digits only", since_problem_s=200, overlaps_problem=True) == "unclear"      # late, or not the problem's words: a tie goes to the check-in
    assert lean("the string has digits only", since_problem_s=20) == "unclear"
    assert lean("hmm let me think about this", since_problem_s=200, on_problem=True) == "thinking_aloud"
    assert lean("hmm let me think about this", since_problem_s=200, on_problem=False) == "unclear"


def test_answers_checkin():
    for t in ("no, just thinking", "I'm working it out", "not for you", "thinking out loud", "myself"):
        assert answers_checkin(t) == "thinking", t
    for t in ("yes", "yeah, what does zero decode to?", "it was for you", "yes please"):
        assert answers_checkin(t) == "for_me", t


def test_pools_are_rich_and_never_echo():
    assert len(LINES["addressed:checkin"]) == 24
    assert len(LINES["addressed:nudge"]) == 16
    assert len(LINES["addressed:reading"]) == 12
    assert "Is that one for me, or are you thinking it through?" in LINES["addressed:checkin"]


def test_state_round_trips():
    s = AddressedState(checkin_used={"core-1"}, thinking_items=set(), reading_said={"core-1"}, checkin_at=12.0, checkin_item="core-1")
    assert AddressedState.from_dict(s.to_dict()) == s
    assert AddressedState.from_dict(None) == AddressedState(set(), set(), set())


def test_checkin_for_you_and_interrogative_lean():
    assert answers_checkin("nope, that was for you") == "for_me"
    assert answers_checkin("not for you") == "thinking"
    assert lean("so what does zero map to", since_problem_s=20) == "unclear"
    assert lean("the string has digits only", since_problem_s=20, overlaps_problem=True) == "reading_problem"


class Chat:
    def __init__(self, answer=None, delay=0.0, error=None):
        self.answer, self.delay, self.error, self.calls = answer, delay, error, []

    async def json(self, messages, schema_name, schema, max_tokens=3000):
        self.calls.append((messages, schema_name, max_tokens))
        if self.delay:
            await asyncio.sleep(self.delay)
        if self.error:
            raise self.error
        return self.answer, {}


def run_model(chat, text="what could zero decode to?", since=20.0, **kw):
    return asyncio.run(classify_by_model(chat, last_line="Here's your first question.", text=text, phase="coding",
                                         problem_excerpt="Decode Ways ...", typing=False, recent=[], since_problem_s=since, **kw))


def test_model_answer_is_used():
    assert run_model(Chat({"addressed": "thinking_aloud", "confidence": 0.9})) == ("thinking_aloud", 0.9, "model")


def test_low_confidence_becomes_unclear():
    assert run_model(Chat({"addressed": "thinking_aloud", "confidence": 0.4}))[0] == "unclear"


def test_timeout_and_errors_fall_back_to_lean():
    t = time.monotonic()
    assert run_model(Chat({"addressed": "to_interviewer", "confidence": 1}, delay=3.0)) == ("unclear", 0.0, "fallback")
    assert time.monotonic() - t < 1.0
    assert run_model(Chat(error=RuntimeError("boom")), text="the input is digits", since=10, overlaps_problem=True) == ("reading_problem", 0.0, "fallback")
    assert run_model(Chat({"addressed": "banana", "confidence": 1}))[2] == "fallback"


# --- a real question is never silenced (final review of the addressed-to-interviewer feature) ------------------------------------------------

ASKS = ("I think I need a hint", "wait can I get a hint", "maybe I should just get a different problem", "hmm what is the time limit",
        "okay so can I use extra space", "uh is zero allowed", "I think I will use dp is that fine", "I have a doubt", "one doubt, can n be zero",
        "the output is an integer right", "actually can I switch to java", "I don't know", "also what is the format")


def test_no_ask_is_placed_as_talk_to_self_by_rules():
    for t in ASKS:
        assert rules(t) not in SILENT, t
        assert rules(t, typing=True) not in SILENT, t
        assert rules(t, reading=True) not in SILENT, t


def test_no_ask_falls_to_silence_when_the_model_is_not_asked():
    for t in ASKS:
        assert lean(t, since_problem_s=20, overlaps_problem=True, on_problem=True) == "unclear", t


def test_asks_while_typing_are_not_thinking_aloud():
    for t in ("give me a hint", "I am stuck", "is the input sorted", "can I assume the input is sorted"):
        assert rules(t, typing=True) not in SILENT, t


def test_a_question_inside_a_read_out_is_not_a_read_out():
    assert rules("given an array of integers nums, is the array sorted", reading=True) not in SILENT


def test_self_talk_only_counts_on_a_problem():
    assert rules("I'll ask one more, what is the team size", on_problem=False) not in SILENT
    assert rules("hmm let me think", on_problem=False) is None
    assert rules("now the loop over the string", typing=True, on_problem=False) is None


def test_a_wrapped_ask_in_a_read_out_still_does_not_hide_the_hint_or_a_change():
    assert rules("given a string of digits, can I get a hint", reading=True) == "to_interviewer"


def test_a_model_that_places_an_ask_as_talk_to_self_is_checked_in_on():
    for t in ("okay so can I use extra space", "one doubt, can n be zero"):
        assert run_model(Chat({"addressed": "thinking_aloud", "confidence": 0.95}), text=t)[0] == "unclear", t
        assert run_model(Chat({"addressed": "reading_problem", "confidence": 0.95}), text=t)[0] == "unclear", t
    assert run_model(Chat({"addressed": "thinking_aloud", "confidence": 0.95}), text="and what could zero decode to?")[0] == "thinking_aloud"


def test_answers_to_the_checkin_that_carry_a_question_are_for_me():
    for t in ("no, can you give me a hint", "no I mean what does zero decode to", "no that was a question", "I was thinking can the string be empty",
              "nope, sorry, is n up to ten to the five"):
        assert answers_checkin(t) == "for_me", t
    assert answers_checkin("no, just thinking about the loop") == "thinking"


def test_the_ask_button_beats_everything():
    assert rules("hmm let me think", armed=True, typing=True) == "to_interviewer"


# ---- follow-up wave (2026-10-20): ask cues while typing, wh-asks inside a read-out, direct-only invitations

TYPED_ASKS = ("is the input sorted", "can I assume the input is sorted", "one doubt, can n be zero", "actually can I switch to java")
READ_ALOUD_WH = ("given a string s containing only digits what does zero decode to",
                 "s contains only digits and may contain leading zeros, so what is the length",
                 "given a string of digits, tell me the constraints",
                 "given a string s containing only digits and may contain leading zeros, what about zero")


def test_asks_typed_while_coding_go_to_the_model_never_to_narration():
    for t in TYPED_ASKS:
        assert rules(t, typing=True) is None, t
    assert rules("now the loop over the string", typing=True) == "thinking_aloud"      # no ask cue: narration while typing


def test_a_wh_ask_inside_a_read_out_is_not_reading_problem():
    for t in READ_ALOUD_WH:
        assert rules(t, reading=True) != "reading_problem", t


def test_pure_read_outs_stay_reading_problem():
    for t in ("given a numeric string determine the number of ways", "s contains only digits and may contain leading zeros",
              "given an array of integers nums and an integer target, return indices of the two numbers"):
        assert rules(t, reading=True) == "reading_problem", t


def test_invites_match_the_put_up_and_intro_lines_and_the_inviting_nudges():
    from app.interviewer.addressed import INVITES, is_invite
    from app.interviewer.lines import _INTRO
    from app.interviewer.plan import PROBLEM_INTRO
    assert all(is_invite(x.format(o="first")) for x in _INTRO) and is_invite(PROBLEM_INTRO)
    inviting = [x for x in LINES["addressed:nudge"] if is_invite(x)]
    assert "Let me know if you'd like me to weigh in." in inviting and "Just say if you want me to jump in." in inviting
    for x in ("let me know", "tell me if", "say if you", "just say", "feel free to ask", "if you'd like me to", "when you're ready",
              "whenever you are ready", "whenever you want me", "I'm here if you need", "ask me anything"):
        assert INVITES.search(x), x
    for x in LINES["addressed:checkin"]:
        assert not is_invite(x), x            # a check-in never turns direct-only on
    assert not is_invite("Take your time.") and not is_invite("Walk me through your approach.")


def test_direct_only_items_round_trip_and_old_checkpoints_load_empty():
    s = AddressedState(direct_only_items={"slot-1"})
    assert AddressedState.from_dict(s.to_dict()).direct_only_items == {"slot-1"}
    assert AddressedState.from_dict({"checkin_used": ["x"]}).direct_only_items == set()


def test_direct_ask_cue_covers_requests_and_complaints():
    from app.interviewer.addressed import has_direct_ask_cue
    for t in ("explain example two", "repeat that please", "one more time please", "I want to use python for this", "I would prefer to code in java",
              "the second example, I do not get it", "I'd like to use a hash map", "I don't get the second example", "I didn't get that"):
        assert has_direct_ask_cue(t), t
    assert not has_direct_ask_cue("now the loop over the string")
    assert not has_direct_ask_cue("hmm let me think about the edge cases")


def test_classify_by_model_keeps_the_raw_label_below_the_threshold():
    raw = {}
    assert run_model(Chat({"addressed": "to_interviewer", "confidence": 0.3}), text="the second example", raw=raw)[0] == "unclear"
    assert raw["label"] == "to_interviewer"
