"""The trace check: one synthetic record per previously fixed problem, a clean one with none, and the last good rehearsals."""
import json
from pathlib import Path

import pytest

from app.interviewer.lines import LINES
from app.interviewer.plan import problem_intro
from app.interviewer.tracecheck import check_record

REHEARSALS = sorted((Path(__file__).parent / "fixtures" / "rehearsals").glob("rh9_*.json"))
OUTLINE = ("Let me tell you how this round will run. We'll start with a short introduction from you, then one or two coding problems, "
           "then a chat about your projects, and finally your questions for me.")


def iv(seq, text, item="core-1", **kw):
    return {"speaker": "interviewer", "seq": seq, "text": text, "item_id": item, "tool_calls": [], "blocked": [], "at": 1000.0 + seq * 10,
            "free_min": 10, **kw}


def cand(seq, text="I would use a hash map and scan once.", item="core-1"):
    return {"speaker": "candidate", "seq": seq, "text": text, "item_id": item, "at": 1000.0 + seq * 10}


def slot(item_id, status="active", turns=3, ended_by=None):
    return {"item_id": item_id, "kind": "slot", "phase": "core", "status": status, "turns": turns, "ended_by": ended_by, "origin": "plan", "title": ""}


def phase(item_id, status="done", turns=1):
    return {"item_id": item_id, "kind": "phase", "phase": item_id, "status": status, "turns": turns, "ended_by": None, "origin": "plan", "title": ""}


def record(*turns, items=(), flow_log=()):
    return {"shape_id": "classic", "turns": list(turns), "items": list(items), "flow_log": list(flow_log), "briefs": [], "end_reason": "completed"}


def found(rec):
    return [(f["check"], f["seq"]) for f in check_record(rec)]


def test_a_clean_record_has_no_findings():
    rec = record(iv(1, "Hi, I'm Siddharth. Can you hear me clearly?", "greeting"), cand(2, "Yes, loud and clear.", "greeting"),
                 iv(3, OUTLINE + " Could you start with a short introduction?", "framing"), cand(4, "I'm a backend engineer.", "candidate_intro"),
                 iv(5, "What was the hardest part of the migration?", "candidate_intro"), cand(6),
                 iv(7, "How would you scan the array once?"), cand(8), iv(9, "Thank you for your time today. Take care.", "wrap_up"),
                 items=[phase("greeting"), phase("framing"), phase("candidate_intro"), slot("core-1"), phase("wrap_up", "active")])
    assert check_record(rec) == []


def test_a_silent_reply_to_the_candidate_is_found_but_a_silent_opening_is_not():
    assert found(record(iv(1, ""), cand(2), iv(3, "  "))) == [("silent_reply", 3)]


def test_narration_an_internal_id_a_tool_call_and_a_planned_later_excuse_spoken_are_found():
    rec = record(iv(1, "Candidate is ready. The small talk is done, so I'll move on to framing."),
                 iv(3, "Let's look at problem-2 after it."),
                 iv(5, 'Brute force is fine. log turn(condition="Candidate is ready.", action="stay", why="x")'),
                 iv(7, "I'd actually planned to ask you that later."))
    assert found(rec) == [("narration", 1), ("internal_id", 3), ("narration", 3), ("tool_call_spoken", 5), ("planned_later", 7)]


def test_asking_whether_the_format_is_okay_is_found_only_when_it_is_not_the_one_check_of_the_outline_turn():
    """Decided 2026-10-18: the outline turn may end with one check; a second ask, or one outside that turn, is a finding."""
    assert found(record(iv(1, OUTLINE + " Does that sound good to you?", "framing"))) == []
    assert found(record(iv(1, OUTLINE + " Does that sound good to you?", "framing"), cand(2, "Sure.", "framing"),
                        iv(3, "Great. Does that sound good to you?", "framing"))) == [("format_confirmation", 3)]


def test_a_third_re_ask_on_one_part_is_found_but_the_second_is_not():
    asks = ["Which project would you like to walk me through, Relay or Vibe?",
            "I still need to know which project you want to discuss: Relay or Vibe?",
            "Let me ask it plainly: Relay or Vibe, which project would you like to walk me through?",
            "Once more, Relay or Vibe, which project is the one to discuss?"]
    turns = []
    for n, ask in enumerate(asks):
        turns += [iv(2 * n + 1, ask, "candidate_intro"), cand(2 * n + 2, "We had a database migration fail once.", "candidate_intro")]
    assert found(record(*turns[:6])) == []
    assert found(record(*turns)) == [("third_reask", 7)]
    ok_tool = [dict(t, tool_calls=[{"name": "go_to", "arguments": {}, "result": {"ok": True}}]) if t["seq"] == 5 else t for t in turns]
    assert found(record(*ok_tool)) == []                                           # a tool move starts the count again


def test_a_problem_done_without_the_candidate_saying_a_word_is_found_unless_it_was_given_up_skipped_or_swapped():
    shown = [{"name": "show_problem", "arguments": {}, "result": {"ok": True}}]      # the problem did go up: the claim is true
    turns = [iv(1, "Here is your first question.", tool_calls=shown), cand(2)]
    assert found(record(*turns, items=[slot("core-1", "done", 0, "problem requested")])) == [("problem_without_candidate", 1)]
    for why in ("they gave up on it", "swapped for a different problem", "skipped: out of time"):
        assert found(record(*turns, items=[slot("core-1", "done", 0, why)])) == []
    assert found(record(*turns, items=[slot("core-1", "done", 3, "done"), slot("core-2", "pending", 0)])) == []


def test_the_outline_given_twice_is_found_at_the_second_time():
    rec = record(iv(1, OUTLINE, "framing"), cand(2, "Sure.", "framing"), iv(3, "Thanks. " + OUTLINE, "framing"))
    assert found(rec) == [("outline_twice", 3)]


def test_asking_for_the_introduction_after_it_is_done_is_found():
    items = [phase("candidate_intro"), {**phase("deep_dive", "active"), "phase": "deep_dive"}]
    rec = record(iv(1, "Tell me about yourself.", "candidate_intro"), cand(2, item="candidate_intro"),
                 iv(3, "Tell me about your project.", "deep_dive"), cand(4, item="deep_dive"),
                 iv(5, "Could you give me a short introduction first?", "deep_dive"), items=items)
    assert found(rec) == [("intro_after_done", 5)]


def test_a_second_goodbye_is_found():
    rec = record(iv(1, "Thanks for your time today. Take care.", "wrap_up"), iv(2, "Goodbye, and all the best.", "wrap_up"))
    assert found(rec) == [("double_goodbye", 2)]


def test_a_goodbye_in_reply_to_the_candidates_goodbye_is_not_a_second_goodbye_but_a_third_is():
    rec = record(iv(1, "Thanks for your time today. Take care.", "wrap_up"), cand(2, "Thank you, goodbye!", "wrap_up"),
                 iv(3, "You too, take care.", "wrap_up"))
    assert found(rec) == []
    canned = record(*rec["turns"], iv(4, "Thank you for your time today, Asha. Take care, and goodbye.", "wrap_up"))
    assert found(canned) == [("double_goodbye", 4)]


