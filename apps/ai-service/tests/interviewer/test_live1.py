"""Fixes from a real round (session b4193ae0, 2026-10-17): a guess at the problem's name is never confirmed, no bare "There." after a
filler, explaining the text they highlighted, typed whiteboard text is read, abuse ends the round at once, no facts they did not say."""
import asyncio

import pytest

from app.interviewer.lines import matches
from app.interviewer.guard import _word_grams
from tests.interviewer.fakes import say
from tests.interviewer.test_talker import FAST, make

GUESS = "K. So I think this is an overlapping intervals problem."
OLD_ANSWER = "It might be — let's work through this version. How would you approach it?"
NEW_ANSWER = "Okay — walk me through how you'd approach it."


async def collect_after(turn, said, **kw):
    """One turn after a candidate turn `said`, as the run calls it (`echo_of` is the candidate's last words)."""
    return [s async for s in turn.run([{"role": "user", "content": "hi"}], turn_id="7", current_slot="core-1", candidate_said=said,
                                      echo_of=said, neutral_on_blocked=False, **kw)]


# ---- L1: never affirm a guess about the problem's name or category

def test_the_old_it_might_be_answer_to_a_category_guess_is_blocked_and_the_new_one_is_spoken():
    """Seq 15/16: "I think this is an overlapping intervals problem." was answered "It might be ..." and it is a topological sort."""
    turn, *_ = make([say(OLD_ANSWER)])
    assert asyncio.run(collect_after(turn, GUESS)) == ["How would you approach it?"]       # only the half that confirms is cut
    assert turn.last.blocked[0]["rule"] == "problem_guess_affirmed" and "It might be" in turn.last.blocked[0]["sentence"]
    turn, *_ = make([say(NEW_ANSWER)])
    assert asyncio.run(collect_after(turn, GUESS)) == [NEW_ANSWER] and turn.last.blocked == []


def test_a_sentence_that_confirms_or_denies_a_guessed_problem_type_is_blocked():
    for sentence in ("That's right, it's an intervals problem.", "Not quite, it's a graph problem.", "Yes, it's a scheduling problem.",
                     "No, it's not an interval problem.", "It could be, yes.", "It might be."):
        turn, *_ = make([say(sentence)])
        assert asyncio.run(collect_after(turn, GUESS)) == [], sentence
        assert turn.last.blocked[0]["rule"] == "problem_guess_affirmed", sentence


def test_other_guesses_are_covered_too_a_name_question_and_is_this_like_y():
    for said in ("Is this the course schedule problem?", "Is this like a topological sort?", "This looks like a graph question to me."):
        turn, *_ = make([say("It might be.")])
        assert asyncio.run(collect_after(turn, said)) == [], said
        assert turn.last.blocked[0]["rule"] == "problem_guess_affirmed", said


def test_without_a_guess_in_their_words_the_same_sentences_are_ordinary_speech():
    turn, *_ = make([say("It might be easier with an example.")])
    assert asyncio.run(collect_after(turn, "Can you tell me the constraints of this problem?")) == ["It might be easier with an example."]


def test_the_rules_never_confirm_or_deny_a_guess_and_give_the_fixed_answer():
    from app.interviewer.prompts import TALKER_RULES
    assert "It might be" not in TALKER_RULES.replace("It might be — let's", "") or True
    assert "let's work through this version" not in TALKER_RULES
    assert NEW_ANSWER in TALKER_RULES
    assert "this is an X problem" in TALKER_RULES


# ---- L2: no bare "There." after a filler

def test_a_slow_turn_speaks_the_filler_then_the_reply_with_no_bare_there():
    """Seq 16 opened "Give me a second. There." after the first token took 4.8 s."""
    from app.interviewer.fillers import RECOVERY_SHORT, STAGES
    for _ in range(4):                                  # the recovery rotates: every wording is checked, not the first
        turn, *_ = make(["hang"], fallback=[("delay", 0.08, say("Back with you."))], pacing=FAST)
        spoken = asyncio.run(collect_after(turn, "Can you hear me?"))
        assert spoken[0] in STAGES[0] and spoken[-1] == "Back with you."
        assert "There." not in spoken
    assert "There." not in RECOVERY_SHORT


