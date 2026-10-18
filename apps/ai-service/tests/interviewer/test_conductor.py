"""The conductor: walking the plan, time limits, silence, proctoring, conduct, briefs, checkpoints."""
import re
from app.interviewer.change_decision import fallback_action
from app.interviewer.lines import LINES, contains, matches
from app.interviewer.conductor import (AWAY_CAP_S, AWAY_LIMIT_SCREEN_S, AWAY_OVERSTAY_LINES, AWAY_RETURN_S, CONDUCT_WARNING_LINE, FINAL_WARNING_LINES,
                                       PROCTOR_END_LINE, VIOLATION_LINES, Conductor, is_violation_line)
from tests.interviewer.fixtures import Clock, _slot, blueprint


def make() -> tuple[Conductor, Clock]:
    clock = Clock()
    c = Conductor(blueprint(), 3600, clock=clock, skills=["Java", "SQL"])
    c.start()
    return c, clock


def to_core(c: Conductor) -> None:
    c.next_item("done")
    c.next_item("done")
    assert c.current().item_id == "core-1"


def test_walks_the_plan_and_ends_quietly_after_wrap_up():
    c, _ = make()
    seen = [c.current().item_id]
    while (nxt := c.next_item("done")) is not None:
        seen.append(nxt.item_id)
    assert seen == ["greeting", "candidate_intro", "core-1", "core-2", "candidate_questions", "wrap_up"]
    assert c.ended and c.end_reason == "completed" and c.end_order.speak is False


def test_converges_then_moves_on_waiting_for_a_pause_up_to_the_grace():
    """Timings are guidance (2026-10-17): the clock only tells the director; the plan moves on by itself only long after."""
    c, clock = make()
    to_core(c)
    c.set_candidate_speaking(True)  # an engaged candidate: no silence nudges muddy the time orders
    clock.advance(960)
    assert c.tick() == []                                     # 80%: the director is told, nothing is said
    clock.advance(240)
    assert c.tick() == []                                     # time up: still the director's call
    clock.advance(299)
    assert c.tick() == []
    clock.advance(1)
    assert [o.kind for o in c.tick()] == ["move_on"]          # the fallback, 5 min after a 20 min problem's time
    assert c.tick() == []


def test_moves_on_at_once_when_the_candidate_is_quiet():
    c, clock = make()
    to_core(c)
    c.on_code_change()
    clock.advance(1500)                                       # time up plus the fallback: quiet or not, the director had its say
    assert "move_on" in [o.kind for o in c.tick()]


def test_silence_nudges_after_20s_talking_and_2min_coding():
    c, clock = make()
    clock.advance(21)
    assert [o.kind for o in c.tick()] == ["nudge"]
    to_core(c)
    clock.advance(100)
    assert c.tick() == []
    clock.advance(21)
    assert [o.kind for o in c.tick()] == ["nudge"]


def test_proctor_rule_mentions_warns_then_ends_and_half_weights_never_end():
    c, clock = make()
    assert c.on_proctor("fullscreen_exit", 0.5, 1).kind == "mention_violation"
    clock.advance(61)                                    # events closer than a minute are one action and one mention
    assert c.on_proctor("tab_hidden", 1, 2).kind == "mention_violation"
    clock.advance(61)
    assert c.on_proctor("share_stopped", 0.5, 3).kind == "mention_violation"
    assert c.on_proctor("window_blur", 1, 4).kind == "final_warning"
    order = c.on_proctor("tab_hidden", 1, 5)
    assert order.kind == "end" and order.end_reason == "ended_by_interviewer" and c.ended


def test_conduct_warns_then_ends_and_counts_one_incident_per_remark():
    c, _ = make()
    c.on_candidate_turn()
    assert c.on_conduct("inappropriate", "Weird lady asking me too many questions", "t1", "talker").kind == "conduct_warning"
    assert c.on_conduct("inappropriate", "…", "t1", "director") is None               # the same interviewer turn
    # The talker flags the same remark again on the next turns (it is still answering it): the candidate has not spoken since,
    # so it is the same incident, not a second one that ends the round.
    assert c.on_conduct("inappropriate", "Weird lady asking me too many questions.", "t2", "talker") is None
    assert c.on_conduct("inappropriate", "Weird lady asking me too many questions.", "t3", "talker") is None
    assert len(c.conduct) == 1 and not c.ended
    c.on_candidate_turn()
    end = c.on_conduct("abusive", "Something worse.", "t4", "talker")
    assert end.kind == "end" and "unacceptable conduct" in end.line and len(c.conduct) == 2


def test_a_hold_keeps_the_check_in_and_the_opening_of_the_next_part_back_until_they_speak_again():
    c, clock = make()
    order = c.hold()
    assert order.kind == "hold" and c.held()
    c.next_item("done")                                  # the talker moved on anyway: the order to open the next part waits
    assert [o.kind for o in c.speakable_orders()] == ["hold"]
    clock.advance(30)
    assert c.tick() == []                                # no silence check-in during their moment
    c.on_candidate_turn(keeps_hold=True)                 # "Hello?" only checks the line
    assert c.held()
    c.on_candidate_turn()                                # they are back: "take your time" was never said, and is moot now
    assert not c.held() and [o.kind for o in c.speakable_orders()] == ["open_item"]


def test_a_hold_runs_out_on_its_own_and_the_check_in_follows():
    c, clock = make()
    c.next_item("done")                                  # the introduction: two minutes, so no timer order fires meanwhile
    c.hold()
    clock.advance(76)
    assert not c.held() and [o.kind for o in c.tick()] == ["nudge"]
    restored = Conductor.restore(blueprint(), 3600, c.checkpoint(), None, clock, ["Java"])
    assert restored.candidate_turns == c.candidate_turns and restored.hold_until == c.hold_until


def test_three_redirects_in_one_item_make_an_incident():
    c, _ = make()
    assert c.on_redirect("t1") is None and c.on_redirect("t2") is None
    assert c.on_redirect("t3").kind == "conduct_warning"


def test_a_stale_brief_is_dropped_and_a_fresh_one_changes_the_plan_within_the_rules():
    c, _ = make()
    to_core(c)
    stale = c.apply_brief({"for_position": c.position - 1, "plan_changes": [{"op": "skip", "target": "core-2"}]})
    assert stale["stale"] and c.items[3].status == "pending"
    fresh = c.apply_brief({"for_position": c.position, "plan_changes": [
        {"op": "skip", "target": "wrap_up"},
        {"op": "insert_filler", "question": "How does HashMap handle collisions?", "skill": "Java"},
        {"op": "insert_filler", "question": "Tell me about Kubernetes.", "skill": "Kubernetes"},
        {"op": "add_follow_up", "text": "What if the input streams in?"},
    ]})
    assert [d["op"] for d in fresh["dropped"]] == ["skip", "insert_filler"]
    assert c.items[c.items.index(c.current()) + 1].kind == "filler"
    assert c.follow_ups["core-1"] == ["What if the input streams in?"]


def test_use_reserve_swaps_the_current_problem():
    c, _ = make()
    to_core(c)
    before = c.position
    out = c.apply_brief({"for_position": before, "plan_changes": [{"op": "use_reserve", "target": "reserve-alternate"}]})
    assert out["applied"] and c.current().item_id == "reserve-alternate"
    assert next(i for i in c.items if i.item_id == "core-1").status == "swapped"
    assert c.position == before + 1


def test_the_round_ceiling_forces_the_wrap_up():
    c, clock = make()
    to_core(c)
    clock.advance(1.5 * 3600)
    assert [o.kind for o in c.tick()] == ["wrap_up_now"]
    assert c.current().item_id == "wrap_up"


def test_labels_are_generic_and_stable():
    c, _ = make()
    assert c.label_for("core-2") == "Problem 1"
    assert c.label_for("core-1") == "Problem 2"
    assert c.label_for("core-2") == "Problem 1"


def test_checkpoint_round_trip():
    c, clock = make()
    to_core(c)
    c.on_proctor("tab_hidden", 1, 1)
    c.record_hint(2)
    restored = Conductor.restore(blueprint(), 3600, c.checkpoint(), clock=clock)
    assert restored.current().item_id == "core-1" and restored.current().hint_step == 2
    assert restored.full_violations == 1 and restored.position == c.position


def test_live_summary_counts_come_from_the_conductors_own_ledger():
    c, _ = make()
    c.on_proctor("tab_hidden", 1, 1)
    c.on_proctor("fullscreen_exit", 0.5, 2)
    c.on_proctor("share_stopped", 0.5, 3)
    c.on_proctor("window_blur", 1, 4)
    summary = c.live_summary()
    assert summary["tab_changes"] == 1 and summary["screen_changes_weighted"] == 2.0 and summary["full_violations"] == 2


def test_no_silence_nudge_while_the_interviewer_owes_the_candidate_a_reply():
    c, clock = make()
    c.reply_owed = True            # the candidate spoke and the answer has not come: the quiet is the interviewer's
    clock.advance(30)
    assert [o.kind for o in c.tick() if o.kind == "nudge"] == []
    c.reply_owed = False
    assert [o.kind for o in c.tick() if o.kind == "nudge"] == ["nudge"]


def test_a_move_on_order_first_acknowledges_what_the_candidate_just_said():
    c, clock = make()
    clock.advance(181)             # the greeting's minute is up, plus the 2 min fallback
    order = next(o for o in c.tick() if o.kind == "move_on")
    assert "acknowledge" in order.text.lower() and "next_item" in order.text


def _on(c, item_id):
    while c.current().item_id != item_id:
        c.next_item("test")


def test_the_background_conversation_needs_enough_exchanges_in_total_before_the_problem_whatever_the_item_labels_say():
    c, clock = make()
    c.set_candidate_speaking(True)           # an engaged candidate: no silence nudges
    _on(c, "candidate_intro")
    ok, why = c.can_advance()
    assert not ok and "before the coding" in why and "5" in why
    for _ in range(4):
        c.on_candidate_turn()
    assert c.can_advance()[0] is False
    c.on_candidate_turn()
    assert c.can_advance() == (True, "")
    # the same total counts when the talker was slow to call next_item and the exchanges landed on earlier phases
    c2, _ = make()
    c2.set_candidate_speaking(True)
    c2.current().turns = 1                   # the greeting and small talk
    c2.next_item("t")
    c2.current().turns = 4                   # then the intro (the talker never moved through framing)
    assert c2.can_advance() == (True, "")
    c3, clock3 = make()
    c3.set_candidate_speaking(True)
    _on(c3, "candidate_intro")
    clock3.advance(121)                       # the phase's two minutes are up: the plan comes first
    assert c3.can_advance()[0] is True


def test_a_problem_can_be_left_by_the_talker_but_the_closing_phases_follow_their_own_rules():
    c, _ = make()
    to_core(c)
    assert c.can_advance()[0] is True
    _on(c, "candidate_questions")
    assert c.can_advance()[0] is False        # no question asked yet
    c.on_candidate_turn()
    assert c.can_advance()[0] is True
    c.next_item("done")
    assert c.current().item_id == "wrap_up" and c.can_advance()[0] is True   # the closing turn itself ends the round


def test_close_out_finishes_the_plan_through_wrap_up_and_ends_the_round_quietly():
    c, _ = make()
    _on(c, "candidate_questions")
    c.close_out()
    assert c.ended and c.end_reason == "completed" and c.end_order.speak is False
    done = [i.item_id for i in c.items if i.status == "done"]
    assert "candidate_questions" in done and "wrap_up" in done


def test_non_urgent_orders_wait_until_the_interviewer_has_been_quiet_for_a_moment():
    c, clock = make()
    to_core(c)
    c.consume(c.pending_orders())             # the order to open the problem has been satisfied
    c.set_candidate_speaking(True)
    clock.advance(1)
    c.set_agent_speaking(True)
    c.set_agent_speaking(False)               # the interviewer has just finished speaking
    assert c.quiet_for_s() < 1
    clock.advance(12)
    assert c.quiet_for_s() >= 12
    assert c.urgent_pending() is False
    c.on_proctor("tab_hidden", 1, 1)
    assert c.urgent_pending() is True


def one_problem_plan():
    """A plan with a single problem (a round type that plans one): the only case where a reserve problem is added."""
    c, clock = make()
    c.items = [i for i in c.items if i.item_id != "core-2"]
    return c, clock


def test_when_the_only_planned_problem_ends_early_with_time_to_spare_a_reserve_problem_follows_sized_to_the_slack():
    c, clock = one_problem_plan()
    to_core(c)
    assert c.current().item_id == "core-1"
    clock.advance(300)                                # solved in five minutes of its twenty
    assert c.would_extend() is True
    item = c.plan_extra_problem()
    assert item is not None and item.item_id == "reserve-alternate" and item.kind == "slot"
    assert c.items[c.index + 1] is item and 180 <= item.max_seconds <= 1200
    assert c.plan_extra_problem() is None             # one extra problem, and no reserve is left anyway


def test_no_extra_problem_when_another_is_still_planned_or_when_there_is_no_slack():
    c, clock = make()
    to_core(c)
    clock.advance(300)
    assert c.would_extend() is False                  # core-2 is still ahead
    c.next_item("t")
    clock.advance(2900)                               # the round is nearly over
    assert c.would_extend() is False and c.plan_extra_problem() is None
    c2, clock2 = make()
    to_core(c2)
    c2.next_item("t")                                 # both planned problems have been given: the standard is two, never a third
    clock2.advance(200)
    assert c2.would_extend() is False and c2.plan_extra_problem() is None


def test_a_quick_solve_gets_the_harder_reserve_a_slow_one_the_alternate():
    c, clock = one_problem_plan()
    c.reserves["reserve-harder"] = {"slot_id": "reserve-harder", "timebox_mins": 15}
    to_core(c)
    clock.advance(200)                                # well inside 60% of the box
    assert c.plan_extra_problem().item_id == "reserve-harder"


def test_entering_a_part_orders_the_interviewer_to_open_it_so_a_bare_transition_is_never_left_hanging():
    c, _ = make()
    assert not [o for o in c.orders if o.kind == "open_item"]            # the greeting needs no such order
    c.next_item("t")                                                     # candidate_intro
    intro = [o for o in c.pending_orders() if o.kind == "open_item"]
    assert intro and "introduction" in intro[-1].text
    c.next_item("t")                                                     # core-1: a problem
    problem = [o for o in c.pending_orders() if o.kind == "open_item"][-1]
    assert "show_problem" in problem.text and "on their screen" in problem.text
    assert "open_item" in __import__("app.interviewer.conductor", fromlist=["URGENT_ORDERS"]).URGENT_ORDERS


def test_the_harder_reserve_is_only_for_a_candidate_who_solved_quickly_with_plenty_of_round_left():
    for round_s, expected in ((980, "reserve-alternate"), (1400, "reserve-harder")):    # 8 minutes of slack, then 15
        c, clock = one_problem_plan()
        c.round_seconds = round_s
        c.reserves["reserve-harder"] = {"slot_id": "reserve-harder", "timebox_mins": 15}
        to_core(c)
        clock.advance(200)                                                                # solved quickly
        assert c.plan_extra_problem().item_id == expected


