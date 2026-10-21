"""The workspace protocol (spec §6), mirroring apps/web/features/interview-live/protocol/messages.ts
(the Zod source). Both sides test against packages/contracts/live-workspace.examples.json."""
from __future__ import annotations

import itertools
import json
import time
from typing import Annotated, Any, Literal, Union

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, ValidationError

PROTOCOL_VERSION = 1
WORKSPACE_TOPIC = "workspace"
BOARD_SNAPSHOT_TOPIC = "workspace.board.snapshot"
BOARD_BACKUP_TOPIC = "workspace.board.backup"
BOARD_RESTORE_TOPIC = "workspace.board.restore"

Id = Annotated[str, Field(min_length=1, max_length=64)]
Line = Annotated[int, Field(ge=1)]
SectionKind = Literal["constraints", "format", "clarification", "hint", "explanation", "note"]
Author = Literal["interviewer", "candidate"]
CodeLanguage = Literal["python", "javascript", "typescript", "java", "cpp", "go"]
EndReason = Literal["completed", "ended_by_interviewer", "candidate_ended", "technical"]
ProctorKind = Literal["tab_hidden", "window_blur", "external_display", "fullscreen_exit", "share_stopped", "foreign_paste"]
AwayKind = Literal["tab_hidden", "window_blur", "fullscreen_exit", "share_stopped"]


class _M(BaseModel):
    model_config = ConfigDict(extra="ignore", populate_by_name=True)


class _Msg(_M):
    v: Literal[1]
    id: Id


class Example(_M):
    input: str = Field(max_length=4000)
    output: str = Field(max_length=4000)
    explanation: str | None = Field(None, max_length=2000)


class Section(_M):
    id: Id
    kind: SectionKind
    title: str = Field(min_length=1, max_length=120)
    body: str = Field(min_length=1, max_length=4000)
    author: Author


class WireHighlight(_M):
    highlight_id: Id
    quote: str = Field(min_length=1, max_length=500)
    occurrence: int = Field(ge=0)
    note: str | None = Field(None, max_length=300)
    author: Author


class Card(_M):
    item_id: Id
    label: str = Field(min_length=1, max_length=40)
    kind: Literal["problem", "question"]
    statement: str = Field(min_length=1, max_length=20000)
    examples: list[Example] = Field(max_length=2)
    sections: list[Section] = Field(max_length=50)
    highlights: list[WireHighlight] = Field(max_length=100)


class LineAt(_M):
    line: Line
    expect: str = Field(max_length=1000)


class DrawElement(_M):
    type: Literal["rectangle", "ellipse", "diamond", "text", "arrow"]
    id: Id
    label: str | None = Field(None, max_length=200)
    x: float | None = None
    y: float | None = None
    from_: Id | None = Field(None, alias="from")
    to: Id | None = None


# ---------------------------------------------------------------- agent → web

class ShowProblem(_Msg):
    type: Literal["panel.show_problem"]
    item_id: Id
    label: str = Field(min_length=1, max_length=40)
    kind: Literal["problem", "question"]
    statement: str = Field(min_length=1, max_length=20000)
    examples: list[Example] = Field(max_length=2)


class AddSection(_Msg):
    type: Literal["panel.add_section"]
    item_id: Id
    section: Section


class PanelHighlight(_Msg):
    type: Literal["panel.highlight"]
    item_id: Id
    highlight_id: Id
    quote: str = Field(min_length=1, max_length=500)
    occurrence: int | None = Field(None, ge=0)
    note: str | None = Field(None, max_length=300)


class PanelClearHighlight(_Msg):
    type: Literal["panel.clear_highlight"]
    highlight_id: Id


class CodeComment(_Msg):
    type: Literal["code.comment"]
    at: Literal["top"] | LineAt
    text: str = Field(min_length=1, max_length=1000)
    purpose: Literal["question", "doubt", "hint"]


class CodeInsert(_Msg):
    type: Literal["code.insert"]
    at: Literal["top"] | LineAt
    text: str = Field(min_length=1, max_length=2000)
    purpose: Literal["stub", "test_input"]


class CodeHighlight(_Msg):
    type: Literal["code.highlight"]
    highlight_id: Id
    start_line: Line
    end_line: Line
    expect: str = Field(max_length=1000)
    note: str | None = Field(None, max_length=300)


