"""Deadline-bounded routing: Gemini (when GEMINI_API_KEY is set) -> Groq models -> Cloudflare -> Google.

Quota reservations and circuits persist across calls on the shared research client.
Provider order and the legacy LLMClient's other workflows are unchanged.
"""
from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field, replace

import httpx

from app.config import Settings
from app.llm.cloudflare_client import CloudflareLLMClient
from app.llm.client import LLMClient, LLMError, LLMResult, extract_thought
from app.llm.gemini_client import GeminiClient
from app.llm.research_google import ResearchGoogleClient, decode_response, event, finish_reason
from app.llm.research_quota import QuotaLedger, Reservation, retry_seconds


@dataclass
class _Call:
    attempts: int = 0
    reason: str = "no_eligible_providers"
    failures: list[str] = field(default_factory=list)


class ResearchLLMClient(LLMClient):
    """Groq-first routing. Research uses the research limits; other callers (profile scoring) can pass
    their own deadline, Groq stage budget and output cap without changing research behaviour."""

    def __init__(self, settings: Settings, *, deadline_seconds: float | None = None,
                 groq_stage_seconds: float | None = None, max_output_tokens: int | None = None):
        keys = list(dict.fromkeys(k.strip() for k in settings.groq_api_keys if k.strip()))
        models = list(dict.fromkeys(model.strip() for model in
                                   [settings.groq_model, *settings.groq_fallback_models] if model.strip()))
        cloudflare_enabled = bool(settings.cloudflare_api_token.strip() and settings.cloudflare_account_id.strip())
        gemini_keys = [k for k in (getattr(settings, "gemini_api_keys", None) or []) if k.strip()]
        if not keys and not settings.llm_api_keys and not cloudflare_enabled and not gemini_keys:
            raise LLMError("No research LLM keys configured (GEMINI_API_KEY, GROQ_API_KEY, Cloudflare or LLM_API_KEY).")
        # A paid Gemini key answers first; the free-tier chain below is its fallback.
        self._gemini = GeminiClient(settings, max_output_tokens=max_output_tokens or settings.research_max_output_tokens) \
            if gemini_keys else None
        self._groq_clients = [LLMClient(
            base_url=settings.groq_base_url, api_keys=keys, model=model,
            timeout_seconds=settings.groq_timeout_seconds, provider="groq",
        ) for model in models] if keys else []
        self._primary = self._groq_clients[0] if self._groq_clients else None
        self._cloudflare = CloudflareLLMClient(settings) if cloudflare_enabled else None
        self._fallback = ResearchGoogleClient(settings) if settings.llm_api_keys else None
        self._quarantined: set[int] = set()
        self._deadline = deadline_seconds or settings.research_llm_deadline_seconds
        self._groq_stage_seconds = groq_stage_seconds or min(25.0, settings.research_groq_stage_seconds)
        self._max_tokens = max_output_tokens or settings.research_max_output_tokens
        self._bytes_per_token = getattr(settings, "groq_bytes_per_token", 3.0) or 3.0
        self._reasoning_effort = getattr(settings, "groq_reasoning_effort", "") or ""
        self._quotas = {
            model: [QuotaLedger(settings.research_groq_tpm, settings.research_groq_rpm) for _ in keys]
            for model in models
        }

    @property
    def routing_identity(self) -> dict:
        policy = "groq-cloudflare-google-v1" if self._cloudflare else "groq-first-v1"
        return {
            # Without Gemini the identity is unchanged, so existing research caches and fixtures still match.
            "policy": f"gemini-{policy}" if self._gemini else policy,
            **({"gemini": self._gemini.routing_identity} if self._gemini else {}),
            "primary": {**self._primary.routing_identity,
                        "models": [client._model for client in self._groq_clients]} if self._primary else None,
            "fallback": self._fallback.routing_identity if self._fallback else None,
            **({"cloudflare": self._cloudflare.routing_identity} if self._cloudflare else {}),
        }

    async def aclose(self) -> None:
        try:
            await asyncio.gather(*(client.aclose() for client in [*self._groq_clients, *([self._gemini] if self._gemini else [])]))
        finally:
            try:
                if self._cloudflare is not None:
                    await self._cloudflare.aclose()
            finally:
                if self._fallback is not None:
                    await self._fallback.aclose()

    def _acquire_primary_key(self, attempted: set[int], primary: LLMClient,
                             tokens: int, call: _Call,
                             repair_key: int | None = None) -> tuple[int | None, Reservation | None, float | None]:
        now = time.monotonic()
        pending = []
        order = [repair_key] if repair_key is not None else []
        for _ in primary._keys:
            index = primary._next % len(primary._keys)
            primary._next += 1
            if index not in order:
                order.append(index)
        for index in order:
            if index in attempted and index != repair_key:
                continue
            reason = ""
            if index in self._quarantined:
                reason = "quarantined"
            elif primary._cooldown_until[index] > now:
                pending.append(primary._cooldown_until[index] - now)
                reason = "cooldown"
            else:
                reservation = self._quotas[primary._model][index].reserve(tokens)
                if reservation is not None:
                    primary._next = index + 1
                    return index, reservation, 0.0
                reason = "quota"
            event("groq", primary._model, "skipped", index, call.attempts, reason)
        return None, None, min(pending) if pending else None

    async def _groq(self, system: str, user: str, label: str, call: _Call) -> LLMResult | None:
        waited = False
        for primary in self._groq_clients:
            attempted: set[int] = set()
            repair_key = None
            repairing = False
            while True:
                prompt = f"{system}\n\n{user}\n\nReturn a valid JSON object."
                if repairing:
                    prompt += " Return only one concise, complete JSON object; no prose or markdown."
                estimate = int(len(prompt.encode("utf-8")) / self._bytes_per_token) + 1 + 32 + self._max_tokens
                if all(estimate > ledger.tpm for ledger in self._quotas[primary._model]):
                    # Larger than a key's whole per-minute budget: no amount of waiting reserves it.
                    call.reason = "prompt_too_large"
                    event("groq", primary._model, "skipped", None, call.attempts, call.reason)
                    break
                key, reservation, wait = self._acquire_primary_key(
                    attempted, primary, estimate, call, repair_key=repair_key)
                if key is None:
                    if (not self._fallback and not self._cloudflare and not waited and wait is not None
                            and wait <= self._groq_stage_seconds):
                        waited = True
                        await primary._cooldown(wait, "eligible Groq keys cooling", "research")
                        continue
                    break
                attempted.add(key)
                call.attempts += 1
                event("groq", primary._model, "start", key, call.attempts,
                      "format_repair" if repairing else "request")
                quota = self._quotas[primary._model][key]
                cool_for = 5.0
                malformed = False
                finish = "none"
                try:
                    response = await primary._client.post(
                        primary._url, headers={"Authorization": f"Bearer {primary._keys[key]}"},
                        json={"model": primary._model, "messages": [{"role": "user", "content": prompt}],
                              "temperature": .2, "response_format": {"type": "json_object"},
                              "max_completion_tokens": self._max_tokens,
                              **({"reasoning_effort": self._reasoning_effort}
                                 if self._reasoning_effort and primary._model.startswith("openai/gpt-oss") else {})},
                    )
                except asyncio.CancelledError:
                    quota.reconcile(reservation)
                    primary._cooldown_until[key] = max(primary._cooldown_until[key], time.monotonic() + cool_for)
                    event("groq", primary._model, "failure", key, call.attempts, "cancelled")
                    raise
                except httpx.TimeoutException:
                    quota.reconcile(reservation)
                    call.reason = "timeout"
                except httpx.TransportError:
                    quota.reconcile(reservation)
                    call.reason = "transport_error"
                else:
                    if response.status_code == 200:
                        finish = finish_reason(response)
                        parsed, content, usage, call.reason = decode_response(response)
                        quota.reconcile(reservation, usage, response.headers)
                        if parsed is not None:
                            event("groq", primary._model, "success", key, call.attempts, "ok", finish_reason=finish)
                            model = parsed["model"]
                            return LLMResult(
                                data=parsed["data"], content=content, thought=extract_thought(content),
                                usage=usage, latency_ms=0, key_index=key, attempts=call.attempts,
                                model=model if isinstance(model, str) and model else primary._model,
                                provider="groq",
                            )
                        malformed = True
                    else:
                        quota.reconcile(reservation, headers=response.headers)
                        call.reason = f"http_{response.status_code}"
                        if response.status_code == 400:
                            try:
                                code = response.json().get("error", {}).get("code")
                            except (AttributeError, TypeError, ValueError):
                                code = None
                            if code in ("json_validate_failed", "json_generation_failed", "invalid_json"):
                                malformed = True
                                call.reason = "invalid_json"
                        elif response.status_code in (401, 403):
                            self._quarantined.add(key)
                        elif response.status_code == 429:
                            cool_for = retry_seconds(response.headers, response.text)
                            quota.exhaust(cool_for)
                event("groq", primary._model, "failure", key, call.attempts, call.reason, finish_reason=finish)
                if malformed and not repairing:
                    repairing, repair_key = True, key
                    continue
                primary._cooldown_until[key] = max(primary._cooldown_until[key], time.monotonic() + cool_for)
                if repairing:
                    event("groq", primary._model, "skipped", None, call.attempts, "format_repair_exhausted")
                    break
                if call.reason in ("http_400", "http_404", "http_422"):
                    event("groq", primary._model, "skipped", None, call.attempts, "model_or_payload_error")
                    break
        return None

    async def complete_full(self, system: str, user: str, *, label: str = "llm") -> LLMResult:
        started = time.monotonic()
        call = _Call()
        try:
            async with asyncio.timeout(self._deadline):
                if self._gemini is not None:
                    # At most 60% of the caller's deadline, so the fallback chain still has time to answer.
                    try:
                        async with asyncio.timeout(self._deadline * 0.6):
                            result = await self._gemini.complete_full(system, user, label=label)
                    except TimeoutError:
                        call.failures.append("gemini:stage_deadline")
                        event("gemini", self._gemini._model, "skipped", None, call.attempts, "stage_deadline")
                    except LLMError as exc:
                        call.attempts += exc.attempts
                        call.failures.append(f"gemini:{getattr(exc, 'reason', 'unavailable')}")
                    else:
                        return replace(result, latency_ms=int((time.monotonic() - started) * 1000))
                try:
                    async with asyncio.timeout(self._groq_stage_seconds):
                        result = await self._groq(system, user, label, call)
                except TimeoutError:
                    call.reason = "groq_stage_deadline"
                    event("groq", self._primary._model if self._primary else "", "skipped", None,
                          call.attempts, call.reason)
                    result = None
                if result is not None:
                    return replace(result, attempts=call.attempts,
                                   latency_ms=int((time.monotonic() - started) * 1000))
                if self._groq_clients:
                    call.failures.append(f"groq:{call.reason}")
                for provider in (self._cloudflare, self._fallback):
                    if provider is None:
                        continue
                    try:
                        result = await provider.complete_full(system, user, label=label)
                    except asyncio.CancelledError as exc:
                        call.attempts += getattr(exc, "attempts", 0)
                        raise
                    except LLMError as exc:
                        call.attempts += exc.attempts
                        call.reason = f"{provider._provider}_unavailable"
                        call.failures.append(call.reason)
                    else:
                        return replace(result, attempts=call.attempts + result.attempts,
                                       latency_ms=int((time.monotonic() - started) * 1000))
        except TimeoutError:
            raise LLMError("Research LLM overall deadline exceeded", attempts=call.attempts) from None
        except asyncio.CancelledError as exc:
            exc.attempts = call.attempts
            raise
        raise LLMError(f"Research LLM failed ({'; '.join(call.failures) or call.reason})",
                       attempts=call.attempts)
