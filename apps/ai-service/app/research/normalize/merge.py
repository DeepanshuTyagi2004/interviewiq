"""Merging grounded claims into snapshot Fields (evidence-hardening spec §8.3, §9). Pure functions.

A grounded claim is a dict with at least {field, value, url, tier, date}; pay claims also carry
{quote, unit, basis, open_ended?}, interview claims {source_type, source_name}.

Votes are weighted by source tier and recency, one vote per domain. The winning value is shown;
every other value is kept as an `alternative`, never silently dropped."""
from __future__ import annotations

import re
from collections import Counter
from datetime import UTC, date, datetime, timedelta
from statistics import median, quantiles

from app.research.fields import TIME_SENSITIVE
from app.research.models import field, unavailable
from app.research.normalize.identity import domain_of
from app.research.normalize.sources import canonical_city
from app.research.normalize.text import clean
from app.research.normalize.titles import title_key

TIER_WEIGHT = {1: 3.0, 2: 2.0, 3: 1.0}
RECENCY_YEARS = 2
STALE_FACTOR = 0.5
MAX_ALTERNATIVES = 5
LIST_CAP = 15
CANDIDATE_TYPES = frozenset({"community", "review_platform"})
_ITEM_ALIASES = {
    "golang": "go", "k8s": "kubernetes", "postgres": "postgresql", "js": "javascript", "ts": "typescript",
    "reactjs": "react", "react.js": "react", "nodejs": "node.js", "node": "node.js", "vuejs": "vue", "vue.js": "vue",
}
_DISAGREE = "Sources disagree; highest-weighted value shown, alternatives listed"
_NO_CLAIM = "No supported claim in the returned sources"


def parse_date(value: str | None) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        m = re.match(r"^(\d{4})\b", str(value))
        return date(int(m.group(1)), 1, 1) if m else None


def _now(now: datetime | None) -> date:
    return (now or datetime.now(UTC)).date()


def _fresh(d: date, today: date) -> bool:
    return d >= today - timedelta(days=365 * RECENCY_YEARS)


def _domain(claim: dict) -> str:
    return domain_of(claim["url"]) or claim["url"]


def _weight(claim: dict, today: date) -> float:
    d = parse_date(claim.get("date"))
    return TIER_WEIGHT.get(claim.get("tier") or 3, 1.0) * (STALE_FACTOR if d and not _fresh(d, today) else 1.0)


def _newest(claims: list[dict]) -> date | None:
    dates = [d for d in (parse_date(c.get("date")) for c in claims) if d]
    return max(dates) if dates else None


def _iso(d: date | None) -> str | None:
    return d.isoformat() if d else None


def evidence_field(value, claims: list[dict], *, note: str | None = None, alternatives: list[dict] | tuple = (),
                   provenance: str = "evidence", time_sensitive: bool = False, now: datetime | None = None) -> dict:
    """A Field over supporting claims with the spec §9.2 confidence rules."""
    today = _now(now)
    urls = sorted({c["url"] for c in claims})
    domains = {domain_of(u) or u for u in urls}
    dates = [parse_date(c.get("date")) for c in claims]
    newest = _newest(claims)
    notes = [note] if note else []
    if alternatives:
        confidence = "low"
        notes.append(_DISAGREE)
    elif len(domains) >= 3 and newest and _fresh(newest, today):
        confidence = "high"
    elif len(domains) >= 2 or any(c.get("tier") == 1 for c in claims):
        confidence = "medium"
    else:
        confidence = "low"
    if time_sensitive and dates and all(dates) and not _fresh(newest, today):
        confidence = "low"
        notes.append(f"Newest evidence from {newest.year}")
    return field(value, confidence=confidence, provenance=provenance, source_urls=urls,
                 note="; ".join(notes) or None, alternatives=list(alternatives), as_of=_iso(newest))


def vote_key(name: str, value) -> str:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return f"{float(value):g}"
    text = str(value)
    if name == "hq":
        return canonical_city(text) or clean(text)
    if name == "title":
        return title_key(text)
    return clean(text)


def _representative(claims: list[dict]) -> dict:
    """The highest-tier, newest claim (first on ties) speaks for a group."""
    return min(enumerate(claims), key=lambda ic: (ic[1].get("tier") or 3,
                                                  -(parse_date(ic[1].get("date")) or date.min).toordinal(), ic[0]))[1]


