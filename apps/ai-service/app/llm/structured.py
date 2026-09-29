"""Instructor-style validate-and-repair wrapper OVER the existing LLMClient.

We do NOT add the `instructor` dependency and we do NOT swap the client. This is a thin loop
around `LLMClient.complete_json`: call it, validate the JSON against a Pydantic model, and on a
`ValidationError` re-ask the model up to N times with the validation errors folded back in as
repair instructions. If it never validates, raise `LLMError` — a raw `ValidationError` must never
escape (callers only catch `LLMError`, mirroring `complete()`'s own contract).

The client's key rotation, cooldowns, and JSON salvaging are reused untouched — every attempt goes
through `complete_json`, so all of that already applies. `max_repairs` is the number of RE-asks
(so total attempts = max_repairs + 1); it comes from settings (`PREP_MAX_REPAIRS`).
"""
from __future__ import annotations

import json
import logging
from typing import TypeVar

from pydantic import BaseModel, ValidationError

from app.llm.client import LLMClient, LLMError

logger = logging.getLogger(__name__)

T = TypeVar("T", bound=BaseModel)

# Cap how much invalid output we echo back into the repair prompt — a huge blob wastes tokens and
# can push the retry past the context window without adding signal.
_MAX_ECHO_CHARS = 2000


def _repair_note(raw: dict, errors: list[dict]) -> str:
    """Fold the pydantic validation errors (and the offending JSON) into a corrective instruction."""
    compact = []
    for e in errors[:8]:  # a handful is enough to steer the fix; avoid dumping 100 array-item errors
        loc = ".".join(str(p) for p in e.get("loc", ()))
        compact.append(f"- at `{loc or '(root)'}`: {e.get('msg', 'invalid')}")
    try:
        echo = json.dumps(raw, default=str)[:_MAX_ECHO_CHARS]
    except (TypeError, ValueError):
        echo = str(raw)[:_MAX_ECHO_CHARS]
    return (
        "Your previous response did NOT match the required schema. "
        "Fix EXACTLY these problems and return the corrected JSON object only "
        "(no prose, no markdown):\n" + "\n".join(compact) +
        "\n\nYour previous (invalid) response was:\n" + echo
    )


async def complete_structured(
    llm: LLMClient,
    system: str,
    user: str,
    response_model: type[T],
    *,
    max_repairs: int,
    label: str = "structured",
) -> T:
    """Return a validated `response_model` instance, repairing invalid LLM output up to
    `max_repairs` times. Raises `LLMError` if the model never produces valid data (the underlying
    `complete_json` also raises `LLMError` on transport/rate-limit/no-JSON failures — those
    propagate unchanged)."""
    attempt = 0
    current_user = user
    last_errors: list[dict] | None = None
    while True:
        attempt += 1
        data = await llm.complete_json(system, current_user, label=f"{label}#{attempt}")
        try:
            return response_model.model_validate(data)
        except ValidationError as exc:
            last_errors = exc.errors()
            if attempt >= max_repairs + 1:
                # Out of repair budget — surface as LLMError so no ValidationError escapes.
                raise LLMError(
                    f"{label}: response failed schema validation after {attempt} attempt(s) "
                    f"({response_model.__name__}). First errors: {last_errors[:3]}"
                ) from exc
            logger.warning("[structured] %s attempt %d invalid (%d error(s)); re-asking",
                           label, attempt, len(last_errors))
            current_user = f"{user}\n\n{_repair_note(data, last_errors)}"