def test_a_turn_that_acknowledges_twice_or_says_a_sentence_again_is_found_and_one_acknowledgement_is_not():
    twice = "That's a solid, contract-first way to split the work. That's a thoughtful split — fixing the contract first saves pain. What slipped through?"
    assert found(record(iv(1, twice))) == [("double_ack", 1)]
    assert found(record(iv(1, "Good to hear. Good to hear. Walk me through how you planned the sprint."))) == [("double_ack", 1)]
    assert found(record(iv(1, "Nice, that's a solid scope. You mentioned running the performance guild, how's that going these days?"))) == []
    assert found(record(iv(1, "Good. Alright, let me tell you how this round will run. We'll start with a short introduction."))) == []


def test_a_stumble_that_was_not_repaired_is_found():
    assert found(record(iv(1, "You said it is linear... I mean, you said it is quadratic, right?"))) == [("unrepaired_stumble", 1)]


def test_a_promise_is_found_only_when_no_thread_or_deferred_topic_followed_and_one_was_allowed():
    promise = "Let's keep that thread for later. What did you build next?"
    kept = [{"move": "defer_topic", "target": "that side project", "why": "inferred: promised to return", "ok": True, "error": "", "at": 1011.0}]
    assert found(record(iv(1, promise, "candidate_intro"))) == [("promise_unkept", 1)]
    assert found(record(iv(1, promise, "candidate_intro"), flow_log=kept)) == []
    assert found(record(iv(1, promise, "candidate_intro", free_min=0))) == []              # no minute to spare: refused legitimately
    assert found(record(iv(1, promise, "candidate_intro"), items=[{**phase("deferred-1", "pending"), "origin": "promise", "kind": "thread"}])) == []
    opened = iv(1, promise, "candidate_intro", tool_calls=[{"name": "open_thread", "arguments": {"title": "x"}, "result": {"ok": True}}])
    assert found(record(opened)) == []


def test_a_silent_turn_is_not_a_finding_after_an_okay_a_short_remark_or_while_they_type():
    assert found(record(iv(1, "Walk me through it."), cand(2, "Okay."), iv(3, ""))) == []
    assert found(record(iv(1, "Walk me through it."), cand(2, "Hmm, let me think."), iv(3, ""))) == []
    typing = iv(3, "", activity={"text": "typed line 4: return seen"})
    assert found(record(iv(1, "Walk me through it."), cand(2, "So I would loop over the pairs now."), typing)) == []
    assert found(record(iv(1, "Walk me through it."), cand(2, "So I would loop over the pairs now."), iv(3, ""))) == [("silent_reply", 3)]


def test_does_that_sound_right_in_the_middle_of_a_problem_is_not_a_format_confirmation():
    assert found(record(iv(1, "So you scan once and keep the counts. Does that sound right to you?", "core-1"))) == []
    assert found(record(iv(1, "We'll cover a quick intro and then two problems. Does that sound right to you?", "framing"))) == [("format_confirmation", 1)]


def test_a_promise_counts_as_kept_by_a_follow_up_or_a_promised_thread_and_a_refused_thread_is_not_a_finding():
    promise = "Let's keep that thread for later. What did you build next?"
    refused = [{"move": "open_thread", "target": "x", "why": "inferred", "ok": False, "error": "not while a problem is up", "at": 1011.0}]
    assert found(record(iv(1, promise, "candidate_intro"), flow_log=refused)) == []
    assert found(record(iv(1, promise, "candidate_intro"), items=[{"item_id": "thread-1", "kind": "thread", "origin": "thread"}])) == []
    assert found(record(iv(1, promise, "candidate_intro"))) == [("promise_unkept", 1)]
    done = dict(record(iv(1, promise, "candidate_intro")), follow_ups={"deep_dive": ["They promised to come back to: that thread"]})
    assert check_record(done) == []


def test_an_interrupted_or_failed_turn_never_counts_toward_a_third_re_ask():
    asks = ["Which project would you like to walk me through, Relay or Vibe?", "I still need to know which project you want to discuss: Relay or Vibe?",
            "Let me ask it plainly: Relay or Vibe, which project would you like to walk me through?",
            "Once more, Relay or Vibe, which project is the one to discuss?"]
    turns = []
    for n, ask in enumerate(asks):
        extra = {"interrupted": True} if n == 3 else {}
        turns += [iv(2 * n + 1, ask, "candidate_intro", **extra), cand(2 * n + 2, "We had a database migration fail once.", "candidate_intro")]
    assert found(record(*turns)) == []


# The last rehearsals (rh9) ran before the speech repair, the deferred topics and the no-minutes rule (rh9_wanders_off seq 5 said the round's minutes) existed, so a few lines in them are findings the
# checker rightly makes: the stumble "...first-name-half mentioned... I mean, you said" (the corpus's line 248, now repaired before
# it is spoken) and "I'll leave the choice to you and pick it up when we get to that part", a line promises_to_return cannot tell from a
# promise (the corpus leaves it unlabelled), and rh9_unplanned_topic seq 26, which asks "What does your code produce for that?" and puts
# problem 2 up in one turn (the talker now holds the second of the two; the question follows "let's move to the next part", which question_after_close also finds). Anything else appearing here is a regression.
KNOWN = {"rh9_wanders_off": [("time_spoken", 5), ("unrepaired_stumble", 9)], "rh9_unplanned_topic": [("promise_unkept", 12), ("question_after_close", 26), ("question_then_problem", 26)]}


@pytest.mark.parametrize("path", REHEARSALS, ids=lambda p: p.stem)
def test_the_last_good_rehearsals_have_only_the_findings_their_older_code_explains(path):
    assert len(REHEARSALS) == 4
    assert [(f["check"], f["seq"]) for f in check_record(json.loads(path.read_text()))] == KNOWN.get(path.stem, [])


def test_every_check_fails_except_an_unkept_promise_which_is_only_a_note():
    promise = iv(1, "Let's keep that thread for later. What did you build next?", "candidate_intro")
    assert [(f["check"], f["severity"]) for f in check_record(record(promise))] == [("promise_unkept", "note")]
    assert [f["severity"] for f in check_record(record(iv(1, "")))] == []
    assert [f["severity"] for f in check_record(record(iv(1, "Does that sound good to you?", "framing")))] == ["fail"]


def test_a_promised_part_or_follow_up_with_another_topic_does_not_keep_this_promise():
    promise = iv(3, "That migration story sounds worth a chat later. What did you build next?", "candidate_intro")
    said = cand(2, "We lost a weekend to a failed database migration.", "candidate_intro")
    other = [{"item_id": "deferred-1", "kind": "thread", "origin": "promise", "title": "that startup idea", "status": "pending"}]
    mine = [{"item_id": "deferred-1", "kind": "thread", "origin": "promise", "title": "that migration story", "status": "pending"}]
    assert found(record(said, promise, items=other)) == [("promise_unkept", 3)]
    assert found(record(said, promise, items=mine)) == []


