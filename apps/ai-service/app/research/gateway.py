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

import asyncio
import hashlib
import json
import logging
import re
from collections.abc import Callable
from typing import Any
from urllib.parse import urlsplit, urlunsplit

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from app.config import Settings
from app.llm.client import LLMError
from app.research.budget import Budget
from app.research.chunks import CHUNK_SYSTEM, CHUNK_VERSION, MAX_CLAIMS, ExtractedClaims, merge_claims, source_chunks
from app.research.concurrency import gather_ordered
from app.research.fixtures import FixtureStore
from app.research.models import Mode
from app.research.normalize.identity import domain_of
from app.research.normalize.sources import classify_source
from app.research.store import ResearchStore
from app.research.trace.tracer import Tracer, utcnow

logger = logging.getLogger(__name__)


def content_hash(text: str) -> str:
    return "sha256:" + hashlib.sha256(text.encode()).hexdigest()


def extract_key(prompt_name: str, prompt_version: str, system: str, user: str,
                routing: dict | None = None) -> str:
    h = hashlib.sha256()
    for part in (prompt_name, prompt_version, system, user):
        h.update(part.encode())
        h.update(b"\x00")
    if routing is not None:
        h.update(json.dumps(routing, sort_keys=True, separators=(",", ":")).encode())
    return h.hexdigest()


def _endpoint_identity(url: str) -> str:
    """Keep endpoint identity, never URL authentication, query tokens or fragments."""
    parsed = urlsplit(url)
    return urlunsplit((parsed.scheme, parsed.netloc.rsplit("@", 1)[-1], parsed.path.rstrip("/"), "", ""))


def _routing_identity(settings: Settings) -> dict:
    """Construct from configuration so replay (which has no live client) hashes identically. A configured
    Gemini key answers first, so it leads the identity; without it every identity is unchanged."""
    base = _chain_identity(settings)
    if getattr(settings, "gemini_api_keys", None):
        gemini = {"provider": "gemini", "model": settings.gemini_model,
                  "base_url": _endpoint_identity(settings.gemini_base_url)}
        return {"primary": gemini, "fallback_route": base}
    return base


def _chain_identity(settings: Settings) -> dict:
    fallback = {
        "provider": "google" if urlsplit(settings.llm_base_url).hostname == "generativelanguage.googleapis.com"
        else "openai-compatible",
        "model": settings.llm_model,
        "base_url": _endpoint_identity(settings.llm_base_url),
    }
    if settings.cloudflare_api_token and settings.cloudflare_account_id:
        # Explicit order, with no account-scoped endpoint or credential in persisted identities.
        chain = []
        if settings.groq_api_keys:
            for model in dict.fromkeys([settings.groq_model, *settings.groq_fallback_models]):
                chain.append({"provider": "groq", "model": model,
                              "base_url": _endpoint_identity(settings.groq_base_url)})
        chain.extend([{"provider": "cloudflare", "model": settings.cloudflare_model}, fallback])
        return {"primary": chain[0], "chain": chain}
    if not settings.groq_api_keys:
        return {"primary": fallback}
    routing = {"primary": {"provider": "groq", "model": settings.groq_model,
                           "base_url": _endpoint_identity(settings.groq_base_url)}, "fallback": fallback}
    # Preserve existing cache/fixture identities when the optional model chain is unset.
    if settings.groq_fallback_models:
        routing["groq_fallback_models"] = list(settings.groq_fallback_models)
    return routing


class _ClaimsEnvelope(BaseModel):
    """The extraction response shape. Individual claims are validated one by one downstream, so one
    bad claim never voids a source (evidence-hardening §7.2)."""
    model_config = ConfigDict(extra="allow")
    claims: list[Any] = Field(max_length=MAX_CLAIMS)


