"""The final review's fixes: what comes next after a thread, order-aware texts, restore, grants, and the smaller rulings."""
import asyncio
import re

from app.blueprint.vocabulary import family
from app.interviewer.brief import Brief
from app.interviewer.conductor import Conductor
from app.interviewer.plan import opening_hint
from app.interviewer.prompts import item_details, state_block
from tests.interviewer.fakes import state_of
from tests.interviewer.fixtures import Clock, blueprint, context
from tests.interviewer.test_conductor import _with_chat, make
from tests.interviewer.test_run import _go_to, make as make_run, say, speak


def _thread_in(c: Conductor, parent_turns: int = 3, minutes: int = 3) -> None:
    c.current().turns = parent_turns
    assert c.open_thread("their migration", "they led it", minutes)[0]


def _in_intro(bp: dict | None = None) -> tuple[Conductor, Clock]:
    clock = Clock()
    c = Conductor(bp or blueprint(), 3600, clock=clock)
    c.start()
    c.current().turns = 5
    c.next_item("done")
    assert c.current().item_id == "candidate_intro"
    return c, clock


def _resume_opener() -> dict:
    bp = blueprint()
    bp["shape_id"] = "resume_opener"
    bp["arc"] = [{"phase": "greeting", "timebox_mins": 1, "scored": False, "guidance": "Greet."},
                 {"phase": "candidate_intro", "timebox_mins": 4, "scored": True, "style": "pointed_resume", "guidance": "Ask."},
                 {"phase": "framing", "timebox_mins": 1, "scored": False, "style": "one_line", "guidance": "Outline."},
                 {"phase": "core", "timebox_mins": 34, "scored": True, "guidance": ""},
                 {"phase": "candidate_questions", "timebox_mins": 4, "scored": True, "guidance": "Invite."},
                 {"phase": "wrap_up", "timebox_mins": 1, "scored": False, "guidance": "Close."}]
    bp["personalization"]["resume_probes"] = [{"prompt": "First probe.", "grounded_in": "projects", "what_it_tests": "x"},
                                              {"prompt": "Second probe.", "grounded_in": "projects", "what_it_tests": "x"}]
    return bp


def _phase_item(phase: str, **extra) -> dict:
    return {"item_id": phase, "kind": "phase", "phase": phase, "hint_step": 0, **extra}


# ---------------------------------------------------------------- A. what comes next

def test_a_thread_closed_to_the_coding_ends_the_part_it_paused_and_it_never_comes_back():
    c, _ = _in_intro()
    _thread_in(c)
    assert c.close_thread("ready to code", target="core-1") == (True, "")
    intro = next(i for i in c.items if i.item_id == "candidate_intro")
    assert (intro.status, intro.ended_by) == ("done", "interviewer: ready to code")
    c.next_item("done")
    assert c.next_item("done").item_id == "candidate_questions"


def test_a_thread_in_small_talk_closed_to_the_introduction_never_brings_the_small_talk_back():
    clock = Clock()
    c = Conductor(_with_chat(), 3600, clock=clock)
    c.start()
    c.current().turns = 1
    c.next_item("done")
    _thread_in(c, parent_turns=2)
    assert c.close_thread("ok", target="candidate_intro") == (True, "")
    c.current().turns = 2
    seen = []
    while (nxt := c.next_item("done")) is not None:
        seen.append(nxt.item_id)
    assert "small_talk" not in seen and seen == ["core-1", "core-2", "candidate_questions", "wrap_up"]


def test_a_thread_cannot_be_closed_past_a_must_cover_parent_that_has_not_had_its_exchanges():
    c, _ = make()
    c.current().turns = 5
    while c.current().item_id != "candidate_questions":
        c.current().turns = 5
        c.next_item("done")
    c.current().turns = 0
    assert c.open_thread("a tangent", "they raised it")[0]
    ok, why = c.close_thread("done", target="wrap_up")
    assert not ok and "0 of 1 exchanges" in why
    assert next(i for i in c.items if i.item_id == "candidate_questions").status == "pending"


def test_inside_a_thread_the_next_part_line_says_to_pick_the_paused_part_up_not_to_open_it():
    run, _, _ = make_run([])
    c = run.conductor
    _go_to(run, "candidate_intro")
    c.consume(c.pending_orders())
    _thread_in(c)
    view = run._view([], [])
    text = state_block(view)
    assert "pick up where you left off" in text and "no new opening question" in text
    assert "open it in that same turn" not in text and "short introduction" not in view["next_part"]["hint"]


def test_the_move_on_order_of_a_thread_picks_the_paused_part_up_without_a_new_opening():
    c, clock = _in_intro()
    _thread_in(c)
    text = c.move_on_order(c.current(), clock()).text
    assert "pick up where you left off" in text and "open it with its first question" not in text


