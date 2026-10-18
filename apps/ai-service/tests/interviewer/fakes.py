"""Fakes for the interviewer tests: a scripted chat, workspace, speaker and API."""
from __future__ import annotations

import asyncio
from typing import Any

from app.interviewer.llm import LLMUnavailable, StreamEvent, ToolCall


def say(*sentences: str, tools: tuple[tuple[str, dict], ...] = ()) -> list[StreamEvent]:
    """One scripted talker reply: text chunks, then tool calls, then done."""
    events = [StreamEvent("text", text=s + " ") for s in sentences]
    events += [StreamEvent("tool_call", tool_call=ToolCall(f"c{i}", name, args)) for i, (name, args) in enumerate(tools)]
    return events + [StreamEvent("done", usage={"total_tokens": 10}, provider="fake")]


def state_of(messages: list[dict]) -> str:
    """The per-turn state block of one talker request. It follows the history (prompts.talker_messages), so its index depends on how long the history is."""
    return next(m["content"] for m in messages[1:] if m["role"] == "system" and "## Current item" in m["content"])


class FakeChat:
    """`turns` is consumed one per stream() call; an entry may be a list of events, an Exception to raise
    before the first event, "hang" to never produce one, or ("delay", seconds, events) to produce them after a wait."""

    def __init__(self, turns: list[Any] | None = None, briefs: list[Any] | None = None, model: str = "fake") -> None:
        self.model = model
        self.turns = list(turns or [])
        self.briefs = list(briefs or [])
        self.calls: list[list[dict]] = []
        self.tools_seen: list[list[str]] = []

    async def stream(self, messages, tools=None, max_tokens=400):
        self.calls.append(messages)
        self.tools_seen.append([t["function"]["name"] for t in tools or []])
        turn = self.turns.pop(0) if self.turns else [StreamEvent("done")]
        if isinstance(turn, tuple) and turn[0] == "delay":
            await asyncio.sleep(turn[1])
            turn = turn[2]
        if turn == "hang":
            await asyncio.sleep(3600)
        if isinstance(turn, Exception):
            raise turn
        for event in turn:
            await asyncio.sleep(0)
            yield event

    async def json(self, messages, schema_name, schema, max_tokens=3000):
        self.calls.append(messages)
        brief = self.briefs.pop(0) if self.briefs else LLMUnavailable("no brief scripted")
        if isinstance(brief, Exception):
            raise brief
        return brief, {"total_tokens": 5}

    async def aclose(self):
        pass


class FakeWorkspace:
    def __init__(self) -> None:
        self.sent: list[dict] = []
        self.lines: list[str] = []
        self.png: bytes | None = None
        self.board_summary = ""
        self.mirror: dict = {}
        self.cards: dict[str, dict] = {}
        self.acks: dict[str, dict] = {}

    async def send(self, body: dict) -> str:
        self.sent.append(body)
        if body["type"] == "panel.show_problem":
            self.cards.setdefault(body["item_id"], {"sections": []}).update(item_id=body["item_id"])
        elif body["type"] == "panel.add_section" and body["item_id"] in self.cards:
            self.cards[body["item_id"]]["sections"].append(body["section"])
        return f"m{len(self.sent)}"

    def code_lines(self) -> list[str]:
        return self.lines

    async def wait_ready(self, timeout: float) -> bool:
        return True

    async def request_snapshot(self) -> bytes | None:
        return self.png

    def mirror_state(self) -> dict:
        return self.mirror

    def restore_mirror(self, data: dict) -> None:
        self.mirror = data

    def of(self, message_type: str) -> list[dict]:
        return [m for m in self.sent if m["type"] == message_type]


class FakeSpeaker:
    def __init__(self) -> None:
        self.replies = 0
        self.said: list[str] = []
        self.backchannels: list[str] = []
        self.deleted = False

    def reply(self) -> None:
        self.replies += 1

    def backchannel(self, text: str) -> None:
        self.backchannels.append(text)

    async def say(self, text: str) -> None:
        self.said.append(text)

    async def wait_for_playout(self) -> None:
        pass

    async def delete_room(self) -> None:
        self.deleted = True


class FakeApi:
    def __init__(self) -> None:
        self.ended: list[tuple[str, str, dict]] = []

    async def end(self, session_id: str, reason: str, summary: dict) -> dict:
        self.ended.append((session_id, reason, summary))
        return {"status": "COMPLETED"}
