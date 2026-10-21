"""Tools, layout and fixed lines follow the round's pack (round packs, task 8)."""
import asyncio
import re
from types import SimpleNamespace

from app.interviewer.lines import BRIDGE_POOLS, LINES, bridge_variant, matches, ordinal_of, pack_key, put_up_ordinals
from app.interviewer.conductor import Conductor
from app.interviewer.llm import ToolCall
from app.interviewer.plan import build_items, layout_for, part_nouns, problem_intro, problem_put_up, wire_ids
from app.interviewer.run import InterviewRun, RunDeps
from app.interviewer.store import MemoryStore
from app.interviewer.tools import CONVERSATION_TOOLS, ToolExecutor, tools_for
from app.rounds.compose import PACKS, compose_rules
from tests.interviewer.fakes import FakeApi, FakeChat, FakeSpeaker, FakeWorkspace, say
from tests.interviewer.fixtures import Clock, blueprint, context
from tests.interviewer.test_conductor import _round_blueprint, _round_conductor, _to_slot

CODE_TOOLS = {"code_comment", "code_insert", "code_highlight"}


def _names(tools):
    return {t["function"]["name"] for t in tools}


def _bp(round_type, **extra):
    bp = blueprint()
    bp["round"] = {**bp["round"], "type": round_type, "level": "sde1"}
    bp["rules"] = compose_rules(round_type, "sde1")
    return bp | extra


# ------------------------------------------------------------------ tools by workspace

def test_the_tools_offered_follow_the_workspace():
    editor, both, board, none = (_names(tools_for(True, True, w)) for w in ("editor", "editor+board", "board", "none"))
    assert editor == _names(tools_for(True, True)) and CODE_TOOLS <= editor and "look_at_board" in editor and "show_problem" in editor and "draw" in editor
    assert both == editor - {"draw"}                        # a design round's interviewer never draws (final review M2)
    assert board == editor - CODE_TOOLS - {"draw"} and "draw" not in board and "show_problem" in board
    assert none == set(CONVERSATION_TOOLS) and _names(tools_for(False, True, "board")) == set(CONVERSATION_TOOLS)
    assert "look_at_board" not in _names(tools_for(True, False, "board"))


# ------------------------------------------------------------------ pack pools

def test_pack_key_names_the_packs_own_pool_and_the_dsa_key_never_changes():
    assert pack_key("bridge:first", "system-design") == "bridge:first@system-design"
    assert pack_key("bridge:first", "dsa") == "bridge:first" and pack_key("put_up:second", "dsa") == "put_up:second"
    assert pack_key("problem", "behavioural") == "problem@behavioural" and pack_key("bridge:next", "behavioural") == "bridge:next"
    assert problem_put_up(1, None) == LINES["put_up:first"][0] and problem_intro(2, None) == LINES["intro:second"][0]


def test_every_pack_wording_matches_its_key_and_no_banned_word_is_in_a_design_or_behavioural_pool():
    pools = {**LINES, **BRIDGE_POOLS}
    registered = {k: v for k, v in pools.items() if "@" in k}
    assert {k.split("@")[1] for k in registered} == {"system-design", "lld", "behavioural", "hiring-manager"}
    for key, pool in registered.items():
        base, pack_id = key.split("@")
        banned = [re.compile(b, re.IGNORECASE) for b in PACKS[pack_id].banned_spoken]
        for wording in pool:
            assert not any(b.search(wording) for b in banned), (key, wording)
            if key in LINES:
                assert matches(key, wording) and matches(base, wording), (key, wording)


def test_the_design_put_up_line_is_recognised_as_a_put_up_by_the_echo_and_leak_matchers():
    line = PACKS["system-design"].lines["put_up:first"][0]
    assert put_up_ordinals(line) == ["first"] and ordinal_of(line) == "first" and matches("put_up", line)
    assert problem_put_up(1, None, pack_id="system-design") == LINES["put_up:first@system-design"][0]
    assert put_up_ordinals("Let me put the second problem on your screen.") == ["second"]


