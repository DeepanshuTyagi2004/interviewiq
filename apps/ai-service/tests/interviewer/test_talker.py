"""One talker turn: guarded sentences, tools after the text, the whiteboard follow-up, timeouts, interruption."""
import asyncio
import json
from types import SimpleNamespace

import pytest

from app.interviewer.conductor import Conductor
from app.interviewer.guard import NEUTRAL_LINE, LeakGuard
from app.interviewer.llm import LLMUnavailable
from app.interviewer.fillers import RECOVERY_APOLOGY, RECOVERY_SHORT, STAGES, Fillers
from app.interviewer.talker import Pacing, TalkerFailed, TalkerTurn
from app.interviewer.tools import ToolExecutor
from tests.interviewer.fakes import FakeChat, FakeWorkspace, say
from app.interviewer.plan import wire_ids
from tests.interviewer.fixtures import Clock, blueprint


def make(turns, timeout=0.2, fallback=None, **extra):
    bp = blueprint()
    conductor = Conductor(bp, 3600, clock=Clock(), skills=["Java"])
    conductor.start()
    conductor.next_item("done")
    conductor.next_item("done")  # now on core-1
    workspace = FakeWorkspace()
    run = SimpleNamespace(conductor=conductor, guard=LeakGuard(bp), actions={}, code_seen=None, candidate_said={}, wire=wire_ids(bp),
                          d=SimpleNamespace(blueprint=bp, workspace=workspace))
    chat = FakeChat(turns, model="primary")
    turn = TalkerTurn(chat, run.guard, ToolExecutor(run), first_token_timeout_s=timeout,
                      fallback=FakeChat(fallback, model="fallback") if fallback is not None else None, **extra)
    run.talker = turn                               # the tools read what was just said through the run's talker
    return turn, run, workspace, chat


async def collect(turn, **kw):
    return [s async for s in turn.run([{"role": "user", "content": "hi"}], turn_id="7", current_slot="core-1", candidate_said="", **kw)]


def test_speaks_sentences_then_runs_tools_and_records_the_decision():
    turn, run, ws, _ = make([say("Let's start with a problem.", "It's on your screen now.",
                                 tools=(("show_problem", {"item_id": "core-1"}),
                                        ("log_turn", {"condition": "none", "action": "ask", "reason": "opening"})))])
    spoken = asyncio.run(collect(turn))
    assert spoken == ["Let's start with a problem.", "It's on your screen now."]
    assert ws.of("panel.show_problem")[0]["label"] == "Problem 1"
    assert turn.last.decision == {"condition": "none", "action": "ask", "reason": "opening"}
    assert [c["name"] for c in turn.last.tool_calls] == ["show_problem"]


def test_show_problem_with_a_public_problem_id_puts_up_the_current_problem():
    turn, run, ws, _ = make([say("Here it is.", tools=(("show_problem", {"item_id": "problem-1"}),))])
    asyncio.run(collect(turn))
    assert ws.of("panel.show_problem")[0]["item_id"] == "core-1"
    assert run.conductor.resolve("problem-2") == "core-2"       # without resolve the refusal test below would pass for the wrong reason


def test_show_problem_naming_the_other_problem_by_its_public_id_is_refused():
    turn, run, ws, _ = make([say("Here it is.", tools=(("show_problem", {"item_id": "problem-2"}),))])
    asyncio.run(collect(turn))
    assert ws.of("panel.show_problem") == []


def test_blocked_sentences_are_dropped_and_a_neutral_line_fills_an_empty_turn():
    turn, *_ = make([say("This is the Pair Sum problem.")])
    assert asyncio.run(collect(turn)) == [NEUTRAL_LINE]
    assert turn.last.blocked[0]["rule"] == "name_or_topic"


def test_silent_turns_say_nothing():
    turn, *_ = make([say("<silent>")])
    assert asyncio.run(collect(turn)) == []


def test_hints_land_on_screen_and_code_comments_carry_the_expected_line():
    turn, run, ws, _ = make([say("Here's a nudge.", tools=(("show_problem", {}), ("give_hint", {"step": 1}),
                                                            ("code_comment", {"line": 2, "text": "Why a dict?", "purpose": "question"})))])
    ws.lines = ["def f(nums):", "    seen = {}"]
    asyncio.run(collect(turn))
    hint = ws.of("panel.add_section")[0]
    assert hint["section"]["kind"] == "hint" and hint["section"]["body"] == "What do you need to remember as you scan?"
    assert ws.of("code.comment")[0]["at"] == {"line": 2, "expect": "    seen = {}"}
    assert run.conductor.current().hint_step == 1


def test_look_at_board_adds_a_follow_up_with_the_image():
    turn, run, ws, chat = make([say("Let me take a look.", tools=(("look_at_board", {}),)), say("Nice diagram.")])
    ws.png = b"\x89PNG"
    assert asyncio.run(collect(turn)) == ["Let me take a look.", "Nice diagram."]
    image_part = chat.calls[1][-1]["content"][1]
    assert image_part["image_url"]["url"].startswith("data:image/png;base64,")


FAST = Pacing(hedge_after_s=0.05, filler_after_s=(0.06, 0.16, 0.3, 0.45), deadline_s=0.7, retry_gap_s=0.01)


def test_a_slow_first_model_is_raced_by_the_fallback_and_the_candidate_hears_a_filler_then_a_recovery_line():
    turn, *_ = make(["hang"], fallback=[("delay", 0.08, say("Back with you."))], pacing=FAST)
    spoken = asyncio.run(collect(turn))
    assert spoken[0] in STAGES[0] and spoken[-1] == "Back with you."
    assert spoken[1] in RECOVERY_SHORT                       # a short acknowledgement after a short wait
    assert turn.last.model == "fallback" and turn.last.hedged


def test_a_failing_first_model_hands_over_at_once_without_a_filler():
    turn, *_ = make([LLMUnavailable("down")], fallback=[say("Here we go.")], pacing=FAST)
    assert asyncio.run(collect(turn)) == ["Here we go."]
    assert turn.last.model == "fallback" and turn.last.fillers == 0


def test_without_a_fallback_the_same_model_is_raced_again():
    turn, *_ = make(["hang", ("delay", 0.08, say("Second try."))], pacing=FAST)
    spoken = asyncio.run(collect(turn))
    assert spoken[-1] == "Second try." and spoken[0] in STAGES[0]


def test_fillers_escalate_in_stages_while_both_models_are_silent_then_the_turn_fails():
    slow = []
    turn, *_ = make(["hang"] * 6, fallback=["hang"] * 6, pacing=FAST, on_slow=slow.append)
    spoken: list[str] = []

    async def go():
        async for sentence in turn.run([{"role": "user", "content": "hi"}], turn_id="7", current_slot="core-1", candidate_said=""):
            spoken.append(sentence)

    with pytest.raises(TalkerFailed):
        asyncio.run(go())
    assert len(spoken) == 4 and all(spoken[i] in STAGES[i] for i in range(4))   # one line per stage, in order
    assert turn.last.error and slow[:1] == [True]


def test_a_long_wait_is_closed_with_an_apology_not_a_bare_okay():
    # both models are slow for ~0.4s: three stages are said, then the first model finally answers
    turn, *_ = make([("delay", 0.4, say("Now, the answer."))], fallback=["hang"], pacing=Pacing(
        hedge_after_s=0.03, filler_after_s=(0.04, 0.08, 0.12, 0.5), deadline_s=1.0))
    spoken = asyncio.run(collect(turn))
    assert [s in STAGES[i] for i, s in enumerate(spoken[:3])] == [True, True, True]
    assert spoken[-2] in RECOVERY_APOLOGY and spoken[-1] == "Now, the answer."


def test_nothing_extra_is_said_when_the_model_answers_in_time():
    turn, *_ = make([say("Straight away.")], fallback=[say("Never used.")], pacing=FAST)
    assert asyncio.run(collect(turn)) == ["Straight away."]
    assert turn.last.fillers == 0 and not turn.last.hedged and turn.last.model == "primary"


def test_every_attempt_failing_fast_fails_the_turn_with_one_line_the_candidate_can_hear():
    turn, *_ = make([LLMUnavailable("a")] * 3, fallback=[LLMUnavailable("b")] * 3, pacing=FAST)
    spoken: list[str] = []

    async def go():
        async for sentence in turn.run([{"role": "user", "content": "hi"}], turn_id="7", current_slot="core-1", candidate_said=""):
            spoken.append(sentence)

    with pytest.raises(TalkerFailed):
        asyncio.run(go())
    assert len(spoken) == 1 and spoken[0] in STAGES[0]


def test_interrupting_during_the_wait_leaves_no_request_running():
    async def go():
        turn, *_ = make(["hang"], fallback=["hang"], pacing=FAST)
        gen = turn.run([{"role": "user", "content": "hi"}], turn_id="7", current_slot="core-1", candidate_said="")
        first = await gen.__anext__()          # the first filler
        await gen.aclose()
        leftovers = [t for t in asyncio.all_tasks() if t is not asyncio.current_task()]
        return first, leftovers, turn.last.interrupted

    first, leftovers, interrupted = asyncio.run(go())
    assert first in STAGES[0] and leftovers == [] and interrupted


def test_the_same_filler_is_not_used_twice_in_a_row():
    f = Fillers()
    firsts = [f.line(0) for _ in range(len(STAGES[0]) * 2)]
    assert all(a != b for a, b in zip(firsts, firsts[1:]))


def test_an_interrupted_turn_runs_no_tools():
    turn, run, ws, _ = make([say("First sentence.", "Second sentence.", tools=(("show_problem", {"item_id": "core-1"}),))])

    async def interrupt():
        gen = turn.run([{"role": "user", "content": "hi"}], turn_id="7", current_slot="core-1", candidate_said="")
        first = await gen.__anext__()
        await gen.aclose()
        return first

    assert asyncio.run(interrupt()) == "First sentence."
    assert ws.sent == [] and turn.last.interrupted


def test_next_item_runs_before_the_other_tools_so_show_problem_lands_on_the_new_item():
    # the model emits show_problem first and next_item second: the problem must still reach the screen
    turn, run, ws, _ = make([say("Let's start the first problem.", tools=(("show_problem", {}), ("next_item", {"reason": "intro done"}),
                                                                     ("log_turn", {"condition": "c", "action": "a", "reason": "r"})))])
    run.conductor.index = 1                       # pretend we are on candidate_intro, one step before core-1
    run.conductor.items[1].status, run.conductor.items[2].status = "active", "pending"
    run.conductor.items[0].status = "done"
    run.conductor.items[1].turns = 5              # the conversation before the coding had its exchanges
    asyncio.run(collect(turn))
    assert run.conductor.current().item_id == "core-1"
    assert ws.of("panel.show_problem")[0]["item_id"] == "core-1"
    assert [c["name"] for c in turn.last.tool_calls] == ["next_item", "show_problem"]


def test_showing_the_same_problem_or_section_twice_is_a_noop_with_a_clear_result():
    turn, run, ws, _ = make([say("Here it is.", tools=(("show_problem", {}), ("reveal", {"kind": "constraints"}))),
                              say("Again.", tools=(("show_problem", {}), ("reveal", {"kind": "constraints"})))])
    asyncio.run(collect(turn))
    asyncio.run(collect(turn))
    assert len(ws.of("panel.show_problem")) == 1 and len(ws.of("panel.add_section")) == 1
    assert [c["result"].get("already") for c in turn.last.tool_calls] == [True, True]


def test_code_anchors_use_the_code_the_talker_was_shown_not_what_the_candidate_typed_since():
    turn, run, ws, _ = make([say("Look at this loop.", tools=(("code_highlight", {"start_line": 2, "end_line": 2}),
                                                            ("code_comment", {"line": 2, "text": "Why?", "purpose": "question"})))])
    run.code_seen = ["def f(n):", "    for i in range(n):", "        pass"]       # what the prompt showed (v5)
    ws.lines = ["# new", "# lines", "def f(n):", "    total = 0", "    for i in range(n):"]  # the candidate typed meanwhile (v6)
    asyncio.run(collect(turn))
    assert ws.of("code.highlight")[0]["expect"] == "    for i in range(n):"     # the browser can now follow or refuse it
    assert ws.of("code.comment")[0]["at"] == {"line": 2, "expect": "    for i in range(n):"}


def test_a_line_past_the_end_of_the_code_is_refused_not_anchored_to_any_blank_line():
    turn, run, ws, _ = make([say("Check line ninety-nine.", tools=(("code_comment", {"line": 99, "text": "Here?", "purpose": "question"}),
                                                                  ("code_highlight", {"start_line": 99})))])
    ws.lines = ["def f():", "    pass"]
    asyncio.run(collect(turn))
    assert ws.of("code.comment") == [] and ws.of("code.highlight") == []
    assert all(c["result"]["ok"] is False for c in turn.last.tool_calls)


def test_a_hint_needs_the_problem_on_screen_and_is_not_counted_as_given_otherwise():
    turn, run, ws, _ = make([say("A nudge.", tools=(("give_hint", {"step": 1}),))])
    asyncio.run(collect(turn))
    assert ws.of("panel.add_section") == [] and run.conductor.current().hint_step == 0
    assert turn.last.tool_calls[0]["result"]["ok"] is False


def test_text_the_talker_puts_on_screen_goes_through_the_leak_guard():
    from tests.interviewer.fixtures import REFERENCE
    turn, run, ws, _ = make([say("Here are notes.", tools=(
        ("show_problem", {}),
        ("add_section", {"kind": "explanation", "title": "Approach", "body": REFERENCE}),
        ("add_section", {"kind": "note", "title": "Pair Sum", "body": "just a title leak"}),
        ("highlight_statement", {"quote": "solve pair sum", "note": "this is the Island Count style"}),
        ("draw", {"elements": [{"type": "rectangle", "id": "a", "label": "Window Peak"}]}),
        ("add_section", {"kind": "clarification", "title": "Clarification", "body": "Values may repeat."})))])
    asyncio.run(collect(turn))
    sections = ws.of("panel.add_section")
    assert [s["section"]["body"] for s in sections] == ["Values may repeat."]
    assert ws.of("panel.highlight") == [] and ws.of("board.draw") == []


