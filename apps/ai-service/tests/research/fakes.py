"""Test doubles for the two external clients ResearchIO wraps. Same method names and return shapes
as ExaClient.collect_sources and LLMClient.complete_full."""
from __future__ import annotations

import copy
import json
from collections.abc import Awaitable, Callable

from app.llm.client import LLMResult


def result(url: str, title: str = "Official site", content: str = "Company homepage text.", date: str | None = None) -> dict:
    return {"title": title, "url": url, "content": content, "date": date}


def resolve_answer(name: str, website: str | None) -> dict:
    return {"is_company": True, "canonical_name": name, "website": website, "aliases": [],
            "confidence": "high", "evidence_urls": [website] if website else [], "reasoning": "official site in results"}


class FakeExa:
    def __init__(self, respond: Callable[[str], list[dict]] | None = None, fail: Exception | None = None):
        self._respond = respond or (lambda q: [])
        self._fail = fail
        self.calls: list[str] = []
        self.includes: list[list[str]] = []

    async def collect_sources(self, queries, *, include_domains, exclude_domains):
        query = queries[0]
        self.calls.append(query)
        self.includes.append(list(include_domains))
        if self._fail is not None:
            raise self._fail
        return copy.deepcopy(self._respond(query))


class FakeLLM:
    def __init__(self, respond: Callable[[str, str, str], dict | Exception],
                 on_call: Callable[[str], Awaitable[None]] | None = None):
        self._respond = respond
        self._on_call = on_call
        self.calls: list[str] = []

    async def complete_full(self, system: str, user: str, *, label: str = "llm") -> LLMResult:
        self.calls.append(label)
        if self._on_call is not None:
            await self._on_call(label)
        data = self._respond(system, user, label)
        if isinstance(data, Exception):
            raise data
        return LLMResult(data=data, thought="", content=json.dumps(data),
                         usage={"prompt_tokens": 100, "completion_tokens": 20},
                         latency_ms=5, key_index=0, attempts=1)

    async def aclose(self) -> None:
        return None


class Exploding:
    """Stands in for a client that must never be called (replay mode)."""

    async def collect_sources(self, *a, **kw):
        raise AssertionError("Exa must not be called in replay mode")

    async def complete_full(self, *a, **kw):
        raise AssertionError("the LLM must not be called in replay mode")

    async def aclose(self) -> None:
        return None