def _persona(*turns, code_log=()):
    return {**record(*turns, items=[slot("core-1")]), "clock_start": 1000.0, "code_log": list(code_log)}


def test_a_claim_about_code_before_any_was_typed_is_found_but_not_after_and_records_without_a_code_log_are_skipped():
    claim = "I see on the screen you've already written the two-pointer solution. What is its complexity?"
    assert found(_persona(iv(1, "Here is the problem."), iv(3, claim))) == [("code_claim", 3)]
    typed = [{"at": 15.0, "code": "def f(nums):\n    return nums\n"}]
    assert found(_persona(iv(1, "Here is the problem."), iv(3, claim), code_log=typed)) == []
    starter = [{"at": 15.0, "code": "# write your solution here\n"}]
    assert found(_persona(iv(1, "Here is the problem."), iv(3, claim), code_log=starter)) == [("code_claim", 3)]
    assert found(record(iv(1, claim))) == []                                      # no code_log: nothing known about the editor
    assert found(_persona(iv(1, "Once you've written it, walk me through a test case."))) == []


def test_a_link_to_a_topic_that_was_not_discussed_is_found():
    hashmap = "A HashMap is an array of buckets and the hash of the key picks one."
    rec = record(iv(1, "Why do long buckets become trees?"), cand(2, hashmap), iv(3, "Let me stay on SQL for one more: what is the difference between WHERE and HAVING?"))
    assert found(rec) == [("false_continuity", 3)]


def test_a_link_to_a_topic_that_was_just_discussed_or_a_plain_new_topic_is_not_found():
    sql = "I used SQL joins a lot, and a JOIN combines rows from two tables."
    linked = record(cand(1, sql), iv(2, "Let me stay on SQL for one more: what is the difference between WHERE and HAVING?"))
    plain = record(cand(1, "A HashMap is an array of buckets."), iv(2, "Let me ask you one on SQL: what is the difference between WHERE and HAVING?"))
    assert found(linked) == [] and found(plain) == []
    assert found(record(cand(1, "We added a cache in front of the dashboard."), iv(2, "Staying on the cache, how did you invalidate it?"))) == []


def test_a_present_tense_screen_claim_before_any_problem_was_shown_is_found_but_not_after_one_was():
    claim = "Alright, let's get into the coding now \u2014 give me your approach to the problem on your screen."
    shown = iv(5, "Let me put it up. Here's your first question. Give it a read.", "candidate_intro",
               tool_calls=[{"name": "show_problem", "arguments": {}, "result": {"ok": True}}])
    assert found(record(iv(1, claim, "framing"))) == [("screen_claim_unshown", 1)]
    assert found(record(shown, iv(7, claim))) == []                              # the claim at 7 follows a problem that really went up
    assert found(record(iv(1, "Let me put the first problem on your screen.", "candidate_intro"))) == []      # the run's own line
    bare = {"speaker": "interviewer", "seq": 1, "text": claim, "item_id": "framing"}
    assert found(record(bare)) == []                                              # no tool_calls in the record: nothing to tell
    assert found(record(iv(1, OUTLINE, "framing"))) == []


def test_the_screen_claim_check_on_the_p20_rehearsal_finds_its_seq_9():
    path = Path("/private/tmp/claude-501/-Users-salescode-Desktop-project-interviewiq/6acd6004-ecd3-44d1-b862-1bf228efd57b/scratchpad/ops/p20/strong_fresher.json")
    if not path.exists():
        pytest.skip("the p20 rehearsal record is not on this machine")
    assert ("screen_claim_unshown", 9) in found(json.loads(path.read_text()))


def test_the_runs_own_problem_lines_are_exempt_sentence_by_sentence():
    from app.interviewer.plan import problem_intro, problem_put_up
    assert found(record(iv(1, problem_intro(1), "candidate_intro"))) == []
    assert found(record(iv(1, problem_put_up(1) + " " + problem_intro(1), "candidate_intro"))) == []


def test_question_then_problem_finds_a_turn_that_asks_something_and_puts_the_problem_up():
    ok = [{"name": "show_problem", "arguments": {}, "result": {"ok": True}}]
    asks = "Alright, let's get into the coding now. Was that deliberate, or learned the hard way? Let me put the first problem on your screen."
    assert found(record(iv(9, asks, "candidate_intro", tool_calls=ok))) == [("question_then_problem", 9)]
    assert found(record(iv(9, "Alright, let's get into the coding now. Let me put the first problem on your screen.", "candidate_intro", tool_calls=ok))) == []
    failed = [{"name": "show_problem", "arguments": {}, "result": {"ok": False}}]
    assert ("question_then_problem", 9) not in found(record(iv(9, asks, "candidate_intro", tool_calls=failed)))
    assert found(record(iv(9, problem_intro(1), "candidate_intro", tool_calls=ok))) == []


def test_question_then_problem_on_the_p21_rehearsal_finds_its_seq_9():
    path = Path("/private/tmp/claude-501/-Users-salescode-Desktop-project-interviewiq/6acd6004-ecd3-44d1-b862-1bf228efd57b/scratchpad/ops/p21/strong_fresher.json")
    if not path.exists():
        pytest.skip("the p21 rehearsal record is not on this machine")
    assert ("question_then_problem", 9) in found(json.loads(path.read_text()))


# ---- interviewer style: metrics and checks (S5)

def test_a_filler_line_right_after_the_candidate_starts_coding_is_a_failure():
    started = cand(2, "Sure, writing the two-pointer version now.")
    assert found(record(iv(1, "Go ahead and code it."), started, iv(3, "Could you say a bit more about that?"))) == [("filler_after_start", 3)]
    # a filler after an ordinary answer is not this check's business, and a real reply after they start is fine
    assert found(record(cand(2), iv(3, "Could you say a bit more about that?"))) == []
    assert found(record(started, iv(3, "Sure."))) == []


def test_three_turns_in_a_row_that_open_with_a_verdict_are_a_note():
    opened = [iv(1, "That's a solid approach. And the cost?"), iv(2, "Good, that's right. What about duplicates?"),
              iv(3, "Nice, clean. What would you change?")]
    findings = check_record(record(cand(0), opened[0], cand(1), opened[1], cand(2), opened[2]))
    assert [(f["check"], f["seq"], f["severity"]) for f in findings if f["check"] == "verdict_streak"] == [("verdict_streak", 3, "note")]
    quiet = [iv(1, "That's a solid approach. And the cost?"), iv(2, "Okay. What about duplicates?"), iv(3, "Nice, clean. What would you change?")]
    assert [f for f in check_record(record(cand(0), quiet[0], cand(1), quiet[1], cand(2), quiet[2])) if f["check"] == "verdict_streak"] == []