def test_a_reserve_problem_reaches_the_browser_under_a_generic_id_never_reserve_harder_or_alternate():
    turn, run, ws, _ = make([say("Here is another one.", tools=(
        ("show_problem", {}), ("reveal", {"kind": "constraints"}), ("give_hint", {"step": 1}),
        ("highlight_statement", {"quote": "solve island count"})))])
    run.conductor.apply_brief({"for_position": run.conductor.position,
                               "plan_changes": [{"op": "use_reserve", "target": "reserve-alternate"}]})
    assert run.conductor.current().slot_id == "reserve-alternate"          # the run still knows it as the blueprint does
    asyncio.run(collect(turn))
    wire = json.dumps(ws.sent)
    assert "alternate" not in wire and "harder" not in wire
    shown = ws.of("panel.show_problem")[0]
    assert shown["item_id"] == "reserve-1"
    assert all(m["item_id"] == "reserve-1" for m in ws.sent if "item_id" in m)
    assert {s["section"]["id"] for s in ws.of("panel.add_section")} == {"constraints-reserve-1", "hint-reserve-1-1"}


def _go_to(run, item_id, turns=3):
    c = run.conductor
    while c.current().item_id != item_id:
        c.current().turns = max(c.current().turns, 3)
        c.next_item("test")
    c.current().turns = turns


def test_next_item_is_refused_while_a_background_phase_is_unfinished_and_the_talker_is_told_why():
    turn, run, ws, _ = make([say("Let's start the problem.", tools=(("next_item", {"reason": "ready"}),))])
    c = run.conductor
    c.index = 1                                       # back on candidate_intro, with core-1 still ahead
    c.items[0].status, c.items[1].status, c.items[2].status = "done", "active", "pending"
    c.items[1].turns = 1                              # only one exchange so far
    asyncio.run(collect(turn))
    assert run.conductor.current().item_id == "candidate_intro"
    result = turn.last.tool_calls[0]["result"]
    assert result["ok"] is False and "exchanges" in result["error"]


def test_next_item_will_not_leave_a_problem_that_was_never_shown_and_says_to_show_it():
    turn, run, ws, _ = make([say("On to the next.", tools=(("next_item", {"reason": "done"}),))])
    # the director swapped in a harder problem the candidate has not seen yet: the talker must show it, not skip it
    assert run.conductor.current().item_id == "core-1"
    asyncio.run(collect(turn))
    assert run.conductor.current().item_id == "core-1"
    result = turn.last.tool_calls[0]["result"]
    assert result["ok"] is False and "show_problem" in result["error"]


def test_next_item_leaves_a_shown_problem_normally_and_never_skips_the_closing_questions():
    turn, run, ws, _ = make([say("Here it is.", tools=(("show_problem", {}),)), say("Good. Let's move on to the next problem.", tools=(("next_item", {"reason": "done"}),))])
    asyncio.run(collect(turn))
    run.conductor.current().turns = 1                 # the candidate has started on it
    run.conductor.current().coded = True
    asyncio.run(collect(turn))
    assert run.conductor.current().item_id == "core-2"


def test_show_problem_moves_the_plan_on_itself_when_the_talker_is_still_on_a_finished_phase():
    turn, run, ws, _ = make([say("Here it is.", tools=(("show_problem", {}),))])
    c = run.conductor
    c.index = 1
    c.items[0].status, c.items[1].status, c.items[2].status = "done", "active", "pending"
    c.items[1].turns = 5                              # the conversation before the coding had its exchanges
    asyncio.run(collect(turn))
    assert c.current().item_id == "core-1" and ws.of("panel.show_problem")


def test_show_problem_is_refused_with_the_reason_while_the_background_questions_are_not_done():
    turn, run, ws, _ = make([say("Here it is.", tools=(("show_problem", {}),))])
    c = run.conductor
    c.index = 1
    c.items[0].status, c.items[1].status, c.items[2].status = "done", "active", "pending"
    c.items[1].turns = 1
    asyncio.run(collect(turn))
    assert c.current().item_id == "candidate_intro" and ws.of("panel.show_problem") == []
    assert "exchanges" in turn.last.tool_calls[0]["result"]["error"]


def test_leaving_the_last_problem_early_adds_the_reserve_problem_and_the_talker_lands_on_it():
    turn, run, ws, _ = make([say("Well done on this one, I have another problem for you.", tools=(("show_problem", {}), ("next_item", {"reason": "done"}), ("show_problem", {}))),])
    c = run.conductor
    c.items = [i for i in c.items if i.item_id != "core-2"]          # a plan with a single problem
    ws.cards["core-1"] = {"sections": []}
    c.clock.advance(240)
    c.current().turns = 2                             # they worked on it before the move on
    c.current().coded = True
    asyncio.run(collect(turn))
    assert c.current().item_id == "reserve-alternate"


def test_a_claim_that_the_problem_is_on_the_screen_is_never_spoken_while_no_problem_may_be_shown():
    turn, run, ws, _ = make([say("Nice mix of projects.", "Let's get into the problem now; it's on your screen.", "Tell me more about Relay.")])

    async def go(block):
        return [s async for s in turn.run([{"role": "user", "content": "hi"}], turn_id="7", current_slot="core-1", candidate_said="",
                                          block_screen_claims=block)]

    assert asyncio.run(go(True)) == ["Nice mix of projects.", "Tell me more about Relay."]
    assert turn.last.blocked[0]["rule"] == "screen_claim"
    turn2, *_ = make([say("It's on your screen now.", "What's your first thought?")])

    async def go2():
        return [s async for s in turn2.run([{"role": "user", "content": "hi"}], turn_id="7", current_slot="core-1", candidate_said="")]

    assert asyncio.run(go2()) == ["It's on your screen now.", "What's your first thought?"]   # allowed when a problem may be shown


def test_announcing_the_coding_part_is_blocked_while_no_problem_may_be_shown():
    turn, *_ = make([say("Nice mix of work.", "Let's jump into the problem now.", "Tell me more about Relay.")])

    async def go():
        return [s async for s in turn.run([{"role": "user", "content": "hi"}], turn_id="7", current_slot=None, candidate_said="",
                                          block_screen_claims=True)]

    assert asyncio.run(go()) == ["Nice mix of work.", "Tell me more about Relay."]
    for phrase in ("Let's get into the coding part.", "Time to move on to the coding problem.", "Let's start the problem."):
        turn, *_ = make([say(phrase)])
        assert asyncio.run(go()) == [NEUTRAL_LINE] and turn.last.blocked[0]["rule"] == "screen_claim"


def test_a_sentence_giving_minutes_is_blocked_as_time_spoken():
    turn, *_ = make([say("We'll spend about twenty-two minutes on problems.", "What was your first thought on the approach?")])
    spoken = asyncio.run(collect(turn))
    assert spoken == ["What was your first thought on the approach?"] and [b["rule"] for b in turn.last.blocked] == ["time_spoken"]


def test_the_announcement_rule_blocks_getting_on_to_the_problem_but_not_describing_the_round():
    from app.interviewer.closing import announces_problem

    for text in ("Alright, let's get you onto the problem.", "Now, the coding problem is going to appear on your screen.",
                 "The problem is up, take a look.", "Let me put the problem up.", "Time to move to the coding question.",
                 "Let's tackle the problem now."):
        assert announces_problem(text), text
    for text in ("I'll give you one coding problem, think aloud, and I'll leave time for your questions.",
                 "Let me give you a quick picture of how this round will run: I'll ask you to introduce yourself, then give you a coding problem, then leave time for your questions.",
                 "The round is about thirty minutes: a short chat, one coding problem up front, and your questions at the end.",
                 "We'll work on a coding problem and then talk about your projects.", "I'll keep that in mind for later.",
                 "Nice work on the problem-solving side of things.", "Let's get into the round now.", "How did you solve that problem at work?"):
        assert not announces_problem(text), text


def test_next_item_on_a_problem_is_refused_unless_the_spoken_words_leave_it():
    turn, run, ws, _ = make([say("Justify the space a bit more: what takes up the p part?", tools=(("next_item", {"reason": "done"}),)),
                             say("Good. Let's move on, I have another problem for you.", tools=(("next_item", {"reason": "done"}),))])
    ws.cards["core-1"] = {"sections": []}
    assert run.conductor.current().item_id == "core-1"
    asyncio.run(collect(turn))
    assert run.conductor.current().item_id == "core-1"
    assert "still asking" in turn.last.tool_calls[0]["result"]["error"]
    run.conductor.current().turns = 1
    run.conductor.current().coded = True
    asyncio.run(collect(turn))
    assert run.conductor.current().item_id != "core-1"


def test_stray_markup_never_reaches_the_voice():
    turn, *_ = make([say("That's a good mix. >", "Tell me about **Relay** and `the relay server`.", "<")])
    assert asyncio.run(collect(turn)) == ["That's a good mix.", "Tell me about Relay and the relay server."]


def test_inviting_the_candidates_questions_is_blocked_until_the_plan_reaches_that_part():
    from app.interviewer.closing import invites_questions_now

    for text in ("Let me move us on to your questions, I'll switch the screen.", "This is your chance, what would you like to ask me?",
                 "Do you have any questions for me?", "Right, that's the end of the coding part. Any questions for me?"):
        assert invites_questions_now(text), text
    for text in ("We'll have time for your questions at the end.", "Then a few minutes for your questions.",
                 "The round is thirty minutes: a chat, one problem, and your questions to close.", "What would you ask the team lead in that situation?"):
        assert not invites_questions_now(text), text
    turn, *_ = make([say("Good, that covers the problem.", "Do you have any questions for me?", "Let's look at a second one.")])

    async def go():
        return [s async for s in turn.run([{"role": "user", "content": "hi"}], turn_id="7", current_slot="core-1", candidate_said="",
                                          block_qa_invites=True)]

    assert asyncio.run(go()) == ["Good, that covers the problem.", "Let's look at a second one."]
    assert turn.last.blocked[0]["rule"] == "questions_too_early"


def test_show_problem_runs_through_the_remaining_background_parts_when_a_problem_is_allowed():
    turn, run, ws, _ = make([say("Let's move to the coding problem.", tools=(("show_problem", {}),))])
    c = run.conductor
    c.index = 0
    c.items[0].status, c.items[1].status, c.items[2].status = "active", "pending", "pending"   # still on the first background part
    c.items[0].started_at = c.clock() - 500                          # its time is long up: the plan says go
    assert c.problem_allowed()
    asyncio.run(collect(turn))
    assert c.current().item_id == "core-1" and ws.of("panel.show_problem")
    assert all(i.status in ("done", "skipped") for i in c.items[:c.index])


def test_one_more_problem_leaves_the_current_one_and_before_we_get_to_your_questions_is_not_an_invitation():
    from app.interviewer.closing import invites_questions_now, leaves_the_part

    assert leaves_the_part("Now, one more problem before we get to your questions.")
    assert leaves_the_part("Good, let's try one more problem.")
    assert not invites_questions_now("Now, one more problem before we get to your questions.")
    assert not invites_questions_now("Before we get to your questions I want to ask about the portal.")


def test_do_one_more_and_the_second_problem_leave_the_current_problem_but_one_more_thing_does_not():
    from app.interviewer.closing import leaves_the_part

    for text in ("Perfect trace, that's clean. Let's do one more — this one is a different kind.", "Good. Now for the second problem.",
                 "Nice. Let's try the next one."):
        assert leaves_the_part(text), text
    for text in ("One more thing on this one: what about an empty input?", "One more check — trace the cycle case.",
                 "Another approach would be a DFS, would that work here?"):
        assert not leaves_the_part(text), text


def test_putting_the_next_problem_up_leaves_the_current_one_and_so_does_the_candidate_asking_for_it():
    from app.interviewer.closing import asks_for_next_problem, leaves_the_part

    assert leaves_the_part("My mistake, putting it up now.") and leaves_the_part("Let me pull it up for you.")
    assert not leaves_the_part("Can you put it in a table?")
    assert asks_for_next_problem("Sure, I'm ready for the next one. I don't see it on my screen yet.")
    assert asks_for_next_problem("Could I have the second problem?")
    assert not asks_for_next_problem("What is the next step in my loop?")


def test_telling_the_candidate_to_read_the_problem_is_held_back_while_no_problem_may_be_shown():
    turn, *_ = make([say("Have a read and tell me how you'd approach it.", "Take a moment to read it first.", "How did you test Relay?")])

    async def go():
        return [s async for s in turn.run([{"role": "user", "content": "hi"}], turn_id="7", current_slot=None, candidate_said="",
                                          block_screen_claims=True)]

    assert asyncio.run(go()) == ["How did you test Relay?"]


def test_saying_the_technical_part_starts_now_is_held_back_while_no_problem_may_be_shown():
    turn, *_ = make([say("Let's get started with the technical part then.", "How did you measure the cold start improvement?")])

    async def go():
        return [s async for s in turn.run([{"role": "user", "content": "hi"}], turn_id="8", current_slot=None, candidate_said="",
                                          block_screen_claims=True)]

    assert asyncio.run(go()) == ["How did you measure the cold start improvement?"]