def test_in_a_resume_opener_the_introduction_does_not_link_to_the_coding_and_the_framing_does_not_ask_for_an_introduction():
    bp = _resume_opener()
    intro = item_details(bp, _phase_item("candidate_intro"))
    assert "Link to the coding" not in intro and "move on" in intro
    framing = item_details(bp, _phase_item("framing"))
    assert "ask for their introduction" not in framing and "Before we get going" not in framing


def test_the_details_follow_what_the_run_says_comes_next_not_the_arc():
    bp = blueprint()
    plain = item_details(bp, _phase_item("candidate_intro"))
    assert "Link to the coding" in plain                                   # the classic order: the coding is next
    after = item_details(bp, _phase_item("candidate_intro", style="after_coding", next_phase="candidate_questions"))
    assert "Link to the coding" not in after


def test_a_classic_introduction_reached_after_the_coding_is_opened_as_an_after_coding_part():
    c, _ = make()
    c.current().turns = 5
    assert c.go_to("core-1", "they want to start coding")[0]
    c.next_item("done")
    c.consume(c.pending_orders())
    c.next_item("done")
    assert c.current().item_id == "candidate_intro" and c.style_of(c.current()) == "after_coding"
    text = " ".join(o.text for o in c.pending_orders())
    assert "Now let's talk a bit about you." in text and "before the coding" not in text.lower()
    assert "Link to the coding" not in item_details(c.blueprint, _phase_item("candidate_intro", style=c.style_of(c.current()), next_phase="candidate_questions"))


def test_a_framing_already_said_that_is_followed_by_the_coding_does_not_ask_for_an_introduction():
    c = Conductor(_resume_opener(), 3600, clock=Clock())
    c.start()
    c.outline_said = True
    c.current().turns = 5
    c.next_item("done")
    c.consume(c.pending_orders())
    c.current().turns = 5
    c.next_item("done")
    assert c.current().item_id == "framing"
    assert "introduction" not in " ".join(o.text for o in c.pending_orders())


def test_wrap_up_now_skips_every_pending_part_including_ones_behind_and_the_closing_opens_nothing():
    c, clock = make()
    c.current().turns = 5
    assert c.go_to("core-1", "they want to start coding")[0]
    c.wrap_up_now(clock(), "director")
    c.consume(c.pending_orders())
    c.close_out()
    intro = next(i for i in c.items if i.item_id == "candidate_intro")
    assert intro.status == "skipped" and intro.ended_by == "director" and c.ended
    assert not any(o.kind == "open_item" for o in c.orders[-3:])


def test_wrap_up_from_a_thread_leaves_the_paused_part_skipped_not_reopened_by_the_closing():
    c, clock = _in_intro()
    _thread_in(c)
    seen = len(c.orders)
    c.apply_brief({"for_position": c.position, "plan_changes": [{"op": "wrap_up"}]})
    c.close_out()
    assert next(i for i in c.items if i.item_id == "candidate_intro").status == "skipped"
    assert not any(o.kind == "open_item" for o in c.orders[seen:])


def test_a_stale_brief_for_the_same_part_still_applies_its_move_on_and_wrap_up():
    c, _ = _in_intro()
    stale = c.position
    c.note_flow_move()
    out = c.apply_brief({"for_position": stale, "plan_changes": [{"op": "move_on"}]})
    assert out["stale"] and [ch["op"] for ch in out["applied"]] == ["move_on"]
    out = c.apply_brief({"for_position": stale, "plan_changes": [{"op": "wrap_up"}]})
    assert [ch["op"] for ch in out["applied"]] == ["wrap_up"] and c.current().phase == "wrap_up"


# ---------------------------------------------------------------- B. coverage and robustness

def test_a_checkpoint_from_before_goals_takes_must_cover_from_the_blueprint_so_problems_cannot_be_skipped():
    c, clock = make()
    c.next_item("done")
    data = c.checkpoint()
    for item in data["items"]:
        for key in ("must", "origin", "why", "title", "parent", "style"):
            item.pop(key, None)
    back = Conductor.restore(blueprint(), 3600, data, clock=clock)
    by_id = {i.item_id: i for i in back.items}
    assert by_id["core-1"].must is True and by_id["candidate_questions"].must is True and by_id["greeting"].must is False
    assert back.skip_goal("core-1", "x")[0] is False


def test_minutes_the_director_grants_raise_the_time_for_the_next_problem_and_the_slack():
    c, _ = _in_intro()
    c.next_item("done")                                          # core-1
    before_next, before_slack = c._time_for_next_problem(), c.slack_s()
    c.apply_brief({"for_position": c.position, "plan_changes": [{"op": "extend", "minutes": 10}]})
    assert c._time_for_next_problem() - before_next == 600 and c.slack_s() - before_slack == 600


