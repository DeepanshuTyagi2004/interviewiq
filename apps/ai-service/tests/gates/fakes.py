from __future__ import annotations

import asyncio

from app.gates.log import MemoryGateLog  # noqa: F401  (re-export for later tasks)
from app.llm.decisions import Decision


def decision(p: dict[str, float], model: str = "typesafe/jev-1.14-test") -> Decision:
    return Decision(answers={k: {"noul": v} for k, v in p.items()}, model=model,
                    cost_usd=0.000005, input_tokens=100, latency_ms=12)


class FakeDecisions:
    """Scripted result per call: a Decision, an Exception instance, or ("sleep", seconds, Decision).
    The last script entry repeats once the list is exhausted."""

    def __init__(self, *script) -> None:
        self.script = list(script)
        self.calls = 0
        self.closed = False
        self.cancelled = False

    async def decide(self, state, questions, **kw):
        item = self.script[min(self.calls, len(self.script) - 1)]
        self.calls += 1
        if isinstance(item, tuple) and item and item[0] == "sleep":
            try:
                await asyncio.sleep(item[1])
            except asyncio.CancelledError:
                self.cancelled = True
                raise
            item = item[2]
        if isinstance(item, BaseException):
            raise item
        return item

    async def aclose(self) -> None:
        self.closed = True
