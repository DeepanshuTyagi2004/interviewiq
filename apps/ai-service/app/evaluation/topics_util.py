"""Small shared helpers for gap topics and practice: word sets, gap iteration, the no-practice subjects, the `Source` of a gap and
bank-tag cleaning. No imports from the rest of the evaluation package, so report, practice, graders and pipeline can all use it."""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

NO_PRACTICE_SUBJECTS = ("behaviour", "behavior", "communication", "habit", "soft skill", "delivery", "conduct", "culture", "leadership")

_STOP = {"with", "from", "that", "this", "when", "into", "over", "and", "the", "for", "why", "how", "does", "not", "versus",
         "including", "using", "choosing", "needed", "final", "answer", "state", "design", "future", "all", "information"}


@dataclass
class Source:
    """The problem a gap came from. `mapped` is True only when the gap was tied to one problem; an unmapped gap carries the round as a
    whole (topics and tags of all its problems) for tie-breaks and the relevance bar, but never earns the harder-problem exception."""
    topics: set[str] = field(default_factory=set)       # canonical topic ids
    tags: set[str] = field(default_factory=set)         # raw bank tags
    difficulty: str | None = None
    slug: str | None = None
    mapped: bool = False


def words(text: str) -> set[str]:
    return {w.replace("isation", "ization") for w in re.findall(r"[a-z0-9]+", text.lower()) if len(w) >= 4 and w not in _STOP}


def _get(t: Any, key: str, default: Any = "") -> Any:
    return t.get(key, default) if isinstance(t, dict) else getattr(t, key, default)


def topics_of(gap: Any) -> list[tuple[str, str, str, list[str] | None]]:
    """(topic, why, subject, bank_tags) for every topic of a gap (a model or a dict); bank_tags is None when none were given."""
    subject = _get(gap, "subject") or ""
    return [(n, _get(t, "why") or "", subject, _get(t, "bank_tags", None))
            for t in _get(gap, "topics", []) or [] if (n := (_get(t, "topic") or "").strip())]


def clean_bank_tags(tags: list[str] | None, vocab: list[str] | None) -> list[str] | None:
    """The tags that are in the vocabulary (case-insensitive, spelled as the vocabulary has them, at most 3); None when no vocabulary is
    known or no list was given. A model returning junk here never fails grading: unknown tags are simply dropped."""
    if tags is None or not vocab:
        return None
    by_lower = {v.lower(): v for v in vocab}
    out: list[str] = []
    for t in tags if isinstance(tags, list) else []:
        v = by_lower.get(str(t).strip().lower())
        if v and v not in out:
            out.append(v)
    return out[:3]
