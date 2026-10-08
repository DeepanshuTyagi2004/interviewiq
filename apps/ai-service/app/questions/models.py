"""The single stored shape for one collected interview question.

Thin by design: metadata + a canonical URL only. The full problem statement is NEVER
stored (copyright + size) — it is fetched/linked live at interview time from `url`.
One flat model with optional per-round fields; Mongo is schemaless so no per-round
subclasses. round_type/difficulty reuse the brief enums (DRY)."""
from __future__ import annotations

from pydantic import BaseModel, Field, field_validator

from app.models.brief import Difficulty, RoundType
from app.models.engineering_levels import Level


def _str_list(v):
    if v is None:
        return []
    if isinstance(v, str):
        return [v] if v.strip() else []
    if isinstance(v, list):
        return [str(x).strip() for x in v if x is not None and str(x).strip()]
    return v


def _slug_list(v):
    """Like _str_list but lowercases (company/level tags are slugs)."""
    return [s.lower() for s in _str_list(v)]


def _level_list(v):
    # model_dump() without mode="json" retains enums; validation must be idempotent.
    if isinstance(v, Level):
        v = v.value
    if isinstance(v, list):
        v = [x.value if isinstance(x, Level) else x for x in v]
    return _str_list(v)


def _norm_difficulty(v):
    if isinstance(v, str):
        s = v.strip().lower()
        return s if s in {d.value for d in Difficulty} else None
    return v


class QuestionRecord(BaseModel):
    # --- shared core ---
    slug: str                       # canonical id: dsa = leetcode slug; sd/lld = "source/slug"
    round_type: RoundType
    title: str
    url: str                        # canonical source URL (fetched live, never stored as text)
    sources: list[str] = Field(default_factory=list)   # datasets/repos this came from
    difficulty: Difficulty | None = None
    topic_tags: list[str] = Field(default_factory=list)
    company_tags: list[str] = Field(default_factory=list)
    level_tags: list[Level] = Field(default_factory=list)
    collection_version: str | None = None
    last_synced: str | None = None
    enrichment_status: str = "raw"  # raw | enriched | enrich_failed
    source_hash: str | None = None   # hash of source-derived fields; drives granular incremental skip
    # --- rich content (docs/question-bank.md): generated from the index facts, never from source text ---
    company_evidence: dict[str, str] = Field(default_factory=dict)  # slug -> reported | inferred
    content: dict | None = None            # round-specific shape, see app/questions/content/models.py
    content_status: str = "none"           # none | generated | verified | failed (content is stored only when it passed its checks)
    content_version: str | None = None
    content_hash: str | None = None        # hash of index facts + CONTENT_VERSION; stale -> regenerate
    content_generated_at: str | None = None
    content_model: str | None = None
    content_error: str | None = None

    # --- DSA extras ---
    acceptance_rate: float | None = None
    frequency_score: float | None = None
    is_premium: bool | None = None

    # --- system-design extras ---
    category: str | None = None
    components_tested: list[str] = Field(default_factory=list)
    is_classic: bool | None = None
    solution_url: str | None = None

    # --- LLD extras ---
    domain: str | None = None
    patterns_tested: list[str] = Field(default_factory=list)
    entities_involved: list[str] = Field(default_factory=list)
    is_machine_coding: bool | None = None
    evaluation_mode: str | None = None   # "working-code" | "discussion"
    assess: list[str] = Field(default_factory=list)

    # shared with both SD and LLD
    estimated_duration_mins: int | None = None

    _diff = field_validator("difficulty", mode="before")(_norm_difficulty)

    @field_validator("title", mode="before")
    @classmethod
    def _clean_title(cls, v):
        """Source markdown leaks into titles ("[211. Design Add…]()"): keep the visible text only."""
        if isinstance(v, str):
            import re
            v = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", v)
            v = re.sub(r"^[\s*_`#>]+|[\s*_`]+$", "", v)
            v = re.sub(r"^\[(.+)\]$", r"\1", v)
        return v
    _t = field_validator("topic_tags", "components_tested", "patterns_tested",
                         "entities_involved", "assess", "sources", mode="before")(_str_list)
    _s = field_validator("company_tags", mode="before")(_slug_list)
    _levels = field_validator("level_tags", mode="before")(_level_list)
