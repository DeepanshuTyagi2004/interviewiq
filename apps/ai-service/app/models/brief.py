"""Interview brief models — the contract for the staged collect→extract→aggregate pipeline.

Per-source raw experiences (RawExperience[]) are extracted by the LLM and then merged into one
consolidated FinalExperience. Both are stored in the brief document. Descriptive only —
no scores or rankings. Validators coerce the messy types small local LLMs emit (ints
where strings are expected, a bare string where a list is expected, mixed-case enums).
"""
from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum

from pydantic import BaseModel, Field, field_validator


class DataConfidence(str, Enum):
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class GenerationStatus(str, Enum):
    SUCCESS = "success"                       # validated brief, medium/high confidence
    INSUFFICIENT_DATA = "insufficient_data"   # validated brief, but low confidence (sparse data)
    FAILED = "failed"                         # could not generate / validate a brief


class RoundType(str, Enum):
    ONLINE_ASSESSMENT = "online-assessment"
    DSA = "dsa"
    SYSTEM_DESIGN = "system-design"
    LLD = "lld"
    BEHAVIOURAL = "behavioural"
    HIRING_MANAGER = "hiring-manager"


class Difficulty(str, Enum):
    EASY = "easy"
    MEDIUM = "medium"
    HARD = "hard"


class Provenance(str, Enum):
    EVIDENCE_BACKED = "evidence_backed"          # >=1 on-level FIRST-HAND account attests this round (may carry named problems)
    PROCESS_GUIDE = "process_guide"              # >=1 on-level source describes this round but NONE first-hand (a guide/official/post): structure only, never named problems
    INFERRED_FROM_SIMILAR = "inferred_from_similar"  # informed by level-unconfirmed real posts / similar patterns; generic
    TEMPLATE = "template"                        # industry-standard round no source covered; generic, no company specifics


class Geo(str, Enum):
    INDIA = "india"
    NON_INDIA = "non-india"
    UNKNOWN = "unknown"


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _norm_round_type(v):
    # LLM output is messy: "System Design" / "DSA" / null. Normalise; unknown -> None.
    if isinstance(v, str):
        s = v.strip().lower().replace(" ", "-")
        return s if s in {t.value for t in RoundType} else None
    return v


def _norm_difficulty(v):
    if isinstance(v, str):
        s = v.strip().lower()
        return s if s in {d.value for d in Difficulty} else None
    return v


def _coerce_str(v):
    """Small models sometimes return a number where free text is expected (e.g. consistency: 1)."""
    if isinstance(v, (int, float, bool)):
        return str(v)
    return v


def _coerce_str_list(v):
    """Tolerate a bare string where a list of strings is expected, and stringify items."""
    if v is None:
        return []
    if isinstance(v, str):
        return [v] if v.strip() else []
    if isinstance(v, list):
        return [str(x) for x in v if x is not None and str(x).strip()]
    return v


class RoundDetail(BaseModel):
    round_number: int | None = None
    type: RoundType | None = None
    duration_mins: int | None = None
    format: str | None = None
    topics: list[str] = Field(default_factory=list)
    problems: list[str] = Field(default_factory=list)   # specific problems/questions mentioned
    difficulty: Difficulty | None = None
    hints_given: bool | None = None
    outcome: str | None = None

    _t = field_validator("type", mode="before")(_norm_round_type)
    _d = field_validator("difficulty", mode="before")(_norm_difficulty)
    _s = field_validator("format", "outcome", mode="before")(_coerce_str)
    _l = field_validator("topics", "problems", mode="before")(_coerce_str_list)


class RawExperience(BaseModel):
    """One source's extracted account (LLM extractor output, one per collected source).

    `is_first_hand` is the trust discriminator: True = one candidate's own account (may carry lived
    specifics — problems/difficulty). False = a guide/official page/aggregated post that describes
    the process but reports no first-hand specifics. Defaults True for back-compat: everything
    stored before this field existed passed the old first-hand-only gate."""
    source: str | None = None
    url: str | None = None
    date: str | None = None
    detected_role: str | None = None
    detected_level: str | None = None
    geo: Geo = Geo.UNKNOWN
    is_first_hand: bool = True
    rounds: list[RoundDetail] = Field(default_factory=list)
    outcome: str | None = None

    _s = field_validator(
        "source", "url", "date", "detected_role", "detected_level", "outcome", mode="before",
    )(_coerce_str)

    @field_validator("geo", mode="before")
    @classmethod
    def _norm_geo(cls, v):
        if isinstance(v, str):
            s = v.strip().lower().replace(" ", "-")
            if s in {g.value for g in Geo}:          # exact: india / non-india / unknown
                return s
            if s in ("in", "indian") or "india" in s:  # india aliases / "..., India"
                return "india"
            return "unknown"                          # ambiguous/foreign -> safe, non-discounting
        return v if v is not None else "unknown"


class FinalRound(BaseModel):
    round_number: int | None = None
    type: RoundType | None = None
    format: str | None = None
    topics: list[str] = Field(default_factory=list)
    problems: list[str] = Field(default_factory=list)
    difficulty: Difficulty | None = None
    provenance: Provenance = Provenance.INFERRED_FROM_SIMILAR
    evidence_urls: list[str] = Field(default_factory=list)
    # Trust metadata — set deterministically by the pipeline after aggregation, NOT by the LLM.
    support_count: int = 0          # # of on-level (exact/adjacent) sources that attest this round
    source_count_total: int = 0     # # of on-level sources in this brief (the "of N")
    rare: bool = False              # reported by exactly one source out of several
    source_sublevels: list[str] = Field(default_factory=list)  # sublevels of the attesting sources

    _t = field_validator("type", mode="before")(_norm_round_type)
    _d = field_validator("difficulty", mode="before")(_norm_difficulty)
    _s = field_validator("format", mode="before")(_coerce_str)
    _l = field_validator("topics", "problems", "evidence_urls", "source_sublevels", mode="before")(_coerce_str_list)

    @field_validator("provenance", mode="before")
    @classmethod
    def _norm_prov(cls, v):
        if isinstance(v, str):
            s = v.strip().lower().replace("-", "_").replace(" ", "_")
            if s in {p.value for p in Provenance}:
                return s
            if s == "inferred":                       # legacy/loose label -> the new inferred tier
                return Provenance.INFERRED_FROM_SIMILAR.value
            if s in ("evidence", "evidenced"):
                return Provenance.EVIDENCE_BACKED.value
        return Provenance.INFERRED_FROM_SIMILAR.value


class FinalExperience(BaseModel):
    """The single consolidated round-by-round experience the JD page renders."""
    rounds: list[FinalRound] = Field(default_factory=list)
    dominant_topics: list[str] = Field(default_factory=list)
    difficulty_calibration: str | None = None
    interviewer_style_notes: str | None = None
    red_flags: list[str] = Field(default_factory=list)
    company_specific_patterns: str | None = None
    data_confidence: DataConfidence = DataConfidence.LOW
    template_used: bool = False     # true when one or more rounds are industry-standard templates

    _s = field_validator(
        "difficulty_calibration", "interviewer_style_notes", "company_specific_patterns",
        mode="before",
    )(_coerce_str)
    _l = field_validator("dominant_topics", "red_flags", mode="before")(_coerce_str_list)
