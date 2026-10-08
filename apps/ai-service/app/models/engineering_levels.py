"""User-selected engineering levels, separate from verbatim source evidence in app.levels.

Enum validation is for new writes only. Legacy normalization is an explicit read operation;
it must never be applied to booked session/brief lookup keys or detected seniority evidence.
"""
from __future__ import annotations

import re
from enum import Enum


class Level(str, Enum):
    INTERN = "intern"
    FRESHER = "fresher"
    SDE1 = "sde1"
    SDE2 = "sde2"
    SDE3 = "sde3"
    STAFF = "staff"
    PRINCIPAL = "principal"
    DISTINGUISHED = "distinguished"


ENGINEERING_LEVELS: tuple[str, ...] = tuple(level.value for level in Level)

_LEGACY_ALIASES = {
    "internship": Level.INTERN,
    "sde0": Level.FRESHER,
    "newgrad": Level.FRESHER,
    "newgraduate": Level.FRESHER,
    "sdei": Level.SDE1,
    "junior": Level.SDE1,
    "sdeii": Level.SDE2,
    "sdeiii": Level.SDE3,
    "senior": Level.SDE3,
    "principle": Level.PRINCIPAL,
}


def normalize_legacy_level(value: object) -> Level | None:
    """Read a known saved alias; unknown labels stay unset, never inferred from years/title."""
    if isinstance(value, Level):
        return value
    if not isinstance(value, str):
        return None
    key = re.sub(r"[\s_-]+", "", value.strip().lower())
    if key in _LEGACY_ALIASES:
        return _LEGACY_ALIASES[key]
    try:
        return Level(key)
    except ValueError:
        return None


def engineering_level_view(value: object) -> dict:
    """Canonical read value with the original unknown label retained as metadata."""
    level = normalize_legacy_level(value)
    legacy = value if level is None and isinstance(value, str) and value.strip() else None
    return {"level": level, "legacyLevel": legacy}