def choose(claims: list[dict], name: str, *, now: datetime | None = None) -> dict:
    found = [c for c in claims if c["field"] == name]
    if not found:
        return unavailable(_NO_CLAIM)
    today = _now(now)
    groups: dict[str, dict[str, list[dict]]] = {}
    for claim in found:
        groups.setdefault(vote_key(name, claim["value"]), {}).setdefault(_domain(claim), []).append(claim)

    def members(key: str) -> list[dict]:
        return [c for cs in groups[key].values() for c in cs]

    def rank(key: str):
        score = sum(max(_weight(c, today) for c in cs) for cs in groups[key].values())
        newest = _newest(members(key))
        return (-score, -len(groups[key]), -(newest or date.min).toordinal(), key)

    order = sorted(groups, key=rank)
    winners = members(order[0])
    alternatives = [{"value": _representative(members(k))["value"], "source_urls": sorted({c["url"] for c in members(k)}),
                     "as_of": _iso(_newest(members(k)))} for k in order[1:1 + MAX_ALTERNATIVES]]
    rep = _representative(winners)
    derived = all(c.get("derived_from") for c in winners)
    return evidence_field(rep["value"], winners, note=f'mapped from "{rep["derived_from"]}"' if derived else None,
                          alternatives=alternatives, provenance="derived" if derived else "evidence",
                          time_sensitive=name in TIME_SENSITIVE, now=now)


def item_key(value: str) -> str:
    key = clean(value).strip(" .,;:()[]")
    return _ITEM_ALIASES.get(key) or _ITEM_ALIASES.get(key.replace(" ", "")) or key


def choose_list(claims: list[dict], name: str, *, cap: int = LIST_CAP, now: datetime | None = None) -> dict:
    found = [c for c in claims if c["field"] == name]
    if not found:
        return unavailable(_NO_CLAIM)
    today = _now(now)
    groups: dict[str, list[dict]] = {}
    for claim in found:
        groups.setdefault(item_key(claim["value"]), []).append(claim)

    def score(key: str) -> float:
        best: dict[str, float] = {}
        for claim in groups[key]:
            best[_domain(claim)] = max(best.get(_domain(claim), 0.0), _weight(claim, today))
        return sum(best.values())

    first_seen = {k: i for i, k in enumerate(groups)}
    top = sorted(groups, key=lambda k: (-score(k), first_seen[k]))[:cap]
    values = []
    for key in top:
        counts = Counter(c["value"] for c in groups[key])
        values.append(max(counts, key=lambda v: (counts[v], -next(i for i, c in enumerate(groups[key]) if c["value"] == v))))
    used = [c for k in top for c in groups[k]]
    domains = {_domain(c) for c in used}
    confidence = "medium" if len(domains) >= 2 or any(c.get("tier") == 1 for c in used) else "low"
    return field(values, confidence=confidence, provenance="evidence", source_urls=sorted({c["url"] for c in used}),
                 as_of=_iso(_newest(used)))


def extractive_text(claims: list[dict], name: str, *, limit: int = 3, tiers: set[int] | None = None,
                    now: datetime | None = None) -> dict:
    found = sorted((c for c in claims if c["field"] == name and (tiers is None or c.get("tier") in tiers)),
                   key=lambda c: c.get("tier") or 3)
    selected, seen = [], set()
    for claim in found:
        key = clean(claim["value"])
        if key not in seen:
            selected.append(claim)
            seen.add(key)
        if len(selected) == limit:
            break
    if not selected:
        return unavailable(_NO_CLAIM)
    return evidence_field("\n\n".join(c["value"] for c in selected), selected,
                          note="Extractive source passages; not an inferred or complete account",
                          time_sensitive=name in TIME_SENSITIVE, now=now)


def ctc_observations(claims: list[dict]) -> list[dict]:
    """One pay observation per source URL (spec §8.3): a min/max pair from the same passage, or a
    single figure (min = max; an open-ended "16+" has no max). Reversed or mixed-unit pairs are
    not observations."""
    by_url: dict[str, dict[str, list[dict]]] = {}
    for claim in claims:
        if claim["field"] in ("ctc_min_lpa", "ctc_max_lpa"):
            by_url.setdefault(claim["url"], {}).setdefault(claim.get("quote") or "", []).append(claim)
    out = []
    for url in sorted(by_url):
        for quote in sorted(by_url[url]):
            rows = by_url[url][quote]
            low = next((c for c in rows if c["field"] == "ctc_min_lpa"), None)
            high = next((c for c in rows if c["field"] == "ctc_max_lpa"), None)
            if low and high and (low.get("unit") != high.get("unit") or low["value"] > high["value"]):
                continue
            lo = low["value"] if low else high["value"]
            hi = high["value"] if high else (None if low.get("open_ended") else lo)
            basis = "total_ctc" if all(c.get("basis") == "total_ctc" for c in (low, high) if c) else "lpa_unspecified"
            first = low or high
            out.append({"min_lpa": lo, "max_lpa": hi, "basis": basis, "source_url": url,
                        "source_name": first.get("source_name"), "tier": first.get("tier"), "date": first.get("date")})
            break   # one observation per source: a page listing several figures must not outvote others
    return out