def test_the_director_clock_counts_granted_minutes():
    run, _, _ = make_run([])
    run.conductor.granted_s = 600
    msgs = asyncio.run(run._director_messages())
    clock = __import__("json").loads(msgs[1]["content"][0]["text"])["clock"]
    assert clock["round_min"] == 70 and clock["left_min"] == 70


def test_show_problem_from_a_thread_before_the_coding_puts_the_problem_up_and_ends_the_paused_part():
    async def go():
        run, _, _ = make_run([say("Let me put it up.", tools=(("show_problem", {}),))])
        await run.start(None)
        _go_to(run, "candidate_intro")
        run.conductor.consume(run.conductor.pending_orders())
        _thread_in(run.conductor, parent_turns=5)
        await speak(run, "sure")
        return run
    run = asyncio.run(go())
    assert run.conductor.current().item_id == "core-1" and run.d.workspace.cards
    assert next(i for i in run.conductor.items if i.item_id == "candidate_intro").status == "done"


def test_a_director_skip_of_a_must_cover_part_is_dropped_with_that_reason():
    c, _ = _in_intro()
    out = c.apply_brief({"for_position": c.position, "plan_changes": [{"op": "skip", "target": "core-2"}]})
    assert out["applied"] == [] and "must-cover parts are not skipped" in out["dropped"][0]["why"]
    assert next(i for i in c.items if i.item_id == "core-2").status == "pending"


def test_the_director_rules_say_skip_is_only_for_optional_parts():
    from app.interviewer.prompts import DIRECTOR_RULES
    assert re.search(r"skip[^.\n]*optional", DIRECTOR_RULES)


# ---------------------------------------------------------------- C. smaller fixes

def test_an_extra_or_give_up_reserve_problem_cannot_be_skipped_either():
    c, _ = _in_intro()
    c.next_item("done")
    next(i for i in c.items if i.item_id == "core-2").must = False
    ok, why = c.skip_goal("core-2", "x")
    assert not ok and "problems are not skipped" in why


def test_a_stale_brief_for_the_same_problem_still_sets_the_problem_signal():
    c, _ = _in_intro()
    c.next_item("done")
    stale = c.position
    c.note_flow_move()
    c.apply_brief({"for_position": stale, "problem_signal": "struggling"})
    assert c.signals["core-1"] == "struggling"


def test_a_fresh_brief_whose_own_change_moves_the_position_is_still_shown():
    async def go():
        run, _, _ = make_run([])
        await run.start(None)
        _go_to(run, "core-1")
        run.conductor.current().turns = 0
        run.conductor.consume(run.conductor.pending_orders())
        await run._on_brief(Brief.model_validate({"for_position": run.conductor.position, "goal": "x",
                                                  "plan_changes": [{"op": "use_reserve", "target": "reserve-alternate"}]}), {"triggers": []})
        return run
    run = asyncio.run(go())
    assert run.brief_for == run.conductor.position and run._view([], [])["brief"] is not None


def test_the_turn_record_keeps_the_free_minutes_the_talker_saw():
    async def go():
        run, deps, _ = make_run([say("Hi.", tools=(("next_item", {}),))])
        await run.start(None)
        await speak(run)
        return deps
    deps = asyncio.run(go())
    seen = int(re.search(r"Free minutes: (\d+)", state_of(deps.talker_chat.calls[0])).group(1))
    assert next(t for t in deps.store.turns if t["speaker"] == "interviewer")["free_min"] == seen


def test_the_rapport_small_talk_no_longer_forbids_the_work_question_it_asks():
    bp = blueprint()
    bp["arc"].insert(1, {"phase": "small_talk", "timebox_mins": 3, "scored": False, "style": "rapport", "guidance": ""})
    text = item_details(bp, _phase_item("small_talk"))
    assert "Do not mention their projects" not in text and "how it will run comes next" not in text
    assert "ask one light question about their work" in text


def test_the_one_line_outline_and_the_move_to_the_problem_name_the_part_by_the_round_family():
    dsa, beh = blueprint(), blueprint()
    beh["round"]["type"] = "behavioural"
    assert "some coding" in opening_hint(dsa, "framing", "one_line") and "some questions about your experience" in opening_hint(beh, "framing", "one_line")
    run, _, _ = make_run([])
    next(i for i in run.conductor.items if i.kind == "slot").style = "with_outline"
    assert "how the coding will run" in run._problem_hint(1)
    run.d.blueprint["round"]["type"] = "behavioural"
    hint = run._problem_hint(1)
    assert "how the questions will run" in hint and "coding" not in hint.split("connecting phrase")[0]
    assert family("lld") == "lld"


def test_opening_a_thread_is_refused_while_a_move_on_for_the_part_is_pending():
    c, clock = _in_intro()
    c.move_on_order(c.current(), clock())
    ok, why = c.open_thread("a tangent", "they raised it")
    assert not ok and "time is up for this part: move on first" in why
