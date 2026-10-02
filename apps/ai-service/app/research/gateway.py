"""ResearchIO: the only way research nodes reach the outside world (spec §3.3, §10.1, §12.2).

Every Exa search and LLM call goes through here, which:
  1. opens a traced span carrying the full request and the full response;
  2. charges the run's budget (live/record only; replay is free);
  3. records to / replays from fixtures according to the run's mode;
  4. caches LLM extracts by a hash of their full input (bypassed in record mode so every call
     gets a fixture), and remembers every search result in research_sources.

Phase 1 stores full prompts on LLM spans (resolve prompts are a few KB). Phase 2's per-source
extracts switch to template + research_sources refs (spec §4.3)."""
from __future__ import annotations

import hashlib
import logging
from collections.abc import Callable
from typing import Any

from app.config import Settings
from app.research.budget import Budget
from app.research.fixtures import FixtureStore
from app.research.models import Mode
from app.research.normalize.identity import domain_of
from app.research.store import ResearchStore
from app.research.trace.tracer import Tracer, utcnow

logger = logging.getLogger(__name__)


def content_hash(text: str) -> str:
    return "sha256:" + hashlib.sha256(text.encode()).hexdigest()


def extract_key(prompt_name: str, prompt_version: str, system: str, user: str) -> str:
    h = hashlib.sha256()
    for part in (prompt_name, prompt_version, system, user):
        h.update(part.encode())
        h.update(b"\x00")
    return h.hexdigest()


class ResearchIO:
    def __init__(self, *, mode: Mode, exa: Any, llm: Any, fixtures: FixtureStore, tracer: Tracer,
                 budget: Budget, store: ResearchStore, settings: Settings):
        self._mode = Mode(mode)
        self._exa = exa
        self._llm = llm
        self._fixtures = fixtures
        self._tracer = tracer
        self._budget = budget
        self._store = store
        self._settings = settings

    async def search(self, query: str, *, company_slug: str, kind: str) -> list[dict]:
        n = self._settings.research_results_per_query
        request = {"query": query, "num_results": n, "user_location": self._settings.exa_user_location,
                   "exclude_domains": sorted(self._settings.exa_exclude_domains)}
        async with self._tracer.span("exa", query, input=request,
                                     attrs={"query": query, "mode": self._mode.value, "kind": kind}) as sp:
            if self._mode is Mode.REPLAY:
                results = self._fixtures.read(company_slug, "exa", request)
                sp.set_attrs(replay=True)
            else:
                await self._budget.charge("exa")
                raw = await self._exa.collect_sources(
                    [query], include_domains=[], exclude_domains=list(self._settings.exa_exclude_domains),
                )
                results = raw[:n]
                if self._mode is Mode.RECORD:
                    sp.set_attrs(recorded_to=str(self._fixtures.write(company_slug, "exa", request, results)))
            logger.debug("exa %r → %d result(s)", query, len(results))
            sp.set_output({"count": len(results), "results": results})
        for r in results:
            text = r.get("content") or ""
            await self._store.upsert_source({
                "url": r["url"], "domain": domain_of(r["url"]), "title": r.get("title"),
                "published_date": r.get("date"), "text": text, "content_hash": content_hash(text),
                "fetched_at": utcnow(), "kinds": [kind],
            })
        return results

    async def extract_json(self, *, prompt_name: str, prompt_version: str, system: str, user: str,
                           company_slug: str, label: str,
                           validate: Callable[[dict], Any] | None = None) -> dict:
        """`validate` (e.g. a pydantic model_validate) gates the cache: a cached value that fails it is
        ignored and re-asked; a fresh response that fails it is never cached and the error propagates."""
        model = self._settings.llm_model
        key = extract_key(prompt_name, prompt_version, system, user)
        request = {"model": model, "prompt_name": prompt_name, "prompt_version": prompt_version,
                   "system": system, "user": user}
        async with self._tracer.span("llm", f"{prompt_name}@{prompt_version}", input=request,
                                     attrs={"model": model, "prompt_name": prompt_name,
                                            "prompt_version": prompt_version, "mode": self._mode.value,
                                            "label": label}) as sp:
            if self._mode is not Mode.RECORD:
                hit = await self._store.get_extract(key)
                if hit is not None and validate is not None:
                    try:
                        validate(hit["output"])
                    except Exception as exc:
                        logger.warning("cached extract for %s@%s failed validation, asking again: %s",
                                       prompt_name, prompt_version, exc)
                        hit = None
                if hit is not None:
                    sp.set_attrs(cache="hit")
                    self._tracer.emit("cache.hit", f"{prompt_name}@{prompt_version}: reused cached extract", level="debug")
                    sp.set_output({"data": hit["output"], "cache": "hit"})
                    return hit["output"]
            if self._mode is Mode.REPLAY:
                response = self._fixtures.read(company_slug, "llm", request)
                sp.set_attrs(replay=True)
            else:
                await self._budget.charge("llm")
                r = await self._llm.complete_full(system, user, label=label)
                response = {"data": r.data, "thought": r.thought, "content": r.content, "usage": r.usage,
                            "latency_ms": r.latency_ms, "key_index": r.key_index, "attempts": r.attempts}
                await self._budget.add_tokens(int(r.usage.get("prompt_tokens") or 0),
                                              int(r.usage.get("completion_tokens") or 0))
                if self._mode is Mode.RECORD:
                    sp.set_attrs(recorded_to=str(self._fixtures.write(company_slug, "llm", request, response)))
            usage = response.get("usage") or {}
            sp.set_attrs(cache="miss", tokens_in=usage.get("prompt_tokens"), tokens_out=usage.get("completion_tokens"),
                         latency_ms=response.get("latency_ms"), key_index=response.get("key_index"),
                         retries=max(0, int(response.get("attempts") or 1) - 1))
            sp.set_output(response)
            if validate is not None:
                validate(response["data"])
        await self._store.put_extract({"key": key, "prompt_name": prompt_name, "prompt_version": prompt_version,
                                       "output": response["data"], "created_at": utcnow()})
        return response["data"]
