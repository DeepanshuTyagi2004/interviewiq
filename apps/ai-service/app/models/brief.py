"""Interview brief models — the contract between the Perplexity response and MongoDB.

A FLAT list of first-hand candidate experiences (each tagged with its source + URL) plus a
consolidated round-by-round process — both produced by Perplexity in one call. Descriptive
only — no scores or rankings. Validators coerce the messy types small local LLMs emit (ints
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
    EVIDENCE_BACKED = "evidence_backed"
    INFERRED = "inferred"


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


class Experience(BaseModel):
    """One candidate's first-hand account of the full process (any source)."""
    source: str | None = None          # platform name (LeetCode Discuss, Glassdoor, jointaro, …)
    source_url: str | None = None      # direct URL to the specific experience post
    total_rounds: int | None = None
    timeline_days: int | None = None
    rounds: list[RoundDetail] = Field(default_factory=list)
    overall_outcome: str | None = None

    _s = field_validator("source", "source_url", "overall_outcome", mode="before")(_coerce_str)


class ConsolidatedRound(BaseModel):
    round_number: int | None = None
    type: RoundType | None = None
    consistency: str | None = None     # e.g. "appears in 4 of 5 experiences"
    format: str | None = None          # what to expect in this round
    dominant_topics: list[str] = Field(default_factory=list)
    difficulty: Difficulty | None = None

    _t = field_validator("type", mode="before")(_norm_round_type)
    _d = field_validator("difficulty", mode="before")(_norm_difficulty)
    _s = field_validator("consistency", "format", mode="before")(_coerce_str)
    _l = field_validator("dominant_topics", mode="before")(_coerce_str_list)


class ConsolidatedProcess(BaseModel):
    """The synthesised process across all role-matched experiences — what the JD page renders."""
    typical_round_count: int | None = None
    rounds: list[ConsolidatedRound] = Field(default_factory=list)
    dominant_topics: list[str] = Field(default_factory=list)
    difficulty_calibration: str | None = None
    interviewer_style_notes: str | None = None
    red_flags: list[str] = Field(default_factory=list)
    company_specific_patterns: str | None = None
    data_confidence: DataConfidence = DataConfidence.LOW

    _s = field_validator(
        "difficulty_calibration", "interviewer_style_notes", "company_specific_patterns",
        mode="before",
    )(_coerce_str)
    _l = field_validator("dominant_topics", "red_flags", mode="before")(_coerce_str_list)

    @field_validator("data_confidence", mode="before")
    @classmethod
    def _norm_conf(cls, v):
        if v is None or (isinstance(v, str) and not v.strip()):
            return DataConfidence.LOW
        if isinstance(v, str):
            return v.strip().lower()
        return v


class PerplexityBriefV2(BaseModel):
    """The JSON object Perplexity returns and we validate. Stored under the brief doc."""
    experiences: list[Experience] = Field(default_factory=list)
    consolidated_process: ConsolidatedProcess


class RawExperience(BaseModel):
    """One source's extracted account (Groq extractor output, one per collected source)."""
    source: str | None = None
    url: str | None = None
    date: str | None = None
    detected_role: str | None = None
    detected_level: str | None = None
    geo: Geo = Geo.UNKNOWN
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
            if s in ("india", "in", "indian"):
                return "india"
            if s in {g.value for g in Geo}:
                return s
            return "unknown" if not s else ("non-india" if s not in ("india",) else s)
        return v if v is not None else "unknown"


class FinalRound(BaseModel):
    round_number: int | None = None
    type: RoundType | None = None
    format: str | None = None
    topics: list[str] = Field(default_factory=list)
    problems: list[str] = Field(default_factory=list)
    difficulty: Difficulty | None = None
    provenance: Provenance = Provenance.INFERRED
    evidence_urls: list[str] = Field(default_factory=list)

    _t = field_validator("type", mode="before")(_norm_round_type)
    _d = field_validator("difficulty", mode="before")(_norm_difficulty)
    _s = field_validator("format", mode="before")(_coerce_str)
    _l = field_validator("topics", "problems", "evidence_urls", mode="before")(_coerce_str_list)

    @field_validator("provenance", mode="before")
    @classmethod
    def _norm_prov(cls, v):
        if isinstance(v, str):
            s = v.strip().lower().replace("-", "_")
            return s if s in {p.value for p in Provenance} else "inferred"
        return "inferred"


class FinalExperience(BaseModel):
    """The single consolidated round-by-round experience the JD page renders."""
    rounds: list[FinalRound] = Field(default_factory=list)
    dominant_topics: list[str] = Field(default_factory=list)
    difficulty_calibration: str | None = None
    interviewer_style_notes: str | None = None
    red_flags: list[str] = Field(default_factory=list)
    company_specific_patterns: str | None = None
    data_confidence: DataConfidence = DataConfidence.LOW

    _s = field_validator(
        "difficulty_calibration", "interviewer_style_notes", "company_specific_patterns",
        mode="before",
    )(_coerce_str)
    _l = field_validator("dominant_topics", "red_flags", mode="before")(_coerce_str_list)
