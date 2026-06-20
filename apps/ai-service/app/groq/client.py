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

_RATE_LIMIT_BACKOFF_SECONDS = 20
_MAX_ATTEMPTS = 4


class GroqError(RuntimeError):
    """Groq call failed after retries. Caller decides whether to drop the item or fail the combo."""


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
    def __init__(self, *, base_url: str, api_key: str, model: str, timeout_seconds: float):
        if not api_key:
            raise GroqError("GROQ_API_KEY is not set. Refusing to start.")
        self._url = base_url.rstrip("/") + "/chat/completions"
        self._model = model
        self._timeout = timeout_seconds
        self._headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}

    async def complete_json(self, system: str, user: str) -> dict:
        """One chat call returning a parsed JSON object (salvaged via parse_json — no strict
        json_object mode, see payload note). Retries on 429/5xx. Raises GroqError on failure."""
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
        attempt = 0
        while True:
            attempt += 1
            try:
                async with httpx.AsyncClient(timeout=self._timeout) as client:
                    resp = await client.post(self._url, json=payload, headers=self._headers)
            except httpx.TransportError as exc:
                if attempt >= _MAX_ATTEMPTS:
                    raise GroqError(f"Groq transport error after {attempt} attempts: {exc}") from exc
                await asyncio.sleep(_RATE_LIMIT_BACKOFF_SECONDS)
                continue
            if resp.status_code == 200:
                try:
                    content = resp.json()["choices"][0]["message"]["content"]
                except (KeyError, IndexError, ValueError) as exc:
                    raise GroqError(f"Groq 200 response malformed: {resp.text[:300]}") from exc
                return parse_json(content)
            if resp.status_code in (429, 500, 502, 503) and attempt < _MAX_ATTEMPTS:
                logger.warning("[groq] %d (attempt %d/%d); backing off", resp.status_code, attempt, _MAX_ATTEMPTS)
                await asyncio.sleep(_RATE_LIMIT_BACKOFF_SECONDS)
                continue
            raise GroqError(f"Groq returned {resp.status_code}: {resp.text[:300]}")


def build_groq_client(settings: Settings) -> GroqClient:
    return GroqClient(
        base_url=settings.groq_base_url,
        api_key=settings.groq_api_key,
        model=settings.groq_model,
        timeout_seconds=settings.groq_timeout_seconds,
    )