def test_the_bridge_link_comes_from_the_rounds_pack_and_a_dsa_blueprint_keeps_todays():
    sd = _bp("system-design", realism={"seed": "r1"})
    assert bridge_variant(sd, "problem") in PACKS["system-design"].lines["problem"]
    assert bridge_variant(sd, "problem") in BRIDGE_POOLS["problem@system-design"]
    assert bridge_variant(_bp("dsa", realism={"seed": "r1"}), "problem") in BRIDGE_POOLS["problem"]
    assert bridge_variant(blueprint(), "problem") == BRIDGE_POOLS["problem"][0]
    assert bridge_variant(sd, "problem", "behavioural") in PACKS["behavioural"].lines["problem"]      # a culture slot uses the behavioural links


def test_layout_and_part_nouns_follow_the_pack():
    bh = _round_blueprint("behavioural")
    assert all(layout_for(bh, i) == "talk" for i in build_items(bh))
    assert part_nouns(_bp("system-design")) == ("a design problem", "the design part")
    assert part_nouns(_bp("lld")) == ("a design problem", "the design part")
    assert part_nouns(bh) == ("some questions about your experience", "the questions")
    assert part_nouns(blueprint()) == ("some coding", "the coding")


# ------------------------------------------------------------------ an item asked aloud is in play

def _executor(round_type):
    c, clock = _round_conductor(round_type)
    _to_slot(c)
    bp = c.blueprint
    run = SimpleNamespace(conductor=c, wire=wire_ids(bp), unanswered="", talker=SimpleNamespace(last=SimpleNamespace(spoken=[])),
                          d=SimpleNamespace(blueprint=bp, workspace=FakeWorkspace(), clock=clock))
    return ToolExecutor(run), c


def test_next_item_is_not_refused_for_a_behavioural_question_asked_aloud():
    async def go():
        tools, c = _executor("behavioural")
        assert not tools.in_play() and not tools.shows_card()
        c.consume([o for o in c.pending_orders() if o.opens_aloud])
        assert c.is_opened_aloud(c.current()) and tools.in_play()
        c.current().turns = 5
        return await tools.execute(ToolCall(id="n", name="next_item", arguments={"reason": "done"}), "1")

    result = asyncio.run(go())
    assert "show_problem" not in str(result.get("error", ""))


def test_show_problem_is_refused_for_a_question_asked_aloud():
    async def go():
        tools, _ = _executor("behavioural")
        return await tools.execute(ToolCall(id="s", name="show_problem", arguments={}), "1"), tools.run.d.workspace
    result, ws = asyncio.run(go())
    assert not result["ok"] and not ws.sent


def test_a_timer_move_on_into_a_behavioural_slot_puts_no_card_on_the_screen():
    async def go():
        clock = Clock()
        deps = RunDeps(blueprint=_round_blueprint("behavioural"), context=context(), talker_chat=FakeChat([say("Thanks, that helps.")]),
                       director_chat=FakeChat(briefs=[]), workspace=FakeWorkspace(), api=FakeApi(), store=MemoryStore(), clock=clock,
                       first_token_timeout_s=0.2)
        run = InterviewRun(deps)
        run.speaker = FakeSpeaker()
        await run.start(None)
        c = run.conductor
        while c.current().item_id != "core-1":
            c.current().turns = 5
            c.next_item("t")
        c.consume([o for o in c.pending_orders() if o.opens_aloud])
        clock.advance(c.current().max_seconds + 5)
        await run.tick()
        pieces = [p async for p in run.reply(None)]
        run.on_conversation_item("assistant", " ".join(pieces), False)
        for _ in range(5):
            await asyncio.sleep(0)
        return deps.workspace

    ws = asyncio.run(go())
    assert not any(m["type"] == "panel.show_problem" for m in ws.sent)