def test_a_sentence_that_breaks_off_and_corrects_itself_mid_way_is_never_spoken():
    garbled = "Good, and note it returns false, no wait, strats... sorry, startswith on an empty prefix is always true."
    turn, *_ = make([say(garbled, "That covers the empty case.")])

    async def go():
        out = [s async for s in turn.run([{"role": "user", "content": "hi"}], turn_id="9", current_slot="core-1", candidate_said="")]
        return out, turn.last.blocked

    out, blocked = asyncio.run(go())
    assert out == ["That covers the empty case."] and blocked[0]["rule"] == "garbled"


def test_an_identifier_with_underscores_is_spoken_as_separate_words_not_run_together():
    turn, *_ = make([say("You could use DENSE_RANK or a window function, or second_highest in a CTE.")])

    async def go():
        return [s async for s in turn.run([{"role": "user", "content": "hi"}], turn_id="10", current_slot=None, candidate_said="")]

    assert asyncio.run(go()) == ["You could use DENSE RANK or a window function, or second highest in a CTE."]


def test_crediting_the_candidate_with_finding_it_themselves_is_never_spoken_because_the_interviewer_may_have_led_them_to_it():
    turn, *_ = make([say("Nice work on this one, and credit where it's due, you caught that inner guard bug yourself and verified the fix without me pointing at it.",
                         "You found it yourself, that's exactly the bug.", "Now, why does it fire there?")])

    async def go():
        out = [s async for s in turn.run([{"role": "user", "content": "hi"}], turn_id="11", current_slot="core-1", candidate_said="")]
        return out, [b["rule"] for b in turn.last.blocked]

    out, rules = asyncio.run(go())
    assert out == ["Now, why does it fire there?"]
    assert rules == ["credit_unearned", "credit_unearned"]


def test_going_to_the_part_the_candidate_offered_is_not_a_screen_claim_but_going_to_the_coding_part_is():
    from app.interviewer.talker import SCREEN_CLAIM

    assert not SCREEN_CLAIM.search("Let's go to the part you offered then: how is a remote actually loaded at runtime?")
    assert not SCREEN_CLAIM.search("Let me move to the next question about the host shell.")
    for line in ("Let's get into the coding part.", "Time to move on to the problem now.", "Let's jump into the first problem.", "Let's start the coding exercise."):
        assert SCREEN_CLAIM.search(line), line


def test_with_fillers_off_a_slow_model_is_waited_for_in_silence_and_a_failure_says_nothing_either():
    slow = []
    turn, *_ = make([("delay", 0.4, say("Hi, I'm Siddharth."))], fallback=["hang"], on_slow=slow.append, pacing=Pacing(
        hedge_after_s=0.03, filler_after_s=(0.04, 0.08, 0.12, 0.5), deadline_s=1.0))
    assert asyncio.run(collect(turn, fillers_allowed=False)) == ["Hi, I'm Siddharth."]       # no "Give me a second. There."
    assert turn.last.fillers == 0 and slow[:1] == [True]                                      # the page still shows it is slow

    failing, *_ = make(["hang"] * 6, fallback=["hang"] * 6, pacing=FAST)
    spoken: list[str] = []

    async def go():
        async for sentence in failing.run([{"role": "user", "content": "hi"}], turn_id="7", current_slot="core-1", candidate_said="",
                                          fillers_allowed=False):
            spoken.append(sentence)

    with pytest.raises(TalkerFailed):
        asyncio.run(go())
    assert spoken == []


def test_the_interviewers_own_machinery_is_never_named_aloud():
    internal = ["Take nums equal to four zeros, it's the case from my earlier brief.", "Per the blueprint you should say it now.",
                "The playbook says to give a hint here.", "I'll check the answer key.", "That is the next hint ladder step.",
                "The conductor wants us to move on.", "The director says this part is done."]
    fine = ["Give me a brief summary of the architecture.", "In a hash table each slot holds a bucket.", "She is the director of the team at Dunzo.",
            "Let me read your plan back to you.", "A brief look at the code first."]
    turn, *_ = make([say(*internal, *fine)])
    out = asyncio.run(collect(turn))
    assert out == fine
    assert {b["rule"] for b in turn.last.blocked} == {"internal_words"} and len(turn.last.blocked) == len(internal)


def test_the_interviewers_decision_about_the_path_is_never_narrated_aloud():
    """A rehearsal interviewer, asked to decide the path before replying, said its reasoning: "They jumped straight into their
    intro, which was the next part anyway, so let me take it. ... let me acknowledge and go with the plan." (2026-10-17)."""
    narrated = ["They jumped straight into their intro, which was the next part anyway, so let me take it.",
                "That migration story is worth hearing out, but first let me acknowledge and go with the plan.",
                "Let me note the plan as done and move us along.", "I'll stick with the plan for now."]
    fine = ["Let me read your plan back to you.", "So the plan was to split the services first.", "They jumped to a new design after that.",
            "What did you change after the rollback?"]
    turn, *_ = make([say(*narrated, *fine)])
    out = asyncio.run(collect(turn))
    assert out == fine
    assert {b["rule"] for b in turn.last.blocked} == {"internal_words"} and len(turn.last.blocked) == len(narrated)


def test_when_the_candidate_is_about_to_type_the_interviewer_says_at_most_one_short_remark_and_no_hint():
    turn, *_ = make([say("Take your time.", "While you type, keep in mind what you add to the total.", "Think about the empty case too.")])
    out = asyncio.run(collect(turn, quiet_coding=True))
    assert out == ["Take your time."]
    assert [b["rule"] for b in turn.last.blocked] == ["hint_while_typing"] * 2

    hinting, *_ = make([say("Keep in mind what you add to the total when you see a plus.", "Go ahead.")])
    assert asyncio.run(collect(hinting, quiet_coding=True)) == ["Go ahead."]
    assert hinting.last.blocked[0]["rule"] == "hint_while_typing"


def test_leaked_tool_markup_and_internal_item_ids_are_never_spoken():
    turn, *_ = make([say('name="reason" string="true"Start core-1 coding problem.', "Moving on to reserve-harder now.",
                         "One quick thing before we move: why Module Federation?")])
    out = asyncio.run(collect(turn))
    assert out == ["One quick thing before we move: why Module Federation?"]
    assert [b["rule"] for b in turn.last.blocked] == ["internal_words", "internal_words"]


def test_let_us_move_into_the_problems_is_recognised_as_a_promise_of_the_coding_problem_in_the_plural_too():
    from app.interviewer.closing import announces_problem
    from app.interviewer.talker import SCREEN_CLAIM

    assert SCREEN_CLAIM.search("That's a clear picture, let's move into the problems now.")
    assert announces_problem("Let's get to the problems now.")


def test_a_sentence_already_said_this_interview_is_held_back_but_a_rewording_is_spoken():
    ask = "Can you walk me through how you would approach this?"
    turn, *_ = make([say(ask), say(ask), say("How would you go about solving this, step by step?")])
    assert asyncio.run(collect(turn)) == [ask]
    assert asyncio.run(collect(turn)) == [NEUTRAL_LINE]
    assert turn.last.blocked[0]["rule"] == "repeat" and turn.last.blocked[0]["match"] == ask
    assert asyncio.run(collect(turn)) == ["How would you go about solving this, step by step?"]


def test_a_promise_that_someone_will_be_in_touch_is_never_spoken():
    """A live round closed with "someone from the team will be in touch about next steps": a mock round has no team behind it."""
    turn, *_ = make([say("Thanks for your time today.", "Someone from the team will be in touch about next steps.")])
    spoken = asyncio.run(collect(turn))
    assert spoken == ["Thanks for your time today."]
    assert turn.last.blocked[0]["rule"] == "next_steps_promise"


def test_ordinary_lines_about_what_comes_next_in_the_round_are_not_blocked():
    turn, *_ = make([say("Next, let's look at your approach.", "We'll get back to that edge case in a minute.")])
    assert asyncio.run(collect(turn)) == ["Next, let's look at your approach.", "We'll get back to that edge case in a minute."]


def test_saying_you_cannot_see_their_highlight_is_allowed_but_guessing_it_is_not():
    """The rules tell the interviewer to say it cannot see what they highlighted; the screen-guess check blocked exactly that
    sentence and a live round fell back to "Could you say a bit more about that?"."""
    turn, *_ = make([say("I can't see what you've highlighted, so tell me which line you mean.")])
    assert asyncio.run(collect(turn)) == ["I can't see what you've highlighted, so tell me which line you mean."]
    turn, *_ = make([say("What you've highlighted is the second example.", "Tell me which part is unclear.")])
    assert asyncio.run(collect(turn)) == ["Tell me which part is unclear."] and turn.last.blocked[0]["rule"] == "screen_guess"


def test_wrapping_up_while_parts_are_still_ahead_is_never_said():
    """A live round, briefed by the director to "close the round", said "I'll wrap up here" with a problem still ahead."""
    turn, *_ = make([say("Since we've made no headway on this one, I'll wrap up here.", "How would you start on this one?")])
    assert asyncio.run(collect(turn, block_qa_invites=True)) == ["How would you start on this one?"]
    assert turn.last.blocked[0]["rule"] == "wraps_up_early"
    turn, *_ = make([say("I'll wrap up here. Thank you for your time.")])
    assert asyncio.run(collect(turn)) == ["I'll wrap up here.", "Thank you for your time."]     # at the end it is the closing


def test_talking_about_a_highlight_the_live_state_shows_is_allowed():
    """A live round's candidate highlighted a line and asked about it three times; the highlight was in the live state but the rules
    and this check only let "I can't see it" through."""
    turn, *_ = make([say("What you've highlighted is the first sentence, about the portion sizes.")])
    assert asyncio.run(collect(turn, highlights_known=True)) == ["What you've highlighted is the first sentence, about the portion sizes."]
    turn, *_ = make([say("What you've highlighted is the first sentence.", "Tell me which part is unclear.")])
    assert asyncio.run(collect(turn)) == ["Tell me which part is unclear."]          # nothing known: still a guess


def test_leaving_the_coding_drops_dismissive_and_vague_extra_transitions():
    """A live round left the coding with "I'll leave you with that. Let's move to another part, you can think about that offline.
    Alright, that wraps up the coding part. Can you walk me through...?": three transitions and a brush-off before one question."""
    turn, *_ = make([say("I'll leave you with that.", "Let's move to another part — you can think about that offline.",
                         "Alright, that wraps up the coding part.", "Can you walk me through how you designed the Experience Portal?")])
    assert asyncio.run(collect(turn)) == ["Alright, that wraps up the coding part.",
                                          "Can you walk me through how you designed the Experience Portal?"]
    assert {b["rule"] for b in turn.last.blocked} == {"dismissive"}
    turn, *_ = make([say("Let's move to another part.", "How did you design the Experience Portal?")])
    assert asyncio.run(collect(turn)) == ["How did you design the Experience Portal?"]
    assert turn.last.blocked[0]["rule"] == "vague_move"


def test_ordinary_next_part_links_are_kept():
    turn, *_ = make([say("Alright, let's talk a bit more about your projects.", "Let's move on to the next problem.")])
    assert asyncio.run(collect(turn)) == ["Alright, let's talk a bit more about your projects.", "Let's move on to the next problem."]


def test_a_reply_that_is_only_an_acknowledgement_is_held_back_when_a_real_answer_was_owed():
    turn, *_ = make([say("Sure, let me clarify that.")])
    spoken = asyncio.run(collect(turn, neutral_on_blocked=False, check_empty_ack=True))
    assert spoken == [] and [b["rule"] for b in turn.last.blocked] == ["empty_ack"]


def test_an_acknowledgement_followed_by_substance_is_spoken_whole_and_so_is_one_when_the_check_is_off():
    turn, *_ = make([say("Okay.", "The hash map lookup is constant time on average, so the scan stays linear.")])
    spoken = asyncio.run(collect(turn, check_empty_ack=True))
    assert spoken == ["Okay.", "The hash map lookup is constant time on average, so the scan stays linear."]
    turn, *_ = make([say("Got it.")])
    assert asyncio.run(collect(turn, check_empty_ack=False)) == ["Got it."]


SPEAK_INSTRUCTION = "Now say your spoken reply to the candidate, in words only, one to three sentences. Do not mention these decisions."


def test_a_tool_only_reply_is_followed_by_a_second_call_without_tools_that_the_candidate_hears():
    tools = (("open_thread", {"title": "Migration failure", "why": "they led it"}), ("log_turn", {"condition": "none", "action": "ask", "reason": "x"}))
    turn, run, ws, chat = make([say(tools=tools), say("Tell me more about the migration.")])
    spoken = asyncio.run(collect(turn, speak_after_tools=True))
    assert spoken == ["Tell me more about the migration."]
    assert turn.last.spoke_after_tools is True
    assert len(chat.calls) == 2 and chat.tools_seen[1] == [] and chat.tools_seen[0] != []
    assert chat.calls[1][-2] == {"role": "assistant", "content": "I decided: open_thread (title: Migration failure, why: they led it); log_turn"}
    assert chat.calls[1][-1] == {"role": "system", "content": SPEAK_INSTRUCTION}
    assert [c["name"] for c in turn.last.tool_calls] == ["open_thread"]            # the held calls still ran, after the speech
    assert turn.last.decision == {"condition": "none", "action": "ask", "reason": "x"}
    assert [a["ok"] for a in turn.last.attempts] == [True, True]
    assert turn.last.usage["total_tokens"] == 20


def test_the_held_tool_calls_run_only_after_the_second_reply_is_spoken():
    turn, run, ws, chat = make([say(tools=(("show_problem", {"item_id": "core-1"}),)), say("Here you go.")])

    async def go():
        seen = []
        async for sentence in turn.run([{"role": "user", "content": "hi"}], turn_id="7", current_slot="core-1", candidate_said="",
                                       speak_after_tools=True):
            seen.append((sentence, len(ws.of("panel.show_problem"))))
        return seen
    assert asyncio.run(go()) == [("Here you go.", 0)]
    assert len(ws.of("panel.show_problem")) == 1