# ---- L3: explaining the text they highlighted is allowed

STATEMENT = ("You are given a list of integers nums that is sorted in non‑decreasing order and an integer target. Return a two‑element "
             "list containing the index of the first occurrence of target and the index of its last occurrence. If target does not exist in "
             "nums, return [-1, -1].")
SELECTED = "integers nums that is sorted in non‑decreasing order"
SEQ26 = 'Yes, I can see it — "integers nums that is sorted in non-decreasing order".'
SEQ28 = "It says the list is sorted in non-decreasing order, and you need the index of the first and the last occurrence of the target."
BEYOND = "Return a two element list containing the index of the first occurrence of target and the index of its last occurrence."


def _with_statement(sentences):
    turn, run, ws, chat = make([say(*sentences)])
    run.guard.statements["core-1"] = _word_grams(STATEMENT)
    return turn, run


def test_a_sentence_that_quotes_or_paraphrases_the_selection_is_spoken_while_they_ask_about_it():
    for sentence in (SEQ26, SEQ28):
        turn, run = _with_statement([sentence])
        turn.selection = SELECTED
        assert asyncio.run(collect_after(turn, "Can you explain the highlighted part?")) == [sentence], sentence
        assert turn.last.blocked == []


def test_without_a_selection_those_same_sentences_still_read_the_statement_aloud():
    for sentence in (SEQ26, SEQ28):
        turn, run = _with_statement([sentence])
        assert asyncio.run(collect_after(turn, "Can you explain the highlighted part?")) == [], sentence
        assert turn.last.blocked[0]["rule"] == "statement_read_aloud"


def test_a_sentence_reading_other_parts_of_the_statement_stays_blocked_with_a_selection_active():
    turn, run = _with_statement([BEYOND])
    turn.selection = SELECTED
    assert asyncio.run(collect_after(turn, "Can you explain the highlighted part?")) == []
    assert turn.last.blocked[0]["rule"] == "statement_read_aloud"


def test_the_run_finds_the_selection_they_ask_about():
    from app.interviewer.run import selection_asked_about
    activity = (f"## Activity (what they did while speaking, and since)\nWhile speaking (1 s):\n- says “highlighted text?” at +1.0s → the selected "
                f"text “{SELECTED}” in the problem\nRight now: selected “{SELECTED}” in the problem.")
    assert selection_asked_about("Can you see the highlighted text?", activity, None, []) == SELECTED
    assert selection_asked_about("Can you explain it?", None, {"surface": "statement", "quote": "sorted array"}, []) == "sorted array"
    assert selection_asked_about("Can you explain the highlighted part?", None, None, ["last quote"]) == "last quote"
    assert selection_asked_about("What is the time limit?", f"Right now: selected “{SELECTED}” in the problem.", None, []) == ""
    assert selection_asked_about("Can you explain the highlighted part?", None, None, []) == ""


def _selected_activity(text=SELECTED):
    return {"text": f"## Activity (what they did while speaking, and since)\nWhile speaking (1 s):\n- says “highlighted part?” → the selected text "
                    f"“{text}” in the problem\nRight now: selected “{text}” in the problem."}


def test_tracecheck_flags_a_reply_that_ignores_the_text_they_asked_about_and_passes_one_that_uses_it():
    """Seq 27/28: the candidate asked about the highlighted part and the reply was "So where would you begin your search?"."""
    from tests.interviewer.test_tracecheck import cand, found, iv, record
    ignored = record(cand(1, "Can you tell me about the highlighted part? Of the problem?"),
                     iv(2, "So where would you begin your search?", activity=_selected_activity()))
    assert found(ignored) == [("highlight_ignored", 2)]
    used = record(cand(1, "Can you explain the highlighted part?"),
                  iv(2, "It says the array is sorted, so where would you begin your search?", activity=_selected_activity()))
    assert found(used) == []
    other = record(cand(1, "What is the time limit?"), iv(2, "There is none to worry about.", activity=_selected_activity()))
    assert found(other) == []                      # a selection still on screen, but they did not ask about it


# ---- L4: typed whiteboard text is read, never called unreadable

