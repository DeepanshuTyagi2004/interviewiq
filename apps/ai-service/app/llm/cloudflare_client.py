"""Research-only Workers AI stage: one request, shared cooldown, no retry sleeps."""
from __future__ import annotations

import asyncio
import logging
import re
import time
from urllib.parse import quote

import httpx

from app.config import Settings
from app.llm.client import (
    LLMClient,
    LLMError,
    LLMResult,
    _RATE_LIMIT_BACKOFF_SECONDS,
    _TRANSPORT_BACKOFF_SECONDS,
    _retry_plan,
    extract_thought,
    parse_json,
)

logger = logging.getLogger(__name__)


class _InvalidResponse(ValueError):
    """Carries only a fixed diagnostic category, never response content."""


class _CloudflareRequestLogFilter(logging.Filter):
    """HTTPX's INFO request line includes the account-bearing URL; omit that line."""

    def filter(self, record: logging.LogRecord) -> bool:
        args = record.args if isinstance(record.args, tuple) else ()
        return not any(isinstance(arg, httpx.URL) and arg.host == "api.cloudflare.com"
                       for arg in args)


logging.getLogger("httpx").addFilter(_CloudflareRequestLogFilter())


class CloudflareLLMClient(LLMClient):
    """A single-credential stage with the usual LLMClient completion/lifetime API.

    Cooldown and authentication quarantine persist for this client's lifetime. The
    lock lets concurrent research calls observe a failed request's cooldown before
    dispatching another request. Neither a cooling nor quarantined stage sleeps.
    """

    def __init__(self, settings: Settings):
        account = quote(settings.cloudflare_account_id.strip(), safe="")
        super().__init__(
            base_url=f"https://api.cloudflare.com/client/v4/accounts/{account}/ai/v1",
            api_keys=[settings.cloudflare_api_token.strip()],
            model=settings.cloudflare_model,
            timeout_seconds=settings.cloudflare_timeout_seconds,
            provider="cloudflare",
        )
        self._max_tokens = min(settings.cloudflare_max_tokens, settings.research_max_output_tokens)
        self._timeout_seconds = settings.cloudflare_timeout_seconds
        # Log the configured identity only; provider-returned model names are untrusted.
        model = self._model.replace(settings.cloudflare_api_token.strip(), "[redacted]")
        model = model.replace(settings.cloudflare_account_id.strip(), "[redacted]")
        self._log_model = (
            model if re.fullmatch(r"[@a-zA-Z0-9_./-]{1,200}", model) and "://" not in model
            else "configured-model"
        )
        self._quarantined = False
        self._request_lock = asyncio.Lock()

    async def complete_full(self, system: str, user: str, *, label: str = "llm") -> LLMResult:
        started = time.monotonic()
        attempts = 0
        self._log("start", "pending", attempts=0)
        try:
            # HTTPX timeouts only bound individual IO phases, not lock wait or the
            # whole response. This deadline covers both the queue and the request.
            async with asyncio.timeout(self._timeout_seconds):
                async with self._request_lock:
                    if self._quarantined:
                        self._log("fail", "quarantined", attempts=0)
                        raise LLMError("Cloudflare credential quarantined", attempts=0)
                    if self._cooldown_until[0] > time.monotonic():
                        self._log("fail", "cooldown", attempts=0)
                        raise LLMError("Cloudflare cooling down", attempts=0)
                    attempts = 1
                    try:
                        return await self._complete_locked(system, user, started)
                    except asyncio.CancelledError:
                        # A dispatched request has unknown outcome on cancellation.
                        # Publish the cooldown before unlocking for queued callers.
                        self._cool_down(float(_TRANSPORT_BACKOFF_SECONDS))
                        raise
        except TimeoutError:
            category = "timeout" if attempts else "queue_timeout"
            self._log("fail", category, attempts=attempts)
            raise LLMError(f"Cloudflare failed: {category}", attempts=attempts) from None
        except asyncio.CancelledError as exc:
            # The enclosing router may own the shorter deadline; carry actual
            # dispatch count through cancellation so its timeout is counted too.
            exc.attempts = attempts
            self._log("fail", "cancelled" if attempts else "queue_cancelled", attempts=attempts)
            raise

    def _log(self, event: str, category: str, *, attempts: int, finish_reason: str = "none") -> None:
        # Never log labels, prompts, URLs, transport errors, or response bodies.
        logger.log(
            logging.WARNING if event == "fail" else logging.INFO,
            "[research.llm] provider=cloudflare model=%s event=%s finish_reason=%s category=%s attempts=%d",
            self._log_model, event, finish_reason, category, attempts,
        )

    def _cool_down(self, seconds: float) -> None:
        self._cooldown_until[0] = max(self._cooldown_until[0], time.monotonic() + seconds)

    async def _complete_locked(self, system: str, user: str, started: float) -> LLMResult:
        cool_for = float(_TRANSPORT_BACKOFF_SECONDS)
        finish_reason = "none"
        try:
            response = await self._client.post(
                self._url,
                headers={"Authorization": f"Bearer {self._keys[0]}"},
                json={
                    "model": self._model,
                    "messages": [
                        {"role": "system", "content": system},
                        {"role": "user", "content": user},
                    ],
                    "temperature": 0.2,
                    "response_format": {"type": "json_object"},
                    "max_tokens": self._max_tokens,
                },
            )
        except httpx.TransportError as exc:
            category = "timeout" if isinstance(exc, httpx.TimeoutException) else "transport"
            last_error = category
        else:
            if response.status_code == 200:
                try:
                    body = response.json()
                    choice = body["choices"][0]
                    raw_finish = choice.get("finish_reason")
                    finish_reason = raw_finish if raw_finish in (
                        "stop", "length", "tool_calls", "content_filter", "function_call",
                    ) else "unknown"
                    if finish_reason == "length":
                        raise _InvalidResponse("truncation")
                    message = choice.get("message")
                    if message is None:
                        raise _InvalidResponse("missing_content")
                    content = message.get("content")
                    if content is None or isinstance(content, str) and not content.strip():
                        raise _InvalidResponse("missing_content")
                    if not isinstance(content, str):
                        raise _InvalidResponse("malformed")
                    data = parse_json(content)
                    if not isinstance(data, dict):
                        raise _InvalidResponse("malformed")
                    usage = body.get("usage") or {}
                    if not isinstance(usage, dict):
                        raise _InvalidResponse("malformed")
                except _InvalidResponse as exc:
                    category = last_error = str(exc)
                except (AttributeError, KeyError, IndexError, TypeError, ValueError):
                    category = last_error = "malformed"
                else:
                    model = body.get("model")
                    self._log("success", "success", attempts=1, finish_reason=finish_reason)
                    return LLMResult(
                        data=data, thought=extract_thought(content), content=content, usage=usage,
                        latency_ms=int((time.monotonic() - started) * 1000),
                        key_index=0, attempts=1,
                        model=model if isinstance(model, str) and model else self._model,
                        provider="cloudflare",
                    )
            elif response.status_code in (401, 403):
                self._quarantined = True
                category = "quarantined"
                last_error = f"HTTP {response.status_code}; credential quarantined"
            elif response.status_code == 429:
                hint, _ = _retry_plan("", response.headers.get("retry-after"))
                cool_for = hint if hint is not None else float(_RATE_LIMIT_BACKOFF_SECONDS)
                category = "rate_limit"
                last_error = "HTTP 429 rate limit"
            else:
                category = "http_error"
                last_error = f"HTTP {response.status_code}"

        self._cool_down(cool_for)
        self._log("fail", category, attempts=1, finish_reason=finish_reason)
        raise LLMError(f"Cloudflare failed: {last_error}", attempts=1) from None