def test_a_reply_with_text_and_tools_makes_one_call():
    turn, run, ws, chat = make([say("Let's go.", tools=(("log_turn", {"condition": "none", "action": "ask", "reason": "x"}),))])
    assert asyncio.run(collect(turn, speak_after_tools=True)) == ["Let's go."]
    assert len(chat.calls) == 1 and turn.last.spoke_after_tools is False


def test_two_silent_replies_make_no_third_call_and_say_nothing_extra():
    turn, run, ws, chat = make([say(tools=(("log_turn", {"condition": "none", "action": "ask", "reason": "x"}),)), say()])
    assert asyncio.run(collect(turn, speak_after_tools=True)) == []
    assert len(chat.calls) == 2 and turn.last.spoke_after_tools is False


def test_a_tool_only_reply_stays_silent_when_the_turn_does_not_ask_for_speech():
    turn, run, ws, chat = make([say(tools=(("log_turn", {"condition": "none", "action": "ask", "reason": "x"}),))])
    assert asyncio.run(collect(turn)) == []
    assert len(chat.calls) == 1


def test_a_deliberate_silent_marker_with_tools_gets_no_second_call():
    turn, run, ws, chat = make([say("<silent>", tools=(("log_turn", {"condition": "none", "action": "wait", "reason": "x"}),))])
    assert asyncio.run(collect(turn, speak_after_tools=True)) == []
    assert len(chat.calls) == 1


STUMBLE = ("Nice, that Bangalore one has some good talks. Coming back to what I asked, though — you're the first-name-half mentioned... "
           "I mean, you said you're mostly Java on the backend. What does your day-to-day look like on Relay?")
REPAIRED = ("Nice, that Bangalore one has some good talks. Coming back to what I asked, though — you said you're mostly Java on the "
            "backend. What does your day-to-day look like on Relay?")


def test_an_aborted_start_corrected_with_i_mean_is_repaired_to_the_correction():
    from app.interviewer.talker import repair_stumble

    assert repair_stumble(STUMBLE) == REPAIRED
    assert repair_stumble("So the loop runs once... I mean, twice, for each pair.") == "twice, for each pair."
    assert repair_stumble("You said it is linear... and then you changed your mind, why?") == "You said it is linear... and then you changed your mind, why?"
    assert repair_stumble("I mean, that is fine.") == "I mean, that is fine."


def test_a_stumble_in_the_stream_is_repaired_even_when_the_sentence_split_falls_inside_it_and_is_recorded():
    turn, *_ = make([say(STUMBLE)])
    out = asyncio.run(collect(turn))
    assert out == ["Nice, that Bangalore one has some good talks.", "Coming back to what I asked, though — you said you're mostly Java on the backend.",
                   "What does your day-to-day look like on Relay?"]
    assert turn.last.blocked == []
    assert turn.last.repaired == [("Coming back to what I asked, though — you're the first-name-half mentioned... I mean, you said you're mostly Java on the backend.",
                                   "Coming back to what I asked, though — you said you're mostly Java on the backend.")]


def test_a_sentence_with_an_ellipsis_but_no_i_mean_is_left_alone():
    turn, *_ = make([say("Hmm... that is one way to see it.", "What would the loop do next?")])
    out = asyncio.run(collect(turn))
    assert out == ["Hmm...", "that is one way to see it.", "What would the loop do next?"] and turn.last.repaired == []


def test_a_tool_call_written_as_speech_and_a_planned_later_excuse_are_blocked():
    leaks = ['log turn(condition="Candidate is ready.", action="stay", why="No new question.", set aside=, set aside why="").',
             "log turnconditioncandidate asked for hint/conditionarg keyaction/arg key.",
             'action="reveal", why="Displayed the constraints.".']
    planned = ["I like that you jumped in, but I'd actually planned to ask you that later.", "I was going to ask that later."]
    fine = ["Walk me through the brute force first."]
    turn, *_ = make([say(*leaks, *planned, *fine)])
    out = asyncio.run(collect(turn))
    assert out == fine
    assert [b["rule"] for b in turn.last.blocked] == ["internal_words"] * 3 + ["planned_later"] * len(planned)


def test_a_problem_id_is_never_said_aloud():
    turn, *_ = make([say("Let's start with problem-1 now.", "What would you do first?")])
    assert asyncio.run(collect(turn)) == ["What would you do first?"]
    assert [b["rule"] for b in turn.last.blocked] == ["internal_words"]


def test_a_second_call_that_yields_no_done_event_does_not_count_the_first_calls_usage_twice():
    from app.interviewer.llm import StreamEvent
    tools = (("log_turn", {"condition": "none", "action": "ask", "reason": "x"}),)
    turn, run, ws, chat = make([say(tools=tools), [StreamEvent("text", text="Tell me more about the migration. ")]])
    assert asyncio.run(collect(turn, speak_after_tools=True)) == ["Tell me more about the migration."]
    assert turn.last.usage["total_tokens"] == 10


def test_when_the_second_call_fails_entirely_the_held_tool_calls_still_run_before_the_failure_is_raised():
    turn, run, ws, chat = make([say(tools=(("show_problem", {"item_id": "core-1"}),)), *[LLMUnavailable("down")] * 4], timeout=0.05)
    with pytest.raises(TalkerFailed):
        asyncio.run(collect(turn, speak_after_tools=True))
    assert len(ws.of("panel.show_problem")) == 1 and [c["name"] for c in turn.last.tool_calls] == ["show_problem"]


OUTLINE = ("Here's how this round will run: we'll start with a short chat about your background, then two coding problems, "
           "and we'll keep time at the end for your questions.")


def test_one_does_that_sound_alright_after_the_outline_is_spoken_and_a_second_or_a_question_after_it_is_blocked():
    """Decided 2026-10-18: the outline turn ends with one check; the introduction question after it waits for their reply."""
    turn, *_ = make([say(OUTLINE, "Does that sound alright?", "So, tell me a bit about yourself.")])

    async def go(**kw):
        return [s async for s in turn.run([{"role": "user", "content": "hi"}], turn_id="5", current_slot=None, candidate_said="", **kw)]

    assert asyncio.run(go()) == [OUTLINE, "Does that sound alright?"]
    assert turn.last.blocked[0]["rule"] == "after_format_confirm"
    turn, *_ = make([say(OUTLINE, "Does that sound alright?")])
    assert asyncio.run(go(confirm_asked=True)) == [OUTLINE]                  # already asked once in the round
    assert turn.last.blocked[0]["rule"] == "format_confirm"


def test_a_format_confirmation_is_blocked_while_the_part_is_framing_even_without_the_outline_in_the_turn():
    turn, *_ = make([say("Shall we go ahead?", "What are you working on these days?")])

    async def go():
        return [s async for s in turn.run([{"role": "user", "content": "hi"}], turn_id="5", current_slot=None, candidate_said="", framing=True)]

    assert asyncio.run(go()) == ["What are you working on these days?"]
    assert turn.last.blocked[0]["rule"] == "format_confirm"


def test_does_that_sound_right_to_you_during_a_problem_is_not_blocked():
    turn, *_ = make([say("Does that sound right to you?")])

    async def go():
        return [s async for s in turn.run([{"role": "user", "content": "hi"}], turn_id="5", current_slot="core-1", candidate_said="")]

    assert asyncio.run(go()) == ["Does that sound right to you?"]
    assert not turn.last.blocked


# ---- a turn never says the same thing twice in other words (2026-10-17 persona rehearsals)

def _turn_text(text):
    import re
    return [s for s in re.split(r"(?<=[.?!])\s+", text) if s]


def _spoken_for(text):
    turn, *_ = make([say(*_turn_text(text))])
    return asyncio.run(collect(turn)), turn.last.blocked


DOUBLE_ACKS = [
    ("That's a solid, contract-first way to split the work. That's a thoughtful split — fixing the contract before parallelising is exactly "
     "what saves integration pain. With reviews focused on the exposed interface, what was one contract issue that slipped through anyway?", 1),
    ("Nice — front-loading the shared interfaces before parallelising the remotes is exactly the right instinct. Good, freezing the "
     "interfaces before parallelising the remotes is the right instinct. And how do you handle code reviews across three people working "
     "on independent remotes?", 1),
    ("That's exactly right — O(n) space as written. Yes, O(n) for the stack as it stands. There's a way to bring that extra space down to "
     "constant — do you see where the stack could be replaced by just one variable?", 1),
    ("Good to hear. Good to hear. Let's start with you then — your resume mentions leading a team of three for the Experience Portal. "
     "Walk me through how you planned the sprint and handled code reviews.", 1),
    ("Thanks, Divya — that's kind of you to say, and I'm glad the discussion was useful. Thanks for your time today. That's kind of you, "
     "and I'm glad the grid and design system discussion landed.", 2),
    ("Spaces only separate tokens — you won't see them splitting a number like that, so you can skip over any spaces you find. Only around and "
     "between tokens — a number is always a contiguous run of digits, so you won't see spaces splitting it. Alright, let me hear your approach.", 1),
    ("Interesting. Interesting. What made you choose Postgres over a document store for that part?", 1),
]


@pytest.mark.parametrize("text,dropped", DOUBLE_ACKS)
def test_a_second_acknowledgement_or_an_exact_repeat_in_one_turn_is_dropped_and_the_rest_is_spoken(text, dropped):
    spoken, blocked = _spoken_for(text)
    sentences = _turn_text(text)
    assert spoken == [s for n, s in enumerate(sentences) if n != dropped]
    assert [b["rule"] for b in blocked] in (["second_verdict"], ["repeat_in_turn"])


SINGLE_ACKS = [
    "Nice, that's a solid scope. You mentioned running the web performance guild at Flipkart, how's that going these days?",
    "Good. Alright, let me tell you how this round will run. We'll start with a short introduction from you, then one or two coding problems "
    "depending on how the first one goes.",
    "Sure, let me clarify that point. The input only has non-negative integers, so you won't see a leading minus, and spaces can be ignored "
    "while scanning. You're right that precedence applies and no parentheses means a single pass is possible.",
    "That's correct. What's the time complexity of that?",
]


@pytest.mark.parametrize("text", SINGLE_ACKS)
def test_one_acknowledgement_with_a_transition_or_a_question_is_left_alone(text):
    spoken, blocked = _spoken_for(text)
    assert spoken == _turn_text(text) and blocked == []


def test_acknowledges_is_the_verdict_plus_that_is_an_evaluative_word_and_nice_good_openers_but_never_a_question_or_a_transition():
    from app.interviewer.talker import ACKNOWLEDGES
    for yes in ("That's a solid, contract-first way to split the work.", "That is a thoughtful split — fixing it first helps.",
                "This is a clean approach.", "Makes sense, that fits.", "Got it.", "Understood, thanks.", "Fair, I see the point.",
                "That's kind of you to say.", "Good to hear.", "That's right."):
        assert ACKNOWLEDGES(yes), yes
    for no in ("Nice, what did you change?", "Alright, let's move to the next part.", "Okay, let me put it up.", "Now, walk me through it.",
               "So here is the problem.", "Let me clarify that.", "Moving on to your projects.", "You're right that precedence applies.",
               "What's the time complexity of that?"):
        assert not ACKNOWLEDGES(no), no


# ---- no claims about code that is not there (p18/smoke/strong_fresher, rh18_intro_covers_projects)

CODE_CLAIMS = [
    "I see on the screen you've already written the two-pointer solution.",
    "Let me have you trace your stack code.",
    "Okay, I've seen the stub you've written.",
    "Your code returns the right index here.",
    "Looking at your solution, the loop handles duplicates.",
]
NOT_CODE_CLAIMS = [
    "Once you've written it, walk me through a test case.",
    "When you're ready, write the code.",
    "What does your approach do with duplicates?",
]


@pytest.mark.parametrize("sentence", CODE_CLAIMS)
def test_a_sentence_that_describes_code_that_is_not_there_is_blocked(sentence):
    turn, *_ = make([say(sentence, "What would you try first?")])
    spoken = asyncio.run(collect(turn))
    assert spoken == ["What would you try first?"] and [b["rule"] for b in turn.last.blocked] == ["code_claim"]


@pytest.mark.parametrize("sentence", NOT_CODE_CLAIMS)
def test_a_hypothetical_about_code_or_a_question_about_the_approach_is_not_a_code_claim(sentence):
    turn, *_ = make([say(sentence)])
    assert asyncio.run(collect(turn)) == [sentence] and turn.last.blocked == []


@pytest.mark.parametrize("sentence", CODE_CLAIMS)
def test_the_same_sentences_are_fine_once_they_have_written_code(sentence):
    turn, *_ = make([say(sentence)])
    assert asyncio.run(collect(turn, has_code=True)) == [sentence] and turn.last.blocked == []


def test_a_sentence_about_something_other_than_their_answer_is_not_an_acknowledgement():
    from app.interviewer.talker import ACKNOWLEDGES
    for no in ("That's the kind of experience your resume mentions around full-stack work.", "That's the kind of detail I was after.",
               "That's a good place for me to pause — thanks, that's a solid round.", "That's a great moment to switch to the problem.",
               "This is a good time for your questions."):
        assert not ACKNOWLEDGES(no), no
    assert ACKNOWLEDGES("That's kind of you to say.") and ACKNOWLEDGES("That's a solid round.")


def test_a_closing_after_an_earlier_acknowledgement_is_spoken_whole():
    text = "Right, and making that choice early saved you pain. That's a good place for me to pause — thanks, that's a solid round."
    spoken, blocked = _spoken_for(text)
    assert spoken == _turn_text(text) and blocked == []


