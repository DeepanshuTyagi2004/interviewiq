"""The interviewer decides what a request for another problem gets (decided 2026-10-18): the conductor's hard limits, the decision call and its
fallback, and the run executing the decision before the talker speaks."""
import asyncio
import time

from app.interviewer.change_decision import ACTIONS, decide_change, fallback_action
from app.interviewer.closing import refusal_points
from app.interviewer.conductor import CHANGE_CAP, MIN_SECOND_PROBLEM_S, Conductor
from tests.interviewer.fakes import FakeChat, say
from tests.interviewer.fixtures import Clock, _slot, blueprint
from tests.interviewer.test_conductor import _worked_on_core_1, ask, make, to_core

ALL = frozenset(ACTIONS)
PERSONA = {"seed": 1, "change": {"firmness": "normal", "refusals_prior": 1}}
CALL = dict(firmness="normal", refusals_problem=1, refusals_round=1, changes_round=0, candidate_text="can we change it", attempted=True, minutes_left=30.0)


def _resisted(c):
    """The first ask on the current problem, resisted."""
    allowed = c.on_change_request()
    assert allowed == {"resist"}
    c.apply_change_action("resist")


# ------------------------------------------------------------------ the conductor's hard limits

def test_change_is_not_allowed_before_any_refusal_and_end_coding_not_before_one_on_this_problem():
    c, clock = make()
    _worked_on_core_1(c, clock)
    assert CHANGE_CAP == 1 and c.on_change_request() == frozenset({"resist"})
    c.apply_change_action("resist")
    assert c.on_change_request() == ALL


def test_a_change_the_model_picks_before_a_refusal_is_a_resist():
    c, clock = make()
    _worked_on_core_1(c, clock)
    c.on_change_request()
    assert c.apply_change_action("change").kind == "keep_problem" and c.current().item_id == "core-1" and not c.change_given
    d, dclock = make()
    _worked_on_core_1(d, dclock)
    d.on_change_request()
    assert d.apply_change_action("end_coding").kind == "keep_problem" and not d.no_more_problems       # nor the end of the coding


def test_after_the_rounds_one_change_it_is_resist_or_end_coding_only():
    c, clock = make()
    _worked_on_core_1(c, clock)
    _resisted(c)
    c.on_change_request()
    assert c.apply_change_action("change").kind == "move_on" and c.change_given
    c.next_item("move_on")
    c.current().turns = 0
    assert c.on_change_request() == frozenset({"resist"})              # a refusal first on the new problem
    c.apply_change_action("resist")
    assert c.on_change_request() == frozenset({"resist", "end_coding"})   # the cap is spent: no change


def test_no_change_with_under_480_seconds_left():
    c, clock = make()
    _worked_on_core_1(c, clock, seconds=3000)
    assert MIN_SECOND_PROBLEM_S == 480.0
    _resisted(c)
    assert c.on_change_request() == frozenset({"resist", "end_coding"})


def test_no_change_when_only_the_harder_reserve_is_left_to_give():
    bp = blueprint()
    bp["slots"] = [x for x in bp["slots"] if x["slot_id"] != "reserve-alternate"] + [_slot("reserve-harder", "reserve", 4, "Skyline")]
    clock = Clock()
    c = Conductor(bp, 3600, clock=clock, skills=["Java"])
    c.start()
    to_core(c)
    c.current().turns = 1
    clock.advance(30)
    next(i for i in c.items if i.item_id == "core-2").status = "skipped"
    _resisted(c)
    assert c.on_change_request() == frozenset({"resist", "end_coding"})


def test_nothing_is_allowed_once_the_coding_has_ended():
    c, clock = make()
    _worked_on_core_1(c, clock)
    _resisted(c)
    c.on_change_request()
    c.apply_change_action("end_coding")
    assert c.no_more_problems and c.allowed_change_actions() == frozenset() and c.on_change_request() is None


def test_a_resist_order_lists_the_points_already_made_and_the_state_survives_a_restart():
    c, clock = make()
    _worked_on_core_1(c, clock)
    c.on_change_request()
    first = c.apply_change_action("resist")
    assert "already said" not in first.text
    c.refusal_points |= refusal_points("A partial solution is perfectly fine. Let's see how far you get.")
    c.on_change_request()
    second = c.apply_change_action("resist")
    assert "partial fine" in second.text and "see how far" in second.text and "something new" in second.text
    back = Conductor.restore(blueprint(), 3600, c.checkpoint(), None, clock, ["Java", "SQL"])
    assert back.refusal_points == {"partial_fine", "see_how_far"} and back.refusals == {"core-1": 2} and back.changes_round == 0


