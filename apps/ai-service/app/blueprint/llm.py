"""Structured LLM calls for the blueprint stages: Gemini first when GEMINI_API_KEY is set, then the
Groq-first free-tier chain with its quota waits; schema validation, one repair round with the exact
errors, and a full trace record per call."""
from __future__ import annotations

import asyncio
import json
from typing import Callable, TypeVar

from pydantic import BaseModel, ValidationError

from app.blueprint.trace import RunTrace, StageError
from app.config import Settings
from app.llm.client import LLMError

T = TypeVar("T", bound=BaseModel)

_QUOTA_MARKERS = ("no_eligible_providers", "quota", "rate limit", "429")
# One bad reply (truncated or malformed JSON) or a dropped connection should not fail a whole prep run:
# these are retried a few times with a short pause before the run gives up as `llm_unavailable`. A call
# that ran out its whole deadline is quota starvation, not a glitch: retrying it only triples the wait.
_TRANSIENT_MARKERS = ("invalid_json", "finish_reason_", "missing_content", "malformed_", "groq:timeout",
                      "gemini:timeout", "transport_error", "http_5")


def build_blueprint_llm(settings: Settings):
    from app.llm.research_client import ResearchLLMClient

    return ResearchLLMClient(settings, deadline_seconds=settings.blueprint_deadline_seconds,
                             groq_stage_seconds=settings.blueprint_groq_stage_seconds,
                             max_output_tokens=settings.blueprint_max_output_tokens)


def _is_quota(exc: Exception) -> bool:
    text = str(exc).lower()
    return any(m in text for m in _QUOTA_MARKERS)


def _is_transient(exc: Exception) -> bool:
    text = str(exc).lower()
    return any(m in text for m in _TRANSIENT_MARKERS)


async def _complete(llm, system: str, user: str, label: str, settings: Settings):
    """One structured call with two independent retry budgets: quota waits (long pauses, the free tier
    cooling down) and transient failures (short pauses, a bad reply or a dropped connection)."""
    gemini_on = bool(getattr(settings, "gemini_api_keys", None))
    quota_used = 0
    transient_left = settings.blueprint_transient_retries
    while True:
        try:
            return await llm.complete_full(system, user, label=label)
        except LLMError as exc:
            # With Gemini answering, a quota failure is better retried soon (two waits); with Gemini out (credits
            # used up, cooling or rejected) the free-tier chain is primary again and gets its full patience.
            text = str(exc).lower()
            gemini_out = any(m in text for m in ("gemini:http_402", "gemini:cooldown", "gemini:quarantined",
                                                 "gemini:http_401", "gemini:http_403"))
            quota_budget = settings.blueprint_quota_retries if (not gemini_on or gemini_out) \
                else min(settings.blueprint_quota_retries, 2)
            if _is_quota(exc) and quota_used < quota_budget:
                quota_used += 1
                await asyncio.sleep(min(60.0, 15.0 * quota_used))
            elif _is_transient(exc) and transient_left > 0:
                transient_left -= 1
                await asyncio.sleep(2.0 * (settings.blueprint_transient_retries - transient_left))
            else:
                raise


def _errors(exc: ValidationError) -> list[str]:
    out = []
    for e in exc.errors()[:12]:
        loc = ".".join(str(p) for p in e.get("loc", ()))
        out.append(f"{loc}: {e.get('msg')}")
    return out


async def structured(llm, trace: RunTrace, stage: str, label: str, system: str, user: str, model: type[T],
                     settings: Settings, *, check: Callable[[T], list[str]] | None = None,
                     fail_code: str = "validation_failed") -> T:
    """Call, validate (schema + `check`), repair once with the exact problems, then give up with
    `fail_code`. Every attempt is recorded on the trace."""
    prompt = user
    problems: list[str] = []
    last_valid: T | None = None
    for attempt in (1, 2):
        record: dict = {"label": label, "attempt": attempt, "system": system, "user": prompt}
        try:
            result = await _complete(llm, system, prompt, label, settings)
        except LLMError as exc:
            record.update(error=str(exc))
            trace.llm(stage, record)
            if last_valid is not None:
                # The first reply parsed but failed a check and the repair could not run: hand the
                # stage what we have (playbooks fill missing branches from the policy defaults).
                raise StageError(fail_code, f"{label}: repair unavailable ({exc}); " + "; ".join(problems)[:400],
                                 partial=last_valid) from None
            raise StageError("llm_unavailable", f"{label}: {exc}") from None
        record.update(raw=result.content, provider=getattr(result, "provider", None), model=result.model,
                      latency_ms=result.latency_ms, attempts=result.attempts,
                      tokens={"prompt": (result.usage or {}).get("prompt_tokens"),
                              "completion": (result.usage or {}).get("completion_tokens")})
        try:
            parsed = model.model_validate(result.data)
            last_valid = parsed
            problems = check(parsed) if check else []
        except ValidationError as exc:
            parsed, problems = None, _errors(exc)
        record.update(valid=not problems, validation_errors=problems)
        trace.llm(stage, record)
        if not problems and parsed is not None:
            return parsed
        # The excerpt stays small: prompt + output cap must fit one key's per-minute quota (RESEARCH_GROQ_TPM).
        prompt = (user + "\n\nYour previous reply failed these checks:\n" + "\n".join(f"- {p}" for p in problems)
                  + "\n\nPrevious reply (truncated):\n" + json.dumps(result.data, ensure_ascii=False)[:2500]
                  + "\n\nReturn the COMPLETE corrected JSON object in the same format.")
    raise StageError(fail_code, f"{label}: " + "; ".join(problems)[:600], partial=last_valid)


async def run_all(coros) -> list:
    """gather() that cancels the siblings as soon as one fails (a failed run must stop spending calls)."""
    tasks = [asyncio.ensure_future(c) for c in coros]
    try:
        return await asyncio.gather(*tasks)
    except BaseException:
        for t in tasks:
            t.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        raise