def test_a_reworded_repeat_is_only_judged_against_the_sentence_before_it_not_every_earlier_one():
    """Corpus line: "Let me shift focus to your problem-solving approach..." and, five sentences later, "Let me shift over to the coding
    problem I have up here..." are two different moves, not a restatement."""
    text = ("Let me shift focus to your problem-solving approach, since that is what we need to see now. Take your time with the page, and let me know if "
            "you have any questions. That is a good lesson for the team. Let me shift over to the coding problem I have up here, and ask you: "
            "how are you thinking about approaching this one?")
    spoken, blocked = _spoken_for(text)
    assert spoken == _turn_text(text) and blocked == []


def test_the_reworded_repeat_rule_has_no_hit_on_any_consecutive_pair_of_the_corpus():
    import json
    import re
    from pathlib import Path
    from app.interviewer.predicates import restates
    rows = [json.loads(x) for x in (Path(__file__).parent / "fixtures" / "interviewer_lines.jsonl").read_text().splitlines()
            if x.strip() and not x.startswith("#")]
    hits = [(a, b) for r in rows for a, b in zip(*(lambda ss: (ss, ss[1:]))([x for x in re.split(r"(?<=[.?!])\s+", r["text"].strip()) if x]))
            if restates(b, a)]
    assert hits == []


def test_a_sentence_that_says_the_code_is_still_to_come_is_not_a_code_claim_wherever_the_hedge_sits():
    from app.interviewer.talker import claims_code
    for ok in ("Walk me through your code once you're done.", "Walk me through your code when you have it.",
               "Trace your code after you're finished.", "Walk me through your code once it's written."):
        assert claims_code(ok) is None, ok
    assert claims_code("Walk me through your code.") is not None


# ---- "you mentioned ..." must be something they said (p19/strong_fresher seq 23)

def _said_claim(claim, heard, then="Go ahead and write the code, thinking aloud as you go."):
    turn, *_ = make([say(claim, then)])
    spoken = asyncio.run(collect(turn, heard=heard))
    return spoken, [b["rule"] for b in turn.last.blocked]


def test_a_claim_of_words_they_never_said_is_blocked_and_the_next_sentence_is_still_spoken():
    spoken, rules = _said_claim("You mentioned the optimal is O(1) extra space — see if you can get there while you implement it.",
                                "Brute force is quadratic. Space is O(n) because of the map.")
    assert spoken == ["Go ahead and write the code, thinking aloud as you go."] and rules == ["unheard_claim"]


@pytest.mark.parametrize("claim,heard", [
    ("You mentioned leading three engineers on the Experience Portal.",
     "At Infosys I was leading three engineers on the Experience Portal, mostly frontend work."),
    ("You mentioned the bucket converting to a red-black tree past eight entries.",
     "When a bucket gets long it converts to a red-black tree once it passes eight entries, to keep lookups fast."),
    ("On the Experience Portal, you mentioned leading three engineers — walk me through how you planned the sprint.",
     "At salescode I led a team of three on the experience portal."),
    ("You said O(n) space.", "Space is O(n)."),
    ("You said O(n) space.", "the space is o of n because of the map"),
    ("You said it runs in linear time.", "so the time is O(n) overall"),
    ("You said it is constant space.", "the extra space is O(1)"),
    ("You said it is constant space.", "the extra space is o of one"),
])
def test_a_claim_they_really_made_passes(claim, heard):
    spoken, rules = _said_claim(claim, heard)
    assert spoken[0] == claim and rules == []


@pytest.mark.parametrize("claim,heard", [
    ("You said it runs in constant space.", "Space is O(n)."),
    ("You mentioned two hundred requests per second.", "We handled about fifty requests per second."),
    ("You said it takes 200 milliseconds.", "It takes around 50 milliseconds."),
])
def test_a_claim_with_a_complexity_or_number_they_did_not_say_is_blocked(claim, heard):
    spoken, rules = _said_claim(claim, heard)
    assert spoken == ["Go ahead and write the code, thinking aloud as you go."] and rules == ["unheard_claim"]


# ---- no false link to a topic that was not discussed (p19/strong_fresher seq 41)

def _linked(sentence, recent="", heard=""):
    turn, *_ = make([say(sentence)])
    spoken = asyncio.run(collect(turn, recent=recent, heard=heard or recent))
    return spoken, turn.last.repaired, turn.last.blocked


HASHMAP = "A HashMap is an array of buckets, and the hash of the key picks one. Why did Java 8 turn long buckets into trees?"


def test_staying_on_a_topic_that_was_never_discussed_is_rewritten_not_blocked():
    before = "Let me stay on SQL for one more: what's the difference between WHERE and HAVING?"
    after = "Let me ask you one on SQL: what's the difference between WHERE and HAVING?"
    spoken, repaired, blocked = _linked(before, HASHMAP)
    assert spoken == [after] and repaired == [(before, after)] and blocked == []


@pytest.mark.parametrize("before,after", [
    ("Let's stick with Docker for a bit: how do you keep images small?", "Let's do one on Docker: how do you keep images small?"),
    ("I'd like to continue on Kubernetes for a moment: what is a pod?", "Let me ask you one on Kubernetes: what is a pod?"),
    ("Staying on the cache, how did you invalidate it?", "On the cache, how did you invalidate it?"),
    ("Still on Redis, what happens when it is down?", "On Redis, what happens when it is down?"),
    ("One more on Postgres: how do you index a JSONB column?", "A question on Postgres: how do you index a JSONB column?"),
    ("Here's one more about caching, how do you size it?", "Here's a question about caching, how do you size it?"),
    ("Let me stay on the load balancer for one more question.", "Let me ask you one on the load balancer."),
    ("Coming back to Kafka, how do you handle a poison message?", "On Kafka, how do you handle a poison message?"),
])
def test_each_false_link_form_is_rewritten_when_its_topic_was_not_discussed(before, after):
    spoken, repaired, _ = _linked(before, HASHMAP)
    assert spoken == [after] and repaired == [(before, after)]


@pytest.mark.parametrize("before,after", [
    ("Staying with Java for a moment \u2014 why must equals and hashCode be overridden together?", "On Java \u2014 why must equals and hashCode be overridden together?"),
    ("Sticking with Java for a bit: why must equals and hashCode be overridden together?", "On Java: why must equals and hashCode be overridden together?"),
    ("Sticking to Java, why must equals and hashCode be overridden together?", "On Java, why must equals and hashCode be overridden together?"),
    ("Staying with Java \u2014 why must equals and hashCode be overridden together?", "On Java \u2014 why must equals and hashCode be overridden together?"),
])
def test_staying_with_and_sticking_to_a_topic_nobody_discussed_is_rewritten(before, after):
    spoken, repaired, _ = _linked(before, "A hash map is an array of buckets and the hash of the key picks one.")
    assert spoken == [after] and repaired == [(before, after)]


@pytest.mark.parametrize("sentence,recent", [
    ("Let me stay on SQL for one more: what's the difference between WHERE and HAVING?", "I used SQL joins a lot. A JOIN combines rows from two tables."),
    ("Staying on the cache, how did you invalidate it?", "We put a cache in front of the dashboard, with a one minute TTL."),
    ("Coming back to the migration you mentioned, how did you roll it back?", "x"),
])
def test_a_link_to_a_topic_that_was_just_discussed_is_left_alone(sentence, recent):
    heard = "I ran the migration for the billing tables last year." if "migration" in sentence else recent
    spoken, repaired, blocked = _linked(sentence, recent, heard)
    assert spoken == [sentence] and repaired == [] and blocked == []


def test_coming_back_to_a_topic_discussed_earlier_in_the_round_is_left_alone():
    sentence = "Coming back to the migration you mentioned, how did you roll it back?"
    turn, *_ = make([say(sentence)])
    earlier = "In my last job I ran the migration for the billing tables."
    assert asyncio.run(collect(turn, recent=HASHMAP, heard=earlier + " " + HASHMAP)) == [sentence] and turn.last.repaired == []


def test_staying_on_a_topic_not_in_the_recent_turns_is_rewritten_even_if_discussed_long_ago():
    turn, *_ = make([say("Let me stay on SQL for one more: what's the difference between WHERE and HAVING?")])
    spoken = asyncio.run(collect(turn, recent=HASHMAP, heard="I wrote a lot of SQL early on. " + HASHMAP))
    assert spoken == ["Let me ask you one on SQL: what's the difference between WHERE and HAVING?"]


def test_what_this_turn_already_said_counts_as_recent():
    turn, *_ = make([say("Good, the cache helps with SQL load.", "Let me stay on SQL for one more: what's a clustered index?")])
    spoken = asyncio.run(collect(turn, recent=HASHMAP))
    assert spoken[1] == "Let me stay on SQL for one more: what's a clustered index?"


# ---- fix round 1: a cut never hides a claim, morphology and equivalent numbers do not block a true one

@pytest.mark.parametrize("claim,heard", [
    ("You mentioned why Kafka was picked over RabbitMQ for ordering.", "we used queues"),
    ("You said what you built was a Kubernetes operator.", "I built a small script"),
    ("You said how do we handle duplicates in the pipeline.", "we used queues"),
    ("You mentioned Java, and Rust.", "I know Java"),
    ("You said you used Redis, and Kafka for the queue.", "I used Redis for caching"),
])
def test_a_claim_that_starts_with_a_question_word_or_lists_an_unheard_item_is_still_blocked(claim, heard):
    spoken, rules = _said_claim(claim, heard)
    assert spoken == ["Go ahead and write the code, thinking aloud as you go."] and rules == ["unheard_claim"]


@pytest.mark.parametrize("claim,heard", [
    ("You mentioned the stack.", "I keep two stacks"),
    ("You said the stack holds one entry per term.", "I use stacks, each term pushes one entry"),
    ("You mentioned the entries in the stack.", "each stack entry is a number"),
    ("You mentioned caching the results.", "I cached results in redis"),
    ("You mentioned about 35% less latency.", "latency dropped by thirty five percent"),
    ("You said the time is O(log n).", "binary search so log n"),
    ("You mentioned a 2x gain.", "it was twice as fast"),
    ("You mentioned leading a team of 3.", "I led a team of three"),
    ("You said you cut latency by 40 percent.", "reduced latency by forty percent"),
])
def test_a_true_claim_in_other_forms_of_the_same_words_or_numbers_passes(claim, heard):
    spoken, rules = _said_claim(claim, heard)
    assert spoken[0] == claim.replace("%", " percent") and rules == []       # the voice says a percent sign


def test_a_name_in_the_lead_is_support_but_never_something_the_claim_must_match():
    spoken, rules = _said_claim("On the Payments team, you mentioned leading the rollout of retries.", "I led the rollout of retries last year")
    assert spoken[0].startswith("On the Payments team") and rules == []


@pytest.mark.parametrize("sentence", [
    "Let's stay on that idea for a bit.", "Let me stay on the same topic for one more.", "I'd like to continue with this approach for a moment.",
    "Let me stay on it for one more.", "Staying on track, what is the input?", "Going back to the start, what is the input?",
    "Back to the original question, what is the input?", "Still on the same problem, what is the edge case?",
])
def test_a_demonstrative_or_idiomatic_link_is_left_alone(sentence):
    spoken, repaired, _ = _linked(sentence, "we discussed hashing")
    assert spoken == [sentence] and repaired == []


def _framing_spoken(text):
    turn, *_ = make([say(text)])

    async def go():
        return [s async for s in turn.run([{"role": "user", "content": "hi"}], turn_id="5", current_slot=None, candidate_said="",
                                          framing=True, block_screen_claims=True, neutral_on_blocked=False)]
    return asyncio.run(go()), turn.last.blocked


def test_in_the_framing_a_present_tense_claim_that_a_problem_is_on_screen_is_blocked_with_nothing_on_it():
    spoken, blocked = _framing_spoken("Alright, let's get into the coding now \u2014 give me your approach to the problem on your screen.")
    assert spoken == [] and [b["rule"] for b in blocked] == ["screen_claim"]


def test_in_the_framing_the_outline_may_say_a_problem_will_come_up_on_the_screen():
    outline = "We'll start with a short chat, then I'll put a problem on your screen, and we'll finish with your questions."
    spoken, blocked = _framing_spoken(outline)
    assert spoken == [outline] and blocked == []


CODE_LINES = [
    ('Trace "3-5*2" for me.', 'Trace "3 minus 5 times 2" for me.'),
    ("What does HAVING COUNT(*) > 5 filter?", "What does HAVING count star greater than 5 filter?"),
    ("Why would a <= b hold there?", "Why would a less than or equal to b hold there?"),
    ("Is O(n*m) acceptable here?", "Is O of n times m acceptable here?"),
    ('Try "14-3/2" next.', 'Try "14 minus 3 divided by 2" next.'),
    ("When does a >= b or a != b or a == b happen?", "When does a greater than or equal to b or a not equal to b or a equals b happen?"),
    ("Is O(1) possible?", "Is O of 1 possible?"),
    ("It takes 10-20 items", "It takes 10-20 items"),
    ("Tell me about the two-pointer approach.", "Tell me about the two-pointer approach."),
    ("Is O(n log n) fine?", "Is O(n log n) fine?"),
    ("It is **really** important, and `this` too.", "It is really important, and this too."),
    ("Look at prices[i - 1] there.", "Look at prices at i minus 1 there."),
]


@pytest.mark.parametrize("text,said", CODE_LINES)
def test_the_voice_says_code_and_arithmetic_exactly_as_a_person_would(text, said):
    spoken, blocked = _spoken_for(text)
    assert spoken == [said] and blocked == []


