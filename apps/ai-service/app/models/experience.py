"""Pydantic models — the contract between scraper, LLM extraction, and MongoDB.

Signals are DESCRIPTIVE (topics, format, difficulty), never evaluative. There is
no score, rank, or comparison field anywhere here, by project rule.
"""
from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum

from pydantic import BaseModel, Field, field_validator


class Source(str, Enum):
    LEETCODE_DISCUSS = "leetcode-discuss"
    GFG = "gfg"
    REDDIT = "reddit"
    AMBITIONBOX = "ambitionbox"
    USER_SUBMITTED = "user-submitted"  # first-party paste-in from candidates


class Level(str, Enum):
    FRESHER = "fresher"
    SDE1 = "sde1"
    SDE2 = "sde2"
    SDE3 = "sde3"


class ProcessingStatus(str, Enum):
    PENDING = "pending"
    EXTRACTED = "extracted"
    FAILED = "failed"


class RoundType(str, Enum):
    DSA = "dsa"
    SYSTEM_DESIGN = "system-design"
    BEHAVIOURAL = "behavioural"
    HIRING_MANAGER = "hiring-manager"


class Difficulty(str, Enum):
    EASY = "easy"
    MEDIUM = "medium"
    HARD = "hard"


class Outcome(str, Enum):
    SELECTED = "selected"
    REJECTED = "rejected"
    UNKNOWN = "unknown"


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class ExtractedSignals(BaseModel):
    """Structured signals for ONE interview round. An experience post usually
    describes several rounds, so an experience stores a list of these."""

    round_number: int | None = None
    round_type: RoundType | None = None
    duration_mins: int | None = None
    topics: list[str] = Field(default_factory=list)
    problems_mentioned: list[str] = Field(default_factory=list)
    difficulty: Difficulty | None = None
    hints_given: bool | None = None
    outcome: Outcome = Outcome.UNKNOWN
    additional_notes: str | None = None

    # LLM output is messy: it lowercases inconsistently and emits null/"" where the
    # prompt asked for a value. Normalise before enum validation so a stray null or
    # "Selected" doesn't fail the whole extraction.
    @field_validator("round_type", "difficulty", mode="before")
    @classmethod
    def _normalise_optional_enum(cls, v):
        if isinstance(v, str):
            return v.strip().lower() or None
        return v

    @field_validator("outcome", mode="before")
    @classmethod
    def _normalise_outcome(cls, v):
        if v is None or (isinstance(v, str) and not v.strip()):
            return Outcome.UNKNOWN
        if isinstance(v, str):
            return v.strip().lower()
        return v


class ProcessingMetadata(BaseModel):
    """Reproducibility trail. extraction_prompt_version lets us re-run extraction
    on old raw_content with an improved prompt without losing the original data."""

    extraction_attempted_at: datetime | None = None
    extraction_model: str | None = None          # LLM_MODEL value at extraction time
    extraction_prompt_version: str | None = None
    error: str | None = None                      # last failure reason, if any


class RawExperience(BaseModel):
    """One scraped experience. raw_content is stored verbatim, never truncated.
    Extraction output is embedded under `signals` once processed."""

    source: Source
    company: str
    role: str
    level: Level
    raw_content: str
    source_url: str
    posted_at: datetime | None = None
    scraped_at: datetime = Field(default_factory=utcnow)
    processing_status: ProcessingStatus = ProcessingStatus.PENDING
    signals: list[ExtractedSignals] = Field(default_factory=list)
    processing_metadata: ProcessingMetadata = Field(default_factory=ProcessingMetadata)


class ExtractionResult(BaseModel):
    """Wrapper the LLM returns for one experience: a list of per-round signals."""

    rounds: list[ExtractedSignals] = Field(default_factory=list)
