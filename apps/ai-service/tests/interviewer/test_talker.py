"""One talker turn: guarded sentences, tools after the text, the whiteboard follow-up, timeouts, interruption."""
import asyncio
import json
from types import SimpleNamespace

import pytest

from app.interviewer.conductor import Conductor
from app.interviewer.guard import NEUTRAL_LINE, LeakGuard
from app.interviewer.llm import LLMUnavailable
from app.interviewer.talker import STALL_LINE, TalkerFailed, TalkerTurn
from app.interviewer.tools import ToolExecutor
from tests.interviewer.fakes import FakeChat, FakeWorkspace, say
from app.interviewer.plan import wire_ids
from tests.interviewer.fixtures import Clock, blueprint


def make(turns, timeout=0.2):
    bp = blueprint()
    conductor = Conductor(bp, 3600, clock=Clock(), skills=["Java"])
    conductor.start()
    conductor.next_item("done")
    conductor.next_item("done")  # now on core-1
    workspace = FakeWorkspace()
    run = SimpleNamespace(conductor=conductor, guard=LeakGuard(bp), actions={}, code_seen=None, candidate_said={}, wire=wire_ids(bp),
                          d=SimpleNamespace(blueprint=bp, workspace=workspace))
    chat = FakeChat(turns)
    turn = TalkerTurn(chat, run.guard, ToolExecutor(run), first_token_timeout_s=timeout)
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


def test_retries_silently_then_stalls_then_fails():
    turn, *_ = make([LLMUnavailable("down"), "hang", say("Back with you.")])
    assert asyncio.run(collect(turn)) == [STALL_LINE, "Back with you."]
    turn, *_ = make([LLMUnavailable("down"), LLMUnavailable("down"), LLMUnavailable("down")])
    with pytest.raises(TalkerFailed):
        asyncio.run(collect(turn))


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
