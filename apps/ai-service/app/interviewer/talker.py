"""One talker turn (spec §5.1), independent of LiveKit: stream the reply from OpenRouter, pass each
sentence through the leak guard before it is spoken, then run the turn's tool calls. A `look_at_board`
call adds a second generation that sees the whiteboard. Tools run only if the reply wasn't cut off."""
from __future__ import annotations

import asyncio
import base64
import re
import time
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Callable

from app.interviewer.guard import NEUTRAL_LINE, LeakGuard
from app.interviewer.llm import LLMUnavailable, StreamEvent, ToolCall
from app.interviewer.tools import TOOLS, ToolExecutor

SENTENCE_END = re.compile(r"(?<=[.!?])\s+")
STALL_LINE = "Give me a second."
SILENT = "<silent>"


class TalkerFailed(Exception):
    """Three attempts at a reply failed."""


@dataclass
class TurnResult:
    spoken: list[str] = field(default_factory=list)
    blocked: list[dict[str, Any]] = field(default_factory=list)
    tool_calls: list[dict[str, Any]] = field(default_factory=list)
    decision: dict[str, Any] | None = None
    first_token_ms: int | None = None
    usage: dict[str, Any] = field(default_factory=dict)
    provider: str | None = None
    interrupted: bool = False
    error: str | None = None


class TalkerTurn:
    def __init__(self, chat, guard: LeakGuard, tools: ToolExecutor, first_token_timeout_s: float,
                 clock: Callable[[], float] = time.perf_counter) -> None:
        self.chat = chat
        self.guard = guard
        self.tools = tools
        self.timeout = first_token_timeout_s
        self.clock = clock
        self.last = TurnResult()

    async def run(self, messages: list[dict[str, Any]], *, turn_id: str, current_slot: str | None,
                  candidate_said: str) -> AsyncIterator[str]:
        result = TurnResult()
        self.last = result
        started = self.clock()
        calls: list[ToolCall] = []
        try:
            async for sentence in self._generate(messages, result, started, calls, current_slot, candidate_said, with_tools=True):
                yield sentence
            image: bytes | None = None
            # next_item first: the model often lists show_problem before the next_item that makes it valid, and the
            # candidate should still see the problem (stable sort keeps every other call in the order it was made).
            for call in sorted(calls, key=lambda c: c.name != "next_item"):
                if call.name == "log_turn":
                    result.decision = {k: call.arguments.get(k) for k in ("condition", "action", "reason")}
                    continue
                outcome = await self.tools.execute(call, turn_id)
                result.tool_calls.append({"name": call.name, "arguments": call.arguments,
                                          "result": {k: v for k, v in outcome.items() if k != "image"}})
                if call.name == "look_at_board" and outcome.get("image"):
                    image = outcome["image"]
            if image is not None:
                follow = [*messages,
                          {"role": "assistant", "content": " ".join(result.spoken) or "Let me take a look."},
                          {"role": "user", "content": [
                              {"type": "text", "text": "(The whiteboard as it looks now. React in one or two spoken sentences.)"},
                              {"type": "image_url", "image_url": {"url": "data:image/png;base64," + base64.b64encode(image).decode()}}]}]
                async for sentence in self._generate(follow, result, started, [], current_slot, candidate_said, with_tools=False):
                    yield sentence
            if not result.spoken and result.blocked:
                result.spoken.append(NEUTRAL_LINE)
                yield NEUTRAL_LINE
        except (asyncio.CancelledError, GeneratorExit):
            result.interrupted = True
            raise

    async def _open(self, messages, with_tools: bool) -> tuple[Any, StreamEvent]:
        stream = self.chat.stream(messages, tools=TOOLS if with_tools else None)
        try:
            first = await asyncio.wait_for(stream.__anext__(), timeout=self.timeout)
        except BaseException:
            await stream.aclose()
            raise
        return stream, first

    async def _generate(self, messages, result: TurnResult, started: float, calls: list[ToolCall],
                        current_slot: str | None, candidate_said: str, *, with_tools: bool) -> AsyncIterator[str]:
        stream = first = None
        for attempt in (1, 2, 3):
            try:
                stream, first = await self._open(messages, with_tools)
                break
            except (TimeoutError, LLMUnavailable, StopAsyncIteration) as exc:
                if attempt == 2:
                    result.spoken.append(STALL_LINE)
                    yield STALL_LINE
                if attempt == 3:
                    result.error = f"{type(exc).__name__}: {exc}"
                    raise TalkerFailed(result.error) from exc

        async def events():
            yield first
            async for event in stream:
                yield event

        buffer = ""
        try:
            async for event in events():
                if event.kind == "text":
                    if result.first_token_ms is None:
                        result.first_token_ms = int((self.clock() - started) * 1000)
                    buffer += event.text
                    *done, buffer = SENTENCE_END.split(buffer)
                    for sentence in done:
                        if (out := self._check(sentence, result, current_slot, candidate_said)) is not None:
                            yield out
                elif event.kind == "tool_call" and event.tool_call is not None:
                    calls.append(event.tool_call)
                elif event.kind == "done":
                    result.usage, result.provider = event.usage, event.provider
        except LLMUnavailable as exc:
            result.error = str(exc)  # a broken stream mid-reply: keep what was already spoken
        if (out := self._check(buffer, result, current_slot, candidate_said)) is not None:
            yield out

    def _check(self, sentence: str, result: TurnResult, current_slot: str | None, candidate_said: str) -> str | None:
        text = sentence.strip()
        if not text or text == SILENT:
            return None
        verdict = self.guard.check_sentence(text, current_slot=current_slot, candidate_said=candidate_said)
        if not verdict.ok:
            result.blocked.append({"sentence": text, "rule": verdict.rule, "match": verdict.match})
            return None
        result.spoken.append(text)
        return text
