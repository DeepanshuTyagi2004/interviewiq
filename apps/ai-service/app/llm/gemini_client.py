"""Google Gemini over the native generateContent API (a paid key): the first stage of routed calls.

One attempt per eligible key per call, plus one format repair on the same key when a reply is
truncated or isn't JSON. A rate-limited key cools down for the provider's retry hint and a rejected
key is quarantined; a timeout or a 5xx doesn't cool the key (a paid key isn't rate-limited, the next
call should try it again). Failures are reported as fixed categories, never with a key, prompt or
response body. JSON mode is requested and thought parts are skipped.
"""
from __future__ import annotations

import asyncio
import time

import httpx

from app.llm.client import LLMClient, LLMError, LLMResult, parse_json
from app.llm.research_google import event
from app.llm.research_quota import retry_seconds

# finishReason values that mean the text is unusable, mapped onto the categories the callers already know.
_FINISH_FAILURES = {
    "MAX_TOKENS": "finish_reason_length",
    "SAFETY": "finish_reason_content_filter", "PROHIBITED_CONTENT": "finish_reason_content_filter",
    "BLOCKLIST": "finish_reason_content_filter", "SPII": "finish_reason_content_filter",
    "RECITATION": "finish_reason_recitation", "MALFORMED_FUNCTION_CALL": "finish_reason_other",
    "OTHER": "finish_reason_other",
}
# Failures worth one more try on the same key with a "complete JSON only" nudge.
_REPAIRABLE = ("invalid_json", "finish_reason_length", "missing_content")


def decode(body) -> tuple[dict | None, str, dict, str, str]:
    """(data, text, usage, reason, finish) from a generateContent response body. reason is "ok" or a
    fixed failure category; usage uses the OpenAI-style names the traces read."""
    if not isinstance(body, dict):
        return None, "", {}, "malformed_envelope", "none"
    meta = body.get("usageMetadata") if isinstance(body.get("usageMetadata"), dict) else {}
    usage = {"prompt_tokens": meta.get("promptTokenCount"), "completion_tokens": meta.get("candidatesTokenCount"),
             "thinking_tokens": meta.get("thoughtsTokenCount"), "total_tokens": meta.get("totalTokenCount")}
    try:
        candidates = body.get("candidates") or []
        if not candidates:
            blocked = (body.get("promptFeedback") or {}).get("blockReason")
            return None, "", usage, "blocked_prompt" if blocked else "missing_content", "none"
        candidate = candidates[0]
        finish = str(candidate.get("finishReason") or "none")
        if finish in _FINISH_FAILURES:
            return None, "", usage, _FINISH_FAILURES[finish], finish.lower()
        parts = (candidate.get("content") or {}).get("parts") or []
        text = "".join(p.get("text") or "" for p in parts if isinstance(p, dict) and not p.get("thought"))
    except (AttributeError, TypeError):
        return None, "", usage, "malformed_envelope", "none"
    if not text.strip():
        return None, "", usage, "missing_content", finish.lower()
    try:
        data = parse_json(text)
        if not isinstance(data, dict):
            raise ValueError
    except ValueError:
        return None, text, usage, "invalid_json", finish.lower()
    return data, text, usage, "ok", finish.lower()


class GeminiClient(LLMClient):
    def __init__(self, settings, *, max_output_tokens: int):
        keys = list(dict.fromkeys(k.strip() for k in settings.gemini_api_keys if k.strip()))
        super().__init__(base_url=settings.gemini_base_url, api_keys=keys, model=settings.gemini_model,
                         timeout_seconds=settings.gemini_timeout_seconds, provider="gemini")
        # The key goes in a header, never the URL (URLs end up in logs and traces).
        self._url = f"{settings.gemini_base_url.rstrip('/')}/models/{settings.gemini_model}:generateContent"
        self._quarantined: set[int] = set()
        self._max_tokens = max(max_output_tokens, settings.gemini_max_output_tokens)
        self._thinking = settings.gemini_thinking_level

    def _payload(self, system: str, user: str, repairing: bool) -> dict:
        config: dict = {"temperature": 0.2, "maxOutputTokens": self._max_tokens, "responseMimeType": "application/json"}
        if self._thinking:
            config["thinkingConfig"] = {"thinkingLevel": self._thinking}
        text = user + ("\n\nReturn only one complete, concise JSON object; no prose or markdown." if repairing else "")
        return {"systemInstruction": {"parts": [{"text": system}]},
                "contents": [{"role": "user", "parts": [{"text": text}]}],
                "generationConfig": config}

    async def complete_full(self, system: str, user: str, *, label: str = "llm") -> LLMResult:
        started = time.monotonic()
        attempts = 0
        last = "no_eligible_keys"
        repair_key: int | None = None   # local: concurrent calls share this client
        n = len(self._keys)
        queue = [(self._next + i) % n for i in range(n)]
        self._next += 1
        try:
            while queue:
                key = queue.pop(0)
                repairing = key == repair_key
                if key in self._quarantined or self._cooldown_until[key] > time.monotonic():
                    last = "quarantined" if key in self._quarantined else "cooldown"
                    event(self._provider, self._model, "skipped", key, attempts, last)
                    continue
                attempts += 1
                event(self._provider, self._model, "start", key, attempts, "format_repair" if repairing else "request")
                cool_for = 0.0
                finish = "none"
                try:
                    response = await self._client.post(self._url, headers={"x-goog-api-key": self._keys[key]},
                                                       json=self._payload(system, user, repairing))
                except asyncio.CancelledError:
                    event(self._provider, self._model, "failure", key, attempts, "cancelled")
                    raise
                except httpx.TimeoutException:
                    last = "timeout"
                except httpx.TransportError:
                    last = "transport_error"
                else:
                    if response.status_code == 200:
                        try:
                            body = response.json()
                        except ValueError:
                            body = None
                        data, text, usage, last, finish = decode(body)
                        if data is not None:
                            event(self._provider, self._model, "success", key, attempts, "ok", finish_reason=finish)
                            version = body.get("modelVersion") if isinstance(body, dict) else None
                            return LLMResult(data=data, thought="", content=text, usage=usage,
                                             latency_ms=int((time.monotonic() - started) * 1000), key_index=key,
                                             attempts=attempts, provider=self._provider,
                                             model=version if isinstance(version, str) and version else self._model)
                        if last in _REPAIRABLE and repair_key is None:
                            repair_key = key
                            queue.insert(0, key)
                    else:
                        last = f"http_{response.status_code}"
                        if response.status_code in (401, 403):
                            self._quarantined.add(key)
                        elif response.status_code == 429:
                            cool_for = retry_seconds(response.headers, response.text)
                        elif response.status_code == 402:
                            # Prepaid credits are used up: set the key aside for a while (a top-up is picked up
                            # afterwards) so calls go straight to the fallback chain instead of failing here first.
                            cool_for = 900.0
                if cool_for:
                    self._cooldown_until[key] = max(self._cooldown_until[key], time.monotonic() + cool_for)
                event(self._provider, self._model, "failure", key, attempts, last, finish_reason=finish)
        except asyncio.CancelledError as exc:
            exc.attempts = attempts
            raise
        err = LLMError(f"Gemini unavailable ({last})", attempts=attempts)
        err.reason = last
        raise err
