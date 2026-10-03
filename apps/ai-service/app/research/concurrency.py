"""Ordered, fail-fast fan-out for research nodes (evidence-hardening spec §11).

Concurrency is BOUNDED at the gateway (ResearchIO's run-wide Exa/LLM semaphores), so nodes may fan
out over sources and roles freely. gather_ordered keeps results in input order (drafts stay
deterministic) and re-raises the real error, never an ExceptionGroup, so the runner still sees
BudgetExhausted / FixtureMissing / CancelledError by type."""
from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Iterable
from typing import TypeVar

T = TypeVar("T")


def _leaves(group: BaseExceptionGroup) -> list[BaseException]:
    out: list[BaseException] = []
    for exc in group.exceptions:
        out += _leaves(exc) if isinstance(exc, BaseExceptionGroup) else [exc]
    return out


async def gather_ordered(coros: Iterable[Awaitable[T]]) -> list[T]:
    coros = list(coros)
    if not coros:
        return []
    tasks: list[asyncio.Task] = []
    try:
        async with asyncio.TaskGroup() as group:
            for coro in coros:
                tasks.append(group.create_task(coro))
    except BaseExceptionGroup as failed:
        errors = _leaves(failed)
        raise next((e for e in errors if not isinstance(e, asyncio.CancelledError)), errors[0]) from None
    return [task.result() for task in tasks]   # a child that raised CancelledError re-raises it here
