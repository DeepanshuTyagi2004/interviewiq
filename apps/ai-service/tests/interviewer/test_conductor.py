"""The conductor: walking the plan, time limits, silence, proctoring, conduct, briefs, checkpoints."""
from app.interviewer.conductor import Conductor
from tests.interviewer.fixtures import Clock, blueprint


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
    c, clock = make()
    to_core(c)
    c.set_candidate_speaking(True)  # an engaged candidate: no silence nudges muddy the time orders
    clock.advance(960)
    assert [o.kind for o in c.tick()] == ["converge"]
    clock.advance(240)
    assert c.tick() == []
    clock.advance(59)
    assert c.tick() == []
    clock.advance(1)
    assert [o.kind for o in c.tick()] == ["move_on"]
    assert c.tick() == []


def test_moves_on_at_once_when_the_candidate_is_quiet():
    c, clock = make()
    to_core(c)
    c.on_code_change()
    clock.advance(1200)
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
    c, _ = make()
    assert c.on_proctor("fullscreen_exit", 0.5, 1).kind == "mention_violation"
    assert c.on_proctor("tab_hidden", 1, 2).kind == "mention_violation"
    assert c.on_proctor("share_stopped", 0.5, 3).kind == "mention_violation"
    assert c.on_proctor("window_blur", 1, 4).kind == "final_warning"
    order = c.on_proctor("tab_hidden", 1, 5)
    assert order.kind == "end" and order.end_reason == "ended_by_interviewer" and c.ended


def test_conduct_warns_then_ends_and_counts_one_incident_per_turn():
    c, _ = make()
    assert c.on_conduct("inappropriate", "…", "t1", "talker").kind == "conduct_warning"
    assert c.on_conduct("inappropriate", "…", "t1", "director") is None
    assert c.on_conduct("abusive", "…", "t2", "talker").kind == "end"


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
    clock.advance(61)              # the greeting's minute is up
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
    clock.advance(1260)
    assert "connecting phrase" in next(o for o in c.tick() if o.kind == "move_on").text


def _worked_on_core_1(c, clock, seconds=600, turns=6):
    to_core(c)
    c.current().turns = turns
    clock.advance(seconds)


def test_a_candidate_who_has_worked_on_the_problem_is_told_to_keep_it_and_that_a_partial_solution_is_fine():
    c, clock = make()
    _worked_on_core_1(c, clock)
    assert c.can_swap_on_request() is False
    order = c.on_change_request()
    assert order.kind == "keep_problem" and "partial solution is perfectly fine" in order.text and "no question" in order.text
    assert c.current().item_id == "core-1" and c.change_requests == {"core-1": 1}


def test_a_candidate_who_has_barely_started_gets_a_different_problem_which_is_still_their_first():
    c, clock = make()
    to_core(c)
    c.labels["core-1"] = "Problem 1"
    c.current().turns = 1
    clock.advance(30)
    assert c.can_swap_on_request() is True
    order = c.on_change_request()
    assert c.current().item_id == "reserve-alternate" and next(i for i in c.items if i.item_id == "core-1").status == "swapped"
    assert order.kind == "open_item" and "different one" in order.text and "Here's your first question." in order.text
    assert c.labels["reserve-alternate"] == "Problem 1"


def test_asking_again_ends_the_problem_kindly_skips_the_second_and_links_to_the_next_part():
    c, clock = make()
    _worked_on_core_1(c, clock)
    c.on_change_request()
    order = c.on_change_request()
    assert order.kind == "move_on" and "Do not argue" in order.text and "connecting phrase" in order.text
    assert c.signals["core-1"] == "struggling" and c.will_skip_next_problem() is True
    c.next_item("move_on")
    assert next(i for i in c.items if i.item_id == "core-2").status == "skipped" and c.current().item_id == "candidate_questions"


def test_a_request_to_write_in_their_editor_is_declined_in_one_sentence_with_no_follow_up():
    c, _ = make()
    order = c.on_edit_request()
    assert order.kind == "decline_request" and "Decline in one short sentence" in order.text and "do not ask a question" in order.text


def test_the_count_of_change_requests_survives_a_restart():
    c, clock = make()
    _worked_on_core_1(c, clock)
    c.on_change_request()
    restored = Conductor.restore(blueprint(), 3600, c.checkpoint(), None, clock, ["Java"])
    assert restored.change_requests == {"core-1": 1}
    assert restored.on_change_request().kind == "move_on"
