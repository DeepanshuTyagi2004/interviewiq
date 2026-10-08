"""Source-bound extraction, grounding and validation for company research (evidence-hardening §7).

Only ResearchIO performs I/O. Every LLM claim is parsed and grounded against its source text:
hard failures (an invented passage, a number not in the quote, foreign pay) are dropped; soft ones
(geography or role context the page does not establish) are kept for the reviewer as `unverified`,
never published. Every outcome carries a reason code. No fallback claims are invented.
"""
from __future__ import annotations

import math
import re
from collections import Counter
from dataclasses import dataclass, field as dc_field
from datetime import date
from typing import TYPE_CHECKING

from pydantic import BaseModel, ConfigDict, Field as PField, ValidationError

from app.exa.client import ExaConfigError, ExaError
from app.llm.client import LLMError
from app.prompts.research.evidence import REPAIR_VERSION, REPAIR_SYSTEM, build_repair_user
from app.research.concurrency import gather_ordered
from app.research.fields import FIELD_SPECS, NUMERIC
from app.research.normalize.identity import domain_of
from app.research.normalize.sources import (
    FIVE_POINT_TYPES, FOREIGN, SourceClass, canonical_city, classify_source, india_signal, is_relevant, role_section,
    foreign_role_context,
)
from app.research.normalize.merge import (  # noqa: F401  (re-exported node API)
    choose, ctc_range, evidence_field, extractive_text, parse_date,
)
from app.research.normalize.text import clean

if TYPE_CHECKING:
    from app.research.graph import CompanyState, NodeDeps


