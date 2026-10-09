"""The director (spec §5.2): a background LLM that reads the whole interview every few turns and writes
a structured brief. Single flight: triggers that arrive while a run is in progress merge into the
next run. It never speaks; failures are logged and the talker keeps the last brief."""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Any, Awaitable, Callable

from pydantic import ValidationError

from app.interviewer.brief import BRIEF_SCHEMA, Brief

logger = logging.getLogger(__name__)


class Director:
    def __init__(self, chat, build_messages: Callable[[], Awaitable[list[dict[str, Any]]]],
                 on_brief: Callable[[Brief, dict[str, Any]], Awaitable[None]],
                 on_failure: Callable[[str], Awaitable[None]] | None = None) -> None:
        self.chat = chat
        self.build_messages = build_messages
        self.on_brief = on_brief
        self.on_failure = on_failure
        self._pending: set[str] = set()
        self._task: asyncio.Task | None = None
        self.runs = 0
        self.failures = 0

    def trigger(self, reasons: set[str]) -> None:
        if not reasons:
            return
        self._pending |= set(reasons)
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._loop())

    async def _loop(self) -> None:
        while self._pending:
            reasons, self._pending = self._pending, set()
            started = time.perf_counter()
            try:
                messages = await self.build_messages()
                data, usage = await self.chat.json(messages, "brief", BRIEF_SCHEMA)
                brief = Brief.model_validate(data)
            except (ValidationError, Exception) as exc:  # noqa: BLE001 - never let a brief failure end the round
                self.failures += 1
                logger.warning("director run failed: %s", exc)
                if self.on_failure is not None:
                    await self.on_failure(f"{type(exc).__name__}: {exc}")
                continue
            self.runs += 1
            await self.on_brief(brief, {"triggers": sorted(reasons), "usage": usage,
                                        "latency_ms": int((time.perf_counter() - started) * 1000)})

    async def idle(self) -> None:
        while self._task is not None and not self._task.done():
            await self._task

    async def aclose(self) -> None:
        if self._task is not None and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