def test_a_problem_may_be_shown_once_the_background_conversation_is_done_or_its_time_is_up_and_never_before():
    c, clock = make()
    c.set_candidate_speaking(True)
    assert c.problem_allowed() is False                  # the greeting
    _on(c, "candidate_intro")
    c.current().turns = 2
    assert c.problem_allowed() is False
    c.current().turns = 5
    assert c.problem_allowed() is True                   # five exchanges across the conversation
    c2, clock2 = make()
    c2.set_candidate_speaking(True)
    _on(c2, "framing") if any(i.item_id == "framing" for i in c2.items) else _on(c2, "candidate_intro")
    clock2.advance(200)                                  # the phase's time is up
    assert c2.problem_allowed() is True
    c3, _ = make()
    _on(c3, "candidate_questions")
    assert c3.problem_allowed() is False                 # after the problems: nothing to show
    c4, _ = make()
    to_core(c4)
    assert c4.problem_allowed() is True


def test_the_director_cannot_swap_out_the_problem_the_candidate_is_already_working_on():
    c, clock = make()
    to_core(c)
    c.on_candidate_turn(); c.on_candidate_turn()        # they have been working on it for a while
    clock.advance(200)
    out = c.apply_brief({"for_position": c.position, "plan_changes": [{"op": "use_reserve", "target": "reserve-alternate"}]})
    assert out["applied"] == [] and "already working" in out["dropped"][0]["why"]
    assert c.current().item_id == "core-1"
    c2, _ = make()
    to_core(c2)                                         # just arrived: nothing has happened on it yet
    out2 = c2.apply_brief({"for_position": c2.position, "plan_changes": [{"op": "use_reserve", "target": "reserve-alternate"}]})
    assert out2["applied"] and c2.current().item_id == "reserve-alternate"


def test_the_director_cannot_skip_the_deep_dive():
    c, _ = make()
    c.apply_brief({"for_position": c.position, "plan_changes": []})
    c.items.insert(4, __import__("app.interviewer.plan", fromlist=["Item"]).Item("deep_dive", "phase", "deep_dive", 600))
    out = c.apply_brief({"for_position": c.position, "plan_changes": [{"op": "skip", "target": "deep_dive"}]})
    assert out["applied"] == [] and next(i for i in c.items if i.item_id == "deep_dive").status == "pending"


def _on_problem(c, n=1):
    while c.current().item_id != f"core-{n}":
        c.current().turns = 5
        c.next_item("t")


def test_performance_on_a_problem_is_strong_unless_the_director_says_struggling_hints_pile_up_or_time_ran_out():
    c, clock = make()
    _on_problem(c)
    item = c.current()
    assert c.performance(item) == "strong"
    c.signals["core-1"] = "struggling"
    assert c.performance(item) == "struggled"
    c.signals["core-1"] = "strong"
    item.hint_step = 2
    assert c.performance(item) == "struggled"            # two hints from the ladder is a candidate who needed help
    item.hint_step = 0
    clock.advance(item.max_seconds + 5)
    assert c.performance(item) == "strong"               # time ran out, but the director says strong: it keeps its word
    c.signals.pop("core-1")
    assert c.performance(item) == "struggled"            # time ran out and nothing says otherwise


def test_a_candidate_who_struggled_on_the_first_problem_does_not_get_the_second_and_the_round_goes_on_to_the_end():
    c, clock = make()
    _on_problem(c)
    c.signals["core-1"] = "struggling"
    assert c.will_skip_next_problem() is True
    c.next_item("t")
    second = next(i for i in c.items if i.item_id == "core-2")
    assert second.status == "skipped" and c.no_more_problems
    assert c.current().item_id == "candidate_questions"      # (this plan has no deep dive)
    assert c.would_extend() is False and c.plan_extra_problem() is None


def test_a_strong_candidate_gets_the_second_problem_sized_to_the_time_that_is_left():
    c, clock = make()
    _on_problem(c)
    clock.advance(600)
    c.signals["core-1"] = "strong"
    assert c.will_skip_next_problem() is False
    c.next_item("t")
    assert c.current().item_id == "core-2" and not c.no_more_problems
    assert 180 <= c.current().max_seconds <= 1200


def test_no_second_problem_when_there_is_not_enough_round_left_for_one():
    c, clock = make()
    _on_problem(c)
    clock.advance(3250)                                       # 3600 s round, 300 s still planned for the questions and the wrap-up
    c.signals["core-1"] = "strong"
    assert c.will_skip_next_problem() is True
    c.next_item("t")
    assert c.current().item_id == "candidate_questions" and c.no_more_problems


def test_the_directors_problem_signal_is_recorded_for_the_current_problem_only_when_the_brief_is_fresh():
    c, _ = make()
    _on_problem(c)
    c.apply_brief({"for_position": c.position - 1, "problem_signal": "struggling"})
    assert "core-1" not in c.signals                          # stale
    c.apply_brief({"for_position": c.position, "problem_signal": "struggling"})
    assert c.signals["core-1"] == "struggling"
    c.apply_brief({"for_position": c.position, "problem_signal": "unknown"})
    assert c.signals["core-1"] == "struggling"                # "unknown" never overwrites a judgement
    c.apply_brief({"for_position": c.position, "problem_signal": "adequate"})
    assert c.signals["core-1"] == "adequate" and c.performance(c.current()) == "strong"


def test_a_follow_up_order_after_a_held_back_problem_says_the_problem_is_not_next():
    c, _ = make()
    plain = c.ask_follow_up()
    held = c.ask_follow_up(held_back_problem=True)
    assert "not next yet" not in plain.text
    assert "not next yet" in held.text and "do not mention" in held.text


def test_entering_the_framing_after_the_outline_was_already_given_does_not_order_it_again():
    from app.interviewer.conductor import Conductor

    from app.interviewer.conductor import Item

    def order_after_entering_framing(outline_said: bool) -> str:
        c, _ = make()
        c.items.insert(c.index + 1, Item("framing", "phase", "framing", 120))
        c.outline_said = outline_said
        c.current().turns = 5
        c.next_item("t")
        assert c.current().item_id == "framing"
        return next(o for o in c.pending_orders() if o.kind == "open_item").text

    said = order_after_entering_framing(True)
    assert "already" in said and "do not repeat it" in said and "from the outline" not in said
    assert "from the outline" in order_after_entering_framing(False)


def test_a_phases_time_being_up_does_not_allow_a_problem_while_another_part_of_the_conversation_is_still_ahead():
    from app.interviewer.conductor import Item

    c, clock = make()
    c.items.insert(c.index + 1, Item("framing", "phase", "framing", 60))          # framing, then candidate_intro, then the problems
    c.current().turns = 1
    c.next_item("t")
    assert c.current().item_id == "framing"
    clock.advance(90)                                                             # the framing's own minute is up...
    assert c.problem_allowed() is False                                           # ...but the introduction still has to happen
    c.current().turns = 1
    c.next_item("t")
    assert c.current().item_id == "candidate_intro"
    clock.advance(500)
    assert c.problem_allowed() is True                                            # the last conversation part, out of time: the problem is next


def test_moving_to_a_new_part_orders_a_connecting_phrase_before_its_first_question():
    c, _ = make()
    c.next_item("t")                                                     # candidate_intro
    intro = [o for o in c.pending_orders() if o.kind == "open_item"][-1].text
    assert "connecting phrase" in intro and "But before the coding, let's start with you." in intro
    c.next_item("t")                                                     # core-1
    problem = [o for o in c.pending_orders() if o.kind == "open_item"][-1].text
    assert "connecting phrase" in problem and "Alright, let's get into the coding now." in problem
    assert "Here's your first question. Give it a read, and let me know if you have any questions." in problem
    assert "think aloud" not in problem


def test_the_second_problem_is_introduced_as_the_second_question():
    c, _ = make()
    to_core(c)
    c.next_item("t")
    assert "Here's your second question." in [o for o in c.pending_orders() if o.kind == "open_item"][-1].text


def test_the_time_up_orders_ask_for_a_connecting_phrase_into_the_next_part():
    c, clock = make()
    to_core(c)
    c.set_candidate_speaking(True)
    clock.advance(1500)
    assert "connecting phrase" in next(o for o in c.tick() if o.kind == "move_on").text


def ask(c):
    """A request for another problem answered by the persona's prior: for a blueprint without a realism block, today's rule (first ask resisted)."""
    allowed = c.on_change_request()
    if allowed is None:
        return None
    _, prior = c.change_stance()
    return c.apply_change_action(fallback_action(prior, c.refusals.get(c.current().item_id, 0), allowed))


def _worked_on_core_1(c, clock, seconds=600, turns=6):
    to_core(c)
    c.current().turns = turns
    clock.advance(seconds)


def test_the_first_ask_for_a_different_problem_is_resisted_whatever_the_progress():
    """(decided 2026-10-18) Every first ask on a problem gets the keep_problem order, even from a candidate who has barely started."""
    c, clock = make()
    _worked_on_core_1(c, clock)
    order = ask(c)
    assert order.kind == "keep_problem" and "you are keeping this one" in order.text and "no question" in order.text
    assert c.current().item_id == "core-1" and c.change_requests == {"core-1": 1} and not c.change_given
    d, dclock = make()
    to_core(d)
    d.current().turns = 1
    dclock.advance(30)
    assert ask(d).kind == "keep_problem" and d.current().item_id == "core-1"      # no swap on the first ask


def test_the_second_ask_with_no_planned_problem_left_swaps_in_a_non_harder_reserve_which_is_still_their_position():
    c, clock = make()
    _worked_on_core_1(c, clock)
    c.labels["core-1"] = "Problem 1"
    next(i for i in c.items if i.item_id == "core-2").status = "skipped"      # no planned problem is left
    assert ask(c).kind == "keep_problem"
    order = ask(c)
    assert c.current().item_id == "reserve-alternate" and next(i for i in c.items if i.item_id == "core-1").status == "swapped"
    assert order.kind == "open_item" and matches("swap_put_up", order.line)
    assert c.labels["reserve-alternate"] == "Problem 1" and c.change_given and c.signals["core-1"] == "struggling"


def test_asking_again_with_time_left_ends_the_problem_kindly_and_gives_the_next_one():
    c, clock = make()
    _worked_on_core_1(c, clock)
    ask(c)
    order = ask(c)
    assert order.kind == "move_on" and "Do not argue" in order.text and "another problem" in order.text
    assert any(v in order.text for v in LINES["put_up:second"]) and "coding part is done" in order.text   # "do not say ..."
    assert contains("give_up", order.line) and any(order.line.endswith(v) for v in LINES["put_up:second"])
    assert c.signals["core-1"] == "struggling" and c.will_skip_next_problem() is False and c.next_problem_after_give_up() is False
    assert c.change_given and not c.no_more_problems
    c.next_item("move_on")
    assert next(i for i in c.items if i.item_id == "core-1").status == "done" and c.current().item_id == "core-2"


def test_asking_again_with_no_time_for_another_problem_ends_the_coding_and_links_to_the_next_part():
    c, clock = make()
    _worked_on_core_1(c, clock, seconds=3000)
    ask(c)
    order = ask(c)
    assert order.kind == "move_on" and matches("coding_over", order.line)
    assert "connecting phrase" in order.text and "do not give another problem" in order.text and not c.change_given
    assert c.no_more_problems and c.signals["core-1"] == "struggling"
    c.next_item("move_on")
    assert next(i for i in c.items if i.item_id == "core-2").status == "skipped" and c.current().kind != "slot"


def _changed_once(c, clock):
    """The round's one change given: two asks on problem 1, and now on problem 2."""
    _worked_on_core_1(c, clock)
    ask(c)
    ask(c)
    c.next_item("move_on")
    assert c.current().item_id == "core-2" and c.change_given
    c.current().turns = 0
    clock.advance(10)


def test_after_the_one_change_the_first_ask_is_resisted_again_and_the_second_ends_the_coding():
    """resist -> change -> resist -> the coding ends."""
    c, clock = make()
    _changed_once(c, clock)
    first = ask(c)
    assert first.kind == "keep_problem" and c.current().item_id == "core-2" and c.change_requests == {"core-1": 2, "core-2": 1}
    second = ask(c)
    assert second.kind == "move_on" and matches("coding_over", second.line)
    assert c.no_more_problems and c.signals["core-2"] == "struggling" and c.plan_changes[-1]["op"] == "coding_over_on_request"
    c.next_item("move_on")
    assert c.current().kind != "slot" and c.current().item_id == "candidate_questions"      # (this plan has no deep dive)


def test_a_second_ask_with_no_replacement_at_all_ends_the_coding():
    bp = blueprint()
    bp["slots"] = [x for x in bp["slots"] if x["slot_id"] == "core-1"]
    clock = Clock()
    c = Conductor(bp, 3600, clock=clock, skills=["Java"])
    c.start()
    _worked_on_core_1(c, clock)
    assert ask(c).kind == "keep_problem"
    order = ask(c)
    assert order.kind == "move_on" and matches("coding_over", order.line) and c.no_more_problems and not c.change_given


def test_never_more_than_one_change_in_a_round_whatever_is_left_to_give():
    c, clock = make()
    _changed_once(c, clock)
    assert c.reserves and "reserve-alternate" in c.reserves                       # a reserve is still held, and the time is there
    ask(c)
    order = ask(c)
    assert matches("coding_over", order.line) and "reserve-alternate" in c.reserves


def test_after_the_coding_is_over_no_path_brings_a_problem_back():
    c, clock = make()
    _changed_once(c, clock)
    ask(c)
    ask(c)
    c.signals["core-2"] = "strong"
    assert c.would_extend() is False and c.plan_extra_problem() is None            # the quick-solve extra problem is shut
    ok, why = c._apply_change({"op": "use_reserve", "target": "reserve-alternate", "replace": c.current().item_id})
    assert ok is False and "coding part is over" in why
    assert ask(c) is None                                           # a further ask changes nothing
    c.next_item("move_on")
    assert c.problem_allowed() is False and all(i.status != "pending" for i in c.items if i.kind == "slot")
    assert c.go_to("reserve-alternate", "back")[0] is False and c.plan_extra_problem() is None


def test_a_hint_request_orders_the_next_ladder_step():
    c, _ = make()
    to_core(c)
    order = c.on_hint_request()
    assert order.kind == "hint_request" and "give_hint with step 1" in order.text
    c.record_hint(1)
    assert "step 2" in c.on_hint_request().text


def test_a_request_to_write_in_their_editor_is_declined_in_one_sentence_with_no_follow_up():
    c, _ = make()
    order = c.on_edit_request()
    assert order.kind == "decline_request" and "Decline in one short sentence" in order.text and "do not ask a question" in order.text