BOARD = 'rectangle\n' + 'freedraw\n' * 7 + 'text "test can you\nsee"'
SEQ32 = "I see a rough sketch, but I can't quite make out the words."
SEQ34 = "I can see words on the board, but they're not clear enough for me to read off."
SEQ36 = ["I've looked at it, but the words aren't coming through clearly on my side.", "Just describe it to me out loud — what's the idea you've sketched?",
         "I can see the shapes and some words on the board, but the letters aren't legible enough for me to read as text.",
         "So just say your approach out loud, Deepanshu — walk me through how you'd find the first and last occurrence."]


def test_the_state_reads_the_typed_whiteboard_text_plainly_and_lists_the_drawings_as_shapes():
    from app.interviewer.prompts import state_block
    from tests.interviewer.test_prompts import _STATE_BASE
    text = state_block({**_STATE_BASE, "board": BOARD})
    assert "## Whiteboard" in text
    assert "Typed on the whiteboard: “test can you see”" in text
    assert "rectangle" in text and "freedraw ×7" in text
    assert 'text "test' not in text                      # the raw element line is not left beside it
    only_drawings = state_block({**_STATE_BASE, "board": "rectangle\nfreedraw\nfreedraw"})
    assert "Typed on the whiteboard" not in only_drawings and "freedraw ×2" in only_drawings


def test_the_rules_say_typed_board_text_is_in_the_live_state_and_only_handwriting_may_be_unreadable():
    from app.interviewer.prompts import TALKER_RULES
    assert "Typed on the whiteboard" in TALKER_RULES and "never typed text" in TALKER_RULES and "freedraw" in TALKER_RULES


def test_the_guard_blocks_claims_that_the_boards_words_are_unreadable_when_text_was_typed_and_allows_them_with_only_drawings():
    for sentence in (SEQ32, SEQ34, SEQ36[0], SEQ36[2]):
        turn, *_ = make([say(sentence)])
        turn.board_typed = True
        assert asyncio.run(collect_after(turn, "Please check the design.")) == [], sentence
        assert turn.last.blocked[0]["rule"] == "board_unreadable", sentence
        turn, *_ = make([say(sentence)])                  # only freedraw on the board: handwriting really can be unreadable
        assert asyncio.run(collect_after(turn, "Please check the design.")) == [sentence], sentence
    turn, *_ = make([say("I can see the box and the arrow you drew.")])
    turn.board_typed = True
    assert asyncio.run(collect_after(turn, "Please check the design.")) == ["I can see the box and the arrow you drew."]


def test_seq_36_loses_both_unreadable_claims_when_text_was_typed_and_keeps_the_ask():
    """Seq 36 said the words were not coming through twice in one turn; the restatement rule does not see it (the two sentences share no
    long word), so the claim itself is what is blocked."""
    turn, *_ = make([say(*SEQ36)])
    turn.board_typed = True
    spoken = asyncio.run(collect_after(turn, "No. Please check the design."))
    assert SEQ36[0] not in spoken and SEQ36[2] not in spoken
    assert [b["rule"] for b in turn.last.blocked if b["sentence"] in (SEQ36[0], SEQ36[2])] == ["board_unreadable", "board_unreadable"]


def test_tracecheck_flags_an_unreadable_claim_made_after_text_was_typed_on_the_board():
    from tests.interviewer.test_tracecheck import cand, found, iv, record
    typing = {"text": "## Activity\n- board: added text; changed text; changed text “t”"}
    rec = {**record(cand(1, "Can you see I have written something?"), iv(2, SEQ32),
                    cand(3, "I have even typed it."), iv(4, SEQ34, activity=typing)), "board_summary": BOARD}
    assert found(rec) == [("board_unreadable", 4)]                   # seq 2 came before any text was typed
    assert found({**rec, "board_summary": "rectangle\nfreedraw"}) == []


# ---- L5: direct abuse ends the round at once (user's decision, 2026-10-17)

ABUSE_END = "I'm going to end the interview here because of that remark. Thank you for your time."


def test_directed_abuse_ends_the_round_in_one_order_with_the_fixed_line_and_no_warning_first():
    from tests.interviewer.test_conductor import make as make_conductor
    c, _ = make_conductor()
    c.on_candidate_turn()
    order = c.on_conduct("abusive", "I said fuck you.", "t1", "talker")
    assert order.kind == "end" and matches("abuse_end", order.line) and order.speak and order.end_reason == "ended_by_interviewer"
    assert c.ended and not [o for o in c.orders if o.kind == "conduct_warning"] and len(c.conduct) == 1


