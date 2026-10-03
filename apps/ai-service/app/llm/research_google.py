"""Research-only bounded Google-compatible stage; legacy retry policy is untouched."""
from __future__ import annotations

import asyncio
import logging
import time

import httpx

from app.llm.client import LLMClient, LLMError, LLMResult, extract_thought, parse_json
from app.llm.research_quota import retry_seconds

logger = logging.getLogger(__name__)


def event(provider: str, model: str, state: str, key: int | None, attempts: int, reason: str,
          *, finish_reason: str = "none") -> None:
    # No caller label, prompt, exception text, returned model, or response body.
    logger.log(logging.WARNING if state == "failure" else logging.INFO,
               "[research.llm] provider=%s model=%s state=%s key_index=%s attempts=%d reason=%s finish_reason=%s",
               provider, model, state, key, attempts, reason, finish_reason)


def finish_reason(response: httpx.Response) -> str:
    try:
        finish = response.json()["choices"][0].get("finish_reason")
    except (AttributeError, KeyError, IndexError, TypeError, ValueError):
        return "none"
    if finish is None:
        return "none"
    return finish if finish in ("stop", "length", "content_filter", "tool_calls", "function_call") else "other"


def decode_response(response: httpx.Response) -> tuple[dict | None, str, dict, str]:
    """Return parsed body/content/usage and a fixed, sanitized failure category."""
    usage = {}
    try:
        body = response.json()
        usage = body.get("usage") or {}
        if not isinstance(usage, dict):
            return None, "", {}, "malformed_usage"
        choice = body["choices"][0]
        finish = choice.get("finish_reason")
        if finish in ("length", "content_filter", "tool_calls", "function_call"):
            return None, "", usage, f"finish_reason_{finish}"
        content = choice.get("message", {}).get("content")
        if not isinstance(content, str) or not content.strip():
            return None, "", usage, "missing_content"
    except (AttributeError, KeyError, IndexError, TypeError, ValueError):
        return None, "", usage, "malformed_envelope"
    try:
        data = parse_json(content)
        if not isinstance(data, dict):
            raise ValueError
    except ValueError:
        return None, content, usage, "invalid_json"
    return {"data": data, "model": body.get("model")}, content, usage, "ok"


class ResearchGoogleClient(LLMClient):
    def __init__(self, settings):
        self._request_timeout = min(12.0, settings.research_google_timeout_seconds)
        super().__init__(
            base_url=settings.llm_base_url,
            api_keys=list(dict.fromkeys(k.strip() for k in settings.llm_api_keys if k.strip())),
            model=settings.llm_model, timeout_seconds=self._request_timeout,
        )
        self._locks = [asyncio.Lock() for _ in self._keys]
        self._quarantined: set[int] = set()
        self._max_tokens = settings.research_max_output_tokens

    async def complete_full(self, system: str, user: str, *, label: str = "llm") -> LLMResult:
        started = time.monotonic()
        attempts = 0
        last = "no_eligible_keys"
        start = self._next % len(self._keys)
        self._next += 1
        try:
            for offset in range(len(self._keys)):
                key = (start + offset) % len(self._keys)
                async with self._locks[key]:
                    if key in self._quarantined or self._cooldown_until[key] > time.monotonic():
                        last = "quarantined" if key in self._quarantined else "cooldown"
                        event(self._provider, self._model, "skipped", key, attempts, last)
                        continue
                    attempts += 1
                    event(self._provider, self._model, "start", key, attempts, "request")
                    cool_for = 5.0
                    finish = "none"
                    try:
                        async with asyncio.timeout(self._request_timeout):
                            response = await self._client.post(
                                self._url, headers={"Authorization": f"Bearer {self._keys[key]}"},
                                json={"model": self._model, "messages": [
                                    {"role": "user", "content": f"{system}\n\n{user}"}],
                                    "temperature": .2, "max_tokens": self._max_tokens},
                            )
                    except asyncio.CancelledError:
                        self._cooldown_until[key] = time.monotonic() + cool_for
                        event(self._provider, self._model, "failure", key, attempts, "cancelled")
                        raise
                    except (TimeoutError, httpx.TimeoutException):
                        last = "timeout"
                    except httpx.TransportError:
                        last = "transport_error"
                    else:
                        if response.status_code == 200:
                            finish = finish_reason(response)
                            parsed, content, usage, last = decode_response(response)
                            if parsed is not None:
                                model = parsed["model"]
                                event(self._provider, self._model, "success", key, attempts, "ok", finish_reason=finish)
                                return LLMResult(
                                    data=parsed["data"], content=content, thought=extract_thought(content),
                                    usage=usage, latency_ms=int((time.monotonic() - started) * 1000),
                                    key_index=key, attempts=attempts, provider=self._provider,
                                    model=model if isinstance(model, str) and model else self._model,
                                )
                        else:
                            last = f"http_{response.status_code}"
                            if response.status_code in (401, 403):
                                self._quarantined.add(key)
                            elif response.status_code == 429:
                                cool_for = retry_seconds(response.headers, response.text)
                    self._cooldown_until[key] = max(self._cooldown_until[key], time.monotonic() + cool_for)
                    event(self._provider, self._model, "failure", key, attempts, last, finish_reason=finish)
        except asyncio.CancelledError as exc:
            exc.attempts = attempts
            raise
        raise LLMError(f"Research fallback unavailable ({last})", attempts=attempts)
