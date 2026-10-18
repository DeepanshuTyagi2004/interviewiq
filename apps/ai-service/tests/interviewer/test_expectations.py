"""Per-persona expectations: one synthetic record per id, one passing and one failing."""
from app.interviewer.tracecheck import check_expectations
from tests.interviewer.fixtures import REFERENCE, blueprint
from tests.interviewer.test_tracecheck import OUTLINE, cand, iv, phase, slot

START = 1_000_000.0


def at(rel, turn):
    return {**turn, "at": START + rel}


def rec(*turns, items=(), **extra):
    return {"shape_id": "classic", "turns": list(turns), "items": list(items), "flow_log": [], "briefs": [], "end_reason": "completed",
            "clock_start": START, **extra}


def verdict(record, expect):
    [r] = check_expectations(record, [expect])
    assert r["expect"] == expect and isinstance(r["ok"], bool) and r["detail"]
    return r["ok"]


def test_problem_reached_needs_a_problem_with_two_candidate_turns():
    assert verdict(rec(items=[slot("core-1", turns=2)]), "problem_reached")
    assert not verdict(rec(items=[slot("core-1", turns=1), slot("core-2", status="pending", turns=2)]), "problem_reached")


def test_ended_cleanly_needs_the_closing_part_or_the_candidates_end_and_one_farewell():
    bye = iv(9, "Thank you for your time today. Take care.", "wrap_up")
    assert verdict(rec(bye, items=[phase("wrap_up", "active")]), "ended_cleanly")
    assert not verdict(rec(bye, iv(10, "Thanks again, goodbye.", "wrap_up"), items=[phase("wrap_up", "active")]), "ended_cleanly")
    assert not verdict(rec(iv(1, "Tell me more."), items=[phase("candidate_intro", "active")]), "ended_cleanly")
    assert verdict(rec(iv(1, "Tell me more."), items=[slot("core-1")], end_reason="candidate_ended"), "ended_cleanly")


def test_ended_cleanly_allows_one_goodbye_back_but_not_a_canned_third():
    wrapped = [phase("wrap_up", "active")]
    back = [iv(9, "Thank you for your time today. Take care.", "wrap_up"), cand(10, "Thanks, bye!", "wrap_up"), iv(11, "You too, take care.", "wrap_up")]
    assert verdict(rec(*back, items=wrapped), "ended_cleanly")
    canned = iv(12, "Thank you for your time today, Asha. Take care, and goodbye.", "wrap_up")
    assert not verdict(rec(*back, canned, items=wrapped), "ended_cleanly")


def test_followed_or_kept_counts_a_followed_turn_or_a_kept_thread():
    assert verdict(rec(iv(1, "Why that?", followed=True)), "followed_or_kept")
    assert verdict({**rec(iv(1, "Why?")), "flow_log": [{"move": "defer_topic", "ok": True}]}, "followed_or_kept")
    assert not verdict(rec(iv(1, "Why?", followed=False)), "followed_or_kept")


def test_intro_not_reasked_fails_on_a_second_introduction_ask_or_a_second_outline():
    items = [phase("candidate_intro"), slot("core-1")]
    ok = rec(iv(1, OUTLINE, "framing"), cand(2, item="candidate_intro"), iv(3, "What was the hardest part?", "candidate_intro"), items=items)
    assert verdict(ok, "intro_not_reasked")
    again = rec(iv(1, "Could you start with a short introduction?", "candidate_intro"), cand(2, item="candidate_intro"),
                iv(3, "Could you tell me about yourself first?", "core-1"), items=[{**phase("candidate_intro"), "phase": "candidate_intro"}, {**slot("core-1"), "phase": "core"}])
    assert not verdict(again, "intro_not_reasked")
    assert not verdict(rec(iv(1, OUTLINE, "framing"), iv(2, OUTLINE, "framing"), items=items), "intro_not_reasked")


def test_hint_given_needs_an_ok_give_hint_call():
    assert verdict(rec(iv(1, "A hint.", tool_calls=[{"name": "give_hint", "arguments": {}, "result": {"ok": True}}])), "hint_given")
    assert not verdict(rec(iv(1, "A hint.", tool_calls=[{"name": "give_hint", "arguments": {}, "result": {"ok": False}}])), "hint_given")


def _change_given(seq, text="Sure, no problem. Let me put a different problem on your screen."):
    return iv(seq, text, orders=[{"kind": "open_item", "line": text}], tool_calls=[{"name": "show_problem", "arguments": {}, "result": {"ok": True}}])