def _repair_note(exc: ValidationError) -> str:
    problems = "\n".join(f"- at `{'.'.join(str(p) for p in e.get('loc', ())) or '(root)'}`: {e.get('msg', 'invalid')}"
                         for e in exc.errors()[:8])
    return ("\n\nYour previous response did not match the required JSON shape {\"claims\": [...]} "
            f"(at most {MAX_CLAIMS} claims). Fix exactly these problems and return only the corrected JSON object:\n" + problems)


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
        # Run-wide caps on in-flight external calls; nodes fan out freely underneath (spec §11).
        self._exa_slots = asyncio.Semaphore(settings.research_exa_concurrency)
        self._llm_slots = asyncio.Semaphore(settings.research_llm_concurrency)

    async def search(self, query: str, *, company_slug: str, kind: str, include_domains: list[str] | tuple[str, ...] | None = None,
                     company_domain: str | None = None) -> list[dict]:
        n = self._settings.research_results_per_query
        include = sorted(set(include_domains or ()))
        request = {"query": query, "num_results": n, "user_location": self._settings.exa_user_location,
                   "exclude_domains": sorted(self._settings.exa_exclude_domains)}
        if include:   # only when given, so fixtures recorded before include_domains keep their identity
            request["include_domains"] = include
        async with self._tracer.span("exa", query, input=request,
                                     attrs={"query": query, "mode": self._mode.value, "kind": kind}) as sp:
            if self._mode is Mode.REPLAY:
                results = self._fixtures.read(company_slug, "exa", request)
                sp.set_attrs(replay=True)
            else:
                async with self._exa_slots:
                    await self._budget.charge("exa")
                    raw = await self._exa.collect_sources(
                        [query], include_domains=include, exclude_domains=list(self._settings.exa_exclude_domains),
                    )
                results = raw[:n]
                if self._mode is Mode.RECORD:
                    sp.set_attrs(recorded_to=str(self._fixtures.write(company_slug, "exa", request, results)))
            logger.debug("exa %r → %d result(s)", query, len(results))
            sp.set_output({"count": len(results), "results": results})
        for r in results:
            text = r.get("content") or ""
            cls = classify_source(r["url"], company_domain=company_domain, company_slug=company_slug)
            await self._store.upsert_source({
                "url": r["url"], "domain": domain_of(r["url"]), "title": r.get("title"),
                "published_date": r.get("date"), "text": text, "content_hash": content_hash(text),
                "fetched_at": utcnow(), "kinds": [kind], "source_type": cls.source_type, "tier": cls.tier,
            })
        return results

    async def extract_json(self, *, prompt_name: str, prompt_version: str, system: str, user: str,
                           company_slug: str, label: str,
                           validate: Callable[[dict], Any] | None = None) -> dict:
        """The operation deadline includes semaphore queueing, budget, provider and cache I/O."""
        try:
            async with asyncio.timeout(self._settings.research_operation_timeout_seconds):
                return await self._extract_json(prompt_name=prompt_name, prompt_version=prompt_version,
                                                system=system, user=user, company_slug=company_slug,
                                                label=label, validate=validate)
        except TimeoutError as exc:
            raise LLMError("Research LLM operation timed out (including queue wait)") from exc

    async def _extract_json(self, *, prompt_name: str, prompt_version: str, system: str, user: str,
                            company_slug: str, label: str,
                            validate: Callable[[dict], Any] | None = None) -> dict:
        """`validate` (e.g. a pydantic model_validate) gates the cache: a cached value that fails it is
        ignored and re-asked; a fresh response that fails it is never cached and the error propagates."""
        routing = _routing_identity(self._settings)
        primary = routing["primary"]
        model, provider = primary["model"], primary["provider"]
        key = extract_key(prompt_name, prompt_version, system, user, routing)
        request = {"model": model, "prompt_name": prompt_name, "prompt_version": prompt_version,
                   "system": system, "user": user}
        routed = bool(self._settings.groq_api_keys or self._settings.cloudflare_api_token)
        if routed:
            request["routing"] = routing
        async with self._tracer.span("llm", f"{prompt_name}@{prompt_version}", input=request,
                                     attrs={"model": model, "provider": provider, "prompt_name": prompt_name,
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
                    # Cached output is not a call to today's primary; retain its provenance.
                    provenance = {"provider": hit.get("provider") or "unknown",
                                  "model": hit.get("model") or "unknown"}
                    sp.set_attrs(cache="hit", **provenance)
                    self._tracer.emit("cache.hit", f"{prompt_name}@{prompt_version}: reused cached extract", level="debug")
                    sp.set_output({"data": hit["output"], "cache": "hit", **provenance})
                    return hit["output"]
            if self._mode is Mode.REPLAY:
                response = self._fixtures.read(company_slug, "llm", request)
                sp.set_attrs(replay=True)
            else:
                async with self._llm_slots:
                    await self._budget.charge("llm")
                    r = await self._llm.complete_full(system, user, label=label)
                response = {"data": r.data, "thought": r.thought, "content": r.content, "usage": r.usage,
                            "latency_ms": r.latency_ms, "key_index": r.key_index, "attempts": r.attempts,
                            "provider": getattr(r, "provider", None) or provider,
                            "model": getattr(r, "model", None) or model}
                await self._budget.add_tokens(int(r.usage.get("prompt_tokens") or 0),
                                              int(r.usage.get("completion_tokens") or 0))
                if self._mode is Mode.RECORD:
                    sp.set_attrs(recorded_to=str(self._fixtures.write(company_slug, "llm", request, response)))
            usage = response.get("usage") or {}
            # Legacy Google-only fixtures predate response provenance; their request fixes the model.
            # Routed fixtures without provenance cannot tell us which fallback answered.
            actual_provider = response.get("provider") or ("unknown" if routed else provider)
            actual_model = response.get("model") or ("unknown" if routed else model)
            response = {**response, "provider": actual_provider, "model": actual_model}
            sp.set_attrs(cache="miss", provider=actual_provider, model=actual_model,
                         tokens_in=usage.get("prompt_tokens"), tokens_out=usage.get("completion_tokens"),
                         latency_ms=response.get("latency_ms"), key_index=response.get("key_index"),
                         retries=max(0, int(response.get("attempts") or 1) - 1))
            sp.set_output(response)
            if validate is not None:
                validate(response["data"])
        await self._store.put_extract({"key": key, "prompt_name": prompt_name, "prompt_version": prompt_version,
                                       "output": response["data"], "provider": actual_provider, "model": actual_model,
                                       "created_at": utcnow()})
        return response["data"]

    async def extract_claims(self, *, prompt_name: str, prompt_version: str, system: str, user: str,
                              company_slug: str, label: str) -> list:
        """Extract a fully covered source in bounded windows with one envelope repair per window.

        Partial successes carry diagnostics on a list-compatible result. All-failed sources raise
        the original error; cancellation, budgets and replay misses always propagate unchanged.
        """
        deadline = asyncio.get_running_loop().time() + self._settings.research_operation_timeout_seconds
        chunks = source_chunks(user, chunk_chars=self._settings.research_chunk_chars,
                               max_chunks=self._settings.research_max_chunks)
        kw = dict(prompt_name=prompt_name, prompt_version=f"{prompt_version}#{CHUNK_VERSION}",
                  system=system + CHUNK_SYSTEM, company_slug=company_slug,
                  validate=_ClaimsEnvelope.model_validate)

        async def extract(index, chunk):
            chunk_label = f"{label}#chunk-{index + 1}" if len(chunks) > 1 else label
            try:
                try:
                    async with asyncio.timeout_at(deadline):
                        try:
                            data = await self.extract_json(user=chunk.user, label=chunk_label, **kw)
                        except ValidationError as exc:
                            data = await self.extract_json(user=chunk.user + _repair_note(exc),
                                                           label=f"{chunk_label}#repair", **kw)
                except TimeoutError as exc:
                    raise LLMError("Research source extraction timed out (including chunks and repairs)") from exc
                return [chunk.absolute_claim(c) for c in data["claims"]], None
            except (LLMError, ValidationError) as exc:
                # Configuration errors are run failures, even if another window succeeded.
                if isinstance(exc, LLMError) and re.search(
                    r"\bHTTP (?:400|401|403|404|422)\b|bad (?:key|config)|invalid (?:api.key|model)|"
                    r"(?:keys? (?:configured|is not set)|no .*keys configured|refusing to start)", str(exc), re.I,
                ):
                    raise
                return [], exc

        results = await gather_ordered([extract(i, chunk) for i, chunk in enumerate(chunks)])
        diagnostics = []
        for i, ((_, error), chunk) in enumerate(zip(results, chunks)):
            if error is not None:
                diagnostic = {"kind": "extract_chunk", "chunk_index": i, "start": chunk.start,
                              "end": chunk.end, "error": type(error).__name__, "reason": "chunk_failed"}
                diagnostics.append(diagnostic)
                self._tracer.emit("research.extract.chunk_failed", "Source window extraction failed",
                                  level="warn", data=diagnostic)
        errors = [error for _, error in results if error is not None]
        if len(errors) == len(results):
            raise errors[-1]
        return ExtractedClaims(merge_claims([claims for claims, _ in results]), diagnostics=diagnostics)