def test_the_count_of_change_requests_and_the_change_given_survive_a_restart():
    c, clock = make()
    _worked_on_core_1(c, clock)
    ask(c)
    restored = Conductor.restore(blueprint(), 3600, c.checkpoint(), None, clock, ["Java"])
    assert restored.change_requests == {"core-1": 1} and restored.change_given is False
    assert ask(restored).kind == "move_on" and restored.change_given
    assert Conductor.restore(blueprint(), 3600, restored.checkpoint(), None, clock, ["Java"]).change_given is True


def test_an_old_remark_flagged_again_after_the_candidate_spoke_is_still_one_incident():
    """A live round warned about "Do you have a girlfriend?", the candidate said other things, and on a later turn the talker quoted
    the same remark again: counted as a second incident, it ended the round with a second goodbye."""
    c, _ = make()
    c.on_candidate_turn()
    assert c.on_conduct("inappropriate", "Do you have a girlfriend?", "t1", "talker").kind == "conduct_warning"
    c.on_candidate_turn()
    c.on_candidate_turn()
    assert c.on_conduct("inappropriate", "do you have a girlfriend", "t5", "talker") is None
    assert len(c.conduct) == 1 and not c.ended


def test_a_framing_already_given_in_the_small_talk_lets_the_plan_move_on_to_the_introduction():
    """A live round told the candidate how the round would run during the small talk; entering the framing it was ordered to ask for
    their introduction, but next_item was refused ("0 of 1 exchanges") and the plan stayed behind the conversation."""
    from app.interviewer.conductor import Item

    c, _ = make()
    c.items.insert(c.index + 1, Item("framing", "phase", "framing", 120))
    c.outline_said = True
    c.current().turns = 5
    c.next_item("t")
    assert c.current().item_id == "framing"
    assert c.can_advance() == (True, "")


def test_a_parts_time_running_out_asks_the_director_and_says_nothing_itself():
    """Decided 2026-10-17: timings are guidance. A part's time running out tells the director, who decides when to move on; the
    conductor no longer speaks up on the clock (a live round's move-on fired in the candidate's thinking pauses)."""
    c, clock = make()
    to_core(c)
    c.set_candidate_speaking(True)
    c.triggers.clear()
    clock.advance(960)
    assert c.tick() == [] and "time" in c.triggers            # 80% of the problem: no "converge" order, the director hears
    clock.advance(240)
    c.triggers.clear()
    assert c.tick() == [] and "time" in c.triggers            # time up: still nothing said


def test_the_director_moves_a_part_on_when_it_decides():
    c, clock = make()
    to_core(c)
    clock.advance(300)
    c.current().turns = 1                                   # a problem nobody has spoken on is not moved on from (see the just-gone-up test)
    c.current().coded = True                                # nor is a coding problem nobody wrote code for
    out = c.apply_brief({"for_position": c.position, "plan_changes": [{"op": "move_on", "reason": "approach is clear"}]})
    assert out["applied"] and [o.kind for o in c.pending_orders()][-1] == "move_on"


def test_without_a_word_from_the_director_a_part_still_ends_some_time_after_its_time():
    c, clock = make()
    to_core(c)
    c.set_candidate_speaking(True)
    clock.advance(1200 + 299)
    assert "move_on" not in [o.kind for o in c.tick()]
    clock.advance(1)
    assert "move_on" in [o.kind for o in c.tick()]          # 20 min problem: the fallback comes 5 min after its time


def test_the_director_can_extend_a_part_and_the_fallback_waits_for_it():
    c, clock = make()
    to_core(c)
    c.set_candidate_speaking(True)
    clock.advance(1100)
    out = c.apply_brief({"for_position": c.position, "plan_changes": [{"op": "extend", "minutes": 5, "reason": "close to a solution"}]})
    assert out["applied"]
    clock.advance(400)                                        # 1500 s: the fallback point without the extension
    assert "move_on" not in [o.kind for o in c.tick()]
    clock.advance(300)
    assert "move_on" in [o.kind for o in c.tick()]


def test_the_director_can_close_the_round():
    c, clock = make()
    to_core(c)
    out = c.apply_brief({"for_position": c.position, "plan_changes": [{"op": "wrap_up", "reason": "round has run its course"}]})
    assert out["applied"] and c.current().item_id == "wrap_up"
    assert [o.kind for o in c.pending_orders()][-1] == "wrap_up_now"


def test_the_planned_round_end_asks_the_director_and_the_round_may_run_over():
    """Decided 2026-10-17: the 45 minutes are flexible too. Reaching them tells the director; only the safety ceiling ends it."""
    c, clock = make()
    to_core(c)
    c.set_candidate_speaking(True)
    c.extensions = {"core-1": 10 ** 6}                        # keep the problem going
    c.triggers.clear()
    clock.advance(3600)
    assert "wrap_up_now" not in [o.kind for o in c.tick()] and "time" in c.triggers


# ------------------------------------------------------------ queued orders that went stale (decided 2026-10-17)

def test_a_check_in_still_queued_when_they_speak_is_cancelled_and_recorded():
    c, clock = make()
    c.next_item("done")
    clock.advance(25)
    assert [o.kind for o in c.tick()] == ["nudge"]
    c.on_candidate_turn()
    assert not any(o.kind == "nudge" for o in c.pending_orders())
    assert c.dropped[-1]["kind"] == "nudge" and c.dropped[-1]["by"] == "auto"


def test_a_take_your_time_they_talked_past_is_cancelled_but_a_line_check_keeps_it():
    c, _ = make()
    c.hold()
    c.on_candidate_turn(keeps_hold=True)                    # "Hello?" alone: the moment they asked for goes on
    assert any(o.kind == "hold" for o in c.pending_orders())
    c.on_candidate_turn()
    assert not any(o.kind == "hold" for o in c.pending_orders())
    assert c.dropped[-1]["kind"] == "hold"


def test_a_move_on_set_aside_keeps_the_part_wakes_the_director_and_holds_off_the_fallback():
    c, clock = make()
    to_core(c)
    c.set_candidate_speaking(True)
    clock.advance(1500)
    [order] = c.tick()
    c.take_triggers()
    assert c.set_aside([order], "they just started an optimisation") == [order]
    assert order.consumed and c.current().item_id == "core-1"
    assert "set_aside" in c.take_triggers()
    assert c.dropped[-1] == {"kind": "move_on", "why": "they just started an optimisation", "by": "interviewer",
                             "item_id": "core-1", "at": clock()}
    clock.advance(119)
    assert c.tick() == []                                   # the director decides again; the fallback waits
    clock.advance(1)
    assert [o.kind for o in c.tick()] == ["move_on"]


def test_only_a_move_on_an_ask_or_an_opening_can_be_set_aside():
    c, clock = make()
    warning = c._order("conduct_warning", "Warn them.", clock())
    assert c.set_aside([warning], "no") == []
    assert not warning.consumed and not c.dropped


def test_set_aside_orders_survive_a_checkpoint():
    c, clock = make()
    to_core(c)
    c.set_aside([c.move_on_order(c.current(), clock())], "mid-idea")
    back = Conductor.restore(blueprint(), 3600, c.checkpoint(), clock=clock)
    assert back.dropped == c.dropped and back.move_on_not_before == c.move_on_not_before


def test_a_checkpoint_from_before_goals_restores_with_their_defaults():
    c, clock = make()
    data = c.checkpoint()
    for item in data["items"]:
        for key in ("must", "origin", "why", "title", "parent", "style"):
            item.pop(key, None)
    back = Conductor.restore(blueprint(), 3600, data, clock=clock)
    # Contract changed by the final review: a missing `must` comes from the blueprint's own plan, so a restored problem is must-cover.
    assert back.items[1].must is True and back.items[1].origin == "plan"
    assert next(i for i in back.items if i.item_id == "core-1").must is True
    assert back.skip_goal("core-1", "x")[0] is False


def test_the_problem_swapped_in_on_request_is_a_reserve_that_must_be_covered():
    c, clock = make()
    _worked_on_core_1(c, clock)
    next(i for i in c.items if i.item_id == "core-2").status = "skipped"      # no planned problem is left, so a reserve is used
    ask(c)
    ask(c)
    item = c.current()
    assert (item.item_id, item.origin, item.must) == ("reserve-alternate", "reserve", True)


def test_free_minutes_are_the_planned_time_left_after_every_pending_must_cover_part():
    c, clock = make()
    assert c.free_seconds() == 3600 - 2820          # at the greeting: introduction, both problems, questions, closing reserved
    c.next_item("done")
    clock.advance(60)
    assert c.free_seconds() == 3600 - 60 - 2700     # the introduction is under way: its own minutes are free to spend


def test_more_time_from_the_director_raises_the_budget():
    c, _ = make()
    c.next_item("done")
    before = c.free_seconds()
    c.apply_brief({"for_position": c.position, "plan_changes": [{"op": "extend", "minutes": 5}]})
    assert c.free_seconds() == before + 300 and c.planned_seconds() == 3900


def test_an_optional_part_has_no_minimum_exchanges():
    bp = blueprint()
    bp["arc"].insert(1, {"phase": "small_talk", "timebox_mins": 2, "scored": False, "guidance": "Chat."})
    c = Conductor(bp, 3600, clock=Clock())
    c.start()
    c.next_item("done")
    assert c.current().phase == "small_talk" and c.can_advance() == (True, "")


def test_a_brief_for_the_same_part_keeps_its_time_change_after_another_move():
    c, _ = make()
    c.next_item("done")
    pos = c.position
    c.note_flow_move()
    out = c.apply_brief({"for_position": pos, "plan_changes": [{"op": "extend", "minutes": 2}, {"op": "skip", "target": "candidate_questions"}]})
    assert out["stale"] and [ch["op"] for ch in out["applied"]] == ["extend"] and c.extensions["candidate_intro"] == 120
    assert c.items[4].status == "pending"


def test_a_brief_for_a_part_already_left_changes_nothing():
    c, _ = make()
    pos = c.position
    c.next_item("done")
    out = c.apply_brief({"for_position": pos, "plan_changes": [{"op": "extend", "minutes": 2}]})
    assert out["stale"] and out["applied"] == [] and not c.extensions


def test_the_time_budget_and_part_positions_survive_a_json_checkpoint():
    import json
    c, _ = make()
    c.next_item("done")
    c.apply_brief({"for_position": c.position, "plan_changes": [{"op": "extend", "minutes": 3}]})
    c.next_item("done")
    saved = json.loads(json.dumps(c.checkpoint()))
    back = Conductor.restore(blueprint(), 3600, saved, clock=Clock())
    assert back.position_items == c.position_items and all(isinstance(k, int) for k in back.position_items)
    assert back.granted_s == 180 and back.planned_seconds() == 3780


def _with_chat() -> dict:
    bp = blueprint()
    bp["arc"][1:1] = [{"phase": "small_talk", "timebox_mins": 2, "scored": False, "guidance": "Light chat."},
                      {"phase": "framing", "timebox_mins": 1, "scored": False, "guidance": "How the round runs."}]
    return bp


def test_the_interviewer_can_go_to_a_later_part_and_optional_parts_passed_over_are_skipped():
    c = Conductor(_with_chat(), 3600, clock=Clock())
    c.start()
    ok, _ = c.go_to("candidate_intro", "they said hello and asked to get going")
    assert ok and c.current().item_id == "candidate_intro"
    assert [(i.item_id, i.status, i.ended_by) for i in c.items[:3]] == [
        ("greeting", "done", "interviewer: they said hello and asked to get going"),
        ("small_talk", "skipped", "passed over"), ("framing", "skipped", "passed over")]


def test_a_must_cover_part_jumped_past_comes_right_after_the_coding():
    c, _ = make()
    c.current().turns = 5                                        # the conversation before the coding is done
    ok, _ = c.go_to("core-1", "they want to start coding")
    assert ok and c.items[1].status == "pending"
    assert c.next_item("done").item_id == "core-2"
    assert c.next_item("done").item_id == "candidate_intro"        # before their questions, not lost
    assert c.next_item("done").item_id == "candidate_questions"


def test_a_must_cover_part_cannot_be_skipped_and_the_questions_wait_for_it():
    c, _ = make()
    c.next_item("done")
    assert c.skip_goal("core-2", "x")[0] is False
    ok, why = c.go_to("candidate_questions", "x")
    assert not ok and "problem-1" in why and "core-" not in why


def test_an_optional_part_can_be_skipped_with_a_reason_and_it_moves_the_flow():
    c = Conductor(_with_chat(), 3600, clock=Clock())
    c.start()
    c.take_triggers()
    pos = c.position
    assert c.skip_goal("framing", "they said they know the format") == (True, "")
    assert c.items[2].status == "skipped" and c.position == pos + 1 and "flow" in c.take_triggers()


def test_with_no_free_minute_optional_moves_and_threads_are_refused_until_more_time_is_granted():
    clock = Clock()
    c = Conductor(_with_chat(), 3600, clock=clock)
    c.start()
    clock.advance(750)                                           # 3600 - 750 - 2820 reserved = 30 s free
    assert c.go_to("small_talk", "x") == (False, "less than a minute is free")
    assert c.open_thread("x", "y")[0] is False
    c.apply_brief({"for_position": c.position, "plan_changes": [{"op": "extend", "minutes": 10}]})
    assert c.go_to("small_talk", "x")[0] is True


def test_a_thread_pauses_the_part_it_interrupts_and_closing_it_resumes_that_part_without_a_new_opening():
    c, clock = make()
    c.next_item("done")
    intro = c.current()
    started = intro.started_at
    c.consume(c.pending_orders())
    clock.advance(30)
    ok, _ = c.open_thread("the monolith migration", "they led it; the plan has nothing on it", 3)
    t = c.current()
    assert ok and (t.kind, t.title, t.max_seconds, t.parent) == ("thread", "the monolith migration", 180, "candidate_intro")
    assert intro.status == "pending" and not c.pending_orders()
    clock.advance(120)
    assert c.close_thread("covered it") == (True, "")
    assert c.current() is intro and intro.started_at == started and not c.pending_orders()
    assert (t.status, t.ended_by) == ("done", "interviewer: covered it")


def test_a_thread_past_its_time_ends_on_the_fallback_and_the_paused_part_resumes():
    c, clock = make()
    c.next_item("done")
    c.open_thread("migration", "why", 3)
    c.set_candidate_speaking(True)
    clock.advance(300)                                           # 3 minutes plus the 2-minute fallback
    assert [o.kind for o in c.tick()] == ["move_on"]
    assert c.next_item("move_on").item_id == "candidate_intro"


def test_threads_are_limited():
    c, clock = make()
    c.next_item("done")
    assert c.open_thread("a", "w", 10)[0] and c.current().max_seconds == 360          # clamped to 6 minutes
    assert c.open_thread("b", "w") == (False, "a thread is already open: close it first")
    c.close_thread("done")
    c.open_thread("c", "w", None)
    assert c.current().max_seconds == 180                                             # 3 minutes by default
    c.close_thread("done")
    c.open_thread("d", "w")
    c.close_thread("done")
    assert c.open_thread("e", "w")[0] is False                                        # three per round
    assert c.flow_log[-1]["ok"] is False and c.flow_log[-1]["move"] == "open_thread"