def test_style_metrics_count_verdicts_echoes_blocked_turns_fillers_and_the_wait_for_the_first_problem():
    from app.interviewer.tracecheck import style_metrics

    said = "Each person owned one remote end to end, and I owned the host shell and the shared contracts between them."
    rec = {"clock_start": 1000.0, "turns": [
        cand(1, said), iv(2, "That's a solid split. Did it hold up?", blocked=[{"rule": "x"}]),
        cand(3, said), iv(4, "You owned the host shell and the shared contracts between the remotes. Did it hold up?"),
        cand(5, "Okay."), iv(6, "Could you say a bit more about that?"),
        cand(7, "Yes."), iv(8, "Let me put the first problem on your screen.", tool_calls=[{"name": "show_problem", "arguments": {}, "result": {"ok": True}}],
                            at=1000.0 + 600)]}
    m = style_metrics(rec)
    assert m["verdict_rate"] == 0.25 and m["echo_rate"] == 0.25 and m["blocked_rate"] == 0.25
    assert m["filler_lines"] == 1 and m["minutes_before_first_problem"] == 10.0


def test_style_metrics_of_an_empty_record_are_zero_and_no_problem_is_none():
    from app.interviewer.tracecheck import style_metrics

    m = style_metrics({"turns": []})
    assert m == {"verdict_rate": 0.0, "echo_rate": 0.0, "blocked_rate": 0.0, "filler_lines": 0, "minutes_before_first_problem": None}


# ---- polish: left_problem_in_words (P16) and non_english (P17)

def test_declaring_the_coding_done_while_the_problem_stays_active_is_a_failure():
    left = iv(3, "That wraps up the coding part. Now a couple of questions about your projects, then some quick fundamentals.", "core-2")
    stays = iv(5, "Tell me how you would start.", "core-2")
    items = [slot("core-1", "done"), slot("core-2")]
    assert ("left_problem_in_words", 3) in found(record(cand(2, item="core-2"), left, cand(4, item="core-2"), stays, items=items))
    # a close that is followed by the plan really leaving the problem is the ordinary flow
    moved = iv(5, "Walk me through the portal.", "deep_dive")
    assert "left_problem_in_words" not in [c for c, _ in found(record(cand(2, item="core-2"), left, cand(4, item="deep_dive"), moved,
                                                                      items=[slot("core-1", "done"), slot("core-2", "done"), phase("deep_dive", "active")]))]


def test_a_sentence_in_a_non_latin_script_is_a_failure():
    assert found(record(iv(1, "Okay. 好的，这样单次查询就能得出结果。"))) == [("non_english", 1)]
    assert found(record(iv(1, "Okay, the cost is O(n) — and “constant” space."))) == []


# ---- polish checks (P3 to P8, P15)

OK_SHOW = [{"name": "show_problem", "arguments": {}, "result": {"ok": True}}]


def test_a_claim_about_the_screen_is_not_a_failure_when_the_next_interviewer_turn_shows_the_problem_before_any_candidate_turn():
    """b1 strong_fresher seq 11 said "Let's get into the coding now." and seq 12, with no candidate turn between, showed the problem."""
    claim = iv(11, "Let's get into the coding now.", "candidate_intro")
    shows = iv(12, problem_intro(1), "core-1", tool_calls=OK_SHOW)
    assert "screen_claim_unshown" not in [c for c, _ in found(record(claim, shows))]
    assert ("screen_claim_unshown", 11) in found(record(claim, cand(12), shows))
    own_line = iv(12, "Let me put the first problem on your screen.", "core-1")           # the run's own line leaves no tool call in the record
    assert "screen_claim_unshown" not in [c for c, _ in found(record(claim, own_line))]


def test_the_screen_failed_claim_and_the_new_topic_while_coding_are_found_in_a_record():
    shown = iv(1, problem_intro(1), tool_calls=OK_SHOW)
    failed = iv(3, "I don't think the problem made it onto your screen properly. Let me put it up again.")
    assert ("screen_failed", 3) in found(record(shown, cand(2), failed))
    assert "screen_failed" not in [c for c, _ in found(record(shown, cand(2, "I can't see the problem."), failed))]
    started = cand(2, "Sure, writing the two-pointer version now.")
    drift = iv(3, "Take your time to write that out — while you do, let me ask something else.")
    assert ("new_topic_while_coding", 3) in found(record(shown, started, drift))


def test_a_second_transition_a_question_after_the_close_and_speech_after_the_problem_line_are_found():
    assert ("second_transition", 1) in found(record(iv(1, "Let's move to the next problem. Alright, let's get into the coding now.")))
    assert ("question_after_close", 1) in found(record(iv(1, "That wraps up the coding part. Can you tighten the space in your code a bit?")))
    assert ("after_problem_line", 1) in found(record(iv(1, "Here's your second question. Give it a read, and let me know if you have any questions. That was good.")))
    assert "second_transition" not in [c for c, _ in found(record(iv(1, "Well done on this one. Let me put the second problem on your screen.")))]


def test_time_spoken_finds_minutes_said_aloud():
    assert found(record(iv(1, "We'll spend about twenty-two minutes on problems."))) == [("time_spoken", 1)]
    assert "time_spoken" not in [c for c, _ in found(record(iv(1, "We're short on time, so I'll skip the React questions.")))]


def test_a_filler_after_the_candidate_announces_a_step_is_a_failure_too():
    traced = cand(2, "Let me trace it on minus one, zero, one, two.")
    assert found(record(iv(1, "Go ahead."), traced, iv(3, "Could you say a bit more about that?"))) == [("filler_after_start", 3)]
    assert found(record(iv(1, "Go ahead."), traced, iv(3, "Sure, go ahead."))) == []


def test_a_requirement_the_problem_does_not_state_is_found_when_the_record_has_its_blueprint():
    from tests.interviewer.fixtures import blueprint

    turn = iv(1, "Right. The problem asks for O of 1 extra space.")
    rec = record(turn)
    assert found(rec) == []                                          # no blueprint: nothing to compare with
    rec["blueprint"] = blueprint()
    assert ("requirement_invented", 1) in found(rec)


def test_a_hint_from_a_problem_the_candidate_was_never_shown_is_found():
    """b1 struggler_gives_up: the plan swapped problem 2 for a reserve that was never put up, and hinted from the reserve's ladder."""
    from tests.interviewer.fixtures import blueprint

    bp = blueprint()
    bp["slots"][2]["hint_ladder"] = [{"step": 1, "hint": "Think about starting with the outermost walls and seeing how the area changes."}]
    items = [slot("core-1", "done"), slot("core-2", "swapped"), slot("reserve-alternate")]
    shown = lambda seq, item: iv(seq, "Let me put the problem on your screen.", item, tool_calls=[{"name": "show_problem", "arguments": {}, "result": {"ok": True, "label": "P"}}])
    hint = iv(9, "Think about starting with the outermost walls and seeing how the area changes.", "reserve-alternate")
    rec = record(shown(1, "core-1"), shown(3, "core-1"), cand(5, item="reserve-alternate"), hint, items=items)
    rec["blueprint"] = bp
    assert ("hint_from_other_problem", 9) in found(rec)
    ok = record(shown(1, "core-1"), shown(3, "core-1"), shown(5, "reserve-alternate"), hint, items=items)
    ok["blueprint"] = bp
    assert "hint_from_other_problem" not in [c for c, _ in found(ok)]
    own = record(iv(1, "Let me put the first problem on your screen.", "core-1"), iv(3, "Let me put the second problem on your screen.", "core-1"),
                 iv(5, "Let me put the third problem on your screen.", "core-2"), hint, items=items)
    own["blueprint"] = bp
    assert "hint_from_other_problem" not in [c for c, _ in found(own)]      # the run's own put-up lines count as the problem going up


