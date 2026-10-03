"""Which failures a retry can fix, and which a research section may degrade on (spec §3.2,
evidence-hardening §10). Budget exhaustion, cancellation, replay misses and bad keys never degrade:
they must pause, stop or fail loudly."""
from __future__ import annotations

import httpx
from pydantic import ValidationError

from app.exa.client import ExaConfigError, ExaError
from app.llm.client import LLMError


def is_transient(exc: BaseException) -> bool:
    """Retry only what a retry can fix: network blips, 429s, 5xx. Bad keys, exhausted budgets,
    missing fixtures and invalid model output fail immediately."""
    if isinstance(exc, ExaConfigError):
        return False
    return isinstance(exc, (ExaError, LLMError, httpx.TransportError))


def is_degradable(exc: BaseException) -> bool:
    """A provider failure that leaves an optional section `unavailable` instead of failing the company."""
    if isinstance(exc, ExaConfigError):
        return False
    return isinstance(exc, (LLMError, ExaError, httpx.TransportError, ValidationError))