def test_a_thread_gets_only_the_free_minutes_and_none_while_a_problem_is_up():
    c, clock = make()
    c.next_item("done")
    clock.advance(780)                                           # 2 free minutes left
    c.open_thread("x", "y", 3)
    assert c.current().max_seconds == 120
    c.close_thread("ok")
    c.current().turns = 5
    c.go_to(None, "done")
    assert c.current().kind == "slot" and c.open_thread("x", "y") == (False, "not while a problem is up")


def test_flow_moves_are_checkpointed_and_old_checkpoints_still_restore():
    c, _ = make()
    c.next_item("done")
    c.open_thread("a", "w")
    data = c.checkpoint()
    r = Conductor.restore(blueprint(), 3600, data, clock=Clock())
    assert r.threads_opened == 1 and r.flow_log == c.flow_log and r.current().kind == "thread"
    data.pop("threads_opened"), data.pop("flow_log")
    old = Conductor.restore(blueprint(), 3600, data, clock=Clock())
    assert old.threads_opened == 0 and old.flow_log == []


def test_closing_a_thread_by_naming_its_parent_resumes_the_parent_without_a_new_opening():
    c, clock = make()
    c.next_item("done")
    intro = c.current()
    started = intro.started_at
    c.open_thread("migration", "why", 3)
    c.consume(c.pending_orders())
    clock.advance(60)
    assert c.close_thread("done", target="candidate_intro") == (True, "")
    assert c.current() is intro and intro.started_at == started
    assert not [o for o in c.pending_orders() if o.kind == "open_item"]


def test_a_straight_in_round_may_start_the_coding_after_one_exchange():
    bp = {**blueprint(), "shape_id": "straight_in"}
    c = Conductor(bp, 3600, clock=Clock())
    c.start()
    c.current().turns = 1
    assert c.problem_allowed() and c.go_to("core-1", "ready")[0]


def test_an_introduction_after_the_coding_opens_with_its_own_bridge():
    bp = {**blueprint(), "shape_id": "straight_in"}
    bp["arc"] = [bp["arc"][0], bp["arc"][2], {**bp["arc"][1], "style": "after_coding"}, *bp["arc"][3:]]
    c = Conductor(bp, 3600, clock=Clock())
    c.start()
    c.current().turns = 1
    c.next_item("done")
    c.next_item("done")
    c.next_item("done")                                      # both problems done
    assert c.current().item_id == "candidate_intro"
    order = [o for o in c.pending_orders() if o.kind == "open_item"][-1]
    assert "Now let's talk a bit about you." in order.text and "coding part is done" in order.text


def test_a_thread_may_be_closed_straight_into_the_coding_once_the_conversation_before_it_is_done():
    c, _ = make()
    c.current().turns = 5
    c.next_item("done")
    assert c.open_thread("the monolith migration", "why", 3)[0]
    assert c.close_thread("ready", target="core-1") == (True, "")
    assert c.current().item_id == "core-1"


def test_the_first_problem_is_opened_with_the_outline_sentence_when_the_core_has_that_style():
    bp = blueprint()
    bp["arc"] = [{**p, "style": "with_outline"} if p["phase"] == "core" else p for p in bp["arc"]]
    c = Conductor(bp, 3600, clock=Clock())
    c.start()
    c.current().turns = 5
    c.next_item("done")
    c.go_to("core-1", "ready")
    text = [o for o in c.pending_orders() if o.kind == "open_item"][-1].text
    assert "how the coding will run, then time for their questions" in text and not re.search(r"\d+ minutes|about \w+ minutes", text)
    assert "never a number of minutes" in text          # no "about N minutes" is ordered (decided 2026-10-18)


def test_a_filler_between_problems_does_not_open_the_coding_gate():
    from app.interviewer.plan import Item
    c, _ = make()
    c.current().turns = 5
    c.go_to("core-1", "ready")
    c.next_item("done")
    filler = Item("filler-1", "filler", "filler", 120, filler={"question": "q", "sound_answer": "a"})
    c.items.insert(c.index + 1, filler)
    c.next_item("done")
    assert c.current() is filler and not c.problem_allowed()
    assert c.go_to("core-2", "skip the decision")[0] is False


def test_the_timing_helpers_reserve_time_for_a_must_cover_part_that_was_jumped_past():
    jumped, _ = make()
    jumped.current().turns = 5
    assert jumped.go_to("core-1", "they want to start coding")[0] and jumped.items[1].status == "pending"
    done, _ = make()
    to_core(done)
    assert done.items[1].status == "done"
    assert jumped._time_for_next_problem() == done._time_for_next_problem() - 120
    assert jumped.slack_s() == done.slack_s() - 120


def test_a_reserve_problem_is_only_ever_problem_n_in_the_goal_map_and_the_state():
    from app.interviewer.prompts import state_block
    c, clock = one_problem_plan()
    c.reserves["reserve-harder"] = {"slot_id": "reserve-harder", "timebox_mins": 15}
    to_core(c)
    clock.advance(200)
    assert c.plan_extra_problem().item_id == "reserve-harder"
    goals = c.goal_map()
    assert [g["id"] for g in goals if g["kind"] == "slot"] == ["problem-2"]
    assert next(g for g in goals if g["kind"] == "slot")["internal_id"] == "reserve-harder"
    item = {"item_id": c.public_id(c.current()), "kind": "slot", "phase": "core", "elapsed_min": 3, "max_min": 20, "hint_step": 0}
    text = state_block({"round_elapsed_min": 4, "round_min": 60, "item": item, "goals": goals, "free_min": 5})
    assert "problem-2 (slot" in text and "Current item: problem-1" in text and "reserve" not in text and "core-" not in text


def test_the_interviewer_can_go_to_a_problem_by_its_public_id():
    c, _ = make()
    c.current().turns = 5
    assert c.resolve("problem-1") == "core-1" and c.resolve("problem-2") == "core-2" and c.resolve("candidate_intro") == "candidate_intro"
    assert c.go_to("problem-1", "they want to start coding")[0] and c.current().item_id == "core-1"


def test_refusals_name_a_problem_by_its_public_id_never_its_slot_id():
    c, _ = make()
    to_core(c)
    ok, why = c.skip_goal("problem-1", "x")
    assert not ok and "problem-1" in why and "core-" not in why and "reserve" not in why
    ok, why = c.go_to("problem-1", "x")
    assert not ok and "core-" not in why
    c2, _ = make()
    c2.current().turns = 5
    ok, why = c2.go_to("problem-2", "x")
    assert not ok and "core-" not in why and "reserve" not in why
    ok, why = c2.skip_goal("problem-2", "x")
    assert not ok and "core-" not in why


ASK = "What was the hardest part of building the Hisaab app for you?"
ASK_AGAIN = "What was the hardest thing about building the Hisaab app?"


def _drop_orders(c):
    return [o for o in c.pending_orders() if o.kind == "drop_question"]


def test_the_same_question_asked_a_third_time_over_their_replies_orders_it_dropped():
    c, _ = make()
    c.note_interviewer_line(ASK)
    c.on_candidate_turn()
    c.note_interviewer_line(ASK_AGAIN)
    c.on_candidate_turn()
    assert c.ask_streak == 2 and _drop_orders(c) == []
    c.note_interviewer_line(ASK)
    assert c.ask_streak == 3
    assert [o.text for o in _drop_orders(c)] == [
        "You have asked about this three times now. Do not ask it again, in any wording. "
        "Take what they said, respond to it briefly, and go on to the next part."]


def test_a_different_question_a_part_change_or_a_tool_move_starts_the_count_again():
    c, _ = make()
    c.note_interviewer_line(ASK)
    c.note_interviewer_line("How did you split the work between the two of you in that team?")
    c.note_interviewer_line(ASK_AGAIN)
    assert _drop_orders(c) == [] and c.ask_streak == 1
    c.note_interviewer_line(ASK)
    assert c.ask_streak == 2
    c.reset_asks()                         # a tool move
    assert c.ask_streak == 0
    c.note_interviewer_line(ASK)
    c.note_interviewer_line(ASK_AGAIN)
    c.next_item("test")                    # the part changed
    c.note_interviewer_line(ASK)
    assert c.ask_streak == 1 and _drop_orders(c) == []


def test_the_drop_question_order_is_spent_when_spoken_and_not_issued_twice():
    c, _ = make()
    for line in (ASK, ASK_AGAIN, ASK, ASK_AGAIN):
        c.note_interviewer_line(line)
    assert len(_drop_orders(c)) == 1
    c.consume(_drop_orders(c))
    assert _drop_orders(c) == []


PULL_BACKS = ("I still want to hear about the sprint side, though — your resume says you led three engineers on the Experience Portal. "
              "How did you split the work?",
              "Okay. Before you start on that, I'd still like your answer to what I asked — how did you split the work across the three "
              "engineers on the Experience Portal?",
              "I'll ask once more, then we can move ahead. On the Experience Portal, how did you break the work into sprints for your team?")


def test_three_differently_worded_pull_backs_on_one_part_order_the_question_dropped():
    c, _ = make()
    to_core(c)
    for line in PULL_BACKS[:2]:
        c.note_interviewer_line(line)
        c.on_candidate_turn()
    assert c.ask_streak == 2 and _drop_orders(c) == []
    c.note_interviewer_line(PULL_BACKS[2])
    assert c.ask_streak == 3 and len(_drop_orders(c)) == 1


def test_a_pull_back_that_shares_nothing_with_the_previous_question_does_not_count():
    c, _ = make()
    to_core(c)
    c.note_interviewer_line("How would you scan the array once and keep the counts?")
    c.note_interviewer_line("Coming back to the problem, what is the complexity?")
    assert c.ask_streak == 1


def test_a_pull_back_that_does_not_end_in_a_question_and_ordinary_follow_ups_never_count_as_a_re_ask():
    c, _ = make()
    to_core(c)
    c.note_interviewer_line("I'd still like to hear how you'd approach it. Even a rough idea in words is fine.")
    assert c.ask_streak == 0
    for line in ("And then what did you change?", "What did that cost you in the end?", "How did the team react to the change afterwards?"):
        c.note_interviewer_line(line)
        c.on_candidate_turn()
    assert c.ask_streak == 1 and _drop_orders(c) == []


def test_asking_for_the_introduction_again_with_a_pull_back_is_a_re_ask_but_a_reworded_one_alone_is_not():
    c, _ = make()
    c.next_item("done")
    assert c.current().phase == "candidate_intro"
    for line in ("Could you tell me a bit about yourself?", "I still want a short introduction, so could you tell me about yourself?",
                 "Let me ask once more: could you tell me about yourself and your background?"):
        c.note_interviewer_line(line)
        c.on_candidate_turn()
    assert c.ask_streak == 3 and len(_drop_orders(c)) == 1
    d, _ = make()
    d.next_item("done")
    d.note_interviewer_line("Could you tell me a bit about yourself?")
    d.note_interviewer_line("Give me a short introduction, who are you today?")
    assert d.ask_streak == 1


def test_asking_the_same_resume_probe_again_with_a_pull_back_is_a_re_ask_but_another_probe_is_not():
    c, _ = make()
    c.next_item("done")
    c.note_interviewer_line("How did the split app handle the settlement logic when several friends owed different amounts to different people?")
    c.note_interviewer_line("Let me ask it differently: how does the settlement logic of the split case work, including rounding and currency handling?")
    assert c.ask_streak == 2
    c.note_interviewer_line("What would you do differently with the logging in it?")
    assert c.ask_streak == 1


def test_three_distinct_follow_ups_that_share_words_with_the_probe_never_order_a_drop():
    c, _ = make()
    c.next_item("done")
    for line in ("How does the settlement logic handle rounding for the split?", "What happens to the split when someone leaves the group midway?",
                 "Which part of the settlement logic did you test the most?"):
        c.note_interviewer_line(line)
        c.on_candidate_turn()
    assert _drop_orders(c) == [] and c.ask_streak < 3


def _with_deep_dive():
    bp = blueprint()
    bp["round"]["deep_dive_mins"] = 4
    c = Conductor(bp, 3600, clock=Clock(), skills=["Java"])
    c.start()
    return c


def test_a_deferred_topic_comes_after_the_coding_and_the_deep_dive_and_before_the_candidates_questions():
    c = _with_deep_dive()
    to_core(c)
    for _ in range(2):                                         # the projects discussion is under way: nothing left to attach to
        c.current().turns = 5
        c.next_item("done")
    assert c.current().item_id == "deep_dive"
    assert c.defer_topic("that side project", "promised during the problem") == (True, "")
    assert [i.item_id for i in c.items] == ["greeting", "candidate_intro", "core-1", "core-2", "deep_dive", "deferred-1", "candidate_questions", "wrap_up"]
    item = next(i for i in c.items if i.item_id == "deferred-1")
    assert (item.kind, item.origin, item.title, item.why, item.max_seconds, item.must) == (
        "thread", "promise", "that side project", "promised during the problem", 180, False)
    assert {"id": c.public_id(item), "kind": "thread", "must": False, "about": "come back to: that side project", "paused": False}.items() <= \
        next(g for g in c.goal_map() if g["internal_id"] == "deferred-1").items()
    c.current().turns = 5
    c.next_item("done")
    assert c.current().item_id == "deferred-1"
    assert [o.text for o in c.pending_orders() if o.kind == "open_item"][-1] == (
        "You promised to come back to that side project: pick it up now in a sentence or two, then ask one question about it.")
    c.next_item("done")
    assert c.current().item_id == "candidate_questions"


def test_at_most_two_topics_are_deferred_and_none_when_less_than_a_minute_is_free_or_the_round_is_over():
    c, clock = make()
    to_core(c)
    assert c.defer_topic("one", "w")[0] and c.defer_topic("two", "w")[0]
    ok, why = c.defer_topic("three", "w")
    assert not ok and "2" in why and sum(1 for i in c.items if i.origin == "promise") == 2
    late, clock2 = make()
    to_core(late)
    clock2.advance(10_000)
    ok, why = late.defer_topic("one", "w")
    assert not ok and "minute" in why and not any(i.origin == "promise" for i in late.items)
    c.wrap_up_now(c.clock(), "ceiling")
    assert not c.defer_topic("four", "w")[0]


def test_wrapping_up_skips_a_deferred_topic_like_any_pending_part():
    c, _ = make()
    to_core(c)
    c.defer_topic("that side project", "w")
    c.wrap_up_now(c.clock(), "time")
    assert next(i for i in c.items if i.origin == "promise").status == "skipped"
    assert c.current().phase == "wrap_up"


def test_a_promise_with_the_projects_discussion_still_ahead_attaches_to_it_and_the_goal_map_shows_it():
    c = _with_deep_dive()
    to_core(c)
    assert c.defer_topic("that side project", "w") == (True, "attached to deep_dive")
    assert not any(i.origin == "promise" for i in c.items)
    assert c.follow_ups["deep_dive"] == ["They promised to come back to: that side project"]
    assert c.flow_log[-1]["move"] == "defer_topic" and c.flow_log[-1]["target"] == "deep_dive" and c.flow_log[-1]["ok"]
    about = next(g["about"] for g in c.goal_map() if g["internal_id"] == "deep_dive")
    assert about == "their projects in depth (come back to: that side project)"
    assert c.defer_topic("another", "w")[1] == "attached to deep_dive"          # attaching is not capped like threads