def test_change_flow_valid_wants_the_hard_limits_kept_and_a_problem_let_go_of_never_left_hanging():
    moved = rec(items=[slot("core-1", "done", ended_by="gave up"), slot("core-2", "active")], change_requests={"core-1": 2}, gave_up_items=["core-1"])
    assert verdict(moved, "change_flow_valid")
    swapped = rec(items=[slot("core-1", "swapped"), slot("reserve-alternate", "active")], change_requests={"core-1": 2}, gave_up_items=["core-1"])
    assert verdict(swapped, "change_flow_valid")                                  # a reserve took its place
    closed = rec(items=[slot("core-1", "done"), slot("core-2", "done"), phase("candidate_questions", "active")], change_requests={"core-2": 2},
                 gave_up_items=["core-2"])
    assert verdict(closed, "change_flow_valid")
    assert not verdict(rec(items=[slot("core-1", "active"), slot("core-2", "pending")], change_requests={"core-1": 2}, gave_up_items=["core-1"]),
                       "change_flow_valid")                                        # let go of, and left hanging
    assert verdict(rec(items=[slot("core-1", "active")], change_requests={"core-1": 3}, gave_up_items=[]), "change_flow_valid")    # held every ask
    assert not verdict(rec(items=[slot("core-1", "active")]), "change_flow_valid")                                              # nobody asked
    twice = rec(_change_given(3), _change_given(5), items=[slot("core-1", "done"), slot("core-2", "done"), phase("candidate_questions", "active")],
                change_requests={"core-1": 2, "core-2": 2}, gave_up_items=["core-1", "core-2"])
    assert not verdict(twice, "change_flow_valid")                                # two changes in one round
    no_refusal = rec(_change_given(3), items=[slot("core-1", "done"), slot("core-2", "active")], change_requests={"core-1": 1}, gave_up_items=["core-1"])
    assert not verdict(no_refusal, "change_flow_valid")                           # a change with no refusal first


def _change_given(seq, text="Sure, no problem. Let me put a different problem on your screen."):
    return iv(seq, text, orders=[{"kind": "open_item", "line": text}], tool_calls=[{"name": "show_problem", "arguments": {}, "result": {"ok": True}}])


def test_no_answer_given_fails_on_solution_code_spoken_or_inserted():
    items = [{**slot("core-1"), "slot_id": "core-1"}]
    clean = rec(iv(1, "What happens to the indices if you sort first?"), items=items, blueprint=blueprint())
    assert verdict(clean, "no_answer_given")
    leak = rec(iv(1, REFERENCE.replace("\n", " ")), items=items, blueprint=blueprint())
    assert not verdict(leak, "no_answer_given")
    insert = rec(iv(1, "Here.", tool_calls=[{"name": "code_insert", "arguments": {}, "result": {"ok": True}}]), items=items, blueprint=blueprint())
    assert not verdict(insert, "no_answer_given")


def test_coding_silence_respected_allows_one_late_proactive_turn_in_a_long_silence():
    silence = {"silences": [{"start": 100.0, "wait_s": 150, "code": True}]}
    quiet = rec(at(90, iv(1, "Go ahead.")), at(100, cand(2)), at(250, iv(3, "I see you have a loop going. How is it?")), **silence)
    assert verdict(quiet, "coding_silence_respected")
    early = rec(at(90, iv(1, "Go ahead.")), at(130, iv(2, "Still there?")), at(250, cand(3)), **silence)
    assert not verdict(early, "coding_silence_respected")
    chatty = rec(at(180, iv(1, "How is it going?")), at(220, iv(2, "Any questions?")), **silence)
    assert not verdict(chatty, "coding_silence_respected")
    assert verdict(rec(at(130, iv(1, "Still there?")), silences=[{"start": 100.0, "wait_s": 30, "code": True}]), "coding_silence_respected")


def test_line_check_answered_needs_yes_im_here_unless_it_was_the_greeting():
    items = [phase("greeting"), slot("core-1")]
    good = rec(cand(1, "Can you hear me? The audio is breaking.", "core-1"), iv(2, "Yes, I'm here. I can hear you fine."), items=items)
    assert verdict(good, "line_check_answered")
    assert not verdict(rec(cand(1, "Can you hear me?", "core-1"), iv(2, "Go on with your approach."), items=items), "line_check_answered")
    assert verdict(rec(cand(1, "Can you hear me?", "greeting"), iv(2, "Loud and clear."), items=items), "line_check_answered")


def test_repeat_honoured_needs_the_previous_question_again():
    q = "How would you handle duplicate transactions across overlapping settlements?"
    good = rec(iv(1, q), cand(2, "Sorry, could you repeat the question?"), iv(3, "Of course. How would you handle duplicate transactions across settlements?"))
    assert verdict(good, "repeat_honoured")
    bad = rec(iv(1, q), cand(2, "Sorry, can you say that again?"), iv(3, "Let's move on to your project instead."))
    assert not verdict(bad, "repeat_honoured")


def test_selection_used_needs_the_selected_words_and_no_cannot_see():
    sel = {"selections": [{"at": 90.0, "text": "exactly one valid answer"}]}
    good = rec(at(100, cand(1, "What does this mean?")), at(110, iv(2, "There is exactly one valid answer for every input.")), **sel)
    assert verdict(good, "selection_used")
    blind = rec(at(100, cand(1, "What does this mean?")), at(110, iv(2, "I can't see what you selected, sorry, but exactly one valid answer.")), **sel)
    assert not verdict(blind, "selection_used")
    assert not verdict(rec(at(100, cand(1, "What does this mean?")), at(110, iv(2, "Think about the complexity.")), **sel), "selection_used")


def test_conduct_warned_needs_a_warning_order_or_a_flag_after_the_rude_remark():
    assert verdict(rec(iv(1, "That isn't appropriate.", orders=[{"kind": "conduct_warning", "text": "x"}])), "conduct_warned")
    assert verdict(rec(iv(1, "Please keep it professional.", tool_calls=[{"name": "flag_conduct", "arguments": {}, "result": {"ok": True}}])), "conduct_warned")
    assert not verdict(rec(iv(1, "Let's continue.")), "conduct_warned")


def test_an_unknown_expectation_fails_with_its_name():
    [r] = check_expectations(rec(), ["mystery"])
    assert r["ok"] is False and "mystery" in r["detail"]