def test_reasoning_spoken_aloud_is_a_failure_and_the_two_b4_turns_are_found():
    assert found(record(iv(1, "His areas after the first move are wrong. Let me check: l=0,r=8: min=1, width=8, area=8."))) == [("reasoning_aloud", 1)]
    assert found(record(iv(1, "At left one and right eight, the area is forty-nine \u2014 what happens next?"))) == []
    for name, seq in (("strong_fresher", 28), ("rh_intro_covers_projects", None)):
        path = Path("/private/tmp/claude-501/-Users-salescode-Desktop-project-interviewiq/6acd6004-ecd3-44d1-b862-1bf228efd57b/scratchpad/ops/b4") / f"{name}.json"
        if not path.exists():
            pytest.skip("the b4 rehearsal records are not on this machine")
        hits = [s for c, s in found(json.loads(path.read_text())) if c == "reasoning_aloud"]
        assert hits and (seq is None or seq in hits), name


def test_the_same_problems_put_up_or_intro_line_spoken_in_two_turns_is_found():
    """b5 unplanned_story seq 23-24: "Here's your second question" said in one turn and again in the next."""
    twice = record(iv(1, "Spot on. Here's your second question. Give it a read, and let me know if you have any questions."), cand(2),
                   iv(3, "Let me put the second problem on your screen. Here's your second question. Give it a read."))
    assert [(c, n) for c, n in found(twice) if c == "problem_line_twice"] == [("problem_line_twice", 3)]
    once = record(iv(1, "Here's your first question. Give it a read."), cand(2), iv(3, "Let me put the second problem on your screen."),
                  cand(4), iv(5, "Here's your second question. Give it a read."))
    assert "problem_line_twice" not in [c for c, _ in found(once)]


def test_the_designed_silence_after_they_say_they_are_starting_to_code_is_not_a_silent_reply():
    """b6a quiet_thinker seq 12-13: "Okay, let me start writing." and an empty interviewer turn is the start-coding silence."""
    assert found(record(iv(1, "Take your time."), cand(2, "Okay, let me start writing."), iv(3, ""))) == []
    assert found(record(iv(1, "Take your time."), cand(2, "So I would loop over the pairs now."), iv(3, ""))) == [("silent_reply", 3)]


def test_staying_with_or_sticking_to_a_topic_nobody_discussed_is_a_false_link():
    """b6a unplanned_story: "Staying with Java for a moment \u2014 why must equals and hashCode be overridden together?" with no Java discussed."""
    for line in ("Staying with Java for a moment \u2014 why must equals and hashCode be overridden together?", "Sticking with Java, why do equals and hashCode pair?",
                 "Sticking to Java: why do equals and hashCode pair?"):
        assert found(record(cand(1, "I built a small cache with Go."), iv(2, line))) == [("false_continuity", 2)], line
    assert found(record(cand(1, "I used Java for the cache."), iv(2, "Staying with Java for a moment \u2014 why must equals and hashCode pair?"))) == []


def test_a_different_problem_put_up_after_a_swap_is_not_the_same_problems_line_twice():
    """bae894ce seq 30-34: "Let me put the second problem on your screen." three times over two swaps; the swap line names no position."""
    swapped = record(iv(1, "Okay, since you'd like a change. Let me put the second problem on your screen."), cand(2, "Skip this one too."),
                     iv(3, "Sure, no problem. Let me put a different problem on your screen."), cand(4, "Skip this one too."),
                     iv(5, "Sure, no problem. Let me put a different problem on your screen."))
    assert "problem_line_twice" not in [c for c, _ in found(swapped)]
    repeated = record(iv(1, "Okay, since you'd like a change. Let me put the second problem on your screen."), cand(2),
                      iv(3, "Sure, let me give you a different one. Let me put the second problem on your screen."))
    assert [(c, n) for c, n in found(repeated) if c == "problem_line_twice"] == [("problem_line_twice", 3)]


def test_numbers_spoken_after_the_constraints_went_on_screen_are_found_on_that_problem_only():
    reveal = [{"name": "reveal", "arguments": {"kind": "constraints"}, "result": {"ok": True}}]
    rec = record(iv(1, "Let me pull those up for you.", tool_calls=reveal), cand(2), iv(3, "How would you start?"), cand(4),
                 iv(5, "The series can have up to thirty thousand days. So, in your own words, what is your plan?"), cand(6),
                 iv(7, "Here is the next one.", "core-2"), cand(8, item="core-2"), iv(9, "It can be up to ten thousand long.", "core-2"))
    assert [(c, n) for c, n in found(rec) if c == "limits_after_reveal"] == [("limits_after_reveal", 5)]
    spoken_with_the_reveal = record(iv(1, "Let me pull those up. They go up to 100000.", tool_calls=reveal))
    assert [(c, n) for c, n in found(spoken_with_the_reveal) if c == "limits_after_reveal"] == [("limits_after_reveal", 1)]


def test_three_interviewer_turns_in_a_row_that_each_ask_something_are_found():
    """bae894ce seq 24-26: the approach asked three times in 80 s while the candidate drew."""
    rec = record(iv(1, "How do you plan to approach this problem?"), iv(2, "Quick thing. Now, what is your plan for finding the best trades?"),
                 iv(3, "I'll give you the limits. In your own words, how would you go about it?"))
    assert [(c, n) for c, n in found(rec) if c == "question_pileup"] == [("question_pileup", 3)]
    answered = record(iv(1, "How do you plan to approach this problem?"), iv(2, "What is your plan for finding the best trades?"), cand(3),
                      iv(4, "And what is the cost of that?"))
    assert "question_pileup" not in [c for c, _ in found(answered)]
    plain_mention = record(iv(1, "How do you plan to approach this problem?"), iv(2, "I noticed you switched to another tab."),
                           iv(3, "Please stay on this screen for the rest of the round."))
    assert "question_pileup" not in [c for c, _ in found(plain_mention)]


def test_an_interviewer_turn_that_starts_with_the_whole_turn_before_it_is_found():
    """bae894ce seq 11-12: one reply stored as two; the second repeated the first and went on."""
    first = "Okay. We'll come back to that — let me first tell you how this round will run."
    rec = record(iv(1, first), iv(2, first + " There'll be some coding, then some questions about your projects. Shall we get started?"))
    assert [(c, n) for c, n in found(rec) if c == "reply_restated"] == [("reply_restated", 2)]
    assert "reply_restated" not in [c for c, _ in found(record(iv(1, first), cand(2), iv(3, "Great. " + first)))]
    assert "reply_restated" not in [c for c, _ in found(record(iv(1, "Okay."), iv(2, "Okay. Go on.")))]       # a short turn proves nothing


