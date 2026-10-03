"""Research-only quota ledger. All mutations are synchronous (atomic on the event loop).

Local rolling charges and provider header ceilings are independent: a late response can
lower a ceiling, but cannot replenish capacity another concurrent request already spent.
Unknown usage remains charged at the reserved estimate, including cancelled requests.
"""
from __future__ import annotations

import math
import re
import time
from dataclasses import dataclass
from email.utils import parsedate_to_datetime


def duration_seconds(value: str | None) -> float | None:
    """Parse seconds or Groq duration headers (e.g. 1m2.5s, 500ms, 2h)."""
    if not value:
        return None
    value = value.strip()
    try:
        result = float(value)
    except ValueError:
        parts = list(re.finditer(r"(\d+(?:\.\d+)?)(ms|s|m|h|d)", value))
        if not parts or "".join(part.group(0) for part in parts) != value:
            return None
        scales = {"ms": .001, "s": 1, "m": 60, "h": 3600, "d": 86400}
        result = sum(float(part[1]) * scales[part[2]] for part in parts)
    return result if math.isfinite(result) and result >= 0 else None


def retry_seconds(headers, body: str = "") -> float:
    """Honor Retry-After and exhausted token/request reset clocks without logging bodies."""
    from app.llm.client import _retry_plan

    raw = headers.get("retry-after")
    retry = duration_seconds(raw)
    if retry is None and raw:
        try:
            retry = max(0.0, parsedate_to_datetime(raw).timestamp() - time.time())
        except (TypeError, ValueError, OverflowError):
            pass
    body_hint, _ = _retry_plan(body, None)
    hints = [hint for hint in (retry, body_hint) if hint is not None]
    for kind in ("tokens", "requests"):
        remaining = _number(headers.get(f"x-ratelimit-remaining-{kind}"))
        if remaining is None or remaining <= 0:
            reset = duration_seconds(headers.get(f"x-ratelimit-reset-{kind}"))
            if reset is not None:
                hints.append(reset)
    return max(hints) if hints else 20.0


def _number(value) -> int | None:
    try:
        number = float(value)
        return max(0, int(number)) if math.isfinite(number) else None
    except (ValueError, TypeError, OverflowError):
        return None


def usage_tokens(usage: dict) -> int | None:
    def token_count(value) -> int | None:
        if isinstance(value, bool):
            return None
        try:
            number = float(value)
            return math.ceil(number) if math.isfinite(number) and number >= 0 else None
        except (TypeError, ValueError, OverflowError):
            return None

    total = token_count(usage.get("total_tokens"))
    if total is not None:
        return total
    prompt = token_count(usage.get("prompt_tokens"))
    completion = token_count(usage.get("completion_tokens"))
    return prompt + completion if prompt is not None and completion is not None else None


@dataclass(eq=False)
class Reservation:
    tokens: int
    expires: float
    active: bool = True


@dataclass
class _Ceiling:
    remaining: int
    expires: float


class QuotaLedger:
    """One key/model's rolling TPM/RPM reservations, shared across concurrent calls."""

    def __init__(self, tpm: int, rpm: int):
        self.tpm = tpm
        self.rpm = rpm
        self._charges: list[Reservation] = []
        self._ceilings: dict[str, _Ceiling] = {}

    def _prune(self, now: float) -> None:
        self._charges = [r for r in self._charges if r.active or r.expires > now]
        self._ceilings = {k: c for k, c in self._ceilings.items() if c.expires > now}

    def reserve(self, tokens: int) -> Reservation | None:
        now = time.monotonic()
        self._prune(now)
        if sum(r.tokens for r in self._charges) + tokens > self.tpm:
            return None
        if len(self._charges) >= self.rpm:
            return None
        for kind, amount in (("tokens", tokens), ("requests", 1)):
            ceiling = self._ceilings.get(kind)
            if ceiling is not None and ceiling.remaining < amount:
                return None
        reservation = Reservation(tokens, now + 60)
        self._charges.append(reservation)
        for kind, amount in (("tokens", tokens), ("requests", 1)):
            if kind in self._ceilings:
                self._ceilings[kind].remaining -= amount
        return reservation

    def reconcile(self, reservation: Reservation, usage: dict | None = None, headers=None) -> None:
        if not reservation.active:
            return
        now = time.monotonic()
        actual = usage_tokens(usage or {})
        if actual is not None:
            # Output/prompt estimates may be low. Debit known server capacity too;
            # refunds only affect the local ledger, never an authoritative ceiling.
            extra = max(0, actual - reservation.tokens)
            ceiling = self._ceilings.get("tokens")
            if ceiling is not None:
                ceiling.remaining = max(0, ceiling.remaining - extra)
            reservation.tokens = actual
        reservation.active = False
        reservation.expires = max(reservation.expires, now + 60)
        self._prune(now)
        if headers is None:
            return
        for kind in ("tokens", "requests"):
            remaining = _number(headers.get(f"x-ratelimit-remaining-{kind}"))
            if remaining is None:
                continue
            reset = duration_seconds(headers.get(f"x-ratelimit-reset-{kind}"))
            expires = now + (reset if reset is not None else 60)
            outstanding = sum(r.tokens if kind == "tokens" else 1
                              for r in self._charges if r.active)
            available = max(0, remaining - outstanding)
            ceiling = self._ceilings.get(kind)
            if ceiling is None:
                self._ceilings[kind] = _Ceiling(available, expires)
            else:
                ceiling.remaining = min(ceiling.remaining, available)
                ceiling.expires = max(ceiling.expires, expires)

    def exhaust(self, seconds: float) -> None:
        """A 429 with no remaining headers is still an authoritative capacity failure."""
        now = time.monotonic()
        expires = now + seconds
        for kind in ("tokens", "requests"):
            previous = self._ceilings.get(kind)
            self._ceilings[kind] = _Ceiling(0, max(expires, previous.expires if previous else now))
