"""Merge DSA records from the 3 sources into one record per leetcode slug.
Union list fields; take the first non-null scalar (sources are ordered by trust:
snehasishroy first for company/frequency, kaggle for acceptance/premium)."""
from __future__ import annotations

from app.questions.models import QuestionRecord

_SCALARS = ("difficulty", "frequency_score", "acceptance_rate", "is_premium", "is_classic", "title")
_LISTS = ("sources", "company_tags", "topic_tags", "level_tags")


def _union(a: list, b: list) -> list:
    seen, out = set(), []
    for x in [*a, *b]:
        if x not in seen:
            seen.add(x)
            out.append(x)
    return out


def merge_dsa(record_lists: list[list[QuestionRecord]]) -> list[QuestionRecord]:
    by_slug: dict[str, QuestionRecord] = {}
    for records in record_lists:
        for r in records:
            cur = by_slug.get(r.slug)
            if cur is None:
                by_slug[r.slug] = r.model_copy(deep=True)
                continue
            for f in _LISTS:
                setattr(cur, f, _union(getattr(cur, f), getattr(r, f)))
            for f in _SCALARS:
                if getattr(cur, f) in (None, "") and getattr(r, f) not in (None, ""):
                    setattr(cur, f, getattr(r, f))
    return list(by_slug.values())