def test_markdown_markers_are_still_stripped_but_never_an_operator_between_operands():
    from app.interviewer.talker import MARKUP, _clean
    assert _clean("## A heading with *emphasis* and ~~this~~ and <b>tags</b> and _words_") == "A heading with emphasis and this and tags and words"
    assert _clean("DENSE_RANK() is fine") == "DENSE RANK() is fine"
    for code in ("3-5*2", "COUNT(*) > 5", "a <= b", "O(n*m)"):
        assert _clean(code) == code, code


# ---- fix round 1: the voice in ordinary speech (review of K3)

def _said(text):
    from app.interviewer.talker import _clean, speakable
    return _clean(speakable(text))


SPEECH = [
    ("SELECT * FROM users", "SELECT star FROM users"),
    ("nums[i] * 2", "nums at i times 2"),
    ("a * b", "a times b"),
    ("We offer 24/7 support, a 50/50 chance, 5/5 stars, 10/10, windows 10/11, on 10/17/2026, and/or I/O or TCP/IP.",
     "We offer 24/7 support, a 50/50 chance, 5/5 stars, 10/10, windows 10/11, on 10/17/2026, and/or I/O or TCP/IP."),
    ("Try `x / 2` there.", "Try x divided by 2 there."),
    ('Try "14-3/2" there.', 'Try "14 minus 3 divided by 2" there.'),
    ("x ** 2", "x to the power of 2"),
    ("2 ** 10", "2 to the power of 10"),
    ("Take `**kwargs` and `*args`.", "Take star star kwargs and star args."),
    ('Does x < "b" hold?', 'Does x less than "b" hold?'),
    ("When a <> b holds", "When a not equal to b holds"),
    ("A -> B", "A to B"),
    ("x => x + 1", "x arrow x plus 1"),
    ("Map<String, List<Integer>> m", "Map of String, List of Integer m"),
    ("5 - 3 = 2", "5 minus 3 equals 2"),
    ("3 + 4 = 7", "3 plus 4 equals 7"),
    ("x // 2", "x floor divided by 2"),
    ("a % b", "a mod b"),
    ("Only 50% pass", "Only 50 percent pass"),
    ("then i++ runs", "then i plus plus runs"),
    ("x += 1 and y -= 2", "x plus equals 1 and y minus equals 2"),
    ("- first point\n- second point", "first point second point"),
    ("Writing C++ is fine", "Writing C++ is fine"),
    ("x = 5", "x = 5"),
    ("an approach with a ^ b and c | d", "an approach with a ^ b and c | d"),
]


@pytest.mark.parametrize("text,said", SPEECH)
def test_the_voice_keeps_ordinary_speech_and_says_code_as_a_person_would(text, said):
    assert _said(text) == said


# ---- fix round 1: K1 and the quiet limit

def test_a_second_acknowledgement_that_carries_a_request_keeps_the_request():
    spoken, blocked = _spoken_for("Perfect. Great, tell me about yourself.")
    assert spoken == ["Perfect.", "Tell me about yourself."]
    assert blocked == []


def test_a_second_acknowledgement_that_only_judges_is_still_dropped():
    spoken, blocked = _spoken_for("Right on both counts. Good, you've covered precedence.")
    assert spoken == ["Right on both counts."] and [b["rule"] for b in blocked] == ["second_verdict"]


def test_a_remark_dropped_by_the_quiet_limit_leaves_a_blocked_entry():
    turn, *_ = make([say("Take your time. Looks fine so far.")])
    asyncio.run(collect(turn, quiet_coding=True))
    assert [b["rule"] for b in turn.last.blocked] == ["quiet_limit"]


@pytest.mark.parametrize("text,said", [
    # A 2-D index was "dp at ij" and "dp at i minus 1j": each index is said in turn (re-review of K fix round 1).
    ("dp[i][j] = dp[i-1][j] + 1", "dp at i, j = dp at i minus 1, j plus 1"),
    ("grid[r][c] is a wall", "grid at r, c is a wall"),
    ("matrix[i][j][k]", "matrix at i, j, k"),
    ("prices[i - 1]", "prices at i minus 1"),
    # Mod between operands, percent after a number ("5 % 3" was "5 percent 3").
    ("5 % 3", "5 mod 3"),
    ("x%2", "x mod 2"),
    ("50% of the time", "50 percent of the time"),
    ("35% faster", "35 percent faster"),
])
def test_chained_indexes_and_mod_versus_percent_are_said_as_a_person_says_them(text, said):
    from app.interviewer.talker import _clean, speakable
    assert _clean(speakable(text)) == said


QUESTION = "Was that an approach you arrived at deliberately, or something you learned the hard way?"
SHOW = (("show_problem", {}),)


def test_a_question_after_lets_get_into_the_coding_is_held_so_the_problem_put_up_has_no_other_question_beside_it():
    # p21 seq 9: "Alright, let's get into the coding now. <project question> Let me put the first problem on your screen."
    turn, run, ws, _ = make([say("That's a solid way to structure it.", "Alright, let's get into the coding now.", QUESTION,
                                 "Let me put the first problem on your screen.", tools=SHOW)])
    spoken = asyncio.run(collect(turn))
    assert QUESTION not in spoken and "?" not in " ".join(spoken)
    assert "Let me put the first problem on your screen." in spoken            # the put-up words are still said
    assert [b["rule"] for b in turn.last.blocked] == ["question_with_problem"]
    assert ws.of("panel.show_problem")                                           # and the problem still goes up


def test_a_problem_announcement_after_a_spoken_question_is_held_and_the_problem_waits_for_the_next_turn():
    turn, run, ws, _ = make([say("Solid work.", QUESTION, "Alright, let's get into the coding now.", "Let me put the first problem on your screen.",
                                 tools=SHOW)])
    spoken = asyncio.run(collect(turn))
    assert spoken == ["Solid work.", QUESTION]
    assert [b["rule"] for b in turn.last.blocked] == ["question_with_problem", "question_with_problem"]
    # A turn that asks something never also puts the problem up (decided 2026-10-18, rehearsal run_a seq 9): show_problem is deferred.
    assert not ws.of("panel.show_problem")
    assert [c["result"].get("deferred") for c in turn.last.tool_calls if c["name"] == "show_problem"] == [True]


def test_an_acknowledgement_then_coding_now_then_the_put_up_with_no_question_is_spoken_as_before():
    turn, run, ws, _ = make([say("That's a solid way to structure it.", "Alright, let's get into the coding now.",
                                 "Let me put the first problem on your screen.", tools=SHOW)])
    spoken = asyncio.run(collect(turn))
    assert spoken == ["That's a solid way to structure it.", "Alright, let's get into the coding now.", "Let me put the first problem on your screen."]
    assert turn.last.blocked == [] and ws.of("panel.show_problem")


def test_a_question_with_no_problem_words_in_the_turn_is_unaffected():
    turn, run, ws, _ = make([say("Thanks for that.", QUESTION)])
    assert asyncio.run(collect(turn)) == ["Thanks for that.", QUESTION]


# ---- interviewer style: the verdict budget (S2)

def _budgeted(text, **kw):
    turn, *_ = make([say(*_turn_text(text))])
    return asyncio.run(collect(turn, verdict_budget=True, **kw)), turn.last.blocked


@pytest.mark.parametrize("text", ["That's correct.", "That's a solid approach.", "Exactly right — nice work."])
def test_with_the_budget_spent_a_sentence_that_only_evaluates_is_dropped(text):
    spoken, blocked = _budgeted(text + " What does it cost in time?")
    assert spoken == ["What does it cost in time?"] and [b["rule"] for b in blocked] == ["verdict_budget"]


def test_with_the_budget_spent_a_verdict_opener_is_stripped_and_the_content_kept():
    for text, kept in [("That's right, and what about duplicates?", "And what about duplicates?"),
                       ("That's a solid approach, and what about duplicates?", "And what about duplicates?"),
                       ("Good, tell me about the CI check.", "Tell me about the CI check.")]:
        spoken, blocked = _budgeted(text)
        assert spoken == [kept] and blocked == [], text


def test_with_the_budget_spent_a_neutral_acknowledgement_is_still_said():
    spoken, blocked = _budgeted("Okay. What about duplicates?")
    assert spoken == ["Okay.", "What about duplicates?"] and blocked == []


def test_without_the_budget_a_single_verdict_is_untouched():
    spoken, blocked = _spoken_for("That's correct. What does it cost in time?")
    assert spoken == ["That's correct.", "What does it cost in time?"] and blocked == []


# ---- fix round 1: the budget keeps real confirmations

@pytest.mark.parametrize("text,kept", [("Yes, the input is always valid.", "The input is always valid."), ("Yes, you can use Python.", "You can use Python."),
                                       ("Right, the array is sorted.", "The array is sorted."), ("Correct, duplicates are allowed.", "Duplicates are allowed."),
                                       ("That's right, the output is a list of indices.", "The output is a list of indices.")])
def test_a_verdict_in_front_of_a_fact_keeps_the_fact_under_the_budget(text, kept):
    spoken, blocked = _budgeted(text)
    assert spoken == [kept] and blocked == []


@pytest.mark.parametrize("text", ["That's correct.", "Right.", "That's a solid approach."])
def test_a_lone_verdict_is_kept_because_nothing_else_is_said(text):
    spoken, blocked = _budgeted(text)
    assert spoken == [text] and blocked == []


def test_a_lone_verdict_is_kept_when_every_sentence_after_it_is_blocked():
    spoken, blocked = _budgeted("That's correct. Someone from the team will be in touch about next steps.")
    assert spoken == ["That's correct."] and [b["rule"] for b in blocked] == ["next_steps_promise"]


@pytest.mark.parametrize("text", ["Okay, that makes sense. What about duplicates?", "Fair. What about duplicates?", "Got it. What about duplicates?",
                                  "Makes sense. What about duplicates?"])
def test_neutral_acknowledgements_are_never_dropped_or_stripped_under_the_budget(text):
    spoken, blocked = _budgeted(text)
    assert spoken == _turn_text(text) and blocked == []


def test_a_sentence_closing_the_coding_part_is_blocked_while_the_plan_has_not_left_the_problem_on_screen():
    turn, run, ws, _ = make([say("That wraps up the coding part.", "Tell me how you would test it?")])
    spoken = asyncio.run(collect(turn, block_close_coding=True))
    assert spoken == ["Tell me how you would test it?"]
    assert [b["rule"] for b in turn.last.blocked] == ["left_problem"]
    turn, run, ws, _ = make([say("That wraps up the coding part.")])
    assert asyncio.run(collect(turn)) == ["That wraps up the coding part."]          # the plan is free to leave it


def test_a_sentence_in_a_non_latin_script_is_never_spoken_and_english_is_asked_for_again():
    """b2 strong_fresher switched to Chinese mid-interview."""
    turn, run, ws, _ = make([say("好的，这样单次查询就能得出结果。", "What did the Prisma query return?")])
    assert asyncio.run(collect(turn)) == ["What did the Prisma query return?"]
    assert [b["rule"] for b in turn.last.blocked] == ["language"]
    for text in ("Хорошо, давайте продолжим.", "ठीक है, आगे बढ़ते हैं।", "حسنا لنكمل.", "それでは次へ。"):
        turn, run, ws, _ = make([say(text)])
        assert asyncio.run(collect(turn, neutral_on_blocked=False)) == []
        assert turn.last.blocked and turn.last.blocked[0]["rule"] == "language", text
    turn, run, ws, _ = make([say("Okay, the cost is O(n) — and the space is \u201cconstant\u201d, right?")])
    assert asyncio.run(collect(turn)) and not turn.last.blocked


def test_the_interviewer_never_narrates_the_conversation_about_the_candidate_but_may_speak_of_people_in_the_problem():
    """b1 rh_unplanned_resume_opener: "They said they're ready, but they didn't actually answer \u2014 let me ask again, differently." Only the
    meta forms are dropped (polish review finding 6)."""
    from app.interviewer.talker import narrates

    for line in ("They said they're ready, but they didn't actually answer \u2014 let me ask again, differently.",
                 "Let me rephrase that question for them.", "Let me ask again, differently.", "Let me try that again.",
                 "He didn't actually answer.", "The candidate seems unsure."):
        assert narrates(line), line
    for line in ("Did they say what the failure rate was?", "Let me put it another way.", "So your team said the deadline moved?",
                 "Tell me what they decided.", "I said we would come back to it.", "They need the indices, not the values.",
                 "So she asked you to rewrite it.", "He gave you the array and a target.", "They asked you to migrate everything. That sounds heavy.",
                 "They said it was fine.", "Tell me what you built for them."):
        assert not narrates(line), line
    # once a sentence is reasoning the rest of the turn goes with it, and the run's retry asks again
    turn, run, ws, _ = make([say("They said they're ready, but they didn't actually answer.", "What does your loop do after a hit?")])
    assert asyncio.run(collect(turn, neutral_on_blocked=False)) == []


def test_when_everything_was_blocked_after_they_announced_a_step_the_fallback_is_sure_go_ahead_not_a_request_for_more():
    turn, run, ws, _ = make([say("They said they're ready, but they didn't actually answer.")])
    spoken = asyncio.run(collect(turn, echo_of="Let me trace it on minus one, zero, one, two."))
    assert spoken == ["Sure, go ahead."]
    turn, run, ws, _ = make([say("They said they're ready, but they didn't actually answer.")])
    assert asyncio.run(collect(turn, echo_of="I think it is n squared.")) == [NEUTRAL_LINE]


def test_a_decline_of_the_editor_never_sounds_like_a_rule_or_an_instruction():
    """b0 struggler said "I'm not allowed to write in your editor, so that part I'll leave with you." """
    for stiff in ("I'm not allowed to write in your editor, so that part I'll leave with you.", "My instructions say I can't type in your editor.",
                  "I can't write in your editor."):
        turn, run, ws, _ = make([say(stiff)])
        assert asyncio.run(collect(turn, neutral_on_blocked=False)) == [], stiff
        assert turn.last.blocked[0]["rule"] == "stiff_decline"
    turn, run, ws, _ = make([say("I'll leave the typing to you.")])
    assert asyncio.run(collect(turn)) == ["I'll leave the typing to you."]


