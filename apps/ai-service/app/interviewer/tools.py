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
    _tool("next_item", "The current item is finished; move to the next one.", {"reason": _STR}),
    _tool("flag_conduct", "Report unacceptable conduct, or an off-topic redirect.",
          {"kind": {"type": "string", "enum": ["inappropriate", "abusive", "refuses_to_engage", "manipulation", "off_topic_redirect"]},
           "quote": _STR}, ("kind",)),
    _tool("log_turn", "Record this turn's decision. Call it on every turn.",
          {"condition": _STR, "action": _STR, "reason": _STR}, ("condition", "action", "reason")),
]
TOOL_NAMES = frozenset(t["function"]["name"] for t in TOOLS)
# What a turn may do while no problem is in play: talk, move on, flag conduct, log. The workspace tools are withheld, so a
# model that is eager to get to the coding cannot "show the problem" during the background questions.
CONVERSATION_TOOLS = frozenset({"next_item", "flag_conduct", "log_turn"})


def tools_for(problem_in_play: bool, board_has_content: bool = True) -> list[dict[str, Any]]:
    """The tools a turn may use. Without a problem in play only the conversation tools; and `look_at_board` only when something is
    on the whiteboard (the candidate's code is already in the prompt, and models reach for it to "look at the code")."""
    if not problem_in_play:
        return [t for t in TOOLS if t["function"]["name"] in CONVERSATION_TOOLS]
    return [t for t in TOOLS if board_has_content or t["function"]["name"] != "look_at_board"]


class ToolExecutor:
    def __init__(self, run: InterviewRun) -> None:
        self.run = run

    async def execute(self, call: ToolCall, turn_id: str) -> dict[str, Any]:
        if call.name not in TOOL_NAMES or call.name == "log_turn":
            return {"ok": False, "error": f"unknown tool {call.name!r}"}
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

    def _on_screen(self) -> bool:
        slot = self._slot()
        return slot is not None and self._wire(slot) in self.run.d.workspace.cards

    def _section(self, slot: dict[str, Any], section_id: str, kind: str, title: str, body: str) -> dict[str, Any]:
        return {"type": "panel.add_section", "item_id": self._wire(slot),
                "section": {"id": section_id, "kind": kind, "title": title[:120], "body": body[:4000], "author": "interviewer"}}

    # ------------------------------------------------------------ tools

    async def _show_problem(self, args: dict[str, Any], turn_id: str) -> dict[str, Any]:
        item = self._conductor.current()
        if item.kind == "phase" and not self._conductor.ended:
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
        if slot is None or item.slot_id is None or (args.get("item_id") or item.slot_id) not in (item.slot_id, self._wire(slot)):
            return {"ok": False, "error": "show_problem only shows the current problem"}
        label = self._conductor.label_for(item.slot_id)
        if self._wire(slot) in self.run.d.workspace.cards:
            return {"ok": True, "already": True, "label": label}   # on screen already: nothing to send
        return {"ok": True, "label": label, "message_id": await self._send(problem_payload(slot, label, self._wire(slot)))}

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
        if not self._on_screen():
            return {"ok": False, "error": "the problem is not on screen yet; call show_problem first"}
        ladder = {int(h["step"]): h["hint"] for h in (slot or {}).get("hint_ladder", [])}
        step = int(args.get("step") or self._conductor.current().hint_step + 1)
        if step not in ladder:
            return {"ok": False, "error": f"no hint step {step}"}
        self._conductor.record_hint(step)
        await self._send(self._section(slot, f"hint-{self._wire(slot)}-{step}", "hint", f"Hint {step}", ladder[step]))
        return {"ok": True, "step": step}

    async def _next_item(self, args, turn_id):
        ok, why = self._conductor.can_advance()
        if not ok:
            return {"ok": False, "error": f"not yet: {why}"}
        item = self._conductor.current()
        slot = self._slot()
        elapsed = self._conductor.clock() - (item.started_at or self._conductor.clock())
        if item.kind == "slot" and slot is not None and not self._on_screen() and elapsed < item.max_seconds:
            return {"ok": False, "error": "this problem has not been shown to the candidate yet: call show_problem now, "
                                          "do not skip it"}
        if item.kind == "slot" and elapsed < item.max_seconds and not leaves_the_part(" ".join(self.run.talker.last.spoken)) \
                and not asks_for_next_problem(getattr(self.run, "unanswered", None) or ""):
            return {"ok": False, "error": "you are still asking about this problem: do not call next_item until you have finished with "
                                          "it and tell them you are moving on (say so in the same turn)"}
        if item.kind == "slot":
            self._conductor.plan_extra_problem()       # time to spare after the last problem: another one follows
        nxt = self._conductor.next_item(str(args.get("reason") or "done")[:200])
        return {"ok": True, "now": nxt.item_id if nxt else None}

    async def _flag_conduct(self, args, turn_id):
        kind = str(args.get("kind") or "")
        if kind == "off_topic_redirect":
            order = self._conductor.on_redirect(turn_id)
        else:
            order = self._conductor.on_conduct(kind or "inappropriate", str(args.get("quote") or ""), turn_id, "talker")
        return {"ok": True, "order": order.kind if order else None}
