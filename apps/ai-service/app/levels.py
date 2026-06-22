"""Seniority classification and JD-level matching for brief generation.

Replaces the old coarse 3-bucket `_level_bucket`/`_level_matches` (which treated a
null detected level as a match — the defect that let null/off-level sources launder
into "high confidence"). Here:

  classify(detected) -> (bucket, sublevel)   — read seniority from a messy string.
  match_tier(jd_level, detected) -> tier      — how a source relates to the JD we asked for:
      "exact"    same sublevel family (fresher↔sde1; sde3↔senior)  -> full level-proof
      "adjacent" same bucket, different rung (intern under fresher; 6yr under sde3) -> tagged, partial
      "unknown"  source never stated a level                       -> inferred support ONLY, never proof
      "off"      different bucket (3yr/sde2 under a fresher JD)     -> excluded before the LLM

Buckets: entry {intern, fresher, sde1} · mid {sde2} · senior {sde3, staff}.
"""
from __future__ import annotations

import re

# sublevel -> coarse bucket
_BUCKET = {
    "intern": "entry", "fresher": "entry", "sde1": "entry",
    "sde2": "mid",
    "sde3": "senior", "staff": "senior",
}

# "3 years", "4+ yrs", "~6 years experience" -> the leading integer
_YEARS_RE = re.compile(r"(\d+)\s*\+?\s*(?:year|yr|yrs|years)")


def classify(detected: str | None) -> tuple[str, str | None]:
    """Map a raw detected-level string to (bucket, sublevel). Unknown when nothing
    explicit is present — we never guess a level from absence."""
    if not detected:
        return ("unknown", None)
    s = str(detected).strip().lower()
    if not s:
        return ("unknown", None)

    # Explicit rung keywords, most senior / most specific first so substrings don't collide.
    if "intern" in s:                                                  # intern / internship
        return ("entry", "intern")
    if any(k in s for k in ("staff", "principal", "architect", "distinguished")):
        return ("senior", "staff")
    if any(k in s for k in ("sde3", "sde-3", "sde 3", "sde iii", "senior", "sse", "lead")):
        return ("senior", "sde3")
    if any(k in s for k in ("sde2", "sde-2", "sde 2", "sde ii", "swe2", "swe ii")):
        return ("mid", "sde2")
    if any(k in s for k in ("sde1", "sde-1", "sde 1", "sde i", "associate", "junior")):
        return ("entry", "sde1")
    if any(k in s for k in ("fresher", "fresh graduate", "new grad", "new-grad", "newgrad",
                            "campus", "graduate", "trainee", "entry level", "entry-level",
                            "final year", "final-year", "0-1 year")):
        return ("entry", "fresher")

    # Fall back to years-of-experience if stated.
    m = _YEARS_RE.search(s)
    if m:
        y = int(m.group(1))
        if y <= 1:
            return ("entry", "sde1")
        if y <= 3:
            return ("mid", "sde2")
        if y <= 5:
            return ("senior", "sde3")
        return ("senior", "staff")

    return ("unknown", None)


def match_tier(jd_level: str | None, detected: str | None) -> str:
    """How a source's detected level relates to the JD level we are building for."""
    tb, ts = classify(jd_level)
    db, ds = classify(detected)
    if db == "unknown":
        return "unknown"
    if db != tb:
        return "off"
    if ds == ts:
        return "exact"
    # Within entry, fresher and sde1 are interchangeable (both full-time entry); intern is adjacent.
    if tb == "entry" and {ts, ds} <= {"fresher", "sde1"}:
        return "exact"
    return "adjacent"


def is_on_level(tier: str) -> bool:
    """on-level == genuine level evidence (exact or adjacent). unknown/off are NOT."""
    return tier in ("exact", "adjacent")


if __name__ == "__main__":  # ponytail: smallest runnable check that the level logic holds
    assert classify("3 years at Juspay") == ("mid", "sde2")          # the cross-level offender
    assert classify("SDE-2") == ("mid", "sde2")
    assert classify("senior") == ("senior", "sde3")
    assert classify("Software Intern") == ("entry", "intern")
    assert classify("Associate") == ("entry", "sde1")
    assert classify("~6 years") == ("senior", "staff")
    assert classify(None) == ("unknown", None)

    assert match_tier("fresher", "fresher") == "exact"
    assert match_tier("fresher", "sde1") == "exact"
    assert match_tier("fresher", "intern") == "adjacent"             # intern != fresher (report finding)
    assert match_tier("fresher", "3 years at Juspay") == "off"       # mid under fresher -> excluded
    assert match_tier("fresher", None) == "unknown"                  # null is NOT a match anymore
    assert match_tier("sde2", "SDE-2") == "exact"
    assert match_tier("sde2", "senior") == "off"                     # senior under sde2 -> excluded
    assert match_tier("sde3", "senior") == "exact"                   # senior == sde3-equiv
    assert match_tier("sde3", "3 years at Juspay") == "off"          # mid under sde3 -> excluded
    print("ok")
