"""Exa AI Search client (https://api.exa.ai/search).

Replaces Perplexity for the collect stage (swapped 2026-06-21). Same public method and
return shape the pipeline already consumed — collect_sources(queries, ...) -> list of
[{title, url, content, date}] — so only the wire format changed, not the pipeline.

Exa takes a SINGLE query per call (Perplexity took an array), so collect_sources runs each
query variant and merges + dedups by URL. Deny-list goes to Exa as `excludeDomains` AND is
re-applied downstream (host-suffix match catches subdomains Exa's exact match won't).

Failure handling mirrors the old client:
  401            -> ExaConfigError, no retry (bad key)
  429            -> back off 30s, retry up to 3x
  500/503        -> back off 60s, retry up to 2x
  timeout        -> retry once
  other non-200  -> ExaError (caller marks the combination failed, continues)
"""
from __future__ import annotations

import asyncio
import logging

import httpx

from app.config import Settings

logger = logging.getLogger(__name__)

_RATE_LIMIT_BACKOFF_SECONDS = 30
_RATE_LIMIT_RETRIES = 3
_SERVER_ERROR_BACKOFF_SECONDS = 60
_SERVER_ERROR_RETRIES = 2


class ExaError(RuntimeError):
    """Generic Exa failure — the combination is marked failed, the job continues."""


class ExaConfigError(ExaError):
    """Unrecoverable configuration problem (e.g. bad API key). Do not retry."""


class ExaClient:
    def __init__(self, *, base_url: str, api_key: str, num_results: int,
                 search_type: str, user_location: str, timeout_seconds: float,
                 max_characters: int):
        if not api_key:
            raise ExaConfigError("EXA_API_KEY is not set. Refusing to start.")
        self._url = base_url.rstrip("/") + "/search"
        self._num_results = num_results
        self._type = search_type
        self._user_location = user_location
        self._timeout = timeout_seconds
        self._max_characters = max_characters
        self._headers = {"x-api-key": api_key, "Content-Type": "application/json"}

    async def collect_sources(
        self,
        queries: list[str],
        *,
        include_domains: list[str],
        exclude_domains: list[str],
    ) -> list[dict]:
        """Run each query variant through Exa /search, merge + dedup by URL (order preserved).
        Returns [{title, url, content, date}]."""
        out: list[dict] = []
        seen: set[str] = set()
        for query in queries:
            payload: dict = {
                "query": query,
                "numResults": self._num_results,
                "type": self._type,
                "userLocation": self._user_location,
                # text capped (not True/uncapped): uncapped dumps post + full comment tree + chrome,
                # ballooning long threads to 20k+ chars and timing out the extract LLM.
                "contents": {"text": {"maxCharacters": self._max_characters}, "highlights": True},
            }
            if include_domains:
                payload["includeDomains"] = include_domains
            if exclude_domains:
                payload["excludeDomains"] = exclude_domains
            data = await self._post_with_retries(payload, label="search")
            for r in _parse_search_results(data):
                if r["url"] in seen:
                    continue
                seen.add(r["url"])
                out.append(r)
        return out

    async def _post_with_retries(self, payload: dict, *, label: str) -> dict:
        rate_limit_attempts = 0
        server_error_attempts = 0
        timeout_retried = False

        while True:
            try:
                async with httpx.AsyncClient(timeout=self._timeout) as client:
                    resp = await client.post(self._url, json=payload, headers=self._headers)
            except (httpx.TimeoutException, httpx.ConnectError) as exc:
                if not timeout_retried:
                    timeout_retried = True
                    logger.warning("[exa] %s timed out (%s); retrying once", label, exc)
                    continue
                raise ExaError(f"Exa timed out for {label}: {exc}") from exc

            status = resp.status_code
            if status == 200:
                return resp.json()

            if status in (401, 403):
                raise ExaConfigError(f"Exa returned {status} — invalid EXA_API_KEY.")

            if status == 429:
                rate_limit_attempts += 1
                if rate_limit_attempts > _RATE_LIMIT_RETRIES:
                    raise ExaError(f"Exa rate-limited {label} after {_RATE_LIMIT_RETRIES} retries.")
                logger.warning("[exa] %s 429; backing off %ds (attempt %d/%d)",
                               label, _RATE_LIMIT_BACKOFF_SECONDS, rate_limit_attempts, _RATE_LIMIT_RETRIES)
                await asyncio.sleep(_RATE_LIMIT_BACKOFF_SECONDS)
                continue

            if status in (500, 503):
                server_error_attempts += 1
                if server_error_attempts > _SERVER_ERROR_RETRIES:
                    raise ExaError(f"Exa server error {status} for {label} after retries.")
                logger.warning("[exa] %s %d; backing off %ds (attempt %d/%d)",
                               label, status, _SERVER_ERROR_BACKOFF_SECONDS, server_error_attempts, _SERVER_ERROR_RETRIES)
                await asyncio.sleep(_SERVER_ERROR_BACKOFF_SECONDS)
                continue

            body = resp.text[:500]
            logger.warning("[exa] %s unexpected status %d: %s", label, status, body)
            raise ExaError(f"Exa returned {status} for {label}")


def _parse_search_results(data: dict) -> list[dict]:
    """Normalise Exa /search results to [{title, url, content, date}], deduped by URL, order
    preserved. Prefers full `text`; falls back to joined `highlights`."""
    out: list[dict] = []
    seen: set[str] = set()
    for r in data.get("results") or []:
        if not isinstance(r, dict):
            continue
        url = r.get("url")
        if not url or url in seen:
            continue
        seen.add(url)
        content = (r.get("text") or "").strip()
        if not content:
            highlights = r.get("highlights") or []
            content = " … ".join(h for h in highlights if isinstance(h, str)).strip()
        out.append({
            "title": r.get("title"),
            "url": url,
            "content": content,
            "date": r.get("publishedDate"),
        })
    return out


def build_exa_client(settings: Settings) -> ExaClient:
    return ExaClient(
        base_url=settings.exa_base_url,
        api_key=settings.exa_api_key,
        num_results=settings.exa_num_results,
        search_type=settings.exa_type,
        user_location=settings.exa_user_location,
        timeout_seconds=settings.exa_timeout_seconds,
        max_characters=settings.exa_max_characters,
    )
