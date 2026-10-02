"""Scrub secrets before anything reaches Mongo or the admin UI (spec §10.3).

Two passes: (1) any mapping key that is an auth header is replaced wholesale; (2) any string
containing a configured secret value has that value replaced with «redacted:<NAME>». Values
shorter than _MIN_SECRET_LEN are never treated as secrets: replacing "x" everywhere would shred
every payload (test env keys are 1 character)."""
from __future__ import annotations

from collections.abc import Mapping
from typing import Any

_SECRET_HEADERS = frozenset({"authorization", "x-api-key", "x-internal-api-key"})
_MIN_SECRET_LEN = 6


def secrets_from_settings(settings: Any) -> dict[str, str]:
    named: dict[str, str] = {
        "EXA_API_KEY": settings.exa_api_key,
        "INTERNAL_API_KEY": settings.internal_api_key,
    }
    for i, key in enumerate(settings.llm_api_keys):
        named[f"LLM_API_KEY#{i}"] = key
    return {name: value for name, value in named.items() if value and len(value) >= _MIN_SECRET_LEN}


def redact(value: Any, secrets: Mapping[str, str]) -> Any:
    if isinstance(value, str):
        for name, secret in secrets.items():
            if secret in value:
                value = value.replace(secret, f"«redacted:{name}»")
        return value
    if isinstance(value, Mapping):
        return {
            k: "«redacted:header»" if isinstance(k, str) and k.lower() in _SECRET_HEADERS else redact(v, secrets)
            for k, v in value.items()
        }
    if isinstance(value, (list, tuple)):
        return [redact(v, secrets) for v in value]
    return value