def test_without_a_projects_discussion_ahead_a_deferred_thread_is_inserted_as_before():
    c, _ = make()
    to_core(c)
    assert c.defer_topic("that side project", "w") == (True, "")
    assert any(i.origin == "promise" for i in c.items)


def test_a_topic_promised_twice_is_kept_once_and_the_ask_count_survives_a_restore():
    c, _ = make()
    to_core(c)
    assert c.defer_topic("that side project", "w") == (True, "")
    assert c.defer_topic("That Side Project!", "w") == (True, "already kept for later")
    assert sum(1 for i in c.items if i.origin == "promise") == 1
    c.note_interviewer_line(ASK)
    c.note_interviewer_line(ASK_AGAIN)
    back = Conductor.restore(blueprint(), 3600, c.checkpoint(), clock=Clock())
    assert (back.ask_streak, back.last_ask, back.ask_item) == (2, ASK_AGAIN, "core-1")
    assert Conductor.restore(blueprint(), 3600, {k: v for k, v in c.checkpoint().items() if not k.startswith("ask_") and k != "last_ask"},
                             clock=Clock()).ask_streak == 0


def test_a_director_move_on_sent_as_a_problem_goes_up_is_refused_but_one_after_a_turn_is_ordered():
    c, _ = make()
    to_core(c)
    assert c.current().turns == 0
    out = c.apply_brief({"for_position": c.position, "plan_changes": [{"op": "move_on"}]})
    assert out["applied"] == [] and out["dropped"][0]["why"].startswith("the problem has just gone up")
    assert not [o for o in c.orders if o.kind == "move_on"]
    stale = c.apply_brief({"for_position": c.position - 1, "plan_changes": [{"op": "move_on"}]})   # an older brief of the same part
    c.position_items[c.position - 1] = c.current().item_id
    again = c.apply_brief({"for_position": c.position - 1, "plan_changes": [{"op": "move_on"}]})
    assert not [o for o in c.orders if o.kind == "move_on"] and "just gone up" in again["dropped"][-1]["why"]
    c.current().turns = 1
    c.current().coded = True
    ok = c.apply_brief({"for_position": c.position, "plan_changes": [{"op": "move_on"}]})
    assert len(ok["applied"]) == 1 and [o for o in c.orders if o.kind == "move_on"]


def test_an_end_request_after_the_interviewers_farewell_ends_without_speaking():
    c, _ = make()
    order = c.on_end_request(farewell_said=True)
    assert order.speak is False and c.ended and c.end_reason == "candidate_ended"
    d, _ = make()
    assert d.on_end_request().speak is True


def test_a_director_move_on_the_talker_could_not_carry_out_is_refused_with_the_gates_reason_and_accepted_once_it_may():
    """p18/strong_fresher seq 9: move_on was accepted on the introduction with 4 of 5 exchanges; every next_item was then refused."""
    c, _ = make()
    c.set_candidate_speaking(True)
    _on(c, "candidate_intro")
    for _ in range(4):
        c.on_candidate_turn()
    out = c.apply_brief({"for_position": c.position, "plan_changes": [{"op": "move_on"}]})
    assert out["applied"] == [] and "before the coding" in out["dropped"][0]["why"] and "4 of 5" in out["dropped"][0]["why"]
    assert not [o for o in c.pending_orders() if o.kind == "move_on"]
    c.on_candidate_turn()
    out = c.apply_brief({"for_position": c.position, "plan_changes": [{"op": "move_on"}]})
    assert [x["op"] for x in out["applied"]] == ["move_on"]
    assert [o.kind for o in c.pending_orders() if o.kind == "move_on"] == ["move_on"]


def test_a_move_on_the_director_ends_early_does_not_say_the_parts_time_is_up():
    c, clock = make()
    c.set_candidate_speaking(True)
    _on(c, "candidate_intro")
    for _ in range(5):
        c.on_candidate_turn()
    early = c.move_on_order(c.current(), clock())
    assert "time is up" not in early.text and "time to move on" in early.text
    c2, clock2 = make()
    c2.set_candidate_speaking(True)
    _on(c2, "candidate_intro")
    clock2.advance(121)
    assert "time is up" in c2.move_on_order(c2.current(), clock2()).text


def test_may_leave_problem_wants_code_for_a_coding_problem_unless_time_is_up_they_gave_up_wrap_up_or_struggled():
    from app.interviewer.conductor import Conductor
    c, clock = make()
    to_core(c)
    item = c.current()
    item.turns = 3
    ok, why = c.may_leave_problem(item)
    assert not ok and why == "they have not written any code for this problem yet: ask them to write it before moving on"
    c.on_code_change("def pair_sum(nums, target):\n    seen = {}\n")
    assert item.coded and c.may_leave_problem(item) == (True, "")

    def uncoded():
        d, dclock = make()
        to_core(d)
        d.current().turns = 3
        return d, dclock

    d, dclock = uncoded()
    dclock.advance(d.current().max_seconds)
    assert d.may_leave_problem(d.current())[0]                          # the problem's own time is up
    d, _ = uncoded()
    d.gave_up_items.add(d.current().item_id)
    assert d.may_leave_problem(d.current())[0]                          # a give-up
    d, dclock = uncoded()
    d._order("wrap_up_now", "close", dclock())
    assert d.may_leave_problem(d.current())[0]                          # a wrap-up is pending
    d, _ = uncoded()
    d.signals[d.current().item_id] = "struggling"
    assert d.may_leave_problem(d.current())[0]                          # the director read a struggle
    d, dclock = uncoded()
    d._order("move_on", "director", dclock())
    assert not d.may_leave_problem(d.current())[0]                      # a move_on alone does not excuse a problem nobody coded
    bp = blueprint()
    bp["slots"][0]["problem"]["round_type"] = "behavioural"
    b = Conductor(bp, 3600, clock=Clock(), skills=["Java"])
    b.start()
    to_core(b)
    b.current().turns = 3
    assert b.may_leave_problem(b.current()) == (True, "")               # a behavioural question has no code


def test_code_state_is_per_problem_whatever_the_editor_still_holds():
    """The editor is never cleared between problems (web CodeEditor), so problem 1's code stays in it when problem 2 goes up."""
    c, clock = make()
    to_core(c)
    solution = "def pair_sum(nums, target):\n    return [0, 1]\n"
    c.on_code_change("# write your solution here\n")                       # the starter text is not code
    assert not c.current().coded and not c.has_code()
    c.on_code_change(solution)
    assert c.current().coded and c.has_code()
    c.current().turns = 2
    c.next_item("done")                                                    # problem 2 goes up with the same text in the editor
    assert c.current().item_id == "core-2" and not c.current().coded and not c.has_code()
    c.on_code_change(solution)                                             # a snapshot of the old text is no work on the new problem
    assert not c.current().coded
    c.on_code_change(solution + "    # two pointers\n")
    assert c.current().coded and c.has_code()


def test_what_counts_as_written_code_is_a_new_line_in_the_editor_comments_and_pointer_lines_included():
    def coded_after(text, first=None):
        c, _ = make()
        to_core(c)
        if first is not None:
            c.on_code_change(first)
        c.on_code_change(text)
        return c.current().coded

    starter = "# write your solution here\n"
    assert not coded_after(starter) and not coded_after("")
    assert coded_after("# take the two ends\n# move the smaller one inward\n")           # pseudocode in comments has started
    assert coded_after("void f(int *p) {\n    *p = 1;\n}\n")                           # a pointer line is code
    assert not coded_after(starter, first=starter)                                      # unchanged
    assert not coded_after("  # write your solution here  \n\n", first=starter)         # only whitespace differs


def test_a_round_restored_mid_problem_two_does_not_mark_it_coded_on_a_snapshot_of_problem_ones_code():
    c, clock = make()
    to_core(c)
    solution = "def pair_sum(nums, target):\n    return [0, 1]\n"
    c.on_code_change(solution)
    c.current().turns = 2
    c.next_item("done")
    assert c.current().item_id == "core-2" and not c.current().coded
    data = c.checkpoint()
    restored = Conductor.restore(blueprint(), 3600, data, clock=clock)
    assert restored.code_text == solution and restored.items[restored.index].code_base == solution
    restored.on_code_change(solution)                       # the editor still holds problem one's code after the restart
    assert not restored.current().coded
    restored.on_code_change(solution + "    # now the second one\n")
    assert restored.current().coded


def _two_question_dive():
    bp = blueprint()
    bp["round"]["deep_dive_mins"] = 10
    bp["personalization"]["resume_probes"] = [{"prompt": "Tell me about the split-bill app's settlement logic and how you tested the rounding.", "grounded_in": "p", "what_it_tests": "x"}]
    bp["personalization"]["round_questions"] = [{"prompt": "Can you explain how a Java HashMap works internally?", "covers": "java-hashmap", "what_it_tests": "collections"}]
    clock = Clock()
    c = Conductor(bp, 3600, clock=clock)
    c.start()
    c.set_candidate_speaking(True)
    _on(c, "deep_dive")
    return c


PROBE_ASK = "How did you test the rounding in the settlement logic of the split-bill app?"
QUESTION_ASK = "Moving on, how does a Java HashMap work internally?"


def test_a_deep_dive_whose_planned_questions_were_each_asked_and_answered_may_be_left_with_two_exchanges():
    c = _two_question_dive()
    assert c.can_advance()[0] is False
    c.note_interviewer_line(PROBE_ASK)
    c.on_candidate_turn()
    c.note_interviewer_line(QUESTION_ASK)
    c.on_candidate_turn()
    assert c.current().turns == 2 and c.can_advance() == (True, "")


def test_a_deep_dive_with_a_planned_question_still_unasked_keeps_its_three_exchanges():
    c = _two_question_dive()
    c.note_interviewer_line(PROBE_ASK)
    c.on_candidate_turn()
    c.on_candidate_turn()
    ok, why = c.can_advance()
    assert not ok and "2 of 3 exchanges" in why
    c.note_interviewer_line("Tell me more about the weather today?")        # not a planned question: it counts for nothing
    assert c.can_advance()[0] is False
    c.on_candidate_turn()
    assert c.can_advance()[0] is True


def test_a_planned_question_asked_but_not_yet_answered_does_not_let_the_deep_dive_go():
    c = _two_question_dive()
    c.note_interviewer_line(PROBE_ASK)
    c.on_candidate_turn()
    c.note_interviewer_line(QUESTION_ASK)
    assert c.can_advance()[0] is False


def test_the_asked_planned_questions_survive_a_checkpoint_and_an_old_checkpoint_has_none():
    c = _two_question_dive()
    c.note_interviewer_line(PROBE_ASK)
    restored = Conductor.restore(c.blueprint, 3600, c.checkpoint(), clock=c.clock)
    assert restored.deep_dive_asked == c.deep_dive_asked and len(restored.deep_dive_asked) == 1
    old = c.checkpoint()
    del old["deep_dive_asked"]
    assert Conductor.restore(c.blueprint, 3600, old, clock=c.clock).deep_dive_asked == set()


def test_the_deep_dive_is_opened_by_saying_the_coding_is_done_once_then_what_comes_next_then_the_first_question():
    from app.interviewer.plan import CODING_DONE
    from tests.interviewer.fixtures import deep_dive_blueprint

    c = Conductor(deep_dive_blueprint(framing=False), 3600, clock=Clock())
    c.start()
    _on(c, "deep_dive")
    text = [o for o in c.pending_orders() if o.kind == "open_item"][-1].text
    assert text.count(CODING_DONE) == 1 and "talk a bit more about your projects" not in text
    assert text.index("projects") < text.index("fundamentals") < text.index("Relay project")


def test_a_planned_question_counts_as_asked_only_with_two_shared_distinctive_words():
    from app.interviewer.closing import asks_planned

    planned = "How does a HashMap work internally in Java?"
    assert asks_planned("Tell me, how does a HashMap work internally?", planned)
    assert not asks_planned("Where have you used a hashmap in your project?", planned)
    assert asks_planned("Walk me through the Experience Portal's sprint planning", "Walk me through the sprint planning?")
    assert not asks_planned("anything at all", "")


def test_a_swapped_in_problem_is_put_up_by_the_run_in_fixed_words_so_it_is_never_current_and_unshown():
    """b1 struggler_gives_up: the reserve became current but nothing showed it, and the hint came from its ladder while the candidate
    worked on the problem on screen."""
    c, clock = make()
    _worked_on_core_1(c, clock)
    next(i for i in c.items if i.item_id == "core-2").status = "skipped"
    ask(c)
    order = ask(c)
    assert order.kind == "open_item" and matches("swap_put_up", order.line)


def test_no_swap_on_the_second_problem_when_the_candidate_reads_it_out_after_two_requests_on_the_first():
    """b1 struggler_gives_up: the acknowledgement "Okay, new problem. So I need all triplets..." was taken for a request on core-2 and the problem
    was swapped for a reserve. Every turn goes through the detector as the run does; it must not have counted a request on core-2."""
    from app.interviewer.closing import asks_to_change_problem

    c, clock = make()
    _worked_on_core_1(c, clock)
    for text in ("Can you change the problem?", "Can you skip this question?"):
        assert asks_to_change_problem(text)
        ask(c)
    c.next_item("move_on")
    assert c.current().item_id == "core-2"
    c.current().turns = 0                                           # their next turn is the first on core-2
    for text in ("Okay, new problem. So I need all triplets of transactions that add up to zero, and no duplicate triplets.",
                 "Okay, new problem. So I need triplets."):
        if asks_to_change_problem(text):
            ask(c)
    assert c.current().item_id == "core-2" and c.change_requests == {"core-1": 2}
    assert next(i for i in c.items if i.item_id == "core-2").status == "active"
    first_step = min(int(h["step"]) for h in next(s for s in c.blueprint["slots"] if s["slot_id"] == "core-2")["hint_ladder"])
    assert f"step {first_step}" in c.on_hint_request().text


def test_the_line_said_for_a_second_request_takes_it_up_instead_of_contradicting_the_refusal():
    c, clock = make()
    _worked_on_core_1(c, clock)
    ask(c)
    order = ask(c)
    assert contains("give_up", order.line) and any(order.line.endswith(v) for v in LINES["put_up:second"])


def test_the_decline_of_an_editor_request_is_worded_as_a_person_would():
    c, _ = make()
    to_core(c)
    text = c.on_edit_request().text
    assert "I'll leave the typing to you." in text and "That's yours to write" not in text and "never say you are not allowed" in text


