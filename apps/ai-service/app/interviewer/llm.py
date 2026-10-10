"""OpenRouter for the live interviewer (spec §2, §3): streamed talker turns with tool calls, and JSON
director briefs. OpenAI-compatible, through the `openai` SDK; no retries here (the callers decide)."""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Literal

import httpx
from openai import AsyncOpenAI

# Spec §3: the lowest-latency provider that supports every parameter we send (tools), OpenRouter's
# own fallbacks allowed, and never a provider that retains or trains on prompts (personal data).
PROVIDER_ROUTING: dict[str, Any] = {
    "sort": "latency", "require_parameters": True, "allow_fallbacks": True, "data_collection": "deny",
}


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
                 http_client: httpx.AsyncClient | None = None) -> None:
        self._client = AsyncOpenAI(api_key=api_key, base_url=base_url, timeout=timeout_s, max_retries=0, http_client=http_client)
        self.model = model
        self.reasoning = reasoning

    def _extra(self) -> dict[str, Any]:
        return {"provider": PROVIDER_ROUTING, "reasoning": reasoning_param(self.reasoning), "usage": {"include": True}}

    async def stream(self, messages: list[dict[str, Any]], tools: list[dict[str, Any]] | None = None,
                     max_tokens: int = 400) -> AsyncIterator[StreamEvent]:
        kwargs: dict[str, Any] = {"tools": tools} if tools else {}
        try:
            response = await self._client.chat.completions.create(
                model=self.model, messages=messages, stream=True, max_tokens=max_tokens, extra_body=self._extra(), **kwargs)
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
                model=self.model, messages=messages, max_tokens=max_tokens, extra_body=self._extra(),
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
                  timeout_s: float = 30.0) -> OpenRouterChat | None:
    if not settings.interviewer_fallback_model:
        return None
    return OpenRouterChat(api_key=settings.openrouter_api_key, base_url=settings.openrouter_base_url,
                          model=settings.interviewer_fallback_model,
                          reasoning=settings.interviewer_fallback_reasoning if reasoning is None else reasoning,
                          timeout_s=timeout_s, http_client=http_client)


def talker_chat(settings, http_client: httpx.AsyncClient | None = None) -> OpenRouterChat:
    return OpenRouterChat(api_key=settings.openrouter_api_key, base_url=settings.openrouter_base_url,
                          model=settings.interviewer_talker_model, reasoning=settings.interviewer_talker_reasoning,
                          timeout_s=30.0, http_client=http_client)


def director_chat(settings, http_client: httpx.AsyncClient | None = None) -> OpenRouterChat:
    return OpenRouterChat(api_key=settings.openrouter_api_key, base_url=settings.openrouter_base_url,
                          model=settings.interviewer_director_model, reasoning=settings.interviewer_director_reasoning,
                          timeout_s=settings.interviewer_director_timeout_seconds, http_client=http_client)


def build_chats(settings, http_client: httpx.AsyncClient | None = None):
    """The talker, the talker's fallback (raced against it when it is slow; None if turned off) and the director, which
    fails over to its own copy of the fallback model. The worker and the simulator both use this."""
    director = FailoverChat(director_chat(settings, http_client), fallback_chat(
        settings, http_client, reasoning=settings.interviewer_director_reasoning, timeout_s=settings.interviewer_director_timeout_seconds))
    return talker_chat(settings, http_client), fallback_chat(settings, http_client), director