def test_resisting_many_times_is_not_a_give_up_but_a_change_is():
    c, clock = make()
    _worked_on_core_1(c, clock)
    for _ in range(3):
        c.on_change_request()
        c.apply_change_action("resist")
    assert not c.gave_up(c.current()) and c.next_problem_after_give_up() is False
    c.on_change_request()
    c.apply_change_action("change")
    assert c.gave_up(c.current()) and c.signals["core-1"] == "struggling"


# ------------------------------------------------------------------ the prior

def test_a_blueprint_without_realism_follows_todays_rule_through_the_prior():
    c, clock = make()
    assert c.change_stance() == ("normal", 1)
    _worked_on_core_1(c, clock)
    assert ask(c).kind == "keep_problem"                                # the first ask is resisted
    order = ask(c)                                                       # the second is the round's change
    assert order.kind == "move_on" and c.change_given
    c.next_item("move_on")
    c.current().turns = 0
    assert ask(c).kind == "keep_problem"                                # after it, resist...
    assert ask(c).kind == "move_on" and c.no_more_problems              # ...then end the coding


def test_the_fallback_resists_until_the_persona_gives_in_then_takes_what_is_allowed():
    assert fallback_action(1, 0, frozenset({"resist"})) == "resist"
    assert fallback_action(2, 1, ALL) == "resist" and fallback_action(2, 2, ALL) == "change"
    assert fallback_action(1, 1, frozenset({"resist", "end_coding"})) == "end_coding"
    assert fallback_action(1, 1, frozenset({"resist"})) == "resist"


def test_the_stance_comes_from_the_realism_block():
    bp = blueprint()
    bp["realism"] = {"change": {"firmness": "firm", "refusals_prior": 3}}
    assert Conductor(bp, 3600, clock=Clock(), skills=[]).change_stance() == ("firm", 3)


# ------------------------------------------------------------------ the decision call

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


def _decide(chat, allowed=ALL, **over):
    started = time.monotonic()
    out = asyncio.run(decide_change(chat, allowed=allowed, **{**CALL, **over}))
    return out, time.monotonic() - started


def test_the_model_answer_is_used_when_it_is_allowed():
    chat = Chat({"action": "change", "why": "stuck"})
    assert _decide(chat)[0] == ("change", "model")
    messages, name, max_tokens = chat.calls[0]
    assert name == "change_decision" and max_tokens <= 60
    asked = messages[-1]["content"]
    assert "can we change it" in asked and "normal" in asked and "end_coding" in asked and "yes" in asked


def test_a_slow_failing_or_out_of_bounds_decision_falls_back_within_1_3_seconds_and_never_outside_allowed():
    (action, source), took = _decide(Chat({"action": "change", "why": ""}, delay=3.0))
    assert (action, source) == ("change", "fallback") and took < 1.3                       # the prior: one refusal on this problem, so the change
    assert _decide(Chat(error=RuntimeError("boom")))[0] == ("change", "fallback")
    both = frozenset({"resist", "end_coding"})
    assert _decide(Chat({"action": "swap please", "why": ""}), allowed=both)[0] == ("end_coding", "fallback")
    assert _decide(Chat({"action": "change", "why": ""}), allowed=both)[0] == ("end_coding", "fallback")     # not allowed now
    assert _decide(Chat({"action": "change", "why": ""}), allowed=frozenset({"resist"}), refusals_problem=0)[0] == ("resist", "fallback")
    assert _decide(Chat(None))[0][1] == "fallback"


# ------------------------------------------------------------------ the run: decided and carried out before the talker speaks

def test_the_run_gives_the_change_the_model_chose_and_shows_the_problem_before_the_talker_speaks():
    from tests.interviewer.test_run import _round_with_two_problems, speak, state_of

    async def go():
        run, deps, clock = await _round_with_two_problems([say("I'd like you to stay with this one. Even a partial solution is fine.")], PERSONA)
        run.d.conduct_chat = Chat({"action": "change", "why": "stuck for long"})
        run.conductor.current().turns = 6
        clock.advance(600)
        out1 = await speak(run, "Can you change the problem?")
        out2 = await speak(run, "I really want another one, I'm stuck.")
        return run, deps, out1, out2

    run, deps, out1, out2 = asyncio.run(go())
    assert out1 and "[keep_problem]" in state_of(deps.talker_chat.calls[0])
    assert len(out2) == 1 and run.conductor.current().item_id == "core-2" and len(deps.talker_chat.calls) == 1   # the second turn never reached the talker
    assert [m["item_id"] for m in deps.workspace.of("panel.show_problem")][-1] == "core-2"
    [turn] = [t for t in deps.store.turns if t["speaker"] == "interviewer" and t.get("change_decision", {}).get("action") == "change"]
    assert turn["change_decision"]["source"] == "model" and isinstance(turn["change_decision"]["ms"], int)
    assert any(t.get("change_decision", {}).get("source") == "limit" for t in deps.store.turns)                  # the first ask had nothing to decide


