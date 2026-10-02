"""LLM client (OpenAI-compatible) for the extract + aggregate stages.

Default provider is Google AI Studio (Gemma via the Gemini API's OpenAI-compatible
/chat/completions endpoint). Any OpenAI-shaped endpoint works by re-pointing LLM_BASE_URL
(LM Studio, OpenRouter, Groq, …). We force JSON output by salvaging the object from the
reply text and tolerate the slips models make (```json fences / preamble). Bounded
concurrency keeps us under the provider's rate limits while extracting many sources.

Gemma note: Gemma has no system role on the Gemini API, so complete_json folds the
system prompt into the user turn — harmless for every other OpenAI-shaped model too.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from dataclasses import dataclass

import httpx

from app.config import Settings

logger = logging.getLogger(__name__)

_RATE_LIMIT_BACKOFF_SECONDS = 20    # fallback when the provider gives no retry-after hint
_TRANSPORT_BACKOFF_SECONDS = 5      # network blip / timeout — not rate-limited, so retry soon
_MAX_ATTEMPTS = 6
_MAX_COOLDOWN_SECONDS = 120         # waits longer than this = daily-limit territory -> give up fast
_COUNTDOWN_STEP = 10               # how often to log the cooldown countdown (seconds)

# Gemma 4 emits a reasoning preamble it can't disable ("Thinking budget is not supported for
# this model" — every suppression knob 400s). The real answer follows </thought>, so strip the
# block before salvaging JSON, else the brace scan grabs a `{` from inside the thought and fails.
# Group 2 captures the inner text so we can also surface it (LLM_CAPTURE_THOUGHTS).
_THINK_BLOCK = re.compile(r"<(think|thought)>(.*?)</\1>", re.DOTALL | re.IGNORECASE)


def extract_thought(content: str) -> str:
    """Join the inner text of any <think>/<thought> blocks (the model's reasoning). '' if none."""
    return "\n\n".join(m.group(2).strip() for m in _THINK_BLOCK.finditer(content)).strip()

# Google AI Studio free tier for Gemma 4 31B: RPM 15 · RPD 1,500 · TPM unlimited.
# RPM is the binding limit here — keep EXTRACT_CONCURRENCY low and let the 429 handler pace bursts.


class LLMError(RuntimeError):
    """LLM call failed after retries. Caller decides whether to drop the item or fail the combo."""


def _retry_plan(body: str, retry_after: str | None) -> tuple[float | None, str]:
    """From a 429 body (+ optional Retry-After header) work out how long to wait and which limit
    was hit, so we can log a precise cooldown and a human error. Returns (seconds, kind); seconds
    is None when the provider gave no hint (caller falls back to a default). The text needles are
    Groq-style; Google AI Studio usually gives only a header (or nothing) — that path returns the
    default and still self-heals."""
    kind = "rate limit"
    for label, needle in (
        ("daily token limit (TPD)", "tokens per day"),
        ("per-minute token limit (TPM)", "tokens per minute"),
        ("daily request limit (RPD)", "requests per day"),
        ("per-minute request limit (RPM)", "requests per minute"),
    ):
        if needle in body:
            kind = label
            break
    wait: float | None = None
    if retry_after:
        try:
            wait = float(retry_after)
        except ValueError:
            wait = None
    if wait is None:
        m = re.search(r"try again in (?:(\d+)m)?([\d.]+)s", body)
        if m:
            wait = int(m.group(1) or 0) * 60 + float(m.group(2))
    return wait, kind


def parse_json(content: str) -> dict:
    """Extract JSON from model text, tolerating reasoning preambles (<think>/<thought> blocks,
    e.g. Gemma 4 which can't disable thinking), ```json fences / prose (grab the outermost
    {...}), and trailing commas. Raises ValueError if none found."""
    content = _THINK_BLOCK.sub("", content).strip()
    candidates = [content]
    start, end = content.find("{"), content.rfind("}")
    if start != -1 and end > start:
        candidates.append(content[start : end + 1])
    for cand in candidates:
        for attempt in (cand, re.sub(r",(\s*[}\]])", r"\1", cand)):
            try:
                return json.loads(attempt)
            except json.JSONDecodeError:
                pass
    raise ValueError(f"no valid JSON found. First 500 chars: {content[:500]!r}")


async def gather_capped(coros: list, limit: int) -> list:
    """Run coros with at most `limit` in flight. Returns results in order; any coro that
    raises is captured as None (a junk source must not abort the whole stage)."""
    sem = asyncio.Semaphore(limit)

    async def _run(coro):
        async with sem:
            try:
                return await coro
            except Exception as exc:  # noqa: BLE001 — per-item isolation
                logger.warning("[llm] capped task failed (%s: %s)", type(exc).__name__, exc)
                return None

    return await asyncio.gather(*(_run(c) for c in coros))


@dataclass(frozen=True)
class LLMResult:
    """Everything one successful call produced. complete() keeps returning just (data, thought); the
    research trace uses complete_full() to also show the raw reply, token usage, key and attempts."""
    data: dict
    thought: str
    content: str
    usage: dict
    latency_ms: int
    key_index: int
    attempts: int


class LLMClient:
    def __init__(self, *, base_url: str, api_keys: list[str], model: str, timeout_seconds: float):
        if not api_keys:
            raise LLMError("LLM_API_KEY is not set. Refusing to start.")
        self._url = base_url.rstrip("/") + "/chat/completions"
        self._model = model
        # Round-robin across keys (same model → same RPM each, so ~N×RPM total). `_next` spreads
        # load; `_cooldown_until[i]` is the monotonic time key i is rate-limited until (0 = free).
        self._keys = api_keys
        self._next = 0
        self._cooldown_until = [0.0] * len(api_keys)
        # One shared client → HTTP keepalive, so extract's many calls per brief reuse connections
        # instead of redoing the TLS handshake every time. Auth is set per-request (per-key), not
        # on the client. Caller closes it (async with / aclose).
        self._client = httpx.AsyncClient(
            timeout=timeout_seconds,
            headers={"Content-Type": "application/json"},
            limits=httpx.Limits(max_keepalive_connections=10, keepalive_expiry=30.0),
        )

    def _acquire_key(self) -> tuple[int, float]:
        """Round-robin to the next key that isn't cooling down. Returns (index, wait): wait>0 means
        every key is rate-limited and the caller must sleep `wait`s before key `index` frees up.
        Sync + no await inside → asyncio runs it atomically, so concurrent callers can't race it."""
        now = time.monotonic()
        n = len(self._keys)
        for _ in range(n):
            i = self._next % n
            self._next += 1
            if self._cooldown_until[i] <= now:
                return i, 0.0
        i = min(range(n), key=lambda k: self._cooldown_until[k])   # all cooling → soonest-free key
        return i, max(0.0, self._cooldown_until[i] - now)

    async def aclose(self) -> None:
        await self._client.aclose()

    async def __aenter__(self) -> "LLMClient":
        return self

    async def __aexit__(self, *_exc) -> None:
        await self.aclose()

    async def complete_json(self, system: str, user: str, *, label: str = "llm") -> dict:
        """One chat call returning just the parsed JSON object. Thin wrapper over complete()."""
        data, _ = await self.complete(system, user, label=label)
        return data

    async def complete(self, system: str, user: str, *, label: str = "llm") -> tuple[dict, str]:
        """One chat call returning (parsed JSON object, reasoning text). See complete_full()."""
        result = await self.complete_full(system, user, label=label)
        return result.data, result.thought

    async def complete_full(self, system: str, user: str, *, label: str = "llm") -> LLMResult:
        """One chat call returning (parsed JSON object, reasoning text). The JSON is salvaged via
        parse_json (no strict json_object mode, see payload note); the reasoning is the
        <thought>/<think> preamble ('' if none). On ANY failure (transport, 429, or any other
        non-200) it logs the full error, cools the current key, and rotates to the next one;
        it only sleeps once every key is cooling. Raises LLMError with the last error once the
        attempt budget is spent. `label` tags the live-log lines. Returns LLMResult; complete() is the
        (data, thought) shorthand."""
        # ponytail: fold system into the user turn — Gemma on the Gemini API has no system role
        # (a system message 400s), and concatenation is harmless for every other OpenAI-shaped model.
        payload = {
            "model": self._model,
            "messages": [
                {"role": "user", "content": f"{system}\n\n{user}"},
            ],
            "temperature": 0.2,
            # Intentionally NOT using response_format=json_object: strict JSON mode is brittle across
            # providers (400s on a thinking preamble, silently dropping sparse sources). We let the
            # model answer freely and salvage the object with parse_json (fences / preamble / commas).
        }
        # ANY failure (transport, 429, or any other non-200) is treated the same: log it in full,
        # cool the current key, and rotate to the next one. Rotation is the intended path, not a
        # real retry, so give each key its own attempt budget on top of the base — else a 5-key
        # fleet burns the budget just discovering they're all cooling.
        # ponytail: a persistent non-key error (e.g. a 400 from a bad payload/model id) will rotate
        # through every key before raising — slower, but it's now logged loudly so the cause is
        # visible rather than swallowed. Add a no-rotate allowlist for 400/404 if that ever bites.
        max_attempts = _MAX_ATTEMPTS + len(self._keys)
        attempt = 0
        last_error = "no attempts made"
        while True:
            attempt += 1
            key_i, wait = self._acquire_key()
            if wait > 0:   # every key is cooling — wait for the soonest to free up, or give up
                if wait > _MAX_COOLDOWN_SECONDS or attempt >= max_attempts:
                    raise LLMError(
                        f"all {len(self._keys)} LLM key(s) unavailable for {self._model} — soonest "
                        f"free in {wait:.0f}s"
                        f"{' (exceeds cap; likely a daily limit — retry later or add keys/upgrade tier)' if wait > _MAX_COOLDOWN_SECONDS else ' (out of retries)'}. "
                        f"Last error: {last_error}"
                    )
                await self._cooldown(wait, f"all {len(self._keys)} keys cooling", label)

            # cool_for/last_error get set by every failure branch below, then a single shared
            # "cool this key + rotate (or raise if out of attempts)" tail runs.
            _t0 = time.monotonic()
            try:
                resp = await self._client.post(
                    self._url, json=payload, headers={"Authorization": f"Bearer {self._keys[key_i]}"}
                )
            except httpx.TransportError as exc:
                # Name WHICH transport error (ReadTimeout / ConnectError / RemoteProtocolError …):
                # a reasoning model running past LLM_TIMEOUT_SECONDS surfaces here as ReadTimeout,
                # not a 429 — the log must say so or it reads like a rate limit.
                last_error = f"transport error ({type(exc).__name__}: {exc or 'no detail'})"
                cool_for = _TRANSPORT_BACKOFF_SECONDS
            else:
                if resp.status_code == 200:
                    try:
                        _body = resp.json()
                        content = _body["choices"][0]["message"]["content"]
                    except (KeyError, IndexError, ValueError):
                        last_error = f"HTTP 200 but malformed body: {resp.text[:300]}"
                        cool_for = _TRANSPORT_BACKOFF_SECONDS
                    else:
                        try:
                            data = parse_json(content)
                        except ValueError as exc:
                            # 200 but no salvageable JSON (e.g. a refusal / prose-only reply). Treat
                            # like a malformed body: cool, rotate, and ultimately raise LLMError — a
                            # bare ValueError must never escape complete() (callers only catch LLMError).
                            last_error = f"HTTP 200 but no salvageable JSON: {exc}"
                            cool_for = _TRANSPORT_BACKOFF_SECONDS
                        else:
                            thought = extract_thought(content)
                            # Additive diagnostics tap: record the raw <thought> against this op's
                            # label. Lazy import + broad except so the LLM path can NEVER be
                            # affected — no-op unless an agent-diag session is bound (production
                            # run_session binds nothing, so record_thought's contextvar is None).
                            _usage = _body.get("usage") or {}
                            _llm_ms = int((time.monotonic() - _t0) * 1000)
                            try:
                                from app.interview_agent import diagnostics_emit as _emit
                                _emit.record_thought(label, thought)
                                _emit.record_llm_io(label, system, user, content)
                                _emit.record_llm_timing(label, _llm_ms,
                                                        _usage.get("prompt_tokens"),
                                                        _usage.get("completion_tokens"))
                            except Exception:  # noqa: BLE001 — diagnostics must never break the call
                                pass
                            return LLMResult(
                                data=data, thought=thought, content=content, usage=_usage,
                                latency_ms=_llm_ms, key_index=key_i, attempts=attempt,
                            )
                elif resp.status_code == 429:
                    cool_for, kind = _retry_plan(resp.text or "", resp.headers.get("retry-after"))
                    cool_for = cool_for if cool_for is not None else _RATE_LIMIT_BACKOFF_SECONDS
                    last_error = f"429 {kind}: {resp.text[:300]}"
                else:
                    last_error = f"HTTP {resp.status_code}: {resp.text[:300]}"
                    cool_for = _TRANSPORT_BACKOFF_SECONDS

            logger.warning("[llm] %s — key #%d failed: %s; payload=%dch; cooling %.0fs, rotating to next key",
                           label, key_i, last_error, len(system) + len(user), cool_for)
            self._cooldown_until[key_i] = time.monotonic() + cool_for
            if attempt >= max_attempts:
                raise LLMError(f"LLM failed after {attempt} attempts ({self._model}). "
                               f"Last error: {last_error}")

    async def _cooldown(self, seconds: float, reason: str, label: str) -> None:
        """Sleep `seconds`, logging a countdown to the live console so a 429 isn't a silent stall."""
        logger.warning("[llm] %s — %s; cooling down %.0fs before retry", label, reason, seconds)
        remaining = seconds
        while remaining > 0:
            step = min(_COUNTDOWN_STEP, remaining)
            await asyncio.sleep(step)
            remaining -= step
            if remaining > 0:
                logger.info("[llm] %s — cooldown %.0fs remaining…", label, remaining)
        logger.info("[llm] %s — retrying now", label)


def build_llm_client(settings: Settings, *, model: str | None = None) -> LLMClient:
    """Build a client bound to a specific model. `model` overrides settings.llm_model — used by
    résumé parsing (RESUME_LLM_MODEL) so it can run on a different Gemini Flash than briefs."""
    return LLMClient(
        base_url=settings.llm_base_url,
        api_keys=settings.llm_api_keys,
        model=model or settings.llm_model,
        timeout_seconds=settings.llm_timeout_seconds,
    )
