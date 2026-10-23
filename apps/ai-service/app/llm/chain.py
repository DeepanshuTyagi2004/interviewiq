"""Try one client for a bounded time, then fall through to another (the routed Gemini → Groq → Cloudflare → Google chain)."""
from __future__ import annotations

import asyncio

from app.llm.client import LLMClient, LLMError, LLMResult
from app.llm.research_google import event


class FallbackLLMClient(LLMClient):
    def __init__(self, primary: LLMClient | None, fallback: LLMClient, *, primary_stage_seconds: float):
        self._primary = primary
        self._fallback = fallback
        self._stage = primary_stage_seconds

    @property
    def routing_identity(self) -> dict:
        return {"policy": "primary-then-chain",
                "primary": self._primary.routing_identity if self._primary else None,
                "fallback": self._fallback.routing_identity}

    async def aclose(self) -> None:
        try:
            if self._primary is not None:
                await self._primary.aclose()
        finally:
            await self._fallback.aclose()

    async def complete_full(self, system: str, user: str, *, label: str = "llm") -> LLMResult:
        failure = ""
        if self._primary is not None:
            try:
                async with asyncio.timeout(self._stage):
                    return await self._primary.complete_full(system, user, label=label)
            except TimeoutError:
                failure = "primary:stage_deadline"
            except LLMError:
                failure = "primary:failed"
            event("primary", getattr(self._primary, "_model", ""), "failure", None, 0, failure.split(":")[1])
        try:
            return await self._fallback.complete_full(system, user, label=label)
        except LLMError as exc:
            reason = exc.args[0] if exc.args else "failed"
            raise LLMError(f"{failure + '; ' if failure else ''}{reason}", attempts=getattr(exc, "attempts", 0)) from None
