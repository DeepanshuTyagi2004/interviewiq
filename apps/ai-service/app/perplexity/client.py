"""Perplexity API client.

Perplexity is OpenAI-compatible: same chat-completions request shape, pointed at
https://api.perplexity.ai. Its sonar models do live web search + synthesis and
return the answer plus citation URLs. Base URL / model / key all come from config.

One public method: query_interview_intelligence(company, role, level) -> (text, citations).

Failure handling (per spec):
  401            -> PerplexityConfigError, no retry (bad key)
  429            -> back off 30s, retry up to 3x
  500/503        -> back off 60s, retry up to 2x
  timeout (30s)  -> retry once
  other non-200  -> PerplexityError (caller marks the combination failed, continues)
"""
from __future__ import annotations

import asyncio
import logging

import httpx

from app.config import Settings
from app.prompts.brief_query import BRIEF_SYSTEM, build_brief_query

logger = logging.getLogger(__name__)

_RATE_LIMIT_BACKOFF_SECONDS = 30
_RATE_LIMIT_RETRIES = 3
_SERVER_ERROR_BACKOFF_SECONDS = 60
_SERVER_ERROR_RETRIES = 2


class PerplexityError(RuntimeError):
    """Generic Perplexity failure — the combination is marked failed, job continues."""


class PerplexityConfigError(PerplexityError):
    """Unrecoverable configuration problem (e.g. bad API key). Do not retry."""


class PerplexityClient:
    def __init__(self, *, base_url: str, api_key: str, model: str, timeout_seconds: float):
        if not api_key:
            raise PerplexityConfigError("PERPLEXITY_API_KEY is not set. Refusing to start.")
        if not model:
            raise PerplexityConfigError("PERPLEXITY_MODEL is not set. Refusing to start.")
        self._url = base_url.rstrip("/") + "/chat/completions"
        self._model = model
        self._timeout = timeout_seconds
        self._headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }

    async def query_interview_intelligence(
        self,
        company: str,
        role: str,
        level: str,
        *,
        specialization: str | None = None,
        title: str | None = None,
        emphasize_json: bool = False,
    ) -> tuple[str, str, list[str]]:
        """Return (prompt_sent, raw_text, citation_urls). Raises PerplexityError on failure.
        The prompt is returned so the caller can surface exactly what was asked."""
        prompt = build_brief_query(
            company, role, level, specialization=specialization,
            title=title, emphasize_json=emphasize_json,
        )
        payload = {
            "model": self._model,
            "messages": [
                {"role": "system", "content": BRIEF_SYSTEM},
                {"role": "user", "content": prompt},
            ],
            "temperature": 0.2,
        }
        data = await self._post_with_retries(payload, label=f"{company}/{role}/{level}")
        try:
            text = data["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as exc:
            raise PerplexityError(f"Unexpected Perplexity response shape: {data!r}") from exc
        return prompt, text, _extract_citations(data)

    async def search(
        self, system_prompt: str, user_prompt: str, *, label: str = "search"
    ) -> tuple[str, list[str]]:
        """Generic live-web search → (raw_text, citation_urls). Same request shape + retry
        handling as the brief query; used for the targeted round-structure follow-up."""
        payload = {
            "model": self._model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "temperature": 0.2,
        }
        data = await self._post_with_retries(payload, label=label)
        try:
            text = data["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as exc:
            raise PerplexityError(f"Unexpected Perplexity response shape: {data!r}") from exc
        return text, _extract_citations(data)

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
                    logger.warning("[perplexity] %s timed out (%s); retrying once", label, exc)
                    continue
                raise PerplexityError(f"Perplexity timed out for {label}: {exc}") from exc

            status = resp.status_code
            if status == 200:
                return resp.json()

            if status == 401:
                raise PerplexityConfigError("Perplexity returned 401 — invalid PERPLEXITY_API_KEY.")

            if status == 429:
                rate_limit_attempts += 1
                if rate_limit_attempts > _RATE_LIMIT_RETRIES:
                    raise PerplexityError(f"Perplexity rate-limited {label} after {_RATE_LIMIT_RETRIES} retries.")
                logger.warning("[perplexity] %s 429; backing off %ds (attempt %d/%d)",
                               label, _RATE_LIMIT_BACKOFF_SECONDS, rate_limit_attempts, _RATE_LIMIT_RETRIES)
                await asyncio.sleep(_RATE_LIMIT_BACKOFF_SECONDS)
                continue

            if status in (500, 503):
                server_error_attempts += 1
                if server_error_attempts > _SERVER_ERROR_RETRIES:
                    raise PerplexityError(f"Perplexity server error {status} for {label} after retries.")
                logger.warning("[perplexity] %s %d; backing off %ds (attempt %d/%d)",
                               label, status, _SERVER_ERROR_BACKOFF_SECONDS, server_error_attempts, _SERVER_ERROR_RETRIES)
                await asyncio.sleep(_SERVER_ERROR_BACKOFF_SECONDS)
                continue

            # Any other non-200: log status + body, give up on this combination.
            body = resp.text[:500]
            logger.warning("[perplexity] %s unexpected status %d: %s", label, status, body)
            raise PerplexityError(f"Perplexity returned {status} for {label}")


def _extract_citations(data: dict) -> list[str]:
    """Perplexity returns citations either as a top-level `citations` list of URLs
    or as `search_results` objects with a `url`. Handle both; dedupe, preserve order."""
    urls: list[str] = []
    for c in data.get("citations") or []:
        if isinstance(c, str):
            urls.append(c)
    for sr in data.get("search_results") or []:
        url = sr.get("url") if isinstance(sr, dict) else None
        if url:
            urls.append(url)
    seen = set()
    deduped = []
    for u in urls:
        if u not in seen:
            seen.add(u)
            deduped.append(u)
    return deduped


def build_perplexity_client(settings: Settings) -> PerplexityClient:
    return PerplexityClient(
        base_url=settings.perplexity_base_url,
        api_key=settings.perplexity_api_key,
        model=settings.perplexity_model,
        timeout_seconds=settings.perplexity_timeout_seconds,
    )