def test_the_harder_reserve_is_never_what_a_request_or_a_give_up_brings_in():
    bp = blueprint()
    bp["slots"] = [x for x in bp["slots"] if x["slot_id"] != "reserve-alternate"] + [_slot("reserve-harder", "reserve", 4, "Skyline")]
    clock = Clock()
    c = Conductor(bp, 3600, clock=clock, skills=["Java"])
    c.start()
    to_core(c)
    c.current().turns = 1
    clock.advance(30)
    assert ask(c).kind == "keep_problem" and c.current().item_id == "core-1"
    next(i for i in c.items if i.item_id == "core-2").status = "skipped"      # no planned problem is left: only the harder reserve could be used
    order = ask(c)
    assert order.kind == "move_on" and matches("coding_over", order.line) and c.no_more_problems and not c.change_given
    assert list(c.reserves) == ["reserve-harder"]


def test_a_swapped_position_counts_once_in_the_labels_and_the_problem_numbers():
    c, clock = make()
    to_core(c)
    assert c.label_for("core-1") == "Problem 1"
    c.current().turns = 1
    next(i for i in c.items if i.item_id == "core-2").status = "skipped"
    clock.advance(30)
    ask(c)
    ask(c)
    assert c.labels["reserve-alternate"] == "Problem 1" and c.change_requests == {"core-1": 2}
    assert c.label_for("core-2") == "Problem 2"                      # not "Problem 3": the swapped-out problem never counted
    assert c.problem_number() == 1


def test_a_tab_switch_and_a_full_screen_exit_within_a_minute_are_one_mention_in_fixed_words():
    c, clock = make()
    first = c.on_proctor("tab_hidden", 1, 1)
    assert first.kind == "mention_violation" and matches("violation:tab_hidden", first.line) and is_violation_line(first.line)
    assert "ask no question" in first.text
    clock.advance(36)                                                # the live round's second event came 36 s later
    assert c.on_proctor("fullscreen_exit", 0.5, 2) is None
    assert [o.kind for o in c.orders].count("mention_violation") == 1 and len(c.proctor) == 2      # both events are in the ledger
    clock.advance(30)                                                # 66 s after the first mention: a new action
    assert c.on_proctor("window_blur", 0.5, 3).kind == "mention_violation"


def test_the_merged_event_still_escalates_by_the_ladder():
    c, _ = make()
    assert c.on_proctor("tab_hidden", 1, 1).kind == "mention_violation"
    assert c.on_proctor("window_blur", 1, 2).kind == "final_warning"        # the second full violation is a warning, never merged away


# ---------------------------------------------------------------- warnings in fixed words, remembered, and the return clock (decided 2026-10-18)

def test_every_warning_order_carries_its_fixed_line_and_what_it_is_about():
    c, clock = make()
    mention = c.on_proctor("window_blur", 1, 1)
    assert (mention.kind, mention.about) == ("mention_violation", "window_blur") and matches("violation:window_blur", mention.line)
    final = c.on_proctor("tab_hidden", 1, 2)
    assert (final.kind, final.about) == ("final_warning", "tab_hidden") and matches("final_warning:tab_hidden", final.line)
    assert "final warning" in final.line.lower() and "stay on this screen" in final.line and "end the interview" in final.line
    end = c.on_proctor("tab_hidden", 1, 3)
    assert end.kind == "end" and matches("proctor_end", end.line)
    d, _ = make()
    d.on_candidate_turn()
    warn = d.on_conduct("inappropriate", "That is a stupid question", "t1", "model")
    assert warn.kind == "conduct_warning" and matches("conduct_warning", warn.line) and warn.about == "conduct"


def test_every_proctor_kind_has_a_final_warning_line_and_it_counts_as_a_screen_warning_in_the_history():
    for kind, line in FINAL_WARNING_LINES.items():
        assert line.startswith("This is your final warning:") and "end the interview" in line and is_violation_line(line), kind
    for line in AWAY_OVERSTAY_LINES.values():
        assert is_violation_line(line)
    assert AWAY_OVERSTAY_LINES["final_warning"] == ("You're still away from the screen. This is your final warning: come back now, "
                                                    "or I'll have to end the interview.")


def test_the_interviewer_remembers_what_it_warned_about_and_forgets_a_warning_that_was_never_played():
    c, _ = make()
    assert c.warnings_summary() == ""
    c.note_warning("mention_violation", "tab_hidden", 4)
    assert c.warnings_summary() == "1 about leaving the interview screen (tab_hidden); no final warning yet; the last was in turn 4"
    c.note_warning("final_warning", "window_blur", 9)
    c.note_warning("conduct_warning", "conduct", 12)
    summary = c.warnings_summary()
    assert "2 about leaving the interview screen (tab_hidden, window_blur); the final warning was given (turn 9)" in summary
    assert "1 about conduct" in summary and summary.endswith("the last was in turn 12")
    c.forget_warnings(12)
    assert "conduct" not in c.warnings_summary()
    assert Conductor.restore(blueprint(), 3600, c.checkpoint(), None, Clock(), ["Java"]).warnings_given == c.warnings_given


def _away(kinds=("tab_hidden",)):
    c, clock = make()
    c.on_away(list(kinds))
    return c, clock


def test_not_back_four_seconds_after_the_warning_played_is_one_more_violation_up_the_ladder():
    c, clock = _away()
    c.on_proctor("tab_hidden", 1, 1)                       # the violation itself: mention (1 of 3)
    clock.advance(2)
    assert c.away_warning_pending()
    c.start_return_clock(clock())                          # the voice finished the warning
    clock.advance(AWAY_RETURN_S - 0.1)
    assert [o for o in c.tick() if o.kind in ("final_warning", "mention_violation")] == []
    clock.advance(0.2)
    [order] = [o for o in c.tick() if o.kind == "final_warning"]
    assert matches("away_overstay:final_warning", order.line) and order.about == "still_away" and c.full_violations == 2
    assert c.proctor[-1]["kind"] == "away_overstay" and c.proctor[-1]["weight"] == 1.0
    clock.advance(10)
    assert [o for o in c.tick() if o.kind == "final_warning"] == []      # once per episode


def test_the_return_warning_is_never_merged_into_the_mention_said_a_moment_before():
    """A mention seen within VIOLATION_MERGE_S of an earlier one is the same action; not coming back is a new thing."""
    c, clock = _away()
    first = c.on_proctor("fullscreen_exit", 0.5, 1)         # half a violation: a mention, not counted
    assert first.kind == "mention_violation" and c.full_violations == 0
    clock.advance(1)
    c.start_return_clock(clock())
    clock.advance(AWAY_RETURN_S)
    [order] = [o for o in c.tick() if o.kind in ("final_warning", "mention_violation")]
    assert order.kind == "mention_violation" and matches("away_overstay:mention_violation", order.line) and c.full_violations == 1


def test_the_return_warning_that_is_the_third_violation_ends_the_interview_with_the_fixed_line():
    c, clock = make()
    c.on_proctor("tab_hidden", 1, 1)
    c.on_proctor("window_blur", 1, 2)
    c.on_away(["tab_hidden"])
    c.start_return_clock(clock())
    clock.advance(AWAY_RETURN_S)
    [order] = [o for o in c.tick() if o.kind == "end"]
    assert matches("proctor_end", order.line) and c.ended


def test_back_in_time_cancels_the_clock_and_a_clock_never_starts_without_a_warning():
    c, clock = _away()
    c.start_return_clock(clock())
    clock.advance(AWAY_RETURN_S - 1)
    c.on_back()
    clock.advance(30)
    assert not [o for o in c.tick() if o.kind != "nudge"]
    assert c.full_violations == 0 and c.away is None
    d, dclock = _away()                                     # nobody told them: the 4 s never starts, only the cap counts
    dclock.advance(20)
    assert not [o for o in d.tick() if o.kind in ("final_warning", "mention_violation", "end")] and d.full_violations == 0


def test_leaving_only_full_screen_or_the_share_has_the_looser_limit_from_the_start_of_the_episode():
    c, clock = _away(("fullscreen_exit",))
    assert c.away_warning_pending() is False                # no warning is needed for it: the web counts down from the start
    clock.advance(AWAY_LIMIT_SCREEN_S - 1)
    assert [o for o in c.tick() if o.kind in ("final_warning", "mention_violation")] == []
    clock.advance(1)
    assert [o.kind for o in c.tick() if o.kind in ("final_warning", "mention_violation")] == ["mention_violation"]
    c.on_away(["tab_hidden", "fullscreen_exit"])            # the tab is left later in the same episode: the strict limit latches
    assert c.away["tight"] is True


def test_still_away_at_the_cap_ends_the_interview_once_whatever_the_cause():
    c, clock = _away(("fullscreen_exit",))
    clock.advance(AWAY_CAP_S - 1)
    assert not c.ended and not [o for o in c.tick() if o.kind == "end"]
    clock.advance(1)
    ended = [o for o in c.tick() if o.kind == "end"]
    assert len(ended) == 1 and matches("proctor_end", ended[0].line) and c.ended and c.proctor[-1]["kind"] == "away_cap"
    assert c.live_summary()["screen_changes_weighted"] == 0.0           # the worker's own ledger entries are not screen changes


def test_the_away_episode_survives_a_restart():
    c, clock = _away()
    c.start_return_clock(clock())
    back = Conductor.restore(blueprint(), 3600, c.checkpoint(), None, clock, ["Java"])
    assert back.away == c.away


def test_the_fixed_line_that_ends_the_coding_is_only_an_acknowledgement_so_the_next_part_carries_the_close():
    """bf82d318 turns 24-25: the fixed line said the coding was left and the next turn's opening said "That wraps up the coding part."."""
    from app.interviewer.closing import closes_coding_part, announces_leaving
    from app.interviewer.conductor import CODING_OVER_LINE
    assert CODING_OVER_LINE == "Okay, that's fine."
    assert not closes_coding_part(CODING_OVER_LINE) and not announces_leaving(CODING_OVER_LINE)


def _short_blueprint(minutes: int, flag_bonus: bool = True) -> dict:
    """The blueprint prep builds for a coding round of this length (real arc, timeboxes and bonus flags), on the conductor fixtures."""
    from app.blueprint.context import build_context
    from app.blueprint.selection import SlotPlan
    from app.blueprint.stages import bonus_slots, plan_arc
    from tests.blueprint.fixtures import request
    ctx = build_context(request("dsa", round={"type": "dsa", "duration_mins": minutes}))
    arc, per_slot, deep = plan_arc(ctx, 2)
    plans = [SlotPlan("core-1", "core", 1, "first problem"), SlotPlan("core-2", "core", 2, "second problem")]
    core = next(a.timebox_mins for a in arc if a.phase == "core")
    bonus = bonus_slots(plans, {p.slot_id: per_slot for p in plans}, core, deep)
    bp = blueprint()
    bp["round"]["duration_mins"] = minutes
    bp["arc"] = [{"phase": a.phase, "timebox_mins": a.timebox_mins, "scored": a.scored, "guidance": ""} for a in arc]
    for s in bp["slots"]:
        if s["kind"] == "core":
            s["timebox_mins"] = per_slot
            if flag_bonus and s["slot_id"] in bonus:
                s["bonus"] = True
    return bp


def test_a_short_rounds_second_problem_is_not_reserved_so_free_time_at_the_start_is_never_negative():
    for minutes in (30, 35, 40, 45):
        c = Conductor(_short_blueprint(minutes), minutes * 60, clock=Clock(), skills=["Java"])
        c.start()
        assert c.free_seconds() >= 0, (minutes, c.free_seconds())
        assert [i.item_id for i in c.items if i.bonus] == (["core-2"] if minutes < 45 else [])
    # A blueprint prepared before the flag existed reserves both boxes exactly as it always did.
    old = Conductor(_short_blueprint(30, flag_bonus=False), 30 * 60, clock=Clock(), skills=["Java"])
    old.start()
    assert not any(i.bonus for i in old.items) and old.free_seconds() < 0


def test_a_bonus_problem_is_still_given_when_the_first_went_well_and_time_allows_but_not_when_it_struggled():
    for minutes in (30, 35):
        c = Conductor(_short_blueprint(minutes), minutes * 60, clock=(clock := Clock()), skills=["Java"])
        c.start()
        _on_problem(c)
        clock.advance(600)
        c.signals["core-1"] = "strong"
        assert c.will_skip_next_problem() is False, minutes
        c.next_item("t")
        assert c.current().item_id == "core-2" and not c.no_more_problems, minutes
        assert 180 <= c.current().max_seconds <= 15 * 60

        s = Conductor(_short_blueprint(minutes), minutes * 60, clock=(clock := Clock()), skills=["Java"])
        s.start()
        _on_problem(s)
        clock.advance(600)
        s.signals["core-1"] = "struggling"
        assert s.will_skip_next_problem() is True


def test_free_minutes_stay_available_for_optional_parts_early_in_a_short_round():
    c = Conductor(_short_blueprint(30), 30 * 60, clock=Clock(), skills=["Java"])
    c.start()
    assert c.free_seconds() >= 60          # the goto / open_thread / defer_topic refusals ("less than a minute is free") do not fire at the start


# ---------------------------------------------------------------- the outline's promises (decided 2026-10-18)

def _deep_dive(promises=("projects:Relay", "fundamentals:Java", "fundamentals:databases"), round_s=3600, realism=True):
    from tests.interviewer.fixtures import deep_dive_blueprint, realism_blueprint

    clock = Clock()
    c = Conductor(realism_blueprint(promises) if realism else deep_dive_blueprint(), round_s, clock=clock)
    c.start()
    while c.current().item_id != "deep_dive":
        c.next_item("done")
    c.set_candidate_speaking(True)           # an engaged candidate: no silence check-ins among the orders
    return c, clock


def test_the_promises_start_open_and_a_blueprint_without_realism_has_none():
    c, _ = _deep_dive()
    assert c.promises == {"projects:Relay": "open", "fundamentals:Java": "open", "fundamentals:databases": "open"}
    assert Conductor(blueprint(), 3600).promises == {} and _deep_dive(realism=False)[0].promises == {}


def test_a_deep_dive_turn_asking_about_sql_marks_databases_covered_and_the_rest_stay_open():
    c, _ = _deep_dive()
    assert c.mark_covered("On databases now: what is the difference between WHERE and HAVING in SQL?") == ["fundamentals:databases"]
    assert c.promises["fundamentals:databases"] == "covered" and c.uncovered() == ["projects:Relay", "fundamentals:Java"]
    assert c.mark_covered("Thanks, that makes sense.") == []                                  # asks nothing
    assert c.mark_covered("Let's go back to the Relay project: how did you handle the command history?") == ["projects:Relay"]


def test_naming_an_area_in_the_outline_itself_covers_nothing():
    c, _ = _deep_dive()
    outline = ("Here's how the round will run: first a short introduction, then a coding problem, after that some questions on Java and databases, "
               "and at the end time for your questions.")
    assert c.mark_covered(outline) == []
    c2, _ = make()
    assert c2.mark_covered("Can you explain how a Java HashMap works?") == []                # no promises: nothing to keep