def test_a_requirement_the_problem_does_not_state_is_blocked_in_speech():
    turn, run, ws, _ = make([say("The problem asks for O of 1 extra space.", "Can you do it in constant extra space?")])
    assert asyncio.run(collect(turn)) == ["Can you do it in constant extra space?"]
    assert turn.last.blocked[0]["rule"] == "requirement_invented"


def test_second_transition_only_drops_a_second_announcement_of_the_same_move():
    """Polish review finding 4: a close followed by a sentence that opens any next part is the normal pair."""
    for sentences in (("That wraps up this part.", "Let's use the rest of the time for your questions."),
                      ("Nice.", "Let's talk about your projects.", "Let's dive into the Relay one first?"),
                      ("Let's go into the details of your loop.", "Let's get into what happens on an empty array?")):
        turn, run, ws, _ = make([say(*sentences)])
        assert asyncio.run(collect(turn)) == list(sentences), sentences
    for sentences in (("Let's move to the next problem.", "Alright, let's get into the coding now."),
                      ("Let's move on.", "Moving on to the next part, then."),
                      ("Let's move to the next problem.", "Time for another problem then.")):
        turn, run, ws, _ = make([say(*sentences)])
        assert len(asyncio.run(collect(turn))) == 1, sentences
        assert turn.last.blocked[0]["rule"] == "second_transition"


def test_the_coding_is_done_when_something_happens_is_not_a_close_while_the_problem_is_current():
    turn, run, ws, _ = make([say("The coding is done when your tests pass, so run them.")])
    assert asyncio.run(collect(turn, block_close_coding=True)) == ["The coding is done when your tests pass, so run them."]


def test_a_name_in_another_script_is_not_a_language_switch_but_a_sentence_in_it_is():
    """Polish review finding 8."""
    turn, run, ws, _ = make([say("Nice to meet you, \u0410\u043b\u0435\u043a\u0441\u0435\u0439.")])
    assert asyncio.run(collect(turn, neutral_on_blocked=False, known_words={"\u0430\u043b\u0435\u043a\u0441\u0435\u0439"})) \
        == ["Nice to meet you, \u0410\u043b\u0435\u043a\u0441\u0435\u0439."]
    turn, run, ws, _ = make([say("Nice to meet you, \u0410\u043b\u0435\u043a\u0441\u0435\u0439.")])
    assert asyncio.run(collect(turn, neutral_on_blocked=False)) == []
    assert turn.last.blocked[0]["rule"] == "language"
    for fine in ("Nice, Jos\u00e9 and Zo\u00eb, and \u0141ukasz.", "The growth is \u03b8(n log n), with \u03b5 small.", "That\u2019s \u201cfine\u201d \u2014 go on\u2026"):
        turn, run, ws, _ = make([say(fine)])
        assert asyncio.run(collect(turn)) == [fine], fine
    turn, run, ws, _ = make([say("\u597d\u7684\uff0c\u8fd9\u6837\u5355\u6b21\u67e5\u8be2\u5c31\u80fd\u5f97\u51fa\u7ed3\u679c\u3002")])
    assert asyncio.run(collect(turn, neutral_on_blocked=False)) == []


def test_the_answer_to_a_problem_name_question_is_the_statement_on_screen_not_a_dodge():
    for dodge in ("It doesn't matter what it's called.", "I'm not able to confirm or deny which problem it is.", "It doesn't matter what that is called."):
        turn, run, ws, _ = make([say(dodge)])
        assert asyncio.run(collect(turn, neutral_on_blocked=False)) == [], dodge
        assert turn.last.blocked[0]["rule"] == "problem_name_dodge"
    answer = "Okay \u2014 walk me through how you'd approach it."
    turn, run, ws, _ = make([say(answer)])
    assert " ".join(asyncio.run(collect(turn))) == answer and turn.last.blocked == []


def test_round2_a_close_followed_by_moving_on_is_the_normal_pair_but_the_same_kind_twice_is_dropped():
    """Re-review C."""
    for sentences in (("That wraps up this part.", "Let's move on to the next question."), ("Nice, that wraps up the coding.", "Let's move on to your projects."),
                      ("Okay, that wraps up the first problem.", "Let's look at the second problem now."),
                      ("Right, let's move on.", "I have another problem for you, it's on your screen."),
                      ("Let's move to the next problem.", "Let me put the second problem on your screen.")):
        turn, run, ws, _ = make([say(*sentences)])
        assert asyncio.run(collect(turn)) == list(sentences), sentences
    for sentences in (("Let's move on to the next problem.", "Alright, let's get into the coding now."), ("Good, let's move on.", "Let's move on to the follow-up."),
                      ("That wraps up the coding.", "Let's leave it there.")):
        turn, run, ws, _ = make([say(*sentences)])
        assert len(asyncio.run(collect(turn))) == 1, sentences
        assert turn.last.blocked[0]["rule"] == "second_transition"


B4_REASONING = ("His areas after the first move are wrong. Let me check: heights 1,8,6,2,5,4,8,3,7. l=0,r=8: min=1, width=8, area=8. Move l to 1: min(8,7)=7, "
                "width=7, area=49. Then r=7: min(8,3)=3, width=6, area=18. Hmm he said eighteen then forty. Let me carefully trace. After area 49 at l=1,r=8. "
                "Now l=1 (h=8), r=8 (h=7). Shorter is 7 (right), move r to 7. l=1,r=7: min(8,3)=3, width=6, area=18. Matches eighteen. " * 2)
B4_PROMPT = ("They have the problem in front of them and their code is still just the stub with the TODO \u2014 nothing to react to yet. They said they have no more "
             "questions, which is an acknowledgement. I should prompt them for their understanding/approach now. Wait \u2014 earlier they said they would start with brute force.")


def test_the_talker_never_speaks_its_reasoning_aloud():
    """b4 strong_fresher seq 28 and rh_intro_covers_projects, b1 rh_unplanned_resume_opener seq 5: the model's private reasoning was spoken."""
    for text in (B4_REASONING, B4_PROMPT, "They said they're ready, but they didn't actually answer \u2014 let me ask again, differently, without repeating the exact wording."):
        turn, run, ws, _ = make([say(*[x for x in text.replace(". ", ".|").split("|")])])
        assert asyncio.run(collect(turn, neutral_on_blocked=False)) == [], text[:40]
        assert {b["rule"] for b in turn.last.blocked} <= {"reasoning_aloud", "internal_words"} and turn.last.blocked
    for single, rule in (("l=0,r=8: min=1, width=8, area=8.", "reasoning_aloud"), ("The new area is min(8,7) times 7.", "reasoning_aloud"),
                         ("I should prompt them for their understanding now.", "reasoning_aloud"), ("I'll ask them about the approach.", "reasoning_aloud"),
                         ("Let me ask them again.", "reasoning_aloud"), ("His areas after the first move are wrong.", "reasoning_aloud"),
                         ("They have the stub and nothing to react to yet.", "reasoning_aloud")):
        turn, run, ws, _ = make([say(single)])
        assert asyncio.run(collect(turn, neutral_on_blocked=False)) == [], single
        assert turn.last.blocked[0]["rule"] == rule, single


def test_once_a_sentence_is_reasoning_every_later_sentence_of_the_turn_is_dropped_too():
    turn, run, ws, _ = make([say("Okay, thanks.", "He said eighteen, which is an acknowledgement.", "What does your loop do next?")])
    assert asyncio.run(collect(turn, neutral_on_blocked=False)) == ["Okay, thanks."]
    assert [b["rule"] for b in turn.last.blocked] == ["reasoning_aloud", "reasoning_aloud"]


def test_a_long_turn_with_a_reasoning_cue_is_cut_back_to_the_sentences_before_the_first_cue():
    long = ["So the idea is to walk the array once and keep a running best, and the loop does one comparison per step." * 1] * 6
    turn, run, ws, _ = make([say(*long, "Wait, let me reconsider the whole thing.", "What is your complexity?")])
    spoken = asyncio.run(collect(turn, neutral_on_blocked=False))
    assert spoken and "Wait" not in " ".join(spoken) and "complexity" not in " ".join(spoken)


def test_ordinary_third_person_problem_talk_and_a_spoken_trace_in_the_second_person_are_kept():
    for fine in ("They need the indices, not the values.", "At left one and right eight, the area is forty-nine \u2014 what happens next?",
                 "Actually, that is right.", "Wait, can you say that again?", "Hmm, interesting choice.", "So the heights are 1, 8, 6 and the pointers start at both ends.",
                 "He gave you the array and a target."):
        turn, run, ws, _ = make([say(fine)])
        assert asyncio.run(collect(turn)) == [fine], fine


@pytest.mark.parametrize("sentence,chars_before,reasoning", [
    # Spoken examples and questions to the candidate are speech (polish re-review 2, findings E-G) ...
    ("Suppose a=1, b=2, c=3: what is the sum?", 0, False),
    ("So for i=0, j=1, what's next?", 0, False),
    ("Is the answer for a=3, b=4 equal to five?", 0, False),
    ("The area is forty-nine at l=0, r=8, and then l=1, r=8 gives forty-two; which one wins?", 0, False),
    ("His approach is interesting but unusual; how would you compare yours?", 0, False),
    ("Wait, do you want me to repeat any of that?", 623, False),
    # ... while the real monologues are still caught (b4 strong_fresher seq 28, rh_intro_covers_projects seq 22).
    ("Let me check: heights 1,8,6,2,5,4,8,3,7. l=0,r=8: min=1, width=8, area=8.", 0, True),
    ("They said they have no more questions, which is an acknowledgement.", 0, True),
    ("I should prompt them for their understanding/approach now.", 0, True),
    ("His areas after the first move are wrong. Let me check: heights", 0, True),
])
def test_reasoning_aloud_catches_monologues_but_keeps_examples_and_questions_said_to_them(sentence, chars_before, reasoning):
    from app.interviewer.talker import is_reasoning
    assert is_reasoning(sentence, chars_before) is reasoning


def test_the_coding_part_is_not_declared_done_when_a_problem_is_still_ahead():
    turn, run, ws, _ = make([say("That wraps up the coding part.", "Alright, let's get into the next one.")])
    spoken = asyncio.run(collect(turn, problem_ahead=True))
    assert spoken[0] == "That wraps up this one."
    assert ("That wraps up the coding part.", "That wraps up this one.") in turn.last.repaired
    turn, run, ws, _ = make([say("That wraps up the coding part.")])
    assert asyncio.run(collect(turn)) == ["That wraps up the coding part."]          # nothing ahead: it really is over


def test_go_ahead_and_write_it_is_blocked_once_the_code_is_in_the_editor_and_fine_before():
    for sentence in ("Sure, go ahead and write it.", "Go ahead and code it up.", "Please write it out."):
        turn, *_ = make([say(sentence)])
        assert asyncio.run(collect(turn, has_code=True, neutral_on_blocked=False)) == [] and [b["rule"] for b in turn.last.blocked] == ["asks_code_again"], sentence
        turn, *_ = make([say(sentence)])
        assert asyncio.run(collect(turn, has_code=False)) == [sentence], sentence


@pytest.mark.parametrize("sentence,reasoning", [
    # b7 unplanned_story: the reasoning-aloud guard missed these wordings.
    ("But they named it, don't confirm — actually let me just answer the clarification and get out of the way.", True),
    ("Their trace works either way, but I want to check the code as written.", True),
    # Still speech.
    ("Users and their data stay on the device, right?", False),
    ("What does your trace give for an empty array?", False),
    ("Could you confirm the input is always sorted?", False),
])
def test_reasoning_aloud_also_catches_named_their_trace_and_rules_said_aloud(sentence, reasoning):
    from app.interviewer.talker import is_reasoning
    assert is_reasoning(sentence) is reasoning


def test_a_sentence_already_said_inside_a_longer_one_in_the_same_turn_is_dropped():
    # l1 highlighter rehearsal: "That reasoning on why moving the shorter pointer is safe holds up. That reasoning holds up."
    spoken, blocked = _spoken_for("That reasoning on why moving the shorter pointer is safe holds up. That reasoning holds up. "
                                  "What does it cost in time?")
    assert spoken == ["That reasoning on why moving the shorter pointer is safe holds up.", "What does it cost in time?"]
    assert [b["rule"] for b in blocked] == ["repeat_in_turn"]
    spoken, blocked = _spoken_for("Okay, the stack holds partial sums. What does the stack hold after the second plus?")
    assert len(spoken) == 2 and not blocked                  # a question that reuses words but asks something new is kept


def test_a_bare_acknowledgement_after_the_turns_question_is_dropped_but_one_before_it_stays():
    # bae894ce turn 20: "I can see the board — a box marked "Test box". What were you working through there? Okay."
    spoken, blocked = _spoken_for("I can see the board, a box marked Test box. What were you working through there? Okay.")
    assert spoken == ["I can see the board, a box marked Test box.", "What were you working through there?"]
    assert [b["rule"] for b in blocked] == ["ack_after_question"]
    spoken, blocked = _spoken_for("Okay. What were you working through there?")
    assert spoken == ["Okay.", "What were you working through there?"] and not blocked
    spoken, blocked = _spoken_for("What were you working through there? Got it.")
    assert spoken == ["What were you working through there?"] and [b["rule"] for b in blocked] == ["ack_after_question"]


