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
    assert spoken[1] in RECOVERY_SHORT                       # "There." after a short wait
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