def _bounds(values: list[float]) -> tuple[float, float]:
    q1, _, q3 = quantiles(values, n=4, method="inclusive")
    iqr = q3 - q1
    return q1 - 1.5 * iqr, q3 + 1.5 * iqr


def _drop_outliers(obs: list[dict]) -> list[dict]:
    if len(obs) < 4:
        return obs
    lo_min, lo_max = _bounds([o["min_lpa"] for o in obs])
    highs = [o["max_lpa"] for o in obs if o["max_lpa"] is not None]
    hi_min, hi_max = _bounds(highs) if len(highs) >= 4 else (float("-inf"), float("inf"))
    return [o for o in obs if lo_min <= o["min_lpa"] <= lo_max and (o["max_lpa"] is None or hi_min <= o["max_lpa"] <= hi_max)]


def _as_claims(obs: list[dict]) -> list[dict]:
    return [{"url": o["source_url"], "tier": o["tier"], "date": o["date"]} for o in obs]


def ctc_range(claims: list[dict], *, now: datetime | None = None) -> tuple[dict, dict, int]:
    # Reported LPA is useful evidence, but it is not necessarily total CTC. Filter before
    # aggregation (including outlier detection) so unspecified pay cannot change either bound.
    obs = _drop_outliers([o for o in ctc_observations(claims) if o["basis"] == "total_ctc"])
    none = "No supported India total-CTC range"
    if not obs:
        return unavailable(none), unavailable(none), 0
    low = median(o["min_lpa"] for o in obs)
    bounded = [o for o in obs if o["max_lpa"] is not None]
    highs = [o["max_lpa"] for o in bounded]
    high = median(highs) if highs else None
    if high is not None and low > high:
        conflict = "Source pay ranges are reversed or conflicting"
        return unavailable(conflict), unavailable(conflict), 0
    note = "Median of source-reported total CTC, normalized to INR annual LPA; derived summary, not a quoted range"
    ev = _as_claims(obs)
    out = [evidence_field(round(low, 2), ev, note=note, provenance="derived", time_sensitive=True, now=now),
           evidence_field(round(high, 2), _as_claims(bounded), note=note, provenance="derived",
                          time_sensitive=True, now=now) if high is not None
           else unavailable("Only open-ended figures; no upper bound reported")]
    if highs and max(o["min_lpa"] for o in obs) > min(highs):
        for f in out:
            if f["provenance"] != "unavailable":
                f["confidence"] = "low"
                f["note"] = f"{f['note']}; source-reported ranges do not overlap; see reported pay observations"
    return out[0], out[1], len({o["source_url"] for o in obs})


def observations_field(obs: list[dict], *, now: datetime | None = None) -> dict:
    if not obs:
        return unavailable("No supported India pay figures")
    ev = _as_claims(obs)
    domains = {domain_of(o["source_url"]) for o in obs}
    return field(obs, confidence="medium" if len(domains) >= 2 else "low", provenance="evidence",
                 source_urls=sorted({o["source_url"] for o in obs}), as_of=_iso(_newest(ev)),
                  note="Each source's reported pay, normalized to INR annual LPA; lpa_unspecified is not verified total CTC")


def reported_passages(claims: list[dict], *, limit: int = 5, now: datetime | None = None) -> dict:
    """Interview passages from non-official sources (spec §8.3), tagged by evidence type, newest first."""
    found, seen = [], set()
    for claim in claims:
        if claim["field"] == "interview_process" and claim.get("tier") != 1 and clean(claim["value"]) not in seen:
            found.append(claim)
            seen.add(clean(claim["value"]))
    found.sort(key=lambda c: (parse_date(c.get("date")) is None, -(parse_date(c.get("date")) or date.min).toordinal(),
                              c.get("tier") or 3))
    found = found[:limit]
    if not found:
        return unavailable("No reported interview experiences in the returned sources")
    entries = [{"text": c["value"],
                "evidence_type": "candidate_report" if c.get("source_type") in CANDIDATE_TYPES else "secondhand",
                "source_url": c["url"], "source_name": c.get("source_name"), "date": c.get("date")} for c in found]
    domains = {_domain(c) for c in found}
    return field(entries, confidence="medium" if len(domains) >= 2 else "low", provenance="evidence",
                 source_urls=sorted({c["url"] for c in found}), as_of=_iso(_newest(found)),
                 note="Reported by candidates or third parties; not official company policy")