def test_a_project_named_after_an_area_does_not_cover_that_area():
    c, _ = _deep_dive(("projects:React Dashboard", "fundamentals:React"))
    assert c.mark_covered("How did you structure the React Dashboard?") == ["projects:React Dashboard"]
    assert c.uncovered() == ["fundamentals:React"]


def test_the_conductor_refuses_to_leave_the_deep_dive_while_a_promise_is_open_and_the_round_has_time():
    c, _ = _deep_dive()
    c.current().turns = 3                                      # the part's own exchanges are had: only the promises hold it
    ok, why = c.can_advance()
    assert not ok and "you told them you would cover" in why and "Java" in why and "Relay" in why
    assert c.go_to("candidate_questions", "done")[0] is False
    assert c.current().item_id == "deep_dive"
    c.mark_covered("Tell me about the Relay project's schema.")
    c.mark_covered("How does a Java HashMap handle collisions?")
    assert c.can_advance()[0] is False                         # databases is still open
    c.mark_covered("What does SQL's HAVING do?")
    assert c.can_advance() == (True, "") and c.go_to("candidate_questions", "done") == (True, "")


def test_past_the_parts_own_time_the_next_open_promise_is_ordered_one_at_a_time_and_the_late_fallback_waits():
    c, clock = _deep_dive()
    c.current().turns = 3
    clock.advance(721)                                         # the deep dive's 12 minutes are up; the round still has a lot of time
    first = [o for o in c.tick() if o.kind == "open_item"]
    assert len(first) == 1 and "Relay" in first[0].text and "not yet counted as asked" in first[0].text and first[0].ask_for == "projects:Relay"
    assert not any(o.kind == "open_item" for o in c.tick())    # once per promise
    clock.advance(400)
    assert not any(o.kind == "move_on" for o in c.tick())      # the late fallback would end the part on its own: not past a promise
    c.mark_covered("Tell me about the Relay project's schema.")
    again = [o for o in c.tick() if o.kind == "open_item"]
    assert len(again) == 1 and "Java" in again[0].text


def test_when_time_runs_out_the_open_promises_are_dropped_with_one_sentence_naming_them_and_no_number():
    c, clock = _deep_dive(round_s=1200)
    c.mark_covered("Tell me about the Relay project's schema.")
    c.current().turns = 3
    clock.advance(850)                                         # the round's free time (what is left after the questions and the closing) is under a minute
    orders = c.tick()
    assert [o.kind for o in orders] == ["skip_notice", "move_on"]        # the notice is words to say; the move is the part's own end
    text = orders[0].text
    assert "short on time" in text and "Java" in text and "databases" in text and "Relay" not in text
    assert "one short sentence" in text and not any(ch.isdigit() for ch in text) and "minute" not in text
    assert c.promises == {"projects:Relay": "covered", "fundamentals:Java": "dropped", "fundamentals:databases": "dropped"}
    assert c.can_advance() == (True, "") and c.uncovered() == []
    assert not [o for o in c.tick() if o.kind in ("move_on", "skip_notice")]    # once


def test_the_drop_notice_and_the_late_fallback_never_fire_in_the_same_tick():
    c, clock = _deep_dive(round_s=3600)
    c.current().turns = 3
    clock.advance(3250)                                        # the round is almost out (free time gone) and far past the part's own time and flex
    orders = c.tick()
    assert [o.kind for o in orders].count("move_on") == 1 and [o.kind for o in orders].count("skip_notice") == 1
    assert not [o for o in c.tick() if o.kind == "move_on"]    # the fallback does not come after the pending move either


def test_a_skip_notice_is_never_set_aside_and_is_ordered_again_when_its_turn_did_not_say_it():
    c, clock = _deep_dive(round_s=1200)
    c.current().turns = 3
    clock.advance(850)
    notice = next(o for o in c.tick() if o.kind == "skip_notice")
    assert c.set_aside([notice], "stale") == [] and not notice.consumed
    c.consume([notice])
    assert not c.notice_said(notice, "Okay, let's talk about the team.")
    assert c.renew_notice(notice) and not notice.consumed
    c.consume([notice])
    assert c.notice_said(notice, "We're short on time, so I'll skip the Java and databases questions.")
    assert c.renew_notice(notice) and c.renew_notice(notice) is False        # tried enough


def test_a_deep_dive_with_no_exchange_yet_is_not_dropped_for_time_before_it_has_opened():
    c, clock = _deep_dive(round_s=1200)
    clock.advance(850)
    assert not [o for o in c.tick() if o.kind == "move_on"] and c.uncovered() == ["projects:Relay", "fundamentals:Java", "fundamentals:databases"]


def test_a_candidate_who_does_not_know_the_answer_still_leaves_the_area_covered_and_it_is_not_asked_again():
    c, _ = _deep_dive(("fundamentals:databases", "fundamentals:Java"))
    assert c.mark_covered("On databases now: what is the difference between WHERE and HAVING in SQL?") == ["fundamentals:databases"]
    c.on_candidate_turn()                                      # "I don't know": the answer is never read, only what was asked
    # The interviewer's next turn answers kindly and goes on: it names nothing it asks, so nothing changes.
    assert c.mark_covered("That's fine, it's a tricky one. Let's move on.") == []
    assert c.promises["fundamentals:databases"] == "covered" and c.uncovered() == ["fundamentals:Java"]
    assert c.mark_covered("Okay. How does a Java HashMap work?") == ["fundamentals:Java"]
    c.on_candidate_turn()
    assert c.mark_covered("And what is the difference between WHERE and HAVING in SQL?") == []      # nothing left to cover: never re-marked
    assert c.promises == {"fundamentals:databases": "covered", "fundamentals:Java": "covered"}


def test_the_closing_for_time_drops_what_is_left_with_a_notice_and_the_promises_survive_a_restart():
    c, clock = _deep_dive(round_s=1200)
    c.mark_covered("Tell me about the Relay project's schema.")
    restored = Conductor.restore(c.blueprint, 1200, c.checkpoint(), clock=clock)
    assert restored.promises == c.promises and restored.uncovered() == ["fundamentals:Java", "fundamentals:databases"]
    clock.advance(1000)                                        # no free time left
    restored.wrap_up_now(clock(), "round")
    closing = next(o for o in restored.pending_orders() if o.kind == "closing")                # the notice is folded into the closing's own order
    assert "short on time" in closing.text and "Java" in closing.text and "no number" in closing.text and not any(ch.isdigit() for ch in closing.text)
    assert not any(o.kind == "skip_notice" for o in restored.pending_orders())
    assert restored.uncovered() == [] and set(restored.promises.values()) == {"covered", "dropped"}


def test_the_directors_wrap_up_is_refused_while_a_promise_holds_and_leaves_them_open_when_the_round_has_time():
    c, clock = _deep_dive()
    c.current().turns = 3
    ok, why = c._apply_change({"op": "wrap_up", "reason": "time"})
    assert not ok and "you told them you would cover" in why and c.current().item_id == "deep_dive"
    # Closed from elsewhere with time to spare: nothing is claimed about a shortage, and the promises stay open for the trace check to say so.
    c2, _ = _deep_dive()
    c2.wrap_up_now(c2.clock(), "director")
    assert c2.uncovered() and not any(o.kind == "skip_notice" for o in c2.pending_orders())
    # Out of time: dropped with the notice.
    c3, clock3 = _deep_dive(round_s=1200)
    clock3.advance(1000)
    c3.wrap_up_now(clock3(), "director")
    assert not c3.uncovered() and "short on time" in next(o for o in c3.pending_orders() if o.kind == "closing").text


def test_only_what_the_deep_dive_asks_covers_a_promise_not_what_other_turns_or_a_lead_in_name():
    from app.interviewer.plan import opening_hint

    c, _ = _deep_dive()
    # The deep dive's own opening, as the order words it: the lead-in names every area, the question is about Relay.
    opening = ("That wraps up the coding part. Next, some questions about your Relay project, then a few quick fundamentals questions on Java "
               "and databases. In the Relay project you used SQLite and Claude API together. How did you design the data schema and handle "
               "persistence for the command history?")
    assert "Java and databases" in opening_hint(c.blueprint, "deep_dive") and c.mark_covered(opening) == ["projects:Relay"]
    # A turn that names a language or says what it saw on the resume asks about nothing.
    assert c.mark_covered("You mentioned Java earlier, but let me ask about something else. How did you test the schema changes?") == []
    assert c.mark_covered("You mentioned Java earlier, but let me ask about SQL. What is the difference between WHERE and HAVING?") == ["fundamentals:databases"]
    assert c.uncovered() == ["fundamentals:Java"]
    # The same words in the introduction or while coding cover nothing: only the deep dive keeps promises.
    c2, _ = make()
    c2.promises = {"fundamentals:Java": "open", "projects:Relay": "open"}
    assert c2.mark_covered("I see you built Relay with SQLite and Java. What are you working on now?") == []         # candidate_intro / greeting
    to_core(c2)
    assert c2.mark_covered("You can write it in Java if you like. How would you approach it?") == [] and c2.uncovered() == ["fundamentals:Java", "projects:Relay"]


def test_a_turn_that_never_played_or_was_cut_off_before_it_asked_gives_its_promises_back():
    c, _ = _deep_dive()
    done = c.mark_covered("On databases now: what is the difference between WHERE and HAVING in SQL?")
    assert c.covers("On databases now: what is the", ["fundamentals:databases"]) == []             # a cut-off that never reached the question
    c.reopen(done)
    assert c.uncovered() == ["projects:Relay", "fundamentals:Java", "fundamentals:databases"]
    c.reopen(["fundamentals:Java"])                                                                  # only a covered promise reopens: open ones are unchanged
    assert c.promises["fundamentals:Java"] == "open"


def test_a_blueprint_without_realism_leaves_the_deep_dive_exactly_as_before():
    c, _ = _deep_dive(realism=False)
    c.current().turns = 3
    assert c.can_advance() == (True, "") and c.mark_covered("How does a Java HashMap work?") == []


def test_the_order_that_puts_the_first_problem_up_in_a_with_outline_round_carries_the_promised_parts():
    from tests.interviewer.fixtures import deep_dive_blueprint, realism_blueprint

    bp = realism_blueprint(("fundamentals:Java", "projects:Relay"))
    bp["arc"][next(n for n, a in enumerate(bp["arc"]) if a["phase"] == "core")]["style"] = "with_outline"
    c = Conductor(bp, 3600, clock=Clock())
    c.start()
    while c.current().item_id != "core-1":
        c.next_item("done")
    text = [o for o in c.pending_orders() if o.kind == "open_item"][-1].text
    assert text.startswith("Before the problem, say in your own words") and "questions on Java" in text and "your Relay project" in text
    assert "never a number of minutes" not in text
    old = deep_dive_blueprint()
    old["arc"][next(n for n, a in enumerate(old["arc"]) if a["phase"] == "core")]["style"] = "with_outline"
    c2 = Conductor(old, 3600, clock=Clock())
    c2.start()
    while c2.current().item_id != "core-1":
        c2.next_item("done")
    assert "Before the problem, say in one sentence how the coding will run, then time for their questions" in \
        [o for o in c2.pending_orders() if o.kind == "open_item"][-1].text


def test_a_lead_in_that_lists_the_parts_never_covers_them_only_the_question_it_asks_does():
    relay = "How did you design the data schema and handle persistence for the command history?"
    for lead in ("That wraps up the coding part. Next, your Relay project, then Java and databases. " + relay,
                 "Next up: Relay, then Java and databases. " + relay,
                 "Next, your Relay project and then Java and databases: " + relay[0].lower() + relay[1:]):
        c, _ = _deep_dive()
        got = c.mark_covered(lead)
        assert set(got) <= {"projects:Relay"} and "fundamentals:Java" in c.uncovered() and "fundamentals:databases" in c.uncovered(), (lead, got)
    # a pool question covers its area whether or not a cue names it
    c, _ = _deep_dive()
    assert c.mark_covered("On databases now. What is the difference between WHERE and HAVING?") == ["fundamentals:databases"]      # the databases pool's own question
    assert c.mark_covered("Now Java. What happens when two keys collide in a HashMap?") == []                                      # a cue is no longer read


def test_the_directors_wrap_up_is_refused_from_any_part_while_a_promise_is_open_and_the_round_has_time():
    c, clock = _deep_dive()
    while c.current().item_id != "core-1":
        c.items[c.index].status = "pending"
        c = Conductor(c.blueprint, 3600, clock=clock)
        c.start()
        while c.current().item_id != "core-1":
            c.next_item("done")
    ok, why = c._apply_change({"op": "wrap_up", "reason": "time"})
    assert not ok and "you told them you would cover" in why and c.current().item_id == "core-1"
    clock.advance(3400)                                        # the round is out of time: the director may close it
    assert c._apply_change({"op": "wrap_up", "reason": "time"}) == (True, "")


def test_a_differently_worded_notice_is_recognised_and_nothing_is_renewed_into_the_closing():
    c, clock = _deep_dive(round_s=1200)
    c.current().turns = 3
    clock.advance(850)
    notice = next(o for o in c.tick() if o.kind == "skip_notice")
    for said in ("Time is tight, so I'll leave out the Java and databases questions.", "I'm running low on time, so no Java or SQL today.",
                 "We're out of time for the Java questions."):
        assert c.notice_said(notice, said), said
    assert not c.notice_said(notice, "Let's move on to your questions.")
    # the closing opens: the notice still owed is folded into the closing's own order, once, and is not pending any more
    c.consume([notice])
    notice.consumed = False
    while c.current().phase != "wrap_up":
        c.next_item("done")
    closing = next(o for o in c.pending_orders() if o.kind == "closing")
    assert "short on time" in closing.text and "Java" in closing.text and not any(o.kind == "skip_notice" for o in c.pending_orders())
    assert c.renew_notice(notice) is False                      # never renewed into the closing
    # an ending discards one too
    c2, clock2 = _deep_dive(round_s=1200)
    c2.current().turns = 3
    clock2.advance(850)
    n2 = next(o for o in c2.tick() if o.kind == "skip_notice")
    c2.on_end_request()
    assert n2.consumed and c2.renew_notice(n2) is False