class CodeClearHighlight(_Msg):
    type: Literal["code.clear_highlight"]
    highlight_id: Id


class BoardRequestSnapshot(_Msg):
    type: Literal["board.request_snapshot"]
    request_id: Id


class BoardDraw(_Msg):
    type: Literal["board.draw"]
    elements: list[DrawElement] = Field(min_length=1, max_length=40)


class RestoreCode(_M):
    language: CodeLanguage
    text: str = Field(max_length=100000)


class WorkspaceRestore(_Msg):
    type: Literal["workspace.restore"]
    cards: list[Card] = Field(max_length=20)
    active_item_id: Id | None
    code: RestoreCode | None
    board: bool


RoomLayout = Literal["talk", "work"]


class RoomState(_Msg):
    """The room's layout (`talk`: the conversation full width, `work`: beside the problem and editor) and whether the
    interviewer is slow to answer. Sent whole on every change and again after a `workspace.hello`."""
    type: Literal["room.state"]
    layout: RoomLayout
    slow: bool


class SessionEnding(_Msg):
    type: Literal["session.ending"]
    reason: EndReason
    message: str = Field(max_length=1000)


class AddressedStateMsg(_Msg):
    """Whether the interviewer is listening only for direct questions on the current item (it invited questions: "let me know if..."). The panel note follows it."""
    type: Literal["addressed.state"]
    direct_only: bool


_AGENT_MODELS = (ShowProblem, AddSection, PanelHighlight, PanelClearHighlight, CodeComment, CodeInsert, CodeHighlight,
                 CodeClearHighlight, BoardRequestSnapshot, BoardDraw, WorkspaceRestore, RoomState, SessionEnding, AddressedStateMsg)
AgentMessage = Annotated[Union[_AGENT_MODELS], Field(discriminator="type")]

# ---------------------------------------------------------------- web → agent


class Ack(_Msg):
    type: Literal["ack"]
    ref: Id
    ok: bool
    reason: str | None = Field(None, max_length=200)


class SectionAdded(_Msg):
    type: Literal["panel.section_added"]
    item_id: Id
    section: Section


class HighlightAdded(_Msg):
    type: Literal["panel.highlight_added"]
    item_id: Id
    highlight_id: Id
    quote: str = Field(min_length=1, max_length=500)
    occurrence: int = Field(ge=0)


class CodeHighlightAdded(_Msg):
    type: Literal["code.highlight_added"]
    start_line: Line
    end_line: Line
    text: str = Field(max_length=4000)


class AskSelection(_Msg):
    type: Literal["ask.selection"]
    surface: Literal["statement", "code", "board"]
    quote: str = Field(min_length=1, max_length=4000)
    item_id: Id | None = None
    lines: tuple[int, int] | None = None


class CodeSnapshot(_Msg):
    type: Literal["code.snapshot"]
    version: int = Field(ge=0)
    language: CodeLanguage
    text: str = Field(max_length=100000)


class BoardSummary(_Msg):
    type: Literal["board.summary"]
    version: int = Field(ge=0)
    text: str = Field(max_length=20000)


class ProctorCounts(_M):
    tab_changes: int = Field(ge=0)
    screen_changes: float = Field(ge=0)
    full_violations: int = Field(ge=0)


class ProctorEventMessage(_Msg):
    type: Literal["proctor.event"]
    kind: ProctorKind
    weight: Literal[1, 0.5]
    at: int = Field(ge=0)
    counts: ProctorCounts
    source: str | None = Field(default=None, max_length=40)
    chars: int | None = Field(default=None, ge=0)
    lines: int | None = Field(default=None, ge=0)


class Hello(_Msg):
    type: Literal["workspace.hello"]
    has_content: bool


class EndRequest(_Msg):
    type: Literal["session.end_request"]


class ProctorAway(_Msg):
    type: Literal["proctor.away"]
    kinds: list[AwayKind] = Field(min_length=1, max_length=4)
    at: int = Field(ge=0)


class ProctorBack(_Msg):
    type: Literal["proctor.back"]
    at: int = Field(ge=0)


class AskInterviewer(_Msg):
    type: Literal["ask.interviewer"]
    at: int = Field(ge=0)


