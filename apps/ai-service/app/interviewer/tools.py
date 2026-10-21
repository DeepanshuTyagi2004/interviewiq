"""The talker's tools (spec §5.1) and their execution against the conductor and the workspace."""
from __future__ import annotations

from typing import TYPE_CHECKING, Any

from app.interviewer.closing import asks_for_next_problem, leaves_the_part
from app.interviewer.llm import ToolCall
from app.interviewer.plan import problem_payload, reveal_text, slot_by_id
from app.interviewer.protocol import new_id

if TYPE_CHECKING:
    from app.interviewer.run import InterviewRun


def _tool(name: str, description: str, properties: dict[str, Any], required: tuple[str, ...] = ()) -> dict[str, Any]:
    return {"type": "function", "function": {"name": name, "description": description,
                                             "parameters": {"type": "object", "properties": properties, "required": list(required)}}}


_STR = {"type": "string"}
_INT = {"type": "integer"}
_ELEMENT = {"type": "object", "properties": {
    "type": {"type": "string", "enum": ["rectangle", "ellipse", "diamond", "text", "arrow"]}, "id": _STR, "label": _STR,
    "x": {"type": "number"}, "y": {"type": "number"}, "from": _STR, "to": _STR}, "required": ["type", "id"]}

TOOLS: list[dict[str, Any]] = [
    _tool("show_problem", "Put the current problem (statement and two examples) on the candidate's screen.", {"item_id": _STR}),
    _tool("reveal", "Add the problem's exact constraints or input/output format to the screen. Only when asked.",
          {"kind": {"type": "string", "enum": ["constraints", "format"]}}, ("kind",)),
    _tool("add_section", "Add a clarification, explanation or note you gave to the problem panel.",
          {"kind": {"type": "string", "enum": ["clarification", "explanation", "note"]}, "title": _STR, "body": _STR}, ("kind", "body")),
    _tool("highlight_statement", "Highlight a passage of the problem statement, quoting its exact words.",
          {"quote": _STR, "note": _STR}, ("quote",)),
    _tool("code_comment", "Leave a comment in the candidate's code, at the top or above a line.",
          {"line": _INT, "text": _STR, "purpose": {"type": "string", "enum": ["question", "doubt", "hint"]}}, ("text",)),
    _tool("code_insert", "Insert a short stub or test input (at most 10 lines). Never solution code.",
          {"line": _INT, "text": _STR, "purpose": {"type": "string", "enum": ["stub", "test_input"]}}, ("text", "purpose")),
    _tool("code_highlight", "Mark lines of the candidate's code, optionally with a note.",
          {"start_line": _INT, "end_line": _INT, "note": _STR}, ("start_line",)),
    _tool("draw", "Draw simple boxes, ellipses, text and arrows on the whiteboard.",
          {"elements": {"type": "array", "items": _ELEMENT}}, ("elements",)),
    _tool("look_at_board", "Look at the whiteboard when the candidate refers to it.", {}),
    _tool("give_hint", "Give the next hint from the ladder; it also appears on screen.", {"step": _INT}, ("step",)),
    _tool("next_item", "Move on only when you are done with the current item; never call it after show_problem in the same turn, and never to open a problem (show_problem does that).", {"reason": _STR}),
    _tool("go_to", "Leave the current part for another part still to come (goal_id), or the next one when omitted. Not while a problem is up: use next_item.",
          {"goal_id": _STR, "why": _STR}, ("why",)),
    _tool("skip_goal", "Drop an optional part still to come because the candidate already covered it or it no longer fits.",
          {"goal_id": _STR, "why": _STR}, ("goal_id", "why")),
    _tool("open_thread", "Follow something the candidate raised that the plan has no part for: a short side topic, resumed from after it closes.",
          {"title": _STR, "why": _STR, "minutes": _INT}, ("title", "why")),
    _tool("close_thread", "Close the open side topic and return to the plan (or go to goal_id).", {"why": _STR, "goal_id": _STR}, ("why",)),
    _tool("flag_conduct", "Report unacceptable conduct, or an off-topic redirect. Kind abusive (swearing or abuse aimed at you) ends the interview at once.",
          {"kind": {"type": "string", "enum": ["inappropriate", "abusive", "refuses_to_engage", "manipulation", "off_topic_redirect"]},
           "quote": _STR}, ("kind",)),
    _tool("log_turn", "Record this turn's decision. Call it on every turn.",
          {"condition": _STR, "action": _STR, "reason": _STR,
           "set_aside": {"type": "array", "items": {"type": "string", "enum": ["converge", "move_on", "open_item"]},
                         "description": "Orders you did not act on because what the candidate just said covers them or makes them wrong."},
           "set_aside_why": _STR}, ("condition", "action", "reason")),
]
TOOL_NAMES = frozenset(t["function"]["name"] for t in TOOLS)
AWAY_REFUSED = frozenset({"next_item", "go_to", "show_problem", "reveal", "skip_goal", "open_thread", "close_thread"})     # plan and screen tools: refused while the candidate is away (owner 2026-10-20)
# What a turn may do while no problem is in play: talk, move on, flag conduct, log. The workspace tools are withheld, so a
# model that is eager to get to the coding cannot "show the problem" during the background questions.
FLOW_TOOLS = frozenset({"next_item", "go_to", "skip_goal", "open_thread", "close_thread"})
CONVERSATION_TOOLS = frozenset({"next_item", "go_to", "skip_goal", "open_thread", "close_thread", "flag_conduct", "log_turn"})