# ------------------------------------------------------------------ fix round 1

def test_no_key_resolves_for_a_pack_to_a_wording_its_own_banned_words_forbid():
    """Every pack x every line and link key: the pool pack_key / bridge_variant resolves (the pack's own, else the default) is clean."""
    keys = [*LINES, *BRIDGE_POOLS]
    for pack in PACKS.values():
        banned = [re.compile(b, re.IGNORECASE) for b in pack.banned_spoken]
        for key in (k for k in keys if "@" not in k):
            resolved = pack_key(key, pack.pack_id)
            pool = BRIDGE_POOLS.get(resolved) or LINES.get(resolved)
            assert pool, (pack.pack_id, key)
            assert pack.pack_id == "dsa" or resolved == key or resolved.endswith(f"@{pack.pack_id}")
            if pack.pack_id in ("dsa", "online-assessment"):
                continue
            for wording in pool:
                assert not any(b.search(wording) for b in banned), (pack.pack_id, key, wording)
    for pack_id, rt in (("system-design", "system-design"), ("lld", "lld"), ("behavioural", "behavioural"), ("hiring-manager", "hiring-manager")):
        bp = _bp(rt, realism={"seed": "z"})
        for key in (k for k in BRIDGE_POOLS if "@" not in k):
            banned = [re.compile(b, re.IGNORECASE) for b in PACKS[pack_id].banned_spoken]
            assert not any(b.search(bridge_variant(bp, key)) for b in banned), (pack_id, key)


def test_a_design_pack_has_put_up_and_intro_for_the_later_positions_too():
    for pack_id in ("system-design", "lld"):
        for o in ("second", "third", "fourth"):
            assert f"put_up:{o}@{pack_id}" in LINES and o in LINES[f"put_up:{o}@{pack_id}"][0]
            assert f"intro:{o}@{pack_id}" in LINES
        assert pack_key("bridge:next", pack_id) == f"bridge:next@{pack_id}"


def test_the_turn_that_leaves_a_culture_slot_for_a_coding_problem_still_offers_show_problem():
    bp = _round_blueprint("dsa")
    bp["slots"][0]["slot_id"] = "culture-1"
    bp["slots"][0]["problem"]["round_type"] = "behavioural"
    cond = Conductor(bp, 3600, clock=Clock())
    cond.start()
    while cond.current().item_id != "culture-1":
        cond.next_item("t")
    run = SimpleNamespace(conductor=cond, d=SimpleNamespace(workspace=FakeWorkspace()))
    names = _names(InterviewRun._tools_for_turn(run, True, cond.current()))
    assert "show_problem" in names and "next_item" in names
    assert "show_problem" not in _names(tools_for(True, True, cond.workspace_for(cond.current())))


def test_the_current_item_block_for_a_behavioural_question_says_ask_it_aloud_and_never_the_screen():
    from app.interviewer.prompts import item_details
    bp = _round_blueprint("behavioural")
    item = {"kind": "slot", "item_id": "number 1", "slot_id": "core-1", "aloud": True, "shown": False, "culture": False, "hint_step": 0}
    text = item_details(bp, item)
    assert "ask it aloud" in text and "Tell me about a time number 1 went wrong." in text
    assert "call show_problem, then" not in text and "ALREADY on their screen" not in text
    asked = item_details(bp, item | {"shown": True})
    assert "already asked it" in asked and "show_problem" not in asked


def test_next_item_and_hint_refusals_for_an_unasked_question_never_mention_show_problem():
    async def go():
        tools, c = _executor("behavioural")
        c.current().turns = 5
        a = await tools.execute(ToolCall(id="h", name="give_hint", arguments={}), "1")
        b = await tools.execute(ToolCall(id="n", name="next_item", arguments={}), "1")
        return a, b
    a, b = asyncio.run(go())
    assert "show_problem" not in str(a.get("error")) and "show_problem" not in str(b.get("error"))
