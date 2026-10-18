"""OpenRouter for the live interviewer (spec §2, §3): streamed talker turns with tool calls, and JSON
director briefs. OpenAI-compatible, through the `openai` SDK; no retries here (the callers decide)."""
from __future__ import annotations

import copy
import json
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Literal

import httpx
from openai import AsyncOpenAI

# Spec §3: the lowest-latency provider that supports every parameter we send (tools), OpenRouter's
# own fallbacks allowed, and never a provider that retains or trains on prompts (personal data).
# max_price (USD per million tokens) is the standard DeepSeek flash tier: a rehearsal (2026-10-17) had the fastest endpoint of
# the moment at twice that price with almost no prompt caching, and the round cost three times as much.
PROVIDER_ROUTING: dict[str, Any] = {
    "sort": "latency", "require_parameters": True, "allow_fallbacks": True, "data_collection": "deny",
    "max_price": {"prompt": 0.3, "completion": 1.2},
}


def talker_routing(order: str) -> dict[str, Any]:
    """The talker's provider preferences. With a pinned `order` (comma-separated provider names) the listed providers are tried in
    that sequence and `sort` is dropped, since OpenRouter documents that setting either one turns load balancing off but not how they
    combine; fallbacks to other providers stay allowed so an outage of the pinned one does not break a round."""
    names = [n.strip() for n in (order or "").split(",") if n.strip()]
    if not names:
        return PROVIDER_ROUTING
    return {**{k: v for k, v in PROVIDER_ROUTING.items() if k != "sort"}, "order": names}


class LLMUnavailable(Exception):
    """The call failed, timed out or returned something unusable."""


def reasoning_param(setting: str) -> dict[str, Any]:
    s = (setting or "").strip().lower()
    return {"enabled": False} if s in ("", "none", "off") else {"effort": s}


@dataclass
class ToolCall:
    id: str
    name: str
    arguments: dict[str, Any]


@dataclass
class StreamEvent:
    kind: Literal["text", "tool_call", "done"]
    text: str = ""
    tool_call: ToolCall | None = None
    usage: dict[str, Any] = field(default_factory=dict)
    provider: str | None = None


class OpenRouterChat:
    def __init__(self, *, api_key: str, base_url: str, model: str, reasoning: str, timeout_s: float,
                 http_client: httpx.AsyncClient | None = None, routing: dict[str, Any] | None = None,
                 session_id: str | None = None, temperature: float | None = None) -> None:
        self._client = AsyncOpenAI(api_key=api_key, base_url=base_url, timeout=timeout_s, max_retries=0, http_client=http_client)
        self.model = model
        self.reasoning = reasoning
        self.routing = routing or PROVIDER_ROUTING      # a caller off the live path (the rehearsal judge) may drop the price cap
        # OpenRouter's sticky-routing key: later requests with it go to the provider that served the first one, so its prompt cache is hit.
        self.session_id = session_id
        self.temperature = temperature       # None leaves the provider's default (the warm-up and the rehearsal judge)

    def with_temperature(self, temperature: float | None) -> "OpenRouterChat":
        """The same chat (client, model, routing, sticky key) at another temperature: a classifier that shares the talker's model must not sample at
        the talker's temperature."""
        other = copy.copy(self)
        other.temperature = temperature
        return other

    def _sampling(self) -> dict[str, Any]:
        return {} if self.temperature is None else {"temperature": self.temperature}

    def _extra(self) -> dict[str, Any]:
        extra: dict[str, Any] = {"provider": self.routing, "reasoning": reasoning_param(self.reasoning), "usage": {"include": True}}
        if self.session_id:
            extra["session_id"] = self.session_id
        return extra

    async def warm_up(self, messages: list[dict[str, Any]], tools: list[dict[str, Any]] | None = None) -> bool:
        """One max_tokens=1 request with the round's real system prefix and tool list, so the first spoken turn finds the connection open
        and the prompt prefix already in the provider's cache (the greeting measured 4.4 s cold). Never raises: False if it failed."""
        kwargs: dict[str, Any] = {"tools": tools} if tools else {}
        try:
            await self._client.chat.completions.create(model=self.model, messages=messages, max_tokens=1, extra_body=self._extra(), **kwargs)
            return True
        except Exception:  # noqa: BLE001 - a warm-up is only an optimisation
            return False

    async def stream(self, messages: list[dict[str, Any]], tools: list[dict[str, Any]] | None = None,
                     max_tokens: int = 400) -> AsyncIterator[StreamEvent]:
        kwargs: dict[str, Any] = {"tools": tools} if tools else {}
        try:
            response = await self._client.chat.completions.create(
                model=self.model, messages=messages, stream=True, max_tokens=max_tokens, extra_body=self._extra(), **self._sampling(), **kwargs)
        except Exception as exc:  # noqa: BLE001 - any SDK or transport failure means "unavailable"
            raise LLMUnavailable(str(exc)) from exc
        pending: dict[int, dict[str, str]] = {}
        usage: dict[str, Any] = {}
        provider: str | None = None
        try:
            async for chunk in response:
                provider = provider or (chunk.model_extra or {}).get("provider")
                if chunk.usage is not None:
                    usage = chunk.usage.model_dump()
                if not chunk.choices:
                    continue
                delta = chunk.choices[0].delta
                if delta.content:
                    yield StreamEvent("text", text=delta.content)
                for tc in delta.tool_calls or []:
                    slot = pending.setdefault(tc.index, {"id": "", "name": "", "arguments": ""})
                    if tc.id:
                        slot["id"] = tc.id
                    if tc.function is not None:
                        slot["name"] += tc.function.name or ""
                        slot["arguments"] += tc.function.arguments or ""
        except LLMUnavailable:
            raise
        except Exception as exc:  # noqa: BLE001
            raise LLMUnavailable(str(exc)) from exc
        for index in sorted(pending):
            slot = pending[index]
            try:
                args = json.loads(slot["arguments"] or "{}")
            except json.JSONDecodeError:
                args = {}
            yield StreamEvent("tool_call", tool_call=ToolCall(slot["id"] or f"call_{index}", slot["name"],
                                                               args if isinstance(args, dict) else {}))
        yield StreamEvent("done", usage=usage, provider=provider)

    async def json(self, messages: list[dict[str, Any]], schema_name: str, schema: dict[str, Any],
                   max_tokens: int = 3000) -> tuple[dict[str, Any], dict[str, Any]]:
        try:
            response = await self._client.chat.completions.create(
                model=self.model, messages=messages, max_tokens=max_tokens, extra_body=self._extra(), **self._sampling(),
                response_format={"type": "json_schema", "json_schema": {"name": schema_name, "schema": schema, "strict": False}})
        except Exception as exc:  # noqa: BLE001
            raise LLMUnavailable(str(exc)) from exc
        content = (response.choices[0].message.content or "").strip() if response.choices else ""
        try:
            data = json.loads(content)
        except json.JSONDecodeError as exc:
            raise LLMUnavailable(f"not JSON: {content[:200]}") from exc
        usage = response.usage.model_dump() if response.usage else {}
        return (data if isinstance(data, dict) else {}), usage

    async def aclose(self) -> None:
        await self._client.close()