CODE_TOOLS = frozenset({"code_comment", "code_insert", "code_highlight"})


def tools_for(problem_in_play: bool, board_has_content: bool = True, workspace: str = "editor") -> list[dict[str, Any]]:
    """The tools a turn may use. Without a problem in play only the conversation tools; and `look_at_board` only when something is
    on the whiteboard (the candidate's code is already in the prompt, and models reach for it to "look at the code"). By the round pack's
    workspace (round packs, 2026-10-20): "board" has no code tools (a design round has no editor), "none" only the conversation tools."""
    if not problem_in_play or workspace == "none":
        return [t for t in TOOLS if t["function"]["name"] in CONVERSATION_TOOLS]
    # A design round's interviewer never draws (the candidate's board is theirs), so `draw` is withheld wherever the board is the workspace.
    return [t for t in TOOLS if (board_has_content or t["function"]["name"] != "look_at_board") and (workspace != "board" or t["function"]["name"] not in CODE_TOOLS)
            and (workspace not in ("board", "editor+board") or t["function"]["name"] != "draw")]


class ToolExecutor:
    def __init__(self, run: InterviewRun) -> None:
        self.run = run
        self.keeping_problem = False          # set each turn by the run: the turn carries a keep_problem order, so no hint may be given

    async def execute(self, call: ToolCall, turn_id: str) -> dict[str, Any]:
        if call.name not in TOOL_NAMES or call.name == "log_turn":
            return {"ok": False, "error": f"unknown tool {call.name!r}"}
        if call.name in AWAY_REFUSED and getattr(self._conductor, "away_paused", lambda: False)():
            return {"ok": False, "error": "the candidate is away from the screen: nothing moves until they are back, so do not say anything is on their screen"}
        handler = getattr(self, f"_{call.name}")
        try:
            return await handler(call.arguments or {}, turn_id)
        except (KeyError, TypeError, ValueError) as exc:  # pydantic's ValidationError is a ValueError
            return {"ok": False, "error": f"bad arguments: {exc}"}

    # ------------------------------------------------------------ helpers

    @property
    def _conductor(self):
        return self.run.conductor

    def _slot(self) -> dict[str, Any] | None:
        return slot_by_id(self.run.d.blueprint, self._conductor.current().slot_id)

    async def _send(self, body: dict[str, Any]) -> str:
        message_id = await self.run.d.workspace.send(body)
        self.run.actions[message_id] = body["type"]   # so a refusal in the browser's ack can be told to the talker
        return message_id

    def _code(self) -> list[str]:
        """The code the talker was shown when this turn began, so line numbers mean what it saw."""
        seen = self.run.code_seen
        return seen if seen is not None else self.run.d.workspace.code_lines()

    def _line(self, n: int) -> str | None:
        lines = self._code()
        return lines[n - 1] if 1 <= n <= len(lines) else None

    def _anchor(self, line: Any) -> Any:
        """"top", or the line with its text (the browser follows the text if the code has moved). None: no such line."""
        if line in (None, 0, "top"):
            return "top"
        n = int(line)
        expect = self._line(n)
        return None if expect is None else {"line": n, "expect": expect}

    def _screen_check(self, *texts: str) -> str | None:
        """The rule that blocks text meant for the candidate's screen, or None if it is fine."""
        said = self.run.candidate_said.get(self._conductor.current().item_id, "")
        for text in texts:
            verdict = self.run.guard.check_text(text, said)
            if not verdict.ok:
                return verdict.rule
        return None

    def _wire(self, slot: dict[str, Any]) -> str:
        return self.run.wire.get(slot["slot_id"], slot["slot_id"])

    def _names_another_problem(self, asked: Any, current_slot_id: str) -> bool:
        """The `item_id` the talker gave names a different problem of this round. Anything else (nothing, the current id, the name of the
        part it is in, a word it made up) means the current problem: a refusal over a label once left a promised problem off the screen."""
        asked = str(asked or "")
        if not asked:
            return False
        asked = self._conductor.resolve(asked)
        others = {sid for sid in self.run.wire if sid != current_slot_id} | {w for sid, w in self.run.wire.items() if sid != current_slot_id}
        return asked in others

    def _on_screen(self) -> bool:
        slot = self._slot()
        return slot is not None and self._wire(slot) in self.run.d.workspace.cards

    def in_play(self) -> bool:
        """The current item has started: its problem is on the candidate's screen, or the question was asked aloud (nothing is put on the screen for it).
        The one test for "started" (round packs): never `_on_screen` alone, which is False for a question asked aloud."""
        return self._on_screen() or self._conductor.is_opened_aloud(self._conductor.current())

    def _not_started(self, on_screen_text: str) -> str:
        """The refusal for an item not started: a question asked aloud is asked first (never "call show_problem")."""
        return on_screen_text if self.shows_card() else "you have not asked this question yet: ask it aloud first, in your own words"

    def shows_card(self) -> bool:
        """The current item is a problem the run puts on the candidate's screen (a question asked aloud has no card)."""
        item = self._conductor.current()
        return item.kind == "slot" and bool(self._conductor.words_for(item)["on_screen"])

    def _section(self, slot: dict[str, Any], section_id: str, kind: str, title: str, body: str) -> dict[str, Any]:
        return {"type": "panel.add_section", "item_id": self._wire(slot),
                "section": {"id": section_id, "kind": kind, "title": title[:120], "body": body[:4000], "author": "interviewer"}}

    # ------------------------------------------------------------ tools

    async def _show_problem(self, args: dict[str, Any], turn_id: str) -> dict[str, Any]:
        item = self._conductor.current()
        if item.kind == "thread" and not self._conductor.ended:
            # Closing the thread to the problem ends the part it paused (it does not resume it): the same move and the same checks
            # as any other jump, so the talker's labels lagging behind the plan never keep the problem off the screen.
            first = next((i for i in self._conductor.items if i.kind == "slot" and i.status == "pending"), None)
            if first is None:
                return {"ok": False, "error": "there is no problem to show after this part: do not say a problem is on their screen; "
                                              "carry on with this part's conversation"}
            ok, why = self._conductor.close_thread("problem requested", target=first.item_id)
            if not ok:
                return {"ok": False, "error": f"not yet: {why}; do not say a problem is on their screen"}
            item = self._conductor.current()
        elif item.kind == "phase" and not self._conductor.ended:
            # The talker is still on a background phase but wants the problem up: when that phase is done, move the plan
            # on for it (the tools of one turn can arrive in either order), otherwise say what is left to do first.
            if self._conductor.problem_allowed():
                # The conversation before the coding is done (or its time is up): the plan runs through whatever background parts
                # are left, so the talker's labels lagging behind it never keep the problem off the screen.
                while self._conductor.current().kind != "slot" and not self._conductor.ended:
                    self._conductor.next_item("problem requested")
                item = self._conductor.current()
            else:
                nxt = next((i for i in self._conductor.items[self._conductor.index + 1:] if i.status == "pending"), None)
                if nxt is None or nxt.kind != "slot":
                    return {"ok": False, "error": "there is no problem to show after this part: do not say a problem is on their screen; "
                                                  "carry on with this part's conversation"}
                ok, why = self._conductor.can_advance()
                if not ok:
                    return {"ok": False, "error": f"not yet: {why}; do not say a problem is on their screen"}
                self._conductor.next_item("problem requested")
                item = self._conductor.current()
        slot = self._slot()
        if item.kind == "slot" and not self._conductor.words_for(item)["on_screen"]:
            return {"ok": False, "error": "this question is asked aloud: nothing is put on their screen for it, so never call show_problem or say it is up"}
        if slot is None or item.slot_id is None or self._names_another_problem(args.get("item_id"), item.slot_id):
            return {"ok": False, "error": "show_problem only shows the current problem"}
        label = self._conductor.label_for(item.slot_id)
        if self._wire(slot) in self.run.d.workspace.cards:
            return {"ok": True, "already": True, "label": label}   # on screen already: nothing to send
        await self._mark_replaced(label, slot)
        self.run._problem_shown_at = self.run.d.clock()        # the first seconds after a problem goes up lean to "reading it aloud" (addressed.py)
        return {"ok": True, "label": label, "message_id": await self._send(problem_payload(slot, label, self._wire(slot)))}

    async def _mark_replaced(self, label: str, new_slot: dict[str, Any]) -> None:
        """A problem that takes the place of one on screen (a reserve swapped in) keeps its label, so the old tab is re-sent as "Problem 2
        (replaced)" first (decided 2026-10-18): the page merges a re-sent card, keeps its sections and does not bring it to the front."""
        cards = self.run.d.workspace.cards
        for old in self._conductor.items:
            slot = slot_by_id(self.run.d.blueprint, old.slot_id) if old.kind == "slot" else None
            if (old.status != "swapped" or slot is None or slot["slot_id"] == new_slot["slot_id"]
                    or self._conductor.labels.get(old.item_id) != label or self._wire(slot) not in cards):
                continue
            if str(cards[self._wire(slot)].get("label") or label) != label:
                continue                                    # already marked
            await self._send(problem_payload(slot, f"{label} (replaced)", self._wire(slot)))

    async def _reveal(self, args, turn_id):
        slot, kind = self._slot(), args.get("kind")
        text = reveal_text(slot, kind) if slot and kind in ("constraints", "format") else None
        if not text:
            return {"ok": False, "error": "nothing to reveal for this item"}
        title = "Constraints" if kind == "constraints" else "Input and output"
        section_id = f"{kind}-{self._wire(slot)}"
        shown = self.run.d.workspace.cards.get(self._wire(slot), {}).get("sections", [])
        if any(sec["id"] == section_id for sec in shown):
            return {"ok": True, "already": True}
        return {"ok": True, "message_id": await self._send(self._section(slot, section_id, kind, title, text))}

    async def _add_section(self, args, turn_id):
        slot, kind = self._slot(), args.get("kind")
        body = str(args.get("body") or "").strip()
        if not slot or kind not in ("clarification", "explanation", "note") or not body:
            return {"ok": False, "error": "needs a problem on screen, a kind and a body"}
        title = str(args.get("title") or kind.title())
        if (rule := self._screen_check(title, body)) is not None:
            return {"ok": False, "error": f"blocked ({rule})"}
        return {"ok": True, "message_id": await self._send(self._section(slot, new_id("sec"), kind, title, body))}

    async def _highlight_statement(self, args, turn_id):
        slot, quote = self._slot(), str(args.get("quote") or "").strip()[:500]
        if not slot or not quote:
            return {"ok": False, "error": "needs a problem on screen and a quote"}
        body: dict[str, Any] = {"type": "panel.highlight", "item_id": self._wire(slot), "highlight_id": new_id("hl"), "quote": quote}
        if args.get("note"):
            if (rule := self._screen_check(str(args["note"])[:300])) is not None:
                return {"ok": False, "error": f"blocked ({rule})"}
            body["note"] = str(args["note"])[:300]
        return {"ok": True, "message_id": await self._send(body)}

    async def _code_comment(self, args, turn_id):
        text = str(args.get("text") or "").strip()[:1000]
        if not text:
            return {"ok": False, "error": "blocked (empty)"}
        if (rule := self._screen_check(text)) is not None:
            return {"ok": False, "error": f"blocked ({rule})"}
        at = self._anchor(args.get("line"))
        if at is None:
            return {"ok": False, "error": f"there is no line {args.get('line')} in the code you were shown"}
        purpose = args.get("purpose") if args.get("purpose") in ("question", "doubt", "hint") else "question"
        return {"ok": True, "message_id": await self._send({"type": "code.comment", "at": at, "text": text, "purpose": purpose})}

    async def _code_insert(self, args, turn_id):
        text = str(args.get("text") or "").rstrip()[:2000]
        if not text or args.get("purpose") not in ("stub", "test_input"):
            return {"ok": False, "error": "blocked (needs text and a purpose)"}
        if (rule := self._screen_check(text)) is not None:
            return {"ok": False, "error": f"blocked ({rule})"}
        at = self._anchor(args.get("line"))
        if at is None:
            return {"ok": False, "error": f"there is no line {args.get('line')} in the code you were shown"}
        return {"ok": True, "message_id": await self._send({"type": "code.insert", "at": at, "text": text, "purpose": args["purpose"]})}

    async def _code_highlight(self, args, turn_id):
        start = int(args["start_line"])
        end = max(start, int(args.get("end_line") or start))
        expect = self._line(start)
        if expect is None or self._line(end) is None:
            return {"ok": False, "error": f"there is no line {end if expect is not None else start} in the code you were shown"}
        body: dict[str, Any] = {"type": "code.highlight", "highlight_id": new_id("ch"), "start_line": start, "end_line": end,
                                "expect": expect}
        if args.get("note"):
            if (rule := self._screen_check(str(args["note"])[:300])) is not None:
                return {"ok": False, "error": f"blocked ({rule})"}
            body["note"] = str(args["note"])[:300]
        return {"ok": True, "message_id": await self._send(body)}

    async def _draw(self, args, turn_id):
        elements = list(args.get("elements") or [])
        if (rule := self._screen_check(*(str(e.get("label")) for e in elements if isinstance(e, dict) and e.get("label")))) is not None:
            return {"ok": False, "error": f"blocked ({rule})"}
        return {"ok": True, "message_id": await self._send({"type": "board.draw", "elements": elements})}

    async def _look_at_board(self, args, turn_id):
        png = await self.run.d.workspace.request_snapshot()
        return {"ok": True, "image": png} if png else {"ok": False, "error": "the whiteboard is empty or didn't answer. The candidate's code is "
                                                                           "already in your live state: read it and comment on it now"}

    async def _give_hint(self, args, turn_id):
        slot = self._slot()
        if not self.in_play():
            return {"ok": False, "error": self._not_started("the problem is not on screen yet; call show_problem first")}
        ladder = {int(h["step"]): h["hint"] for h in (slot or {}).get("hint_ladder", [])}
        # (live round 781a1f0a, turns 27-33) A refusal turn gave hint 1 and the next turn jumped to hint 2: never in a turn that keeps the
        # problem, and never past the next step.
        if self.keeping_problem:
            return {"ok": False, "error": "you are keeping the problem this turn: no hint"}
        given = self._conductor.current().hint_step
        step = int(args.get("step") or given + 1)
        if step > given + 1:
            return {"ok": False, "error": f"give hint step {given + 1} first"}
        if step not in ladder:
            return {"ok": False, "error": f"no hint step {step}"}
        self._conductor.record_hint(step)
        await self._send(self._section(slot, f"hint-{self._wire(slot)}-{step}", "hint", f"Hint {step}", ladder[step]))
        return {"ok": True, "step": step, "hint": ladder[step]}

    async def _next_item(self, args, turn_id):
        ok, why = self._conductor.can_advance()
        if not ok:
            return {"ok": False, "error": f"not yet: {why}"}
        item = self._conductor.current()
        slot = self._slot()
        elapsed = self._conductor.clock() - (item.started_at or self._conductor.clock())
        if item.kind == "slot" and slot is not None and not self.in_play() and elapsed < item.max_seconds:
            return {"ok": False, "error": self._not_started("this problem has not been shown to the candidate yet: call show_problem now, "
                                                            "do not skip it")}
        ahead = self._conductor.peek_next()
        if getattr(self._conductor, "opens_coding_problem", lambda t: False)(ahead) \
                and getattr(self.run.talker, "_asks_this_turn", lambda: False)():
            return self._asks_refusal()          # (a move to a phase with its opening question is the intended flow and is not refused)
        may_leave, why_not = self._conductor.may_leave_problem(item)
        if not may_leave:
            # It has just gone up and they have not spoken: a next_item now means "go to the problem" said by mistake, and would end
            # a must-cover problem with no attempt. Checked first: the "still asking" refusal below would send the model to say it is moving on,
            # which on a problem that has just gone up is the wrong thing to fix (live round c8e70bb8, turn 15).
            return {"ok": False, "error": why_not}
        gave_up = self._conductor.gave_up(item)      # the interviewer let this problem go on their ask (a change or the end of the coding): it is over
        if item.kind == "slot" and elapsed < item.max_seconds and not leaves_the_part(" ".join(self.run.talker.last.spoken)) \
                and not asks_for_next_problem(getattr(self.run, "unanswered", None) or "") and not gave_up:
            return {"ok": False, "error": "you are still asking about this problem: do not call next_item until you have finished with "
                                          "it and tell them you are moving on (say so in the same turn)"}
        if item.kind == "slot":
            self._conductor.plan_extra_problem()       # time to spare after the last problem: another one follows
        nxt = self._conductor.next_item(str(args.get("reason") or "done")[:200])
        return {"ok": True, "now": self._conductor.public_id(nxt) if nxt else None}

    @staticmethod
    def _asks_refusal() -> dict[str, Any]:
        return {"ok": False, "deferred": True, "error": "you asked a question in this turn, so the coding problem is not opened now: ask your question, and move to "
                                      "the problem in your next turn, after they answer"}

    @staticmethod
    def _why(args) -> str:
        return str(args.get("why") or "").strip()[:200] or "no reason given"

    @staticmethod
    def _id(args, key: str = "goal_id") -> str:
        v = args.get(key)
        return v.strip() if isinstance(v, str) else ""

    def _flow_result(self, moved: tuple[bool, str]) -> dict[str, Any]:
        ok, error = moved
        if not ok:
            return {"ok": False, "error": error}
        item = self._conductor.current()
        return {"ok": True, "now": self._conductor.public_id(item) if item else None}

    async def _go_to(self, args, turn_id):
        why, target = self._why(args), self._id(args)
        if self._conductor.current().kind == "slot":
            nxt = self._conductor.peek_next()
            if not target or (nxt is not None and self._conductor.resolve(target) == nxt.item_id):
                result = await self._next_item({"reason": why}, turn_id)
                return result if not result.get("ok") else {"ok": True, "now": result.get("now")}
            return {"ok": False, "error": "finish this problem first: call next_item when it is done"}
        goal = self._conductor.resolve(target) if target else None
        dest = next((i for i in self._conductor.items if i.item_id == goal), None) if goal else self._conductor.peek_next()
        if getattr(self._conductor, "opens_coding_problem", lambda t: False)(dest) \
                and getattr(self.run.talker, "_asks_this_turn", lambda: False)():
            return self._asks_refusal()
        return self._flow_result(self._conductor.go_to(target or None, why))

    async def _skip_goal(self, args, turn_id):
        target = self._id(args)
        if not target:
            return {"ok": False, "error": "name the part to skip (goal_id)"}
        return self._flow_result(self._conductor.skip_goal(target, self._why(args)))

    async def _open_thread(self, args, turn_id):
        title = str(args.get("title") or "").strip()[:120]
        if not title:
            return {"ok": False, "error": "give the thread a title"}
        raw = args.get("minutes")
        minutes: int | None = None
        if isinstance(raw, int) and not isinstance(raw, bool):
            minutes = raw
        elif isinstance(raw, str) and raw.strip().lstrip("-").isdigit():
            minutes = int(raw.strip())
        return self._flow_result(self._conductor.open_thread(title, self._why(args), minutes))

    async def _close_thread(self, args, turn_id):
        return self._flow_result(self._conductor.close_thread(self._why(args), self._id(args) or None))

    async def _flag_conduct(self, args, turn_id):
        kind = str(args.get("kind") or "")
        if kind == "off_topic_redirect":
            order = self._conductor.on_redirect(turn_id)
        else:
            order = self._conductor.on_conduct(kind or "inappropriate", str(args.get("quote") or ""), turn_id, "talker")
        return {"ok": True, "order": order.kind if order else None}
