"""Groq client (OpenAI-compatible) for the extract + aggregate stages.

Groq serves OpenAI-shaped /chat/completions. We force JSON output and tolerate the
slips models make (```json fences / preamble). Bounded concurrency keeps us under
Groq rate limits while extracting many sources in parallel.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re

import httpx

from app.config import Settings

logger = logging.getLogger(__name__)

_RATE_LIMIT_BACKOFF_SECONDS = 20    # fallback when Groq gives no retry-after hint
_MAX_ATTEMPTS = 6
_MAX_COOLDOWN_SECONDS = 120         # waits longer than this = daily-limit territory -> give up fast
_COUNTDOWN_STEP = 10               # how often to log the cooldown countdown (seconds)

# Groq free/on-demand limits for qwen/qwen3-32b (for clear error messages):
#   RPM 60 · RPD 1,000 · TPM 6,000 · TPD 500,000


class GroqError(RuntimeError):
    """Groq call failed after retries. Caller decides whether to drop the item or fail the combo."""


def _retry_plan(body: str, retry_after: str | None) -> tuple[float | None, str]:
    """From a Groq 429 body (+ optional Retry-After header) work out how long to wait and which
    limit was hit, so we can log a precise cooldown and a human error. Returns (seconds, kind);
    seconds is None when Groq gave no hint (caller falls back to a default)."""
    kind = "rate limit"
    for label, needle in (
        ("daily token limit (TPD)", "tokens per day"),
        ("per-minute token limit (TPM)", "tokens per minute"),
        ("daily request limit (RPD)", "requests per day"),
        ("per-minute request limit (RPM)", "requests per minute"),
    ):
        if needle in body:
            kind = label
            break
    wait: float | None = None
    if retry_after:
        try:
            wait = float(retry_after)
        except ValueError:
            wait = None
    if wait is None:
        m = re.search(r"try again in (?:(\d+)m)?([\d.]+)s", body)
        if m:
            wait = int(m.group(1) or 0) * 60 + float(m.group(2))
    return wait, kind


def parse_json(content: str) -> dict:
    """Extract JSON from model text, tolerating ```json fences / preamble (grab the outermost
    {...}) and trailing commas. Raises ValueError if none found."""
    content = content.strip()
    candidates = [content]
    start, end = content.find("{"), content.rfind("}")
    if start != -1 and end > start:
        candidates.append(content[start : end + 1])
    for cand in candidates:
        for attempt in (cand, re.sub(r",(\s*[}\]])", r"\1", cand)):
            try:
                return json.loads(attempt)
            except json.JSONDecodeError:
                pass
    raise ValueError(f"no valid JSON found. First 500 chars: {content[:500]!r}")


async def gather_capped(coros: list, limit: int) -> list:
    """Run coros with at most `limit` in flight. Returns results in order; any coro that
    raises is captured as None (a junk source must not abort the whole stage)."""
    sem = asyncio.Semaphore(limit)

    async def _run(coro):
        async with sem:
            try:
                return await coro
            except Exception as exc:  # noqa: BLE001 — per-item isolation
                logger.warning("[groq] capped task failed (%s: %s)", type(exc).__name__, exc)
                return None

    return await asyncio.gather(*(_run(c) for c in coros))


class GroqClient:
    def __init__(self, *, base_url: str, api_key: str, model: str, timeout_seconds: float,
                 reasoning_effort: str = "", reasoning_format: str = ""):
        if not api_key:
            raise GroqError("GROQ_API_KEY is not set. Refusing to start.")
        self._url = base_url.rstrip("/") + "/chat/completions"
        self._model = model
        self._timeout = timeout_seconds
        self._reasoning_effort = reasoning_effort
        self._reasoning_format = reasoning_format
        self._headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}

    async def complete_json(self, system: str, user: str, *, label: str = "groq") -> dict:
        """One chat call returning a parsed JSON object (salvaged via parse_json — no strict
        json_object mode, see payload note). Retries on 429/5xx with a logged countdown.
        Raises GroqError on failure. `label` tags the live-log lines."""
        payload = {
            "model": self._model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "temperature": 0.2,
            # Intentionally NOT using response_format=json_object: with reasoning-capable models
            # (e.g. qwen3) strict JSON mode 400s ("json_validate_failed") when the model emits a
            # thinking preamble, silently dropping sparse sources. We let the model answer freely
            # and salvage the object with parse_json (tolerates fences / preamble / trailing commas).
        }
        # Suppress qwen3 chain-of-thought so `content` is clean JSON (not a <think> dump that gets
        # truncated before the JSON) and token usage stays under the Groq TPM tier. qwen3-32b uses
        # reasoning_format="hidden"; reasoning_effort="none" is qwen3.6-27b-only.
        if self._reasoning_format:
            payload["reasoning_format"] = self._reasoning_format
        if self._reasoning_effort:
            payload["reasoning_effort"] = self._reasoning_effort
        attempt = 0
        while True:
            attempt += 1
            try:
                async with httpx.AsyncClient(timeout=self._timeout) as client:
                    resp = await client.post(self._url, json=payload, headers=self._headers)
            except httpx.TransportError as exc:
                if attempt >= _MAX_ATTEMPTS:
                    raise GroqError(f"Groq transport error after {attempt} attempts: {exc}") from exc
                await self._cooldown(_RATE_LIMIT_BACKOFF_SECONDS, "transport error", label)
                continue
            if resp.status_code == 200:
                try:
                    content = resp.json()["choices"][0]["message"]["content"]
                except (KeyError, IndexError, ValueError) as exc:
                    raise GroqError(f"Groq 200 response malformed: {resp.text[:300]}") from exc
                return parse_json(content)
            if resp.status_code == 429:
                wait, kind = _retry_plan(resp.text or "", resp.headers.get("retry-after"))
                wait = wait if wait is not None else _RATE_LIMIT_BACKOFF_SECONDS
                if wait > _MAX_COOLDOWN_SECONDS or attempt >= _MAX_ATTEMPTS:
                    raise GroqError(
                        f"Groq {kind} reached for {self._model} — cooldown is {wait:.0f}s"
                        f"{' (exceeds cap; likely a daily limit — retry later or upgrade tier)' if wait > _MAX_COOLDOWN_SECONDS else ' (out of retries)'}."
                    )
                await self._cooldown(wait, f"429 {kind}", label)
                continue
            if resp.status_code in (500, 502, 503) and attempt < _MAX_ATTEMPTS:
                await self._cooldown(_RATE_LIMIT_BACKOFF_SECONDS, f"server error {resp.status_code}", label)
                continue
            raise GroqError(f"Groq returned {resp.status_code}: {resp.text[:300]}")

    async def _cooldown(self, seconds: float, reason: str, label: str) -> None:
        """Sleep `seconds`, logging a countdown to the live console so a 429 isn't a silent stall."""
        logger.warning("[groq] %s — %s; cooling down %.0fs before retry", label, reason, seconds)
        remaining = seconds
        while remaining > 0:
            step = min(_COUNTDOWN_STEP, remaining)
            await asyncio.sleep(step)
            remaining -= step
            if remaining > 0:
                logger.info("[groq] %s — cooldown %.0fs remaining…", label, remaining)
        logger.info("[groq] %s — retrying now", label)


def build_groq_client(settings: Settings) -> GroqClient:
    return GroqClient(
        base_url=settings.groq_base_url,
        api_key=settings.groq_api_key,
        model=settings.groq_model,
        timeout_seconds=settings.groq_timeout_seconds,
        reasoning_effort=settings.groq_reasoning_effort,
        reasoning_format=settings.groq_reasoning_format,
    )