class TypingStat(_M):
    median: float = Field(ge=0)
    cv: float = Field(ge=0)


class TypingWindow(_Msg):
    type: Literal["typing.window"]
    t0: int = Field(ge=0)
    t1: int = Field(ge=0)
    keys: int = Field(ge=0)
    chars: int = Field(ge=0)
    iki: TypingStat | None = None
    dwell: TypingStat | None = None
    backspaces: int = Field(ge=0)
    nav: int = Field(ge=0)
    longest_pause: float = Field(ge=0)
    jumps: int = Field(ge=0)
    untrusted: int = Field(ge=0)
    charless: int = Field(ge=0)


class _Event(_M):
    t: int = Field(ge=0)


class PtrCode(_Event):
    k: Literal["ptr"]
    s: Literal["code"]
    line: Line
    col: Annotated[int, Field(ge=1)]
    text: str = Field(max_length=80)


class PtrBoard(_Event):
    k: Literal["ptr"]
    s: Literal["board"]
    x: float
    y: float
    over: str | None = Field(None, max_length=60)


class PtrPanel(_Event):
    k: Literal["ptr"]
    s: Literal["panel"]
    quote: str = Field(max_length=120)


class PtrOut(_Event):
    k: Literal["ptr"]
    s: Literal["out"]


class SelPanel(_Event):
    """Text the candidate selected in the problem ("" once the selection is cleared): "this part" is resolved to it."""
    k: Literal["sel"]
    s: Literal["panel"]
    text: str = Field(max_length=300)


class Caret(_Event):
    k: Literal["caret"]
    line: Line
    col: Annotated[int, Field(ge=1)]
    sel: tuple[Line, Line] | None = None
    text: str | None = Field(None, max_length=120)


class Edit(_Event):
    k: Literal["edit"]
    from_line: Line
    to_line: Line
    ins: str = Field(max_length=200)
    removed: int = Field(ge=0)


class Shape(_Event):
    k: Literal["shape"]
    op: Literal["add", "move", "edit", "delete"]
    id: Id
    kind: str = Field(min_length=1, max_length=30, pattern=r"^[a-z]+$")   # Excalidraw element types: rectangle, arrow, freedraw…
    label: str | None = Field(None, max_length=60)


class Focus(_Event):
    k: Literal["focus"]
    s: Literal["code", "board", "panel"]


ActivityEvent = Union[PtrCode, PtrBoard, PtrPanel, PtrOut, SelPanel, Caret, Edit, Shape, Focus]
ACTIVITY_MAX_EVENTS = 60


class ActivityBatch(_Msg):
    type: Literal["activity.batch"]
    sent_at: int = Field(ge=0)
    events: list[ActivityEvent] = Field(min_length=1, max_length=ACTIVITY_MAX_EVENTS)


_WEB_MODELS = (Ack, SectionAdded, HighlightAdded, CodeHighlightAdded, AskSelection, CodeSnapshot, BoardSummary,
               ProctorEventMessage, Hello, EndRequest, ProctorAway, ProctorBack, AskInterviewer, ActivityBatch, TypingWindow)
WebMessage = Annotated[Union[_WEB_MODELS], Field(discriminator="type")]

_AGENT = TypeAdapter(AgentMessage)
_WEB = TypeAdapter(WebMessage)

AGENT_TYPES: set[str] = {m.model_fields["type"].annotation.__args__[0] for m in _AGENT_MODELS}
WEB_TYPES: set[str] = {m.model_fields["type"].annotation.__args__[0] for m in _WEB_MODELS}

_seq = itertools.count(1)


def new_id(prefix: str = "a") -> str:
    return f"{prefix}_{int(time.time() * 1000):x}_{next(_seq):x}"


def parse_web(raw: str) -> Any | None:
    """A web → agent message from a text stream, or None if it isn't one this version understands."""
    try:
        return _WEB.validate_json(raw)
    except (ValidationError, ValueError):
        return None


def agent_message(body: dict[str, Any]) -> dict[str, Any]:
    """Stamp `v` and `id` on an agent → web body, validate it, and return the wire dict."""
    model = _AGENT.validate_python({**body, "v": PROTOCOL_VERSION, "id": new_id("a")})
    return json.loads(model.model_dump_json(by_alias=True, exclude_none=True))