def test_a_bare_acknowledgement_after_the_turns_question_is_found():
    rec = record(iv(1, "I can see the board, a box marked Test box. What were you working through there? Okay."))
    assert [(c, n) for c, n in found(rec) if c == "ack_after_question"] == [("ack_after_question", 1)]
    assert "ack_after_question" not in [c for c, _ in found(record(iv(1, "Okay. What were you working through there?")))]


def _gave_change(seq, line="Sure, no problem. Let me put a different problem on your screen."):
    return iv(seq, line, orders=[{"kind": "open_item", "line": line}], tool_calls=[{"name": "show_problem", "arguments": {}, "result": {"ok": True}}])


def test_a_second_problem_change_given_in_one_round_is_found_at_the_turn_that_gave_it():
    one = record(cand(1, "Can we change it?"), _gave_change(2), cand(3, "Can we change this one too?"))
    assert "changes_over_cap" not in [c for c, _ in found(one)]
    legacy = iv(4, "Okay, since you'd like a change, let's leave this one there. Let me put the second problem on your screen.",
                orders=[{"kind": "move_on", "line": "Okay, since you'd like a change, let's leave this one there. Let me put the second problem on your screen."}],
                tool_calls=[{"name": "show_problem", "arguments": {}, "result": {"ok": True}}])
    two = record(cand(1, "Can we change it?"), legacy, cand(5, "Can we change this one too?"), _gave_change(6))
    assert ("changes_over_cap", 6) in found(two)
    shown_before = record(_gave_change(2), iv(4, "Sure, no problem. Let me put a different problem on your screen.", orders=[{"kind": "open_item", "line": "Sure, no problem."}],
                                                tool_calls=[{"name": "show_problem", "arguments": {}, "result": {"ok": True, "already": True}}]))
    assert "changes_over_cap" not in [c for c, _ in found(shown_before)]            # nothing new was put up: not a change


def test_a_warning_glued_to_other_words_is_found_but_a_warning_alone_or_first_in_an_answer_is_not():
    final = "This is your final warning: please stay on this screen. If you leave it again, I'll have to end the interview."
    glued = record(iv(15, "I noticed you switched to another tab. Please stay on this screen for the rest of the round."),
                   iv(16, final + " Alright, this one stays now, so let's work with it. Where would you begin?"))
    assert [(c, n) for c, n in found(glued) if c == "warning_glued"] == [("warning_glued", 16)]
    alone = record(iv(15, "I noticed you switched to another tab. Please stay on this screen for the rest of the round."), iv(16, final),
                   iv(17, "I'm going to end the interview here, because of repeated screen switching. Thank you for your time."))
    assert "warning_glued" not in [c for c, _ in found(alone)]
    answering = record(cand(1, "How long is the round?"), iv(2, "I noticed you switched to another tab. Please stay on this screen for the rest of the round. "
                                                              "It runs for about the time on your screen."))
    assert "warning_glued" not in [c for c, _ in found(answering)]
    backwards = record(cand(1, "How long is the round?"), iv(2, "It runs for about the time on your screen. I noticed you switched to another tab. "
                                                              "Please stay on this screen for the rest of the round."))
    assert ("warning_glued", 2) in found(backwards)
    twice = record(cand(1, "How long is the round?"), iv(2, "I noticed you switched to another tab. Please stay on this screen. It is a standard round. "
                                                         "Please stay on this screen for the rest of the round."))
    assert ("warning_glued", 2) in found(twice)


def test_a_move_announced_that_the_plan_never_made_is_found_by_refusal_or_by_staying_on_the_problem():
    refused = iv(20, "Alright, since you'd like a change, let's leave this one there too. Let me shift gears.", "core-2",
                 tool_calls=[{"name": "go_to", "arguments": {}, "result": {"ok": False, "error": "no code yet"}}])
    assert ("move_announced_not_made", 20) in found(record(cand(19, "Can we change it to", "core-2"), refused, cand(21, "Okay.", "core-2")))
    taken_back = iv(20, "Okay, let's leave this one there. Actually, let's stay with this problem.", "core-2",
                    tool_calls=[{"name": "go_to", "arguments": {}, "result": {"ok": False}}])
    assert "move_announced_not_made" not in [c for c, _ in found(record(cand(19, "x", "core-2"), taken_back, cand(21, "Okay.", "core-2")))]
    stayed = iv(20, "Looks like we're not getting much coding going today. Let me shift gears.", "core-2")
    assert ("move_announced_not_made", 20) in found(record(cand(19, "x", "core-2"), stayed, cand(21, "Okay.", "core-2")))
    moved = record(cand(19, "x", "core-2"), stayed, cand(21, "Okay.", "deep_dive"))
    assert "move_announced_not_made" not in [c for c, _ in found(moved)]                     # the plan did move
    fixed = iv(20, "Sure, no problem. Let me put a different problem on your screen.", "reserve-alternate",
               tool_calls=[{"name": "show_problem", "arguments": {}, "result": {"ok": True}}])
    assert "move_announced_not_made" not in [c for c, _ in found(record(cand(19, "x", "core-1"), fixed, cand(21, "Okay.", "reserve-alternate")))]


def test_ended_on_question_fires_when_the_round_completes_right_after_a_question_to_the_candidate():
    """bf82d318 turn 37: "...thank you for your time today. What questions do you have for me about the role or the team?" was the last turn."""
    rec = record(cand(8, "I don't know.", "deep_dive"),
                 iv(9, "No problem. That's everything I wanted to ask, so now it's your turn - thank you for your time today. "
                       "What questions do you have for me about the role or the team?", "candidate_questions"),
                 items=[phase("candidate_questions", "done", turns=0)])
    assert ("ended_on_question", 9) in found(rec)
    no_turn = record(cand(8, "ok", "deep_dive"), iv(9, "Thanks for your time today. Take care.", "wrap_up"), items=[phase("candidate_questions", "done", turns=0)])
    assert ("ended_on_question", 9) in found(no_turn)


def test_ended_on_question_is_quiet_for_a_normal_close_and_for_ends_the_interviewer_did_not_choose():
    closed = record(cand(8, "No questions, thanks.", "candidate_questions"), iv(9, "Thanks for your time today. Take care.", "wrap_up"),
                    items=[phase("candidate_questions", "done", turns=1)])
    assert not [f for f in found(closed) if f[0] == "ended_on_question"]
    pressed = {**record(iv(9, "What questions do you have for me?", "candidate_questions"), items=[phase("candidate_questions", "done", turns=0)]),
               "end_reason": "candidate_ended"}
    assert not [f for f in found(pressed) if f[0] == "ended_on_question"]


# ---------------------------------------------------------------- the outline's promises (decided 2026-10-18)

