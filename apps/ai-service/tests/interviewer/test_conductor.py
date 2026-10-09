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