def test_the_run_keeps_resisting_when_the_model_says_resist_and_ends_the_coding_when_it_says_so():
    from tests.interviewer.test_run import _round_with_two_problems, speak

    async def go(answers):
        run, deps, clock = await _round_with_two_problems([say("Let's stay with it."), say("Think about what a first step could be."), say("Okay, the projects.")],
                                                          PERSONA)
        run.d.conduct_chat = Chat()
        run.conductor.current().turns = 6
        clock.advance(600)
        await speak(run, "Can you change the problem?")
        for answer in answers:
            run.d.conduct_chat.answer = {"action": answer, "why": ""}
            out = await speak(run, "Please, another problem.")
        return run, out

    run, out = asyncio.run(go(["resist"]))
    assert run.conductor.current().item_id == "core-1" and not run.conductor.gave_up(run.conductor.current()) and run.conductor.refusals == {"core-1": 2}
    run, out = asyncio.run(go(["end_coding"]))
    assert run.conductor.no_more_problems and run.conductor.current().kind != "slot"


# ------------------------------------------------------------------ review fixes

def test_a_blueprint_without_realism_never_asks_the_model_and_follows_todays_rule_in_the_run():
    from tests.interviewer.test_run import _round_with_two_problems, speak
    from app.interviewer.lines import LINES, contains, matches

    async def go():
        run, deps, clock = await _round_with_two_problems([say("Stay with it, a partial solution is fine."), say("Let's keep going with this problem. Try the idea you trust most first.")])
        chat = run.d.conduct_chat = Chat({"action": "resist", "why": "would hold"})          # a model that would resist forever is never asked
        run.conductor.current().turns = 6
        clock.advance(600)
        outs = [await speak(run, "Can you change the problem?"), await speak(run, "I asked for another problem, actually."),
                await speak(run, "Can we change this one too?"), await speak(run, "I still want another one.")]
        return run, deps, chat, outs

    run, deps, chat, outs = asyncio.run(go())
    assert chat.calls == []
    assert contains("give_up", outs[1][0]) and matches("coding_over", outs[3][0])                # resist, change, resist, coding over
    c = run.conductor
    assert c.no_more_problems and c.changes_round == 1 and c.refusals == {"core-1": 1, "core-2": 1}
    sources = [t["change_decision"]["source"] for t in deps.store.turns if t.get("change_decision")]
    assert sources == ["limit", "prior", "limit", "prior"]


def test_a_natural_refusal_that_holds_firm_is_not_blocked_and_a_repeated_point_is():
    from tests.interviewer.test_run import _round_with_two_problems, speak

    async def go():
        run, deps, clock = await _round_with_two_problems([
            say("I'd like you to stay with this one. A partial solution is fine, I want to see how far you get."),
            say("Let's stay with it for now. Even a rough first version helps me see how you think."),
            say("Let's keep going with this problem.")], PERSONA)
        run.d.conduct_chat = Chat({"action": "resist", "why": ""})
        run.conductor.current().turns = 6
        clock.advance(600)
        return run, deps, [await speak(run, "Can you change the problem?"), await speak(run, "Please, I really want another one.")]

    run, deps, (first, second) = asyncio.run(go())
    assert first == ["I'd like you to stay with this one.", "A partial solution is fine, I want to see how far you get."]
    assert "stay with it" in " ".join(second).lower() and run.conductor.refusal_points >= {"partial_fine", "see_how_far"}
    assert "partial_fine" in run.conductor.refusal_points and "stay_with_it" not in run.conductor.refusal_points


def test_nothing_is_counted_or_ordered_when_the_coding_has_ended_and_next_problem_after_give_up_is_false_then():
    c, clock = make()
    _worked_on_core_1(c, clock)
    _resisted(c)
    c.on_change_request()
    c.apply_change_action("end_coding")
    assert c.apply_change_action("resist") is None and c.refusals == {"core-1": 1}
    assert not [o for o in c.orders if o.kind == "keep_problem"][1:]
    assert c.next_problem_after_give_up() is False
    d, dclock = make()
    _worked_on_core_1(d, dclock)
    _resisted(d)
    d.on_change_request()
    d.apply_change_action("change")
    assert d.change_given and Conductor.change_given.fset is None                       # read only: the count is the state