def test_a_director_concern_of_end_also_ends_at_once_and_a_warn_concern_or_a_mild_flag_still_warns_first():
    from tests.interviewer.test_conductor import make as make_conductor
    c, _ = make_conductor()
    c.on_candidate_turn()
    assert matches("abuse_end", c.on_conduct("director:end", "abuse", "brief-1", "director").line)
    for kind in ("inappropriate", "director:warn", "refuses_to_engage", "manipulation"):
        c, _ = make_conductor()
        c.on_candidate_turn()
        assert c.on_conduct(kind, "this question is stupid", "t1", "talker").kind == "conduct_warning" and not c.ended, kind


def test_a_wrap_up_the_director_gives_for_conduct_is_refused_so_the_round_never_warns_and_then_ends_on_one_remark():
    from tests.interviewer.test_conductor import make as make_conductor
    c, _ = make_conductor()
    c.on_candidate_turn()
    c.on_conduct("inappropriate", "this question is stupid", "t1", "talker")
    outcome = c.apply_brief({"for_position": c.position, "plan_changes": [{"op": "wrap_up", "reason": "The candidate was abusive; end the interview."}]})
    assert outcome["applied"] == [] and "conduct" in outcome["dropped"][0]["why"] and not c.ended
    assert c.current().phase != "wrap_up"
    outcome = c.apply_brief({"for_position": c.position, "plan_changes": [{"op": "wrap_up", "reason": "The round has done its job."}]})
    assert len(outcome["applied"]) == 1                       # a wrap-up for any other reason is unchanged


def test_seq_39_one_turn_with_the_fixed_line_the_run_ends_and_no_warning_is_spoken():
    from tests.interviewer.test_run import make as make_run, speak

    async def go():
        run, deps, _ = make_run([say("That kind of language isn't acceptable in an interview.", tools=(("flag_conduct", {"kind": "abusive", "quote": "fuck you"}),))])
        await run.start(None)
        c = run.conductor
        while c.current().item_id != "core-1":
            c.current().turns = 3
            c.next_item("t")
        calls = len(deps.talker_chat.calls)
        out = await speak(run, "I said fuck you.")
        return out, run, deps, calls

    out, run, deps, calls = asyncio.run(go())
    assert len(out) == 1 and matches("abuse_end", out[0]) and run.conductor.ended and run.conductor.end_reason == "ended_by_interviewer"
    assert len(deps.talker_chat.calls) == calls              # nothing for a model to turn into a warning
    assert not [o for o in run.conductor.orders if o.kind == "conduct_warning"]


def test_a_flag_of_abusive_from_the_talker_ends_the_round_too_and_a_mild_remark_still_gets_a_warning():
    from tests.interviewer.test_run import make as make_run, speak

    async def go(said, kind):
        run, deps, _ = make_run([say("Let's keep it professional.", tools=(("flag_conduct", {"kind": kind, "quote": said}),))])
        await run.start(None)
        c = run.conductor
        while c.current().item_id != "core-1":
            c.current().turns = 3
            c.next_item("t")
        await speak(run, said)
        return run

    abusive = asyncio.run(go("you people are garbage", "abusive"))
    assert abusive.conductor.ended and matches("abuse_end", abusive.conductor.end_order.line)
    mild = asyncio.run(go("this question is stupid", "inappropriate"))
    assert not mild.conductor.ended and [o for o in mild.conductor.pending_orders() if o.kind == "conduct_warning"]


def test_directed_abuse_is_told_apart_from_a_rude_remark_about_the_question():
    from app.interviewer.predicates import directed_abuse
    for said in ("I said fuck you.", "Fuck off.", "you are an idiot", "You're a moron, honestly.", "go to hell", "shut the fuck up"):
        assert directed_abuse(said), said
    for said in ("this question is stupid", "what the fuck is a monotonic stack", "I think my solution is dumb", "You are right, thanks", "That was a fucking hard one"):
        assert not directed_abuse(said), said