OUTLINE_JD = ("Here's how this round will run: a short chat about your background, then a coding problem, then some quick fundamentals on Java "
              "and databases, and at the end time for your questions.")


def _kept(record_, **extra):
    return {**record_, **extra}


def test_outline_unkept_fires_for_a_promised_area_never_asked_and_never_dropped():
    from tests.interviewer.fixtures import realism_blueprint

    rec = record(iv(1, "How does a Java HashMap work?", "deep_dive"), cand(2, "No idea.", "deep_dive"), iv(3, "Thanks for your time. Take care.", "wrap_up"))
    assert found(_kept(rec, promises={"fundamentals:Java": "covered", "fundamentals:databases": "open"})) == [("outline_unkept", 3)]
    # a promise the ledger calls dropped counts only when the interviewer really said so
    assert found(_kept(rec, promises={"fundamentals:Java": "covered", "fundamentals:databases": "dropped"})) == [("outline_unkept", 3)]
    noticed = record(iv(1, "How does a Java HashMap work?", "deep_dive"), cand(2, "No idea.", "deep_dive"),
                     iv(3, "We're short on time, so I'll skip the databases questions.", "deep_dive"), iv(4, "Take care.", "wrap_up"))
    assert found(_kept(noticed, promises={"fundamentals:Java": "covered", "fundamentals:databases": "dropped"})) == []
    assert found(_kept(rec, promises={"fundamentals:Java": "covered", "fundamentals:databases": "open"}, end_reason="candidate_ended")) == []
    # no ledger: the same states read from the turns against the blueprint's realism block
    bp = realism_blueprint(("fundamentals:Java", "fundamentals:databases"))
    items = [phase("deep_dive", "done"), phase("wrap_up", "done")]
    assert found(_kept(rec, blueprint=bp, items=items)) == [("outline_unkept", 3)]
    said = record(iv(1, "How does a Java HashMap work?", "deep_dive"), cand(2, "No idea.", "deep_dive"),
                  iv(3, "On databases now: what is the difference between WHERE and HAVING in SQL?", "deep_dive"), cand(4, "Not sure.", "deep_dive"),
                  iv(5, "Thanks for your time. Take care.", "wrap_up"))
    assert found(_kept(said, blueprint=bp, items=items)) == []
    short = record(iv(1, "How does a Java HashMap work?", "deep_dive"), cand(2, "No idea.", "deep_dive"),
                   iv(3, "We're short on time, so I'll skip the databases questions.", "deep_dive"), iv(4, "Take care.", "wrap_up"))
    assert found(_kept(short, blueprint=bp, items=items)) == []


def test_outline_mismatch_fires_when_the_spoken_outline_omits_a_promised_area_or_adds_one():
    from tests.interviewer.fixtures import realism_blueprint

    bp = realism_blueprint(("fundamentals:Java", "fundamentals:databases"))
    assert found(_kept(record(iv(1, OUTLINE_JD, "framing"), cand(2, "Sounds good.", "framing")), blueprint=bp, end_reason="candidate_ended")) == []
    omits = OUTLINE_JD.replace("Java and databases", "Java")
    assert found(_kept(record(iv(1, omits, "framing")), blueprint=bp, end_reason="candidate_ended")) == [("outline_mismatch", 1)]
    adds = OUTLINE_JD.replace("Java and databases", "Java, databases and React")
    assert found(_kept(record(iv(1, adds, "framing")), blueprint=bp, end_reason="candidate_ended")) == [("outline_mismatch", 1)]
    # the ledger's own keys are enough when the record has no blueprint
    assert found(_kept(record(iv(1, adds, "framing")), promises={"fundamentals:Java": "open", "fundamentals:databases": "open"}, end_reason="candidate_ended")) == [("outline_mismatch", 1)]


def test_the_outline_checks_are_skipped_for_a_record_with_neither_a_ledger_nor_a_realism_blueprint():
    from tests.interviewer.fixtures import deep_dive_blueprint

    rec = record(iv(1, OUTLINE_JD.replace("Java and databases", "React"), "framing"), iv(2, "Thanks for your time. Take care.", "wrap_up"))
    assert found(rec) == [] and found(_kept(rec, blueprint=deep_dive_blueprint())) == [] and found(_kept(rec, promises={})) == []


def test_outline_unkept_reads_coverage_only_from_deep_dive_turns_and_the_question_each_asks():
    from tests.interviewer.fixtures import realism_blueprint

    bp = realism_blueprint(("fundamentals:Java", "projects:Relay"))
    items = [phase("candidate_intro"), phase("deep_dive"), phase("wrap_up")]
    # naming Relay and Java in the introduction, and a language in a coding turn, asks about neither
    rec = record(iv(1, "I see you built Relay with SQLite and Java. What are you working on now?", "candidate_intro"), cand(2, item="candidate_intro"),
                 iv(3, "You can write it in Java if you like. How would you approach it?", "core-1"), cand(4),
                 iv(5, "Thanks for your time. Take care.", "wrap_up"), items=items)
    assert [f for f in found(_kept(rec, blueprint=bp)) if f[0] == "outline_unkept"] == [("outline_unkept", 5), ("outline_unkept", 5)]
    asked = record(iv(1, "How does a Java HashMap work?", "deep_dive"), cand(2, item="deep_dive"),
                   iv(3, "Tell me about the Relay project's schema.", "deep_dive"), cand(4, item="deep_dive"), iv(5, "Take care.", "wrap_up"), items=items)
    assert found(_kept(asked, blueprint=bp)) == []


def test_outline_mismatch_checks_the_turn_the_guard_checks_a_with_outline_turn_before_the_first_problem_and_not_a_later_description():
    from tests.interviewer.fixtures import realism_blueprint

    bp = realism_blueprint(("fundamentals:Java", "fundamentals:databases"))
    items = [phase("candidate_intro"), slot("core-1"), slot("core-2"), {**phase("deep_dive"), "phase": "deep_dive"}, phase("wrap_up")]
    said_before_coding = ("Before we start, here's how this round will go: one or two coding problems, then some time for your questions at the end. "
                          "Here's your first question.")
    # the with_outline turn (said on the intro's turn, as the move to the first problem is made) must hold the promises
    rec = _kept(record(iv(1, said_before_coding, "candidate_intro"), items=items), blueprint=bp, end_reason="candidate_ended")
    assert found(rec) == [("outline_mismatch", 1)]
    fine = _kept(record(iv(1, OUTLINE_JD, "candidate_intro"), items=items), blueprint=bp, end_reason="candidate_ended")
    assert found(fine) == []
    # a first description that comes only in the deep dive or the closing was never checked by the guard: not a mismatch
    late = _kept(record(iv(1, said_before_coding, "deep_dive"), items=items), blueprint=bp, end_reason="candidate_ended")
    assert found(late) == []


