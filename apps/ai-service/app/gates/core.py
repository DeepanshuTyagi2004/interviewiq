"""Decision gates: ask Jev a cheap yes/no before (or beside) an expensive LLM call."""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import random
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from enum import StrEnum
from typing import TYPE_CHECKING, Awaitable, Callable, Generic, TypeVar

from app.llm.decisions import DecisionsClient

if TYPE_CHECKING:
    from app.gates.log import GateLog

logger = logging.getLogger(__name__)
T = TypeVar("T")

DEFAULT_ASK_TIMEOUT_SECONDS = 9.0   # the default client timeout (8 s) + 1 s; build_gate derives it from settings


class GateMode(StrEnum):
    OFF = "off"
    SHADOW = "shadow"
    ON = "on"


@dataclass(frozen=True)
class Verdict:
    p_yes: float | None
    answers: dict
    model: str | None
    cost_usd: float
    latency_ms: int
    error: str | None


@dataclass
class GatedResult(Generic[T]):
    value: T
    skipped: bool
    verdict: Verdict | None
    record_id: str | None


def _unknown(error: str, latency_ms: int = 0) -> Verdict:
    return Verdict(p_yes=None, answers={}, model=None, cost_usd=0.0, latency_ms=latency_ms, error=error[:200])


class Gate:
    def __init__(self, stage: str, *, mode: GateMode, skip_below: float,
                 client: DecisionsClient | None, log: "GateLog",
                 ask_timeout_seconds: float = DEFAULT_ASK_TIMEOUT_SECONDS, audit_rate: float = 0.0,
                 rng: Callable[[], float] = random.random) -> None:
        self.stage = stage
        self.mode = mode
        self.skip_below = skip_below
        self.log = log
        self.ask_timeout_seconds = ask_timeout_seconds
        self.audit_rate = audit_rate
        self._rng = rng
        self._client = client

    @property
    def active(self) -> bool:
        return self.mode != GateMode.OFF and self._client is not None

    async def ask(self, state, questions: dict, *, skip_question: str) -> Verdict:
        """Never raises except CancelledError; any failure is an unknown verdict (with its real elapsed time)."""
        if self._client is None:
            return _unknown("no client")
        started = time.monotonic()
        try:
            d = await asyncio.wait_for(self._client.decide(state, questions), self.ask_timeout_seconds)
            return Verdict(p_yes=d.p_yes(skip_question), answers=d.answers, model=d.model,
                           cost_usd=d.cost_usd, latency_ms=d.latency_ms, error=None)
        except Exception as exc:  # noqa: BLE001 — Jev must never break the pipeline
            return _unknown(f"{type(exc).__name__}: {exc}", int((time.monotonic() - started) * 1000))

    def should_skip(self, v: Verdict) -> bool:
        return self.mode == GateMode.ON and v.p_yes is not None and v.p_yes < self.skip_below

    def audit(self) -> bool:
        """ON mode: run the LLM anyway on this share of would-be skips, so lost positives stay measurable."""
        return self.audit_rate > 0 and self._rng() < self.audit_rate


async def _cancel(task: asyncio.Task) -> None:
    task.cancel()
    try:
        await task
    except BaseException:  # noqa: BLE001 — drain the cancelled task
        pass
    # Draining swallows every CancelledError, including one aimed at the caller while it waited here.
    current = asyncio.current_task()
    if current is not None and hasattr(current, "cancelling") and current.cancelling():
        raise asyncio.CancelledError


async def _settle(task: asyncio.Task) -> Verdict:
    """Shadow mode never adds latency: use Jev's verdict only if it is already done."""
    if task.done():
        return task.result()
    await _cancel(task)
    return Verdict(p_yes=None, answers={}, model=None, cost_usd=0.0, latency_ms=0, error="slower_than_llm")


def state_hash(state) -> str:
    text = state if isinstance(state, str) else json.dumps(state, ensure_ascii=False, sort_keys=True, default=str)
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


async def _record(gate: Gate, *, state, questions: dict, v: Verdict, skipped: bool,
                  llm_label: dict | None, llm_error: str | None, llm_latency_ms: int | None,
                  context: dict, audit: bool = False) -> str | None:
    doc = {
        "stage": gate.stage, "mode": str(gate.mode), "created_at": datetime.now(timezone.utc),
        "model": v.model, "state": state, "state_hash": state_hash(state),
        "questions": list(questions), "answers": v.answers, "p_yes": v.p_yes,
        "skipped": skipped, "audit": audit, "jev_error": v.error, "jev_cost_usd": v.cost_usd,
        "jev_latency_ms": v.latency_ms, "llm_label": llm_label, "llm_error": llm_error,
        "llm_latency_ms": llm_latency_ms, "context": context,
    }
    try:
        return await gate.log.insert(doc)
    except Exception as exc:  # noqa: BLE001
        logger.warning("[gate] log write failed (stage=%s): %s", gate.stage, exc)
        return None


async def run_gated(gate: Gate | None, *, state, questions: dict, skip_question: str,
                    call_llm: Callable[[], Awaitable[T]], label_of: Callable[[T], dict],
                    on_skip: Callable[[], T], context: dict) -> GatedResult[T]:
    if gate is None or not gate.active:
        return GatedResult(await call_llm(), False, None, None)

    loop = asyncio.get_running_loop()
    task: asyncio.Task | None = None
    verdict: Verdict | None = None
    audit = False
    if gate.mode == GateMode.ON:
        verdict = await gate.ask(state, questions, skip_question=skip_question)
        if gate.should_skip(verdict):
            if not gate.audit():
                rid = await _record(gate, state=state, questions=questions, v=verdict, skipped=True,
                                    llm_label=None, llm_error=None, llm_latency_ms=None, context=context)
                return GatedResult(on_skip(), True, verdict, rid)
            audit = True   # a sampled would-be skip: the LLM runs and labels it like any other call
    else:
        task = asyncio.ensure_future(gate.ask(state, questions, skip_question=skip_question))

    started = loop.time()
    try:
        value = await call_llm()
    except asyncio.CancelledError:
        if task is not None:
            await _cancel(task)
        raise
    except Exception as exc:
        llm_ms = int((loop.time() - started) * 1000)
        if task is not None:
            verdict = await _settle(task)
        assert verdict is not None
        await _record(gate, state=state, questions=questions, v=verdict, skipped=False,
                      llm_label=None, llm_error=f"{type(exc).__name__}: {exc}"[:200],
                      llm_latency_ms=llm_ms, context=context, audit=audit)
        raise
    llm_ms = int((loop.time() - started) * 1000)
    if task is not None:
        verdict = await _settle(task)
    assert verdict is not None
    try:
        label = label_of(value)
    except Exception as exc:  # noqa: BLE001 — gate code must never break a pipeline
        label = {"label_error": f"{type(exc).__name__}: {exc}"[:200]}
    rid = await _record(gate, state=state, questions=questions, v=verdict, skipped=False,
                        llm_label=label, llm_error=None, llm_latency_ms=llm_ms, context=context, audit=audit)
    return GatedResult(value, False, verdict, rid)