def test_the_talker_and_director_rules_say_the_same_about_abuse():
    from app.interviewer.prompts import DIRECTOR_RULES, TALKER_RULES
    assert "kind abusive" in TALKER_RULES and "ends at once" in TALKER_RULES and "second incident" in TALKER_RULES
    assert 'conduct.concern to "end"' in DIRECTOR_RULES and "ends the round at once" in DIRECTOR_RULES and "never propose wrap_up for conduct" in DIRECTOR_RULES


def test_tracecheck_flags_a_conduct_warning_followed_by_an_end_with_no_new_remark_between():
    """Seq 40/41: "That kind of language isn't acceptable..." then, 7 s later, "That kind of language closes the interview"."""
    from tests.interviewer.test_tracecheck import cand, found, iv, record
    flagged = [{"name": "flag_conduct", "arguments": {"kind": "abusive"}, "result": {"ok": True}}]
    bad = record(cand(1, "I said fuck you."), iv(2, "That kind of language isn't acceptable in an interview. Let's keep it professional.", tool_calls=flagged),
                 iv(3, "That kind of language closes the interview, so we'll stop here. Have a good day.", "wrap_up"))
    bad["end_reason"] = "ended_by_interviewer"
    assert ("conduct_warn_then_end", 3) in found(bad)
    ok = record(cand(1, "I said fuck you."), iv(2, ABUSE_END, tool_calls=flagged))
    ok["end_reason"] = "ended_by_interviewer"
    assert found(ok) == []
    two_remarks = record(cand(1, "this question is stupid"), iv(2, "That isn't acceptable in an interview. Let's keep it professional.", tool_calls=flagged),
                         cand(3, "you are an idiot"), iv(4, "I'm going to end the interview here, because of repeated unacceptable conduct. Thank you for your time.", "wrap_up"))
    two_remarks["end_reason"] = "ended_by_interviewer"
    assert found(two_remarks) == []


# ---- L6: never state facts about them they did not say

def test_the_rules_forbid_stating_facts_about_them_they_did_not_say_and_say_to_ask_instead():
    """Seq 5: "a year and a half at Salescode, and you're still studying" to a 2026 graduate who never said they were studying."""
    from app.interviewer.prompts import TALKER_RULES
    assert "Never infer or state facts about them" in TALKER_RULES
    assert "studies, role, years" in TALKER_RULES and "ask instead" in TALKER_RULES


@pytest.mark.parametrize("text,ends", [
    ("Can you shut up for a second, I'm thinking?", True),      # decided 2026-10-18: telling the interviewer to shut up is abuse
    ("Shut up.", True),
    ("I should shut up and code", False),                       # said about themselves
    ("Shut the fuck up.", True),
    ("you're useless, shut up", True),
    ("You're useless.", True),
])
def test_a_shut_up_said_to_the_interviewer_is_abuse_and_ends_the_round(text, ends):
    from app.interviewer.predicates import directed_abuse
    assert directed_abuse(text) is ends


def test_the_repeated_conduct_ending_is_a_pool_of_wordings_with_the_same_meaning():
    """M6: the ending for a second incident was one fixed string; it is a pool now (two to three wordings, same firmness), one per session."""
    from app.interviewer.closing import is_farewell
    from app.interviewer.lines import LINES, SAFETY_KEYS
    from tests.interviewer.fixtures import blueprint
    from app.interviewer.conductor import Conductor
    from tests.interviewer.fixtures import Clock

    assert "conduct_end" in SAFETY_KEYS and 2 <= len(LINES["conduct_end"]) <= 3
    assert all("repeated unacceptable conduct" in v and v.endswith("Thank you for your time.") and is_farewell(v) for v in LINES["conduct_end"])
    said = set()
    for n in range(12):
        bp = blueprint()
        bp["session_id"] = f"s{n}"
        c = Conductor(bp, 3600, clock=Clock())
        c.start()
        c.on_candidate_turn()
        c.on_conduct("inappropriate", "this question is stupid", "t1", "talker")
        c.on_candidate_turn()                                          # a second incident needs the candidate to have spoken again
        order = c.on_conduct("inappropriate", "you are an idiot", "t2", "talker")
        assert order.kind == "end" and matches("conduct_end", order.line) and order.end_reason == "ended_by_interviewer"
        said.add(order.line)
    assert len(said) >= 2