class SourceSpan(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")
    start: int = PField(ge=0)
    end: int = PField(gt=0)


class Claim(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")
    field: str
    value: str | float
    quote: str = PField(min_length=1, max_length=3000)
    geo: str = "unknown"
    geo_quote: str = ""
    role_title: str | None = None
    unit: str | None = None
    quote_span: SourceSpan | None = None
    value_span: SourceSpan | None = None


class RepairEnvelope(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")
    claims: list[object] = PField(max_length=100)


HARD_REASONS = frozenset({
    "schema_invalid", "field_not_allowed", "quote_not_verbatim", "value_not_supported", "category_invalid",
    "category_signal_missing", "foreign_geo", "ctc_not_total", "ctc_estimate", "ctc_unit_missing",
    "rating_scale_missing", "rating_not_adjacent", "count_not_wlb", "out_of_range", "too_long",
})
SOFT_REASONS = frozenset({"geo_unconfirmed", "role_not_in_context", "role_mismatch"})

LEVEL_SIGNALS = {
    "intern": r"\bintern(?:ship)?\b", "fresher": r"\bfresher|\bcampus|\bgraduate|\bentry.level",
    "sde1": r"\b(?:sde|swe|software (?:development )?engineer)[\s-]*(?:1|i)\b",
    "sde2": r"\b(?:sde|swe|software (?:development )?engineer)[\s-]*(?:2|ii)\b",
    "sde3": r"\bsenior\b|\b(?:sde|swe|software (?:development )?engineer)[\s-]*(?:3|iii)\b",
    "staff": r"\bstaff\b", "principal": r"\bprincipal\b", "distinguished": r"\bdistinguished\b",
}
CATEGORY_SIGNALS = {
    "business_model": {"product": r"\bproducts?\b|\bsaas\b|software[\s-]as[\s-]a[\s-]service|\bplatforms?\b",
                       "service": r"\bservices?\b|\bconsult(?:ing|ancy)\b|\boutsourcing\b",
                       "hybrid": r"\bhybrid\b|\bproducts?\b.*\bservices?\b|\bservices?\b.*\bproducts?\b"},
    "sector": {
        "fintech": r"\bfintech\b|financial technology|payment", "e-commerce": r"e[ -]?commerce",
        "saas": r"\bsaas\b|software.as.a.service", "it-services": r"\bit services\b|information technology services",
        "consumer-internet": r"consumer.internet", "enterprise-software": r"enterprise.software",
        "semiconductors": r"semiconductor", "telecom": r"telecom", "edtech": r"edtech|education.technology",
        "healthtech": r"healthtech|health.technology|healthcare.technology", "gaming": r"\bgaming\b|video.games",
        "logistics": r"logistics", "other": r"\bother\b",
    },
    "funding_stage": {
        "public": r"\bpublic\b|publicly.traded|publicly.listed|stock.exchange|\bipo\b|\blisted\b|\bnse\b|\bbse\b|\bnasdaq\b|\bnyse\b",
        "late-stage": r"late.stage", "growth": r"\bgrowth\b", "early": r"early.stage|\bseed\b|series.a\b",
        "bootstrapped": r"bootstrap", "subsidiary": r"subsidiary|\bacquired\b",
    },
    "employment_type": {"full_time": r"full[\s-]?time|\bpermanent\b", "intern": r"\bintern(?:ship)?\b",
                        "contract": r"\bcontract(?:ual)?\b"},
}
# Checked before CATEGORY_SIGNALS["funding_stage"]: "pre-IPO" is a late-stage round, not a listing.
_FUNDING_ROUNDS = (
    (re.compile(r"\bpre[\s-]?ipo\b|\bseries[\s-]*[d-j]\b", re.I), "late-stage"),
    (re.compile(r"\bseries[\s-]*[bc]\b", re.I), "growth"),
    (re.compile(r"\bpre[\s-]?seed\b|\bseed\b|\bangel\b|\bseries[\s-]*a\b", re.I), "early"),
)

_ELLIPSIS = re.compile(r"…|\.\.\.|\[\s*(?:…|\.\.\.)\s*\]")
_MIN_PIECE, _MAX_PIECES = 20, 8


def verbatim(passage: str, text: str) -> bool:
    """A passage is verbatim when it occurs in the text, or when it is up to 8 pieces separated by
    an ellipsis, each at least 20 characters, found in the text in order."""
    pieces = [p for p in (clean(x) for x in _ELLIPSIS.split(passage or "")) if p]
    if not pieces:
        return False
    haystack = clean(text)
    if len(pieces) == 1:
        return pieces[0] in haystack
    if len(pieces) > _MAX_PIECES or any(len(p) < _MIN_PIECE for p in pieces):
        return False
    pos = 0
    for piece in pieces:
        found = haystack.find(piece, pos)
        if found < 0:
            return False
        pos = found + len(piece)
    return True


def exact_passage(passage: str, text: str) -> str | None:
    """Recover source characters after comparison-only typography/Markdown normalization."""
    if not verbatim(passage, text):
        return None
    chars, offsets = [], []
    pending_space = None
    for index, char in enumerate(text):
        normalized = clean(char)
        if not normalized:
            if chars:
                pending_space = index
            continue
        if pending_space is not None:
            chars.append(" ")
            offsets.append(pending_space)
            pending_space = None
        for letter in normalized:
            chars.append(letter)
            offsets.append(index)
    normalized = "".join(chars)
    recovered, cursor = [], 0
    for piece in (clean(p) for p in _ELLIPSIS.split(passage)):
        if not piece:
            continue
        start = normalized.find(piece, cursor)
        if start < 0:
            return None
        cursor = start + len(piece)
        recovered.append(text[offsets[start]:offsets[cursor - 1] + 1])
    return " … ".join(recovered)


def _has_number(value: float, text: str) -> bool:
    numbers = re.findall(r"(?<![\w.])\d+(?:\.\d+)?(?![\w.])", text.replace(",", ""))
    return any(float(n) == value for n in numbers)


def map_funding_round(text: str) -> str | None:
    for pattern, stage in _FUNDING_ROUNDS:
        if pattern.search(text or ""):
            return stage
    return None


def parse_claim(raw: object) -> tuple[Claim | None, str | None, bool]:
    """Validate ONE raw LLM claim. Numbers sent as text are parsed ("20" → 20.0); a trailing "+"
    is accepted only on minimums and marks the claim open-ended. Returns (claim, reason, open_ended)."""
    if not isinstance(raw, dict):
        return None, "schema_invalid", False
    data = {k: v for k, v in raw.items() if not (k in ("geo", "geo_quote") and v is None)}
    open_ended = False
    name, value = data.get("field"), data.get("value")
    if not isinstance(name, str):
        return None, "schema_invalid", False
    if name in NUMERIC and isinstance(value, str):
        m = re.fullmatch(r"\s*(\d+(?:\.\d+)?)\s*(\+?)\s*", value.replace(",", ""))
        if not m or (m.group(2) and name not in {"ctc_min_lpa", "yoe_min"}):
            return None, "schema_invalid", False
        data["value"], open_ended = float(m.group(1)), bool(m.group(2))
    if isinstance(data.get("value"), bool):
        return None, "schema_invalid", False
    try:
        return Claim.model_validate(data), None, open_ended
    except ValidationError:
        return None, "schema_invalid", False


@dataclass(frozen=True)
class Grounded:
    """`claim` is the source-annotated claim (also returned for a soft reason, so it can be shown
    to the reviewer); `reason` is None when the claim is supported."""
    claim: dict | None
    reason: str | None = None
    soft: bool = False


_WLB = r"(?:work[\s-]*life(?:[\s-]*balance)?|\bWLB\b)"
_GAP = r"[\s#*:|\-–—]*"
_RATING = r"(\d(?:\.\d+)?)"


def _adjacent_ratings(quote: str) -> list[float]:
    after = re.findall(_WLB + _GAP + _RATING, quote, re.I)
    found = after or re.findall(_RATING + r"(?:\s*/\s*5)?" + _GAP + _WLB, quote, re.I)
    return [float(x) for x in found]


def _number(claim: Claim, quote: str, src: SourceClass) -> tuple[float | None, str | None, dict]:
    value, name = claim.value, claim.field
    if not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0 or not _has_number(value, quote):
        return None, "value_not_supported", {}
    if name.startswith("ctc_"):
        if value <= 0:
            return None, "value_not_supported", {}
        if re.search(r"\bestimat|\bprojected|\bpredicted|\bhypothetical", quote, re.I):
            return None, "ctc_estimate", {}
        total = bool(re.search(r"\bCTC\b|total\s+compensation", quote, re.I))
        if not total and re.search(r"\b(?:base|fixed|stipend|in[\s-]hand|take[\s-]home)\b", quote, re.I):
            return None, "ctc_not_total", {}
        if claim.unit == "INR_LPA" and re.search(r"\bLPA\b|lakhs?\s+(?:per\s+annum|annually|per\s+year)", quote, re.I):
            basis = "total_ctc" if total else "lpa_unspecified"
        elif (claim.unit in {"INR_ANNUAL", "INR_MONTHLY"}
              and re.search(r"₹|\bINR\b|\bRs\.?\s", quote, re.I)
              and re.search(r"\b(?:annual|annually|yearly|per year|per annum)\b" if claim.unit == "INR_ANNUAL"
                            else r"\b(?:monthly|per month)\b", quote, re.I)
              and not re.search(r"\b(lakh|lac|crore|million|LPA)\b", quote, re.I)):
            if not total:
                return None, "ctc_not_total", {}
            value, basis = value / 100000 * (12 if claim.unit == "INR_MONTHLY" else 1), "total_ctc"
        else:
            return None, "ctc_unit_missing", {}
        return round(value, 2), None, {"basis": basis}
    if name == "wlb_rating":
        if value > 5:
            return None, "out_of_range", {}
        if not re.search(_WLB, quote, re.I):
            return None, "rating_not_adjacent", {}
        if not (src.source_type in FIVE_POINT_TYPES or re.search(r"/\s*5|out of 5|five[\s-]point|5[\s-]point", quote, re.I)):
            return None, "rating_scale_missing", {}
        if float(value) not in _adjacent_ratings(quote):
            return None, "rating_not_adjacent", {}
        return value, None, {}
    if name == "wlb_review_count":
        if value != int(value):
            return None, "value_not_supported", {}
        if not re.search(r"reviews?", quote, re.I) or not re.search(_WLB, quote, re.I):
            return None, "count_not_wlb", {}
        return int(value), None, {}
    if name.startswith("yoe_"):
        if value > 60:
            return None, "out_of_range", {}
        if not re.search(r"years?|\byoe\b", quote, re.I):
            return None, "value_not_supported", {}
    return value, None, {}


def _category(claim: Claim, quote: str) -> tuple[str | None, str | None, dict]:
    name, value = claim.field, claim.value
    if not isinstance(value, str) or not value.strip():
        return None, "category_invalid", {}
    norm = value.strip().lower()
    if name == "employment_type":
        norm = re.sub(r"[\s-]+", "_", norm)
    allowed = FIELD_SPECS[name].allowed
    if name == "funding_stage":
        if norm not in allowed:
            mapped = map_funding_round(value)
            if mapped is None:
                return None, "category_invalid", {}
            if map_funding_round(quote) != mapped:
                return None, "category_signal_missing", {}
            return mapped, None, {"derived_from": value.strip()}
        round_stage = map_funding_round(quote)
        if round_stage is not None:   # a named round decides the stage, whatever word the model chose
            if round_stage != norm:
                return None, "category_signal_missing", {}
            return norm, None, {"derived_from": next(p.search(quote).group(0) for p, s in _FUNDING_ROUNDS if s == norm)}
    if norm not in allowed:
        return None, "category_invalid", {}
    if name == "level" and not re.search(LEVEL_SIGNALS[norm], quote, re.I):
        return None, "category_signal_missing", {}
    if name in CATEGORY_SIGNALS and not re.search(CATEGORY_SIGNALS[name][norm], quote, re.I):
        return None, "category_signal_missing", {}
    return norm, None, {}


def ground(claim: Claim, source: dict, src: SourceClass, *, open_ended: bool = False) -> Grounded:
    """Check one parsed claim against its source (spec §7.3). Role context is NOT checked here; the
    roles node resolves it against the company's known titles (spec §8.2)."""
    spec = FIELD_SPECS.get(claim.field)
    if spec is None:
        return Grounded(None, "field_not_allowed")
    text = source.get("content") or ""
    # The gateway translates window offsets into the original, unmodified source text.
    updates = {}
    if spec.kind == "text":
        for name in ("quote", "value"):
            span = getattr(claim, name + "_span")
            if span is not None:
                if not 0 <= span.start < span.end <= len(text):
                    return Grounded(None, "value_not_supported" if name == "value" else "quote_not_verbatim")
                updates[name] = text[span.start:span.end]
        if updates:
            claim = claim.model_copy(update=updates)
    quote = claim.quote.strip()
    if not verbatim(quote, text):
        return Grounded(None, "quote_not_verbatim")
    value, reason, extra = claim.value, None, {}
    if spec.kind == "number":
        value, reason, extra = _number(claim, quote, src)
    elif spec.kind == "category":
        value, reason, extra = _category(claim, quote)
    elif spec.kind == "text":
        if not isinstance(value, str) or not value.strip() or not verbatim(value, quote):
            reason = "value_not_supported"
        elif spec.max_len and len(value) > spec.max_len:
            reason = "too_long"
    else:  # item: one skill / technology / city, named in the quote itself
        if not isinstance(value, str) or not value.strip() or clean(value) not in clean(quote):
            reason = "value_not_supported"
        elif spec.max_len and len(value) > spec.max_len:
            reason = "too_long"
        elif claim.field == "location":
            city = canonical_city(value)
            if city is None:
                reason = "foreign_geo" if FOREIGN.search(value) else "value_not_supported"
            value = city
        else:
            value = value.strip()
    if reason:
        return Grounded(None, reason)
    url = source["url"]
    grounded = {**claim.model_dump(exclude={"quote_span", "value_span"}), "value": value, "url": url,
                "source_name": source.get("title") or domain_of(url), "date": source.get("date"),
                "tier": src.tier, "source_type": src.source_type, **extra}
    if open_ended:
        grounded["open_ended"] = True
    if spec.india_only:
        geo_quote = claim.geo_quote.strip()
        if geo_quote and not verbatim(geo_quote, text):
            geo_quote = ""   # an unverifiable location passage establishes nothing
        # A foreign passage directly supplied for this claim always wins. India context, however,
        # must belong to this role's section, not another opening or a corporate address.
        if spec.section == "roles" and geo_quote and not FOREIGN.search(geo_quote):
            section = role_section(text, quote, claim.role_title)
            if section is None or not verbatim(geo_quote, section):
                geo_quote = ""
        signal = india_signal(geo=claim.geo, geo_quote=geo_quote, quote=quote, url=url, tier=src.tier,
                              text=text if spec.section == "roles" else "", role_title=claim.role_title)
        grounded["geo_quote"] = geo_quote
        if signal == "foreign":
            return Grounded(None, "foreign_geo")
        if signal == "unknown":
            return Grounded(grounded, "geo_unconfirmed", soft=True)
    return Grounded(grounded)


def ground_page_claims(raw_claims: list, source: dict, src: SourceClass, *, fields) -> list[tuple[object, Grounded]]:
    """Ground a page together so a validated location can support only its own role section.

    Returned pairs preserve raw claims for diagnostics/one bounded text repair. No model I/O here.
    """
    parsed = []
    text = source.get("content") or ""
    for raw in raw_claims:
        claim, reason, open_ended = parse_claim(raw)
        if claim is not None and claim.field not in fields:
            claim, reason = None, "field_not_allowed"
        result = ground(claim, source, src, open_ended=open_ended) if claim else Grounded(None, reason)
        # Exact extractive recovery is restricted to passage fields: retain the actual supporting
        # passage rather than the model's summary. Scalar text (titles/HQ/etc.) is never guessed.
        if claim and claim.field in {"jd", "interview_process", "review_summary", "review_quote"}:
            if result.reason == "value_not_supported" and verbatim(claim.quote, text):
                exact = exact_passage(claim.quote, text)
                claim = claim.model_copy(update={"value": exact, "quote": exact}) if exact else claim
                result = ground(claim, source, src, open_ended=open_ended)
            elif (result.reason == "quote_not_verbatim" and not FOREIGN.search(claim.quote)
                  and isinstance(claim.value, str) and verbatim(claim.value, text)):
                exact = exact_passage(claim.value, text)
                claim = claim.model_copy(update={"value": exact, "quote": exact}) if exact else claim
                result = ground(claim, source, src, open_ended=open_ended)
        if claim is not None and result.claim is not None:
            claim = claim.model_copy(update={"quote": result.claim["quote"], "value": result.claim["value"]})
        parsed.append((raw, claim, open_ended, result))
    locations = [(c, role_section(text, c.quote, c.role_title)) for _, c, _, g in parsed
                 if c is not None and c.field == "location" and g.reason is None]
    out = []
    for raw, claim, open_ended, result in parsed:
        if claim is not None and result.reason == "geo_unconfirmed" and FIELD_SPECS[claim.field].section == "roles":
            section = role_section(text, claim.quote, claim.role_title)
            for location, local in locations:
                if (section is not None and not foreign_role_context(section) and section == local and claim.role_title and location.role_title
                        and clean(claim.role_title) == clean(location.role_title)):
                    enriched = claim.model_copy(update={"geo": "IN", "geo_quote": location.quote})
                    result = ground(enriched, source, src, open_ended=open_ended)
                    break
        out.append((raw, result))
    return out


@dataclass
class ResearchOutcome:
    """What one research() call found: grounded claims, claims routed to review, failures, and the
    sources it extracted (url → source with tier/source_type), plus counters for the trace."""
    claims: list[dict] = dc_field(default_factory=list)
    unverified: list[dict] = dc_field(default_factory=list)
    failures: list[dict] = dc_field(default_factory=list)
    stats: Counter = dc_field(default_factory=Counter)
    sources: dict[str, dict] = dc_field(default_factory=dict)
    extracted: int = 0
    successful_urls: set[str] = dc_field(default_factory=set)
    retryable_sources: dict[str, dict] = dc_field(default_factory=dict)
    _last_extract_error: BaseException | None = dc_field(default=None, repr=False)
    partial_urls: set[str] = dc_field(default_factory=set)

    def merge(self, other: "ResearchOutcome") -> "ResearchOutcome":
        return self + other

    def __add__(self, other: "ResearchOutcome") -> "ResearchOutcome":
        successes = self.successful_urls | other.successful_urls
        consumed = {url for sources in (self.sources, other.sources)
                    for url, src in sources.items() if src.get("_source_retry")}
        sources = {url: {**src, "_source_retry": True} if url in consumed else src
                   for url, src in {**self.sources, **other.sources}.items()}
        retries = {u: s for u, s in {**self.retryable_sources, **other.retryable_sources}.items()
                   if u not in successes and u not in consumed}
        # A retried source can repeat the already successful windows. Keep distinct evidence,
        # but never count identical grounded claims/reviewer entries twice in the merged result.
        def unique(rows):
            out = []
            for row in rows:
                if row not in out:
                    out.append(row)
            return out

        return ResearchOutcome(unique(self.claims + other.claims), unique(self.unverified + other.unverified),
                                self.failures + other.failures, self.stats + other.stats,
                                sources, self.extracted + other.extracted, successes, retries,
                                other._last_extract_error or self._last_extract_error,
                                (self.partial_urls | other.partial_urls) - successes)

    def raise_if_all_failed(self) -> None:
        """Optional nodes must report a real extraction outage after their bounded source retry.

        A valid empty extraction is a success; an empty search result is not an outage. Keep the
        outcome attached to the original exception for internal diagnostics, preserving its type.
        """
        if self.extracted and not (self.successful_urls or self.partial_urls) and self._last_extract_error is not None:
            self._last_extract_error.research_outcome = self
            raise self._last_extract_error

    def notes(self, section: str) -> list[str]:
        out = []
        for kind, template in (("search", "{section}: {n} search(es) failed ({types})"),
                                ("extract", "{section}: {n} of {total} sources could not be extracted ({types})"),
                                ("extract_chunk", "{section}: {n} source window extraction(s) failed ({types})"),
                                ("repair", "{section}: {n} text repair(s) failed ({types})"),
                                ("repair_skipped", "{section}: {n} text repair(s) skipped: payload exceeds configured chunk limit ({types})")):
            failed = [f for f in self.failures if f["kind"] == kind]
            if failed:
                types = ", ".join(sorted({f["error"].split(":", 1)[0] for f in failed}))
                note = template.format(section=section, n=len(failed), total=self.extracted, types=types)
                if kind == "extract_chunk" and any(f["target"] in self.partial_urls for f in failed):
                    note += "; source coverage incomplete"
                out.append(note)
        return out


def company_domain(state: "CompanyState") -> str | None:
    website = ((state.get("identity") or {}).get("website") or {}).get("value") or state["company"].get("website")
    return domain_of(website)


def company_names(state: "CompanyState") -> list[str]:
    identity = state.get("identity") or {}
    names = [state["company"]["name"], (identity.get("name") or {}).get("value"),
             *((identity.get("aliases") or {}).get("value") or []), *(state["company"].get("aliases") or [])]
    return list(dict.fromkeys(n.strip() for n in names if isinstance(n, str) and n.strip()))


def render_queries(queries, *, name: str, title: str | None = None, domain: str | None = None) -> list[tuple[str, list[str]]]:
    out = []
    for template, include in queries:
        if include == "company_domain":
            if not domain:
                continue
            domains = [domain]
        else:
            domains = list(include or [])
        out.append((template.format(name=name, title=title or ""), domains))
    return out


def unverified_entry(claim: dict, reason: str) -> dict:
    return {"field": claim["field"], "value": claim["value"], "quote": claim["quote"][:500], "url": claim["url"],
            "source_name": claim.get("source_name"), "date": claim.get("date"), "tier": claim.get("tier"),
            "reason": reason, "role_title": claim.get("role_title"), "_claim": dict(claim)}


def cap_unverified(entries: list[dict], n: int) -> list[dict]:
    """Highest tier first, then newest; at most n (spec §7.4)."""
    ranked = sorted(enumerate(entries), key=lambda ie: (ie[1].get("tier") or 3,
                                                         -(parse_date(ie[1].get("date")) or date.min).toordinal(), ie[0]))
    return [{k: v for k, v in e.items() if not k.startswith("_")} for _, e in ranked[:n]]


def _error(exc: BaseException) -> str:
    return f"{type(exc).__name__}: {str(exc)[:200]}"


def _raise_bad_configuration(exc: BaseException) -> None:
    # Legacy LLM clients expose configuration failures as LLMError rather than a distinct type.
    # Never turn authentication/payload/model misconfiguration into a partial-success outcome.
    if isinstance(exc, LLMError) and re.search(
        r"\bHTTP (?:400|401|403|404|422)\b|bad (?:key|config)|invalid (?:api.key|model)|"
        r"(?:keys? (?:configured|is not set)|no .*keys configured|refusing to start)", str(exc), re.I,
    ):
        raise exc


async def research(state: "CompanyState", deps: "NodeDeps", prompt, *, kind: str, queries,
                   role_title: str | None = None, skip_urls: frozenset[str] | set[str] = frozenset(),
                   retry_sources: dict[str, dict] | None = None) -> ResearchOutcome:
    """Search → relevance filter → extract → per-claim parse + ground (spec §5–§7, §10).

    Failed extracts retain source text for ONE role-workflow retry. Stored retries need no search;
    pass queries=() for retry-only work. Budget, cancellation, replay misses and bad config propagate.
    All-search failure still raises when no stored retry is available."""
    company = state["company"]
    domain = company_domain(state)
    names = company_names(state)
    out = ResearchOutcome()
    rendered = render_queries(queries, name=company["name"], title=role_title, domain=domain)

    async def search(query: str, include: list[str]):
        try:
            return await deps.io.search(query, company_slug=company["slug"], kind=kind, include_domains=include,
                                        company_domain=domain), None
        except ExaConfigError:
            raise
        except ExaError as exc:
            return [], exc

    searched = await gather_ordered([search(q, inc) for q, inc in rendered])
    errors = [err for _, err in searched if err is not None]
    for (query, _), (_, err) in zip(rendered, searched):
        if err is not None:
            out.failures.append({"kind": "search", "target": query, "error": _error(err)})
            out.stats["search_failed"] += 1
    if rendered and len(errors) == len(rendered) and not retry_sources:
        raise errors[-1]

    picked: list[tuple[dict, SourceClass]] = []
    seen = set(skip_urls)
    for url, source in (retry_sources or {}).items():
        if url in seen:
            continue
        seen.add(url)
        if source.get("_source_retry") or not (source.get("content") or "").strip():
            continue
        picked.append(({**source, "url": url, "_source_retry": True},
                       classify_source(url, company_domain=domain, company_slug=company["slug"])))
    for found, _ in searched:
        for source in found:
            url = source.get("url") or ""
            if url in seen or not url.startswith(("https://", "http://")) or not (source.get("content") or "").strip():
                continue
            seen.add(url)
            cls = classify_source(url, company_domain=domain, company_slug=company["slug"])
            if not is_relevant(source, names, tier=cls.tier):
                out.stats["irrelevant_source"] += 1
                deps.tracer.emit("log", f"{kind}: skipped a source that is not about {company['name']}", level="debug",
                                 data={"url": url, "reason": "irrelevant_source"})
                continue
            picked.append((source, cls))
    out.extracted = len(picked)

    async def extract(source: dict):
        try:
            return await deps.io.extract_claims(
                prompt_name=prompt.PROMPT_NAME,
                prompt_version=prompt.PROMPT_VERSION + ("#source-retry-v1" if source.get("_source_retry") else ""), system=prompt.SYSTEM,
                user=prompt.build_user(company=company["name"], source=source, fields=prompt.FIELDS, role_title=role_title),
                company_slug=company["slug"], label=f"{kind}:{company['slug']}"), None
        except (LLMError, ValidationError) as exc:
            _raise_bad_configuration(exc)
            return None, exc

    extracted = await gather_ordered([extract(source) for source, _ in picked])
    for (source, cls), (raw_claims, err) in zip(picked, extracted):
        url = source["url"]
        out.sources[url] = {**source, "tier": cls.tier, "source_type": cls.source_type}
        if err is not None:
            out._last_extract_error = err
            out.failures.append({"kind": "extract", "target": url, "error": _error(err)})
            out.stats["extract_failed"] += 1
            if not source.get("_source_retry"):
                out.retryable_sources[url] = out.sources[url]
            continue
        diagnostics = getattr(raw_claims, "diagnostics", ())
        if diagnostics:
            out.partial_urls.add(url)
            out.stats["extract_partial"] += 1
            out.stats["extract_chunk_failed"] += len(diagnostics)
            out.failures.extend({**diagnostic, "kind": "extract_chunk", "target": url} for diagnostic in diagnostics)
            if not source.get("_source_retry"):
                out.retryable_sources[url] = out.sources[url]
        else:
            out.successful_urls.add(url)
        results = ground_page_claims(raw_claims, source, cls, fields=prompt.FIELDS)
        rejected = [{"claim": raw, "reason": g.reason} for raw, g in results
                    if isinstance(raw, dict) and isinstance(raw.get("field"), str) and raw.get("field") in FIELD_SPECS
                    and FIELD_SPECS[raw["field"]].kind == "text"
                    and g.reason in {"quote_not_verbatim", "value_not_supported"}]
        repair_user = None
        if rejected:
            limit = deps.settings.research_chunk_chars
            if len(source.get("content") or "") > limit:
                reason = "source_exceeds_chunk_limit"
            else:
                repair_user = build_repair_user(company=company["name"], source=source,
                                                rejected=rejected, role_title=role_title)
                reason = "repair_payload_exceeds_chunk_limit" if len(repair_user) > limit else None
            if reason:
                repair_user = None
                out.stats["text_repair_skipped"] += 1
                diagnostic = {"kind": "repair_skipped", "target": url, "reason": reason,
                              "error": f"RepairPayloadLimit: {reason}", "limit_chars": limit}
                out.failures.append(diagnostic)
                deps.tracer.emit("research.repair.skipped", "Text repair skipped: payload exceeds configured bound",
                                 level="warn", data={"reason": reason, "limit_chars": limit})
        if repair_user is not None:
            # One extra extraction, no envelope re-ask loop; the IO gateway still charges budgets,
            # checks fixtures and caches under this distinct version/input.
            out.stats["text_repair_attempted"] += 1
            try:
                repaired = await deps.io.extract_json(
                    prompt_name=prompt.PROMPT_NAME + ".text_repair", prompt_version=REPAIR_VERSION,
                    system=REPAIR_SYSTEM,
                    user=repair_user,
                    company_slug=company["slug"], label=f"{kind}:{company['slug']}#text-repair",
                    validate=RepairEnvelope.model_validate)
            except (LLMError, ValidationError) as exc:
                _raise_bad_configuration(exc)
                out.failures.append({"kind": "repair", "target": url, "error": _error(exc)})
                out.stats["text_repair_failed"] += 1
            else:
                allowed = {(r["claim"]["field"], r["claim"].get("role_title")) for r in rejected}
                limited = [r for r in repaired["claims"] if isinstance(r, dict)
                           and isinstance(r.get("field"), str)
                           and (r.get("role_title") is None or isinstance(r.get("role_title"), str))
                           and (r.get("field"), r.get("role_title")) in allowed]
                # Include original location claims to apply the same validated local geography.
                context = [r for r in raw_claims if isinstance(r, dict) and r.get("field") == "location"]
                results.extend(ground_page_claims(context + limited, source, cls, fields=prompt.FIELDS)[len(context):])
        for raw, grounded in results:
            name = raw.get("field") if isinstance(raw, dict) else None
            if grounded.reason is None:
                out.claims.append(grounded.claim)
                out.stats["kept"] += 1
                continue
            if grounded.soft:
                out.unverified.append(unverified_entry(grounded.claim, grounded.reason))
                out.stats[f"unverified:{grounded.reason}"] += 1
            else:
                out.stats[f"dropped:{grounded.reason}"] += 1
            deps.tracer.emit("log", f"{kind}: {'unverified' if grounded.soft else 'dropped'} {name} claim ({grounded.reason})",
                             level="debug", data={"url": url, "field": name, "reason": grounded.reason})

    dropped = {k.split(":", 1)[1]: v for k, v in out.stats.items() if k.startswith("dropped:")}
    unverified = sum(v for k, v in out.stats.items() if k.startswith("unverified:"))
    reasons = ", ".join(f"{k} {v}" for k, v in sorted(dropped.items()))
    deps.tracer.emit("log", f"{kind}: kept {out.stats['kept']}, unverified {unverified}, dropped {sum(dropped.values())}"
                     + (f" ({reasons})" if reasons else ""), level="info", data={"stats": dict(out.stats)})
    return out