class FailoverChat:
    """The director's chat: the primary model, then the fallback model when the primary is unavailable. Only
    `json` fails over (the talker races its fallback instead, see talker.py)."""

    def __init__(self, primary, fallback) -> None:
        self.primary = primary
        self.fallback = fallback

    @property
    def model(self) -> str | None:
        return getattr(self.primary, "model", None)

    async def json(self, messages, schema_name, schema, max_tokens: int = 3000):
        try:
            return await self.primary.json(messages, schema_name, schema, max_tokens)
        except LLMUnavailable:
            if self.fallback is None:
                raise
            return await self.fallback.json(messages, schema_name, schema, max_tokens)

    def stream(self, *args, **kwargs):
        return self.primary.stream(*args, **kwargs)

    async def aclose(self) -> None:
        await self.primary.aclose()
        if self.fallback is not None:
            await self.fallback.aclose()


def fallback_chat(settings, http_client: httpx.AsyncClient | None = None, *, reasoning: str | None = None,
                  timeout_s: float = 30.0, session_id: str | None = None, temperature: float | None = None) -> OpenRouterChat | None:
    if not settings.interviewer_fallback_model:
        return None
    return OpenRouterChat(api_key=settings.openrouter_api_key, base_url=settings.openrouter_base_url,
                          model=settings.interviewer_fallback_model,
                          reasoning=settings.interviewer_fallback_reasoning if reasoning is None else reasoning,
                          timeout_s=timeout_s, http_client=http_client, session_id=session_id, temperature=temperature)


def talker_chat(settings, http_client: httpx.AsyncClient | None = None, session_id: str | None = None) -> OpenRouterChat:
    return OpenRouterChat(api_key=settings.openrouter_api_key, base_url=settings.openrouter_base_url,
                          model=settings.interviewer_talker_model, reasoning=settings.interviewer_talker_reasoning,
                          timeout_s=30.0, http_client=http_client, session_id=session_id,
                          routing=talker_routing(settings.interviewer_talker_provider_order),
                          temperature=settings.interviewer_talker_temperature)


def director_chat(settings, http_client: httpx.AsyncClient | None = None, session_id: str | None = None) -> OpenRouterChat:
    return OpenRouterChat(api_key=settings.openrouter_api_key, base_url=settings.openrouter_base_url,
                          model=settings.interviewer_director_model, reasoning=settings.interviewer_director_reasoning,
                          timeout_s=settings.interviewer_director_timeout_seconds, http_client=http_client, session_id=session_id,
                          temperature=settings.interviewer_director_temperature)


def build_chats(settings, http_client: httpx.AsyncClient | None = None, *, session_id: str | None = None):
    """The talker, the talker's fallback (raced against it when it is slow; None if turned off) and the director, which
    fails over to its own copy of the fallback model. The worker and the simulator both use this.

    With a `session_id` (and INTERVIEWER_STICKY_ROUTING on) each chat gets its own sticky-routing key, one per role: the talker, the
    director and the fallback send different prompts, so they must not share one provider's cache slot."""
    def key(role: str) -> str | None:
        return f"{session_id}:{role}" if session_id and settings.interviewer_sticky_routing else None

    director = FailoverChat(director_chat(settings, http_client, key("director")), fallback_chat(
        settings, http_client, reasoning=settings.interviewer_director_reasoning, timeout_s=settings.interviewer_director_timeout_seconds,
        session_id=key("director-fallback"), temperature=settings.interviewer_director_temperature))
    return (talker_chat(settings, http_client, key("talker")),
            fallback_chat(settings, http_client, session_id=key("fallback"), temperature=settings.interviewer_talker_temperature), director)