def test_the_trace_check_and_the_guard_pick_the_same_outline_turn_even_with_the_deep_dive_before_the_coding():
    from tests.interviewer.fixtures import realism_blueprint

    bp = realism_blueprint(("fundamentals:Java", "fundamentals:databases"))
    said = ("Before we start, here's how this round will go: one or two coding problems, then some time for your questions at the end. "
            "Here's your first question.")
    ahead = [{**phase("deep_dive"), "phase": "deep_dive"}, slot("core-1"), phase("wrap_up")]
    rec = _kept(record(iv(1, said, "deep_dive"), items=ahead), blueprint=bp, end_reason="candidate_ended")
    assert found(rec) == [("outline_mismatch", 1)]                       # the deep dive comes first here: that turn is before the coding
    later = [slot("core-1"), {**phase("deep_dive"), "phase": "deep_dive"}, phase("wrap_up")]
    assert found(_kept(record(iv(1, said, "deep_dive"), items=later), blueprint=bp, end_reason="candidate_ended")) == []


def _refusal(seq, text):
    return iv(seq, text, orders=[{"kind": "keep_problem", "line": None}])


def _coding_over(seq, line="That's fine."):
    return iv(seq, line, orders=[{"kind": "move_on", "line": LINES["coding_over"][0]}])


def test_the_change_flow_checks_find_a_second_change_a_change_without_a_refusal_and_a_coding_ended_without_one():
    ok = record(cand(1, "Can we change it?"), _refusal(2, "Stay with this one."), cand(3, "Please."), _gave_change(4))
    assert not {"changes_over_cap", "change_without_refusal", "change_flow_valid"} & {c for c, _ in found(ok)}
    second = record(_refusal(2, "Stay with this one."), _gave_change(4), _gave_change(6))
    assert {("changes_over_cap", 6), ("change_flow_valid", 6)} <= set(found(second)) and "change_without_refusal" not in [c for c, _ in found(second)]
    bare = record(cand(1, "Can we change it?"), _gave_change(2))
    assert {("change_without_refusal", 2), ("change_flow_valid", 2)} <= set(found(bare))
    ended_bare = record(_refusal(2, "Stay with this one."), _gave_change(4), _coding_over(6))             # a refusal in the round, none on this problem
    assert ("change_flow_valid", 6) in found(ended_bare)
    ended = record(_refusal(2, "Stay with this one."), _gave_change(4), _refusal(6, "Let's see what a first step could be."), _coding_over(8))
    assert "change_flow_valid" not in [c for c, _ in found(ended)]


def test_a_refusal_that_makes_a_point_an_earlier_refusal_made_is_found():
    twice = record(_refusal(2, "I'd like you to stay with this one. A partial solution is fine."), cand(3, "Please change it."),
                   _refusal(4, "Honestly, a partial solution is perfectly fine here."))
    assert ("repeated_refusal", 4) in found(twice) and "repeated_refusal" not in [c for c, s in found(twice) if s == 2]
    new = record(_refusal(2, "I'd like you to stay with this one. A partial solution is fine."), _refusal(4, "Tell me what your first instinct is."))
    assert "repeated_refusal" not in [c for c, _ in found(new)]


def test_change_flow_valid_finds_the_harder_reserve_as_a_replacement_and_a_problem_shown_after_the_coding_ended():
    shown = [{"name": "show_problem", "arguments": {}, "result": {"ok": True}}]
    swapped = [slot("core-1", "swapped", ended_by="asked_for_another"), {**slot("reserve-harder", "active"), "origin": "reserve"}]
    bad = record(_refusal(2, "Stay with this one."), _gave_change(4), items=swapped)
    assert ("change_flow_valid", 4) in found(bad)
    assert any("harder" in f["detail"] for f in check_record(bad) if f["check"] == "change_flow_valid")
    via_plan = record(_refusal(2, "Stay with this one."), _gave_change(4), items=[slot("core-1", "swapped"), slot("reserve-alternate", "active")])
    via_plan["plan_changes"] = [{"op": "swap_on_request", "target": "reserve-harder"}]
    assert ("change_flow_valid", 4) in found(via_plan)
    fine = record(_refusal(2, "Stay with this one."), _gave_change(4), items=[slot("core-1", "swapped"), slot("reserve-alternate", "active")])
    assert "change_flow_valid" not in [c for c, _ in found(fine)]
    # the director's own use_reserve (ended_by "use_reserve") may hand a harder reserve to a candidate who is flying: not the change flow's (final review I6)
    director = record(_refusal(2, "Stay with this one."), _gave_change(4),
                      items=[slot("core-1", "swapped", ended_by="use_reserve"), {**slot("reserve-harder", "active"), "origin": "reserve"}])
    assert "change_flow_valid" not in [c for c, _ in found(director)]
    after = record(_refusal(2, "Stay with this one."), _coding_over(4), iv(6, "Here's another one.", orders=[], tool_calls=shown))
    assert ("change_flow_valid", 6) in found(after) and ("change_flow_valid", 4) not in found(after)
    again = record(_refusal(2, "Stay with this one."), _coding_over(4), iv(6, "Tell me about your projects.", tool_calls=[{**shown[0], "result": {"ok": True, "already": True}}]))
    assert "change_flow_valid" not in [c for c, _ in found(again)]


def test_time_spoken_exempts_only_a_length_the_current_problem_states():
    from tests.interviewer.fixtures import blueprint

    bp = blueprint()
    bp["slots"][0]["follow_ups"] = ["What if cache entries expire after 10 minutes?"]
    rec = record(iv(1, "The cache entries expire after 10 minutes, so how would you refill one?"), cand(2, "I would use a queue, about five minutes of data."),
                 iv(3, "Keep the part about five minutes of data in mind."), iv(4, "We'll spend about twenty-two minutes on problems."),
                 iv(5, "Count the hits in the past 2 hours."), iv(6, "That leaves us twelve minutes."), iv(7, "In fifteen minutes we will switch to design."),
                 iv(8, "Five minutes to go."), iv(9, "What if cache entries expire after ten minutes?"))
    rec["blueprint"] = bp
    # only the problem's own "10 minutes" passes (turns 1 and 9); the candidate's words exempt nothing
    assert [x for x in found(rec) if x[0] == "time_spoken"] == [("time_spoken", n) for n in (3, 4, 5, 6, 7, 8)]
    rec2 = record(iv(1, "You have ten minutes left, and the cache entries expire after 10 minutes."))
    assert [x for x in found(rec2) if x[0] == "time_spoken"] == [("time_spoken", 1)]       # no blueprint: nothing is exempt


def test_double_ack_finds_two_bare_acknowledgements_in_a_turn_but_not_the_runs_own_fixed_line():
    two = record(iv(1, "Okay, cool. Hmm, okay. How did you pick that structure?"))
    assert ("double_ack", 1) in found(two)
    one = record(iv(2, "Okay. How did you pick that structure?"))
    assert "double_ack" not in [c for c, _ in found(one)]
    own = record(iv(3, "Mm-hmm. Okay. How did you pick that structure?", fixed=["Mm-hmm."]))
    assert "double_ack" not in [c for c, _ in found(own)]