def test_the_conduct_check_and_the_change_decision_run_side_by_side_and_an_ending_stops_the_change():
    from tests.interviewer.test_run import _round_with_two_problems, speak

    class Slow(Chat):
        async def json(self, messages, schema_name, schema, max_tokens=3000):
            await asyncio.sleep(0.3)
            return (self.verdict if schema_name == "conduct_check" else self.answer), {}

    async def go(verdict, said="This is a stupid problem, change it now, damn it"):
        run, deps, clock = await _round_with_two_problems([say("Stay with it."), say("I'm ending the interview.")], PERSONA)
        chat = run.d.conduct_chat = Slow({"action": "change", "why": ""})
        chat.verdict = verdict
        run.conductor.current().turns = 6
        clock.advance(600)
        await speak(run, "Can you change the problem?")
        started = time.monotonic()
        out = await speak(run, said)
        return run, out, time.monotonic() - started

    run, out, took = asyncio.run(go({"verdict": "none", "reason": ""}))
    assert took < 0.55 and run.conductor.change_given          # 0.3 + 0.3 in a row would be 0.6
    run, out, took = asyncio.run(go({"verdict": "abuse", "reason": "insult"}, "You idiot, change the problem now, you are useless"))
    assert run.conductor.ended and not run.conductor.change_given and run.conductor.refusals == {"core-1": 1}


def test_a_cancelled_reply_keeps_the_ask_pending_for_the_next_one():
    from tests.interviewer.test_run import _round_with_two_problems

    async def go():
        run, deps, clock = await _round_with_two_problems([say("Stay with it.")], PERSONA)
        run.d.conduct_chat = Chat({"action": "change", "why": ""}, delay=5.0)
        run.conductor.current().turns = 6
        clock.advance(600)
        run.conductor.on_change_request()
        run.conductor.apply_change_action("resist")
        run._note_request("Please, another problem.")
        assert run._change_pending == "Please, another problem."
        task = asyncio.ensure_future(run._decide_change())
        await asyncio.sleep(0.05)
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
        return run

    run = asyncio.run(go())
    assert run._change_pending == "Please, another problem." and not run.conductor.change_given


# ------------------------------------------------------------------ final review wave (decided 2026-10-18)

def test_an_overlapping_reply_cannot_decide_and_apply_the_same_ask_a_second_time():
    """M8: both replies saw the pending ask, both decided it and both applied an action: the ask was granted twice."""
    from tests.interviewer.test_run import _round_with_two_problems

    async def go():
        run, deps, clock = await _round_with_two_problems([say("Stay with it.")], PERSONA)
        run.d.conduct_chat = Chat({"action": "change", "why": ""}, delay=0.2)
        run.conductor.current().turns = 6
        clock.advance(600)
        run.conductor.on_change_request()
        run.conductor.apply_change_action("resist")
        run._note_request("Please, another problem.")
        first = asyncio.ensure_future(run._decide_change())
        await asyncio.sleep(0.05)
        assert run._change_pending is None and run._change_in_flight         # taken: nothing is pending for an overlapping reply
        assert run.skip_reply("okay") is False                              # and the ticker waits for the decision
        second = await run._decide_change()                                  # the overlapping reply decides nothing
        decision = await first
        run._apply_change(second)
        run._apply_change(decision)
        return run, second, decision

    run, second, decision = asyncio.run(go())
    assert second is None and decision is not None and decision[0] == "change"
    assert run.conductor.change_given and run.conductor.changes_round == 1 and not run._change_in_flight and run._change_pending is None


def test_a_change_that_cannot_be_applied_or_decided_never_breaks_the_reply():
    """M7: `_apply_change` was not wrapped, unlike `_note_request`: an exception stopped the reply."""
    from tests.interviewer.test_run import _round_with_two_problems

    async def go():
        run, deps, clock = await _round_with_two_problems([say("Stay with it.")], PERSONA)
        run.conductor.current().turns = 6
        clock.advance(600)

        def boom(action):
            raise RuntimeError("conductor exploded")

        run.conductor.apply_change_action = boom
        run._apply_change(("change", "model", clock()))                      # logged, not raised
        run.conductor.allowed_change_actions = lambda: (_ for _ in ()).throw(RuntimeError("no limits"))
        run._change_pending = "Please, another problem."
        out = await run._decide_change()
        return run, out

    run, out = asyncio.run(go())
    assert out is None and run._change_pending is None and not run._change_in_flight and not run.conductor.change_given