def test_only_the_final_clause_that_asks_covers_a_promise_and_nothing_a_lead_in_or_deferral_names():
    relay = "how did you design the data schema and handle persistence for the command history?"
    deferrals = ["Okay, we'll get to Java later. How did you deploy Relay?",
                 "Let's come back to Java later. How did you deploy Relay?",
                 "Let's move to Java next. Before that, how did you deploy Relay?",
                 "We'll talk Java later. How did you deploy it?",
                 "Databases next, after this one. How did you deploy Relay?",
                 "Before we move to Java, how did you test Relay?",
                 "Java can wait. How did you deploy Relay?",
                 "Let's park Java for a minute. How did you deploy Relay?",
                 "How did you deploy Relay, before we get to Java?",
                 "How did you deploy Relay before we move to Java?",
                 "How did you deploy Relay, and we'll do Java next?",
                 "Tell me how you deployed Relay, then we'll move on to Java."]
    lists = ["Okay, so what's left is Relay, then Java and databases: " + relay,
             "Alright, what we'll do now is Relay, then Java and databases, so " + relay,
             "Next, your Relay project, then Java and databases; " + relay,
             "That wraps up the coding part. Next, your Relay project, then Java and databases. " + relay[0].upper() + relay[1:-1] + "...?",
             "Next up: Relay, then Java and databases. How did you design the data schema?",
             "Next, your Relay project and then Java and databases: " + relay,
             "Next, your Relay project, then Java and databases, so " + relay]
    for turn in deferrals + lists:
        c, _ = _deep_dive()
        got = c.mark_covered(turn)
        assert set(got) <= {"projects:Relay"} and {"fundamentals:Java", "fundamentals:databases"} <= set(c.uncovered()), (turn, got)
    # the deferrals that ask about the project do cover it, by the project's name in the question
    c, _ = _deep_dive()
    assert c.mark_covered("Java can wait. How did you deploy Relay?") == ["projects:Relay"]
    # a trailing deferral is cut: these cover the project the question names and never the area it defers
    for turn in deferrals[-4:]:
        c, _ = _deep_dive()
        assert c.mark_covered(turn) == ["projects:Relay"], turn
    # what the final clause names covers
    for turn, area in (("Switching to Java: what's a checked exception in Java?", "fundamentals:Java"),
                       ("What's the difference between an interface and an abstract class in Java?", "fundamentals:Java"),
                       ("Why did you pick WebSockets for Relay?", "projects:Relay")):
        c, _ = _deep_dive()
        assert c.mark_covered(turn) == [area], turn
    for turn in ("Next, Java. What happens when two keys collide in a HashMap?",
                 "Let's move to Java next. How does garbage collection work?", "Finally, Java. How does garbage collection work?"):
        c, _ = _deep_dive()
        assert c.mark_covered(turn) == [], turn         # false misses, accepted: the area is named only outside the clause that asks


def test_a_short_topic_lead_in_right_before_the_question_counts_and_nothing_that_defers_or_lists_does():
    for turn, area in (("On Java now: how does a HashMap work under the hood?", "fundamentals:Java"),
                       ("In Java, what is a checked exception?", "fundamentals:Java"),
                       ("On the database side \u2014 how would you index this table?", "fundamentals:databases"),
                       ("For databases, how would you find customers with more than five orders?", "fundamentals:databases"),
                       ("Switching to Java: how does a HashMap store its entries?", "fundamentals:Java"),
                       ("Moving to Java, what's the JVM?", "fundamentals:Java"),
                       ("On Relay: why SQLite?", "projects:Relay")):
        c, _ = _deep_dive()
        assert area in c.mark_covered(turn), turn
    for turn in ("Skipping Java for now, how did you deploy it?", "Java can wait, how did you deploy it?", "For Java and databases, how did you deploy it?",
                 "Before we move to Java, how did you deploy it?", "On Java next, how did you deploy it?", "On Java later, how did you deploy it?",
                 "In Java and SQL, how did you deploy it?", "For Relay, Java and databases, how did you deploy it?"):
        c, _ = _deep_dive()
        got = c.mark_covered(turn)
        assert "fundamentals:Java" not in got and "fundamentals:databases" not in got, (turn, got)


def test_an_order_to_ask_about_a_promise_covers_it_when_the_next_turn_asks_whatever_the_words_and_no_skip_notice_follows():
    c, clock = _deep_dive(round_s=2700)                               # a 45-minute round
    c.promises["projects:Relay"] = c.promises["fundamentals:databases"] = "covered"
    c.current().turns = 3
    clock.advance(c.current().max_seconds + 5)                        # the part's own time is spent: Java is ordered by name
    order = next(o for o in c.tick() if o.ask_for == "fundamentals:Java")
    assert "whose own words name it" in order.text and "not yet counted as asked" in order.text
    first = "Walk me through how an interface differs from an abstract class."            # a question the detector does not read as Java
    assert c.covers(first, ["fundamentals:Java"]) == []
    c.consume([order])
    assert c.mark_covered(first, [order]) == ["fundamentals:Java"] and c.uncovered() == [] and "fundamentals:Java" in c.by_order
    assert c.mark_covered("Thanks. What about that?") == []                                 # nothing left: never re-marked, never looped
    clock.advance(1500)
    assert not [o for o in c.tick() if o.kind == "skip_notice"]
    # an order the turn took but whose turn asked nothing covers nothing
    c2, clock2 = _deep_dive(round_s=2700)
    c2.promises["projects:Relay"] = c2.promises["fundamentals:databases"] = "covered"
    c2.current().turns = 3
    clock2.advance(c2.current().max_seconds + 5)
    o2 = next(o for o in c2.tick() if o.ask_for)
    c2.consume([o2])
    assert c2.mark_covered("Okay, that makes sense.", [o2]) == [] and c2.uncovered() == ["fundamentals:Java"]
    # a cut-off after the question began keeps a directed cover; one that never reached a question does not
    c3, _ = _deep_dive(round_s=2700)
    c3.promises["projects:Relay"] = c3.promises["fundamentals:databases"] = "covered"
    o3 = c3._order("open_item", "x", 0.0)
    o3.ask_for = "fundamentals:Java"
    assert c3.mark_covered(first, [o3]) == ["fundamentals:Java"]
    assert c3.still_covers("Walk me through how an interface differs?", "fundamentals:Java") and not c3.still_covers("Okay, so", "fundamentals:Java")


def test_a_refused_move_directs_the_interviewer_and_the_first_question_after_it_covers_the_promise_so_three_different_questions_never_loop():
    c, clock = _deep_dive(round_s=2700)
    c.promises["projects:Relay"] = c.promises["fundamentals:databases"] = "covered"
    c.current().turns = 3
    ok, why = c.go_to("candidate_questions", "done")
    assert not ok and "whose own words name the Java questions" in why and "different from any question already asked" in why
    # the turn that tried to move: whatever it said in that turn is not the answer to the refusal
    assert c.mark_covered("Thanks, that makes sense. Anything you'd like to add?") == [] and c.uncovered() == ["fundamentals:Java"]
    assert c.mark_covered("How would an interface and an abstract class differ?") == ["fundamentals:Java"]              # the question after the refusal
    assert c.uncovered() == [] and c.can_advance() == (True, "")
    clock.advance(1700)
    assert not [o for o in c.tick() if o.kind == "skip_notice"]


def test_a_question_that_matches_a_pool_question_covers_its_promise_without_naming_the_area():
    c, _ = _deep_dive()
    assert "fundamentals:Java" in c.covers("Can you explain how a HashMap works internally?", c.uncovered())          # the Java pool's own question
    assert c.covers("How would you index this table?", ["fundamentals:databases"]) == []
    pool = {"prompt": "How would you index this table, and when does an index hurt?", "covers": "SQL indexes"}
    c.blueprint["personalization"]["round_questions"].append(pool)
    assert c.covers("How would you index this table?", ["fundamentals:databases"]) == ["fundamentals:databases"]


def test_a_skip_notice_consumed_by_the_turn_that_also_moved_into_the_closing_is_folded_into_the_closing_once():
    c, clock = _deep_dive(round_s=1200)
    c.current().turns = 3
    clock.advance(850)
    notice = next(o for o in c.tick() if o.kind == "skip_notice")
    c.consume([notice])                                         # the turn that carried it ends up moving the plan on into the wrap-up
    while c.current().phase != "wrap_up":
        c.next_item("done")
    closing = next(o for o in c.pending_orders() if o.kind == "closing")
    assert "short on time" not in closing.text                  # the notice was consumed before the closing opened: nothing folded yet
    assert c.renew_notice(notice) is True and "short on time" in closing.text and "Java" in closing.text
    assert closing.text.count("short on time") == 1 and c.renew_notice(notice) is False and not any(o.kind == "skip_notice" for o in c.pending_orders())


# ------------------------------------------------------------------ final review wave (decided 2026-10-18)

def test_a_wrap_up_refused_from_the_coding_does_not_make_the_deep_dives_first_question_cover_a_promise():
    """I2: the director's wrap-up refused from the coding set `_directed`; mark_covered returned early outside the deep dive without clearing it, so the
    deep dive's opener (any question) covered the first open promise."""
    from tests.interviewer.fixtures import realism_blueprint

    clock = Clock()
    c = Conductor(realism_blueprint(), 3600, clock=clock)
    c.start()
    while c.current().item_id != "core-1":
        c.next_item("done")
    ok, why = c._apply_change({"op": "wrap_up", "reason": "time"})
    assert not ok and "you told them you would cover" in why
    assert c._directed == ""                                                       # a refusal outside the deep dive directs nothing
    c.mark_covered("Okay, thanks.")
    c.mark_covered("Good.")
    while c.current().item_id != "deep_dive":
        c.current().turns = 5
        c.next_item("done")
    assert c.mark_covered("What did you enjoy most about that team?") == []
    assert c.uncovered() == ["projects:Relay", "fundamentals:Java", "fundamentals:databases"]
    # a refusal made inside the deep dive still directs the first question after it
    c.current().turns = 3
    assert c.go_to("candidate_questions", "done")[0] is False and c._directed == "projects:Relay"
    c.mark_covered("Okay.")
    c.mark_covered("Right.")
    assert c.mark_covered("What did you enjoy most about that team?") == ["projects:Relay"]
    # and a direction does not outlive the deep dive
    c2, _ = _deep_dive()
    c2.current().turns = 3
    assert c2.go_to("candidate_questions", "done")[0] is False and c2._directed
    c2.promises = {p: "covered" for p in c2.promises}
    c2.next_item("done")
    c2.mark_covered("Thanks.")
    assert c2._directed == ""


def test_a_check_or_clarification_does_not_cover_the_promise_an_order_asked_about():
    """I1: a turn that took an ask order covers its promise by any question; "Does that make sense?" is not the question asked."""
    from app.interviewer.conductor import Order
    c, _ = _deep_dive()
    order = Order("open_item", "ask about Java", 0.0, ask_for="fundamentals:Java")
    for check in ("Does that make sense?", "Okay. Any questions on that?", "Is that clear?", "Shall we go on?", "Sounds fair?"):
        assert c.mark_covered(check, [order]) == [], check
    assert c.promises["fundamentals:Java"] == "open"
    assert c.mark_covered("Walk me through how an interface differs from an abstract class.", [order]) == ["fundamentals:Java"]


def test_the_deep_dive_credits_a_topic_lead_before_the_first_break_and_a_pool_question_by_word_stems_run_b_seq_37_39_43():
    """I5: run_b asked API design 3-4 times: "On the API side now: at Zoho ... — how did you make those idempotent?" had its lead before the FIRST
    break, "On API design now: if you were to add ..., how would you ..." had it before the first of two, and a pool paraphrase used another word form."""
    c, _ = _deep_dive(("fundamentals:databases", "fundamentals:API design"))
    c.blueprint["personalization"]["round_questions"].append(
        {"prompt": "During your internship at Zoho you built REST endpoints for SLA policies. How did you ensure idempotency and proper error handling in those APIs?",
         "covers": "Fundamentals - API design", "what_it_tests": "api"})
    turns = ["On the API side now: at Zoho you built REST endpoints for SLA policies — how did you make those idempotent?",
             "Fair enough — that's an honest answer, and that's often how it goes in practice. On API design now: if you were to add proper idempotency to those SLA "
             "policy creation endpoints today, how would you go about it?",
             "Fair enough — and the concern angle is the right instinct there. On the API design side now: you mentioned the SLA endpoints at Zoho — apart from "
             "idempotency, how did you handle errors and validation in those APIs?"]
    for text in turns:
        c2, _ = _deep_dive(("fundamentals:databases", "fundamentals:API design"))
        assert c2.mark_covered(text) == ["fundamentals:API design"], text
    # a pool question asked with another word form of its words (idempotent / idempotency, policies / policy)
    assert c.mark_covered("How did you ensure those endpoints stayed idempotent for the policies?") == ["fundamentals:API design"]
    # every deferral, list and skip turn of the earlier tests stays excluded
    for text in ("We'll do API design later: how did you build those endpoints?", "On API design and databases now: how did you build the endpoints?",
                 "On the design side now: how did you structure the endpoints?", "I'll skip API design for now — tell me about the team — how big was it?"):
        c3, _ = _deep_dive(("fundamentals:databases", "fundamentals:API design"))
        assert "fundamentals:API design" not in c3.mark_covered(text), text


def test_a_sentence_initial_topic_lead_counts_only_when_nothing_between_it_and_the_ask_defers():
    """Owner-approved: "On Java now: I'll come back to that later - for now, how big was your team?" covers no Java."""
    for turn in ("On Java now: I'll come back to that later — for now, how big was your team?",
                 "On Java: let's park that for a moment — how big was the team?",
                 "In Java: I won't go there yet — what did your team ship?"):
        c, _ = _deep_dive()
        assert c.mark_covered(turn) == [], turn
    c, _ = _deep_dive()
    got = c.mark_covered("On databases now: we will skip that for now; how did you deploy Relay?")
    assert "fundamentals:databases" not in got and set(got) <= {"projects:Relay"}, got
    c, _ = _deep_dive()
    assert c.mark_covered("On Java now: you mentioned a HashMap earlier — how does it resize?") == ["fundamentals:Java"]


def test_a_deferral_between_a_sentence_initial_lead_and_the_ask_blocks_the_credit_but_an_ordinary_recap_does_not():
    """Owner-approved, narrowed by review: only deferral PHRASES between the lead and the asking clause count; and/not/first/also/then/after/done do not."""
    for turn in ("On Java now: let's table that — how big was your team?", "On Java now: we can revisit that — how big was your team?",
                 "On Java now: maybe another time — how big was your team?", "On Java now: I'll get back to it, how big was your team?",
                 "On Java now: we can hold off on that — how big was your team?", "On Java now: that can wait — how big was your team?"):
        c, _ = _deep_dive()
        assert "fundamentals:Java" not in c.mark_covered(turn), turn
    for turn, area in (("On the API side now: at Zoho you built REST endpoints and an SLA dashboard — how did you make those idempotent?", "fundamentals:API design"),
                       ("On API design now: if you were to add idempotency and retries to those SLA endpoints today, how would you go about it?", "fundamentals:API design"),
                       ("On API design now: you said the endpoints were not idempotent at first — how would you fix that?", "fundamentals:API design"),
                       ("On API design now: you also built a webhook layer — how did you secure it?", "fundamentals:API design"),
                       ("On Java now: you used Spring Boot and Hibernate at Zoho — how does dependency injection work there?", "fundamentals:Java"),
                       ("On Java now: you mentioned the endpoints were done in Spring — how does dependency injection work there?", "fundamentals:Java"),
                       ("On Java now: you built them after joining Zoho — how does dependency injection work there?", "fundamentals:Java")):
        c, _ = _deep_dive(("fundamentals:databases", "fundamentals:API design", "fundamentals:Java"))
        assert area in c.mark_covered(turn), turn
