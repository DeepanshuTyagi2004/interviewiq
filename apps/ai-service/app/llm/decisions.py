"""Client for OpenRouter's Decisions API (a non-generative classifier model, TypeSafe Jev)."""
from __future__ import annotations

import asyncio
import json
import time
from dataclasses import dataclass, field
from typing import Any, Callable

import httpx

MAX_STATE_BYTES = 30_000
_RETRY_STATUSES = {429, 524, 529}
_BACKOFF_SECONDS = 0.5
BREAKER_FAILURES = 3          # consecutive failures that open the circuit breaker
BREAKER_OPEN_SECONDS = 60.0   # how long an open breaker fails fast before trying Jev again


class DecisionsUnavailable(RuntimeError):
    """Jev could not give an answer (error, timeout, refused state). Callers treat it as "unknown"."""


def noul(instructions: str, *, true: str, false: str) -> dict:
    return {"type": "noul", "instructions": instructions, "criteria": {"true": true, "false": false}}


def choice(instructions: str, options: dict[str, str]) -> dict:
    return {"type": "choice", "instructions": instructions, "criteria": options}


def score(instructions: str, levels: list[str]) -> dict:
    return {"type": "score", "instructions": instructions, "criteria": levels}


def state_bytes(state) -> int:
    text = state if isinstance(state, str) else json.dumps(state, ensure_ascii=False)
    return len(text.encode("utf-8"))


def _num(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value)


@dataclass(frozen=True)
class Decision:
    answers: dict[str, dict] = field(default_factory=dict)
    model: str = ""
    cost_usd: float = 0.0
    input_tokens: int = 0
    latency_ms: int = 0

    def _answer(self, name: str) -> dict:
        a = self.answers.get(name)
        return a if isinstance(a, dict) else {}

    def p_yes(self, name: str) -> float | None:
        v = _num(self._answer(name).get("noul"))
        return v if v is not None and 0.0 <= v <= 1.0 else None

    def score_of(self, name: str) -> float | None:
        return _num(self._answer(name).get("score"))

    def choice_of(self, name: str) -> str | None:
        v = self._answer(name).get("choice")
        return v if isinstance(v, str) else None


class DecisionsClient:
    def __init__(self, *, api_key: str, model: str, url: str, timeout_seconds: float,
                 http_client: httpx.AsyncClient | None = None,
                 clock: Callable[[], float] = time.monotonic) -> None:
        self._api_key = api_key
        self._model = model
        self._url = url
        self._timeout = timeout_seconds
        self._http = http_client or httpx.AsyncClient(timeout=timeout_seconds)
        self._clock = clock
        self._failures = 0           # consecutive DecisionsUnavailable failures from the endpoint
        self._open_until = 0.0       # breaker fails fast until this clock reading

    async def decide(self, state: str | dict | list, questions: dict[str, dict], *,
                     model: str | None = None, session_id: str | None = None) -> Decision:
        if state_bytes(state) > MAX_STATE_BYTES:
            raise DecisionsUnavailable("state too large")   # the caller's input, not an endpoint failure
        if self._clock() < self._open_until:
            raise DecisionsUnavailable("breaker open")
        try:
            decision = await self._send(state, questions, model=model, session_id=session_id)
        except DecisionsUnavailable:
            self._failures += 1
            if self._failures >= BREAKER_FAILURES:
                self._open_until = self._clock() + BREAKER_OPEN_SECONDS
            raise
        self._failures = 0
        self._open_until = 0.0
        return decision

    async def _send(self, state, questions: dict[str, dict], *, model: str | None,
                    session_id: str | None) -> Decision:
        body: dict[str, Any] = {"model": model or self._model, "state": state, "questions": questions,
                                "provider": {"data_collection": "deny"}}
        if session_id:
            body["session_id"] = session_id
        headers = {"Authorization": f"Bearer {self._api_key}", "Content-Type": "application/json"}
        started = time.monotonic()
        resp: httpx.Response | None = None
        for attempt in range(2):
            try:
                resp = await self._http.post(self._url, json=body, headers=headers, timeout=self._timeout)
            except httpx.TimeoutException as exc:
                # A slow Jev is not retried: a second full timeout would only delay the LLM call it gates.
                raise DecisionsUnavailable(f"request failed: {type(exc).__name__}") from exc
            except httpx.HTTPError as exc:
                if attempt == 0:
                    await asyncio.sleep(_BACKOFF_SECONDS)
                    continue
                raise DecisionsUnavailable(f"request failed: {type(exc).__name__}") from exc
            retryable = resp.status_code in _RETRY_STATUSES or resp.status_code >= 500
            if retryable and attempt == 0:
                await asyncio.sleep(_BACKOFF_SECONDS)
                continue
            break
        assert resp is not None
        if resp.status_code != 200:
            raise DecisionsUnavailable(f"HTTP {resp.status_code}")
        try:
            data = resp.json()
        except ValueError as exc:
            raise DecisionsUnavailable("invalid JSON") from exc
        if not isinstance(data, dict):
            raise DecisionsUnavailable("unexpected response")
        answers = data.get("answers")
        usage = data.get("usage") if isinstance(data.get("usage"), dict) else {}
        return Decision(
            answers=answers if isinstance(answers, dict) else {},
            model=str(data.get("model") or body["model"]),
            cost_usd=_num(usage.get("cost")) or 0.0,
            input_tokens=int(_num(usage.get("input_tokens")) or 0),
            latency_ms=int((time.monotonic() - started) * 1000),
        )

    async def aclose(self) -> None:
        await self._http.aclose()


_shared: DecisionsClient | None = None


def shared_decisions_client(settings) -> DecisionsClient | None:
    global _shared
    if not settings.openrouter_api_key:
        return None
    if _shared is None:
        _shared = DecisionsClient(api_key=settings.openrouter_api_key, model=settings.decisions_model,
                                  url=settings.decisions_url, timeout_seconds=settings.decisions_timeout_seconds)
    return _shared


async def close_shared_decisions_client() -> None:
    global _shared
    client, _shared = _shared, None
    if client is not None:
        await client.aclose()