def test_the_limits_stay_off_the_air_once_the_constraints_are_on_screen_on_any_turn():
    # bae894ce turn 26: a proactive turn said "up to thirty thousand days" eight turns after the constraints were revealed.
    said = "Take your time with it. The series can have up to thirty thousand days. How would you start?"
    turn, *_ = make([say(said)])
    spoken = asyncio.run(collect(turn, limits_revealed=True))
    assert not any("thousand" in x for x in spoken) and [b["rule"] for b in turn.last.blocked] == ["values_aloud"]
    turn, *_ = make([say(said)])
    assert any("thousand" in x for x in asyncio.run(collect(turn)))          # before the reveal the limits are the model's to say
    # "zero" alone is an edge case and an example's digits are the example, not a limit; magnitudes, long numbers and bounds still are.
    for fine in ("What happens when the array is zero length?", "Walk me through the example with 3 and 22. How would you get there?"):
        turn, *_ = make([say(fine)])
        assert " ".join(asyncio.run(collect(turn, limits_revealed=True))) == fine
    for limit in ("Each price is at most 10000.", "The length goes between one and fifty.", "It can have up to 10^5 elements."):
        turn, *_ = make([say(limit)])
        assert asyncio.run(collect(turn, limits_revealed=True, neutral_on_blocked=False)) == [], limit


def test_on_the_turn_of_the_request_every_number_is_blocked_unless_they_asked_a_yes_no_about_a_property():
    turn, *_ = make([say("Let me pull those up for you. It is zero or more.")])
    spoken = asyncio.run(collect(turn, block_values=True))
    assert spoken == ["Let me pull those up for you."] and [b["rule"] for b in turn.last.blocked] == ["values_aloud"]
    turn, *_ = make([say("Yes, zero is allowed.")])
    assert asyncio.run(collect(turn, block_values=True, values_words_ok=True)) == ["Yes, zero is allowed."]


def test_sentences_leaving_the_problem_or_the_coding_are_blocked_while_the_plan_stays_on_it_in_any_wording():
    """Live round 2a2cb5c2 turn 20: "let's leave this one there too ... shift gears, and we'll talk about your projects" with the plan on problem 2."""
    turn, run, ws, _ = make([say("Alright, since you'd like a change, let's leave this one there too.", "Looks like we're not getting much coding going today.",
                                 "Let me shift gears, and we'll talk about your projects and some fundamentals instead.", "How would you start?")])
    spoken = asyncio.run(collect(turn, block_close_coding=True))
    assert spoken == ["How would you start?"]
    assert [b["rule"] for b in turn.last.blocked] == ["left_problem"] * 3


def test_the_put_up_and_intro_lines_of_the_problem_already_on_screen_are_never_said_again_but_the_next_problems_line_is_free():
    turn, run, ws, _ = make([say("Let me put the first problem on your screen.", "Here's your first question.", "The first problem should be up now.",
                                 "Walk me through how you would start?")])
    spoken = asyncio.run(collect(turn, shown_problem=1))
    assert spoken == ["Walk me through how you would start?"]
    assert [b["rule"] for b in turn.last.blocked] == ["problem_already_up"] * 3
    turn, run, ws, _ = make([say("That wraps up this one.", "Let me put the second problem on your screen.")])
    assert asyncio.run(collect(turn, shown_problem=1)) == ["That wraps up this one.", "Let me put the second problem on your screen."]


def test_a_move_the_plan_refused_after_it_was_announced_is_taken_back_in_fixed_words():
    """Speech streams out before the tools run: the go_to was refused after "let's leave this one" had been said."""
    from app.interviewer.talker import STAY_ON_PART, STAY_ON_PROBLEM

    turn, run, ws, _ = make([say("Okay, let's leave this one there.", tools=(("go_to", {"goal_id": "candidate_questions", "why": "x"}),))])
    spoken = asyncio.run(collect(turn))
    assert spoken == ["Okay, let's leave this one there.", STAY_ON_PROBLEM] and turn.last.spoken == spoken
    assert turn.last.tool_calls[0]["result"]["ok"] is False and turn.last.repaired[-1][1] == STAY_ON_PROBLEM
    turn, run, ws, _ = make([say("Tell me how you would start.", tools=(("go_to", {"goal_id": "candidate_questions", "why": "x"}),))])
    assert asyncio.run(collect(turn)) == ["Tell me how you would start."]                  # nothing announced, nothing to take back
    assert STAY_ON_PART != STAY_ON_PROBLEM


def test_leave_taking_is_blocked_while_the_candidates_questions_are_only_being_opened():
    """bf82d318 turn 37: "...thank you for your time today. What questions do you have for me?" ended a 45-minute round at 5 minutes."""
    turn, *_ = make([say("It's your turn - thank you for your time today.", "What questions do you have for me about the role or the team?")])
    spoken = asyncio.run(collect(turn, block_leave_taking=True))
    assert spoken == ["What questions do you have for me about the role or the team?"]
    assert turn.last.blocked[0]["rule"] == "leave_taking_early"
    turn, *_ = make([say("Thanks for your time today.", "Take care.")])
    assert asyncio.run(collect(turn)) == ["Thanks for your time today.", "Take care."]            # the closing is not held back


def test_the_fixed_ending_for_abuse_is_not_held_back_as_leave_taking():
    from app.interviewer.conductor import ABUSE_END_LINE
    turn, *_ = make([say(ABUSE_END_LINE)])
    assert asyncio.run(collect(turn, block_leave_taking=True)) == ["I'm going to end the interview here because of that remark.", "Thank you for your time."]


def test_the_interviewer_never_says_the_line_is_dropping_when_their_words_are_arriving():
    """bf82d318 turns 5-11: Deepgram heard "Vibe" as "by" and "five five" and the interviewer blamed the audio for 70 seconds."""
    from app.interviewer.talker import UNCLEAR_REPLY, CLAIMS_LINE_DROPPING, repair_line_claim
    for text in ("The audio seems to keep dropping on your side.", "Alright, the line keeps dropping on Vibe, so let's not lose more time on it.",
                 "Sorry, I think the line cut off - which project was it?", "Sorry, that didn't come through clearly.", "Your connection looks unstable."):
        assert CLAIMS_LINE_DROPPING.search(text), text
    for text in ("Did you say Vibe?", "Sorry, I didn't quite catch that.", "That line of code breaks when n is zero.", "On line 3 the loop is poor for big inputs.",
                 "Is the connection fine on your side?", "Can you hear me clearly?"):
        assert not CLAIMS_LINE_DROPPING.search(text), text
    assert repair_line_claim("The audio seems to keep dropping on your side.") == UNCLEAR_REPLY
    assert repair_line_claim("Sorry, I think the line cut off — which project was it?") == UNCLEAR_REPLY + " Which project was it?"
    turn, *_ = make([say("The audio seems to keep dropping on your side.", "Did you say Vibe?")])
    assert asyncio.run(collect(turn)) == [UNCLEAR_REPLY, "Did you say Vibe?"]
    turn, *_ = make([say("The audio seems to keep dropping on your side.", "Which project was it?")])
    assert asyncio.run(collect(turn, line_trouble_ok=True)) == ["The audio seems to keep dropping on your side.", "Which project was it?"]


# ---------------------------------------------------------------- the spoken outline against the plan's promises (decided 2026-10-18)

OUTLINE_JD = ("Here's how this round will run: a short chat about your background, then a coding problem, then some quick fundamentals on Java "
              "and databases, and at the end time for your questions.")


def _outline_turn(outline, said):
    turn, *_ = make([say(said)])
    turn.outline_expect = outline

    async def go():
        return [s async for s in turn.run([{"role": "user", "content": "hi"}], turn_id="5", current_slot=None, candidate_said="", framing=True)]

    return turn, asyncio.run(go())


def test_a_spoken_outline_naming_every_promised_area_and_no_other_passes_in_any_wording():
    turn, spoken = _outline_turn((["Java", "databases"], []), OUTLINE_JD)
    assert spoken == [OUTLINE_JD] and not turn.last.blocked
    reworded = ("So the round goes like this: first a short intro from you, then a coding problem, after that a few fundamentals questions "
                "covering SQL and the Java side of things, and finally your questions.")
    turn, spoken = _outline_turn((["Java", "databases"], []), reworded)
    assert spoken == [reworded] and not turn.last.blocked


def test_a_spoken_outline_that_omits_a_promised_area_or_adds_an_unpromised_one_is_held_back():
    turn, spoken = _outline_turn((["Java", "databases"], []), OUTLINE_JD.replace("Java and databases", "databases"))
    assert not any("round will run" in x for x in spoken) and turn.last.blocked[0]["rule"] == "outline_mismatch" and "Java" in turn.last.blocked[0]["match"]
    turn, spoken = _outline_turn((["Java", "databases"], []), OUTLINE_JD.replace("Java and databases", "Java, databases and React"))
    assert not any("round will run" in x for x in spoken) and turn.last.blocked[0]["rule"] == "outline_mismatch" and "React" in turn.last.blocked[0]["match"]


def test_the_outline_is_unchecked_without_a_realism_plan_and_a_projects_promise_only_needs_the_projects_mentioned():
    turn, spoken = _outline_turn(None, OUTLINE_JD.replace("Java and databases", "React"))
    assert spoken and not turn.last.blocked
    with_projects = OUTLINE_JD.replace("some quick fundamentals on Java and databases", "some questions about your projects, then fundamentals on Java")
    turn, spoken = _outline_turn((["Java"], ["Relay"]), with_projects)
    assert spoken == [with_projects] and not turn.last.blocked
    turn, spoken = _outline_turn((["Java"], ["Relay"]), OUTLINE_JD.replace("Java and databases", "Java"))
    assert not any("round will run" in x for x in spoken) and turn.last.blocked[0]["match"] == "does not say it will ask about their projects"


def test_a_language_named_to_code_in_a_label_by_its_words_and_a_project_by_its_name_are_accepted():
    # a language to code in is no fundamentals area
    coding = OUTLINE_JD.replace("a coding problem", "a coding problem you can solve in Java or Python").replace("Java and databases", "databases")
    turn, spoken = _outline_turn((["databases"], []), coding)
    assert spoken == [coding] and not turn.last.blocked
    # ...but a promised Java is still named by its own mention, and a language chain does not hide a real area after "then"
    turn, spoken = _outline_turn((["Java"], []), OUTLINE_JD.replace("Java and databases", "databases"))
    assert turn.last.blocked and turn.last.blocked[0]["rule"] == "outline_mismatch"
    # a promise label outside the known areas is named by its words in any form
    label = OUTLINE_JD.replace("Java and databases", "designing APIs")
    turn, spoken = _outline_turn((["API design"], []), label)
    assert spoken == [label] and not turn.last.blocked
    # "your Relay work" names the projects part without the word "project"
    work = OUTLINE_JD.replace("some quick fundamentals on Java and databases", "your Relay work, then fundamentals on Java")
    turn, spoken = _outline_turn((["Java"], ["Relay"]), work)
    assert spoken == [work] and not turn.last.blocked


# ---------------------------------------------------------------- a refusal says something new each time (decided 2026-10-18)

def _refusal_turn(said, points):
    turn, *_ = make([say(*said)])
    turn.refusal_said = points

    async def go():
        return [s async for s in turn.run([{"role": "user", "content": "hi"}], turn_id="5", current_slot="core-1", candidate_said="")]

    return turn, asyncio.run(go())


def test_a_refusal_sentence_that_makes_a_point_the_round_already_made_is_blocked_but_a_new_point_passes():
    turn, spoken = _refusal_turn(["A partial solution is fine, you know.", "Tell me what your first instinct is."], {"partial_fine"})
    assert spoken == ["Tell me what your first instinct is."]
    assert [b["rule"] for b in turn.last.blocked] == ["repeated_refusal"] and "partial_fine" in turn.last.blocked[0]["match"]
    turn, spoken = _refusal_turn(["Give it a good try first.", "Give this another try as well."], set())
    assert spoken == ["Give it a good try first."] and turn.last.blocked[0]["rule"] == "repeated_refusal"       # the same point twice in one turn
    turn, spoken = _refusal_turn(["Let's stay with this one.", "I'd like you to stick with it a bit longer."], {"partial_fine"})
    assert spoken == ["Let's stay with this one.", "I'd like you to stick with it a bit longer."]                  # holding firm is the refusal: never blocked
    turn, spoken = _refusal_turn(["A partial solution is fine, you know."], None)
    assert spoken == ["A partial solution is fine, you know."]                    # not a refusal turn: nothing is checked


def test_a_length_of_time_the_problem_states_is_spoken_but_the_rounds_time_is_still_blocked():
    """I3: the guard exempts a length found in the current problem's facts or the candidate's words; "twenty-two minutes on problems" stays blocked."""
    turn, run, *_ = make([say("The cache entries expire after 10 minutes, so what happens to a stale entry?",
                              "We'll spend about twenty-two minutes on problems.", "You have 10 minutes left.")])
    run.guard.facts["core-1"] += " Cache entries expire after 10 minutes."
    spoken = asyncio.run(collect(turn))
    assert spoken == ["The cache entries expire after 10 minutes, so what happens to a stale entry?", "You have 10 minutes left."]   # exempt: same length, stated
    assert [b["rule"] for b in turn.last.blocked] == ["time_spoken"] and "twenty-two" in turn.last.blocked[0]["sentence"]


def test_a_second_bare_acknowledgement_in_one_turn_is_dropped_run_b_seq_15():
    turn, *_ = make([say("Okay, cool.", "Hmm, okay.", "How did you pick that structure?")])
    spoken = asyncio.run(collect(turn))
    assert spoken == ["Okay, cool.", "How did you pick that structure?"]
    assert [(b["rule"], b["sentence"]) for b in turn.last.blocked] == [("second_verdict", "Hmm, okay.")]
    one, *_ = make([say("Okay.", "How did you pick that structure?")])
    assert asyncio.run(collect(one)) == ["Okay.", "How did you pick that structure?"] and one.last.blocked == []
