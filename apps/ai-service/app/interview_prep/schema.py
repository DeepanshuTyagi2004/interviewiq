"""InterviewPlan models — the interviewer's prep material for one session (Pipeline 1).

Descriptive + evidence-carrying throughout, mirroring the rest of the service. The per-question
rubric lives ONLY here — it is never grafted onto any Profile Builder / ProfileSummary contract.

Wire shape matches interviewiq-infra/contracts/openapi.yaml: every model is camelCase on the wire
(alias_generator=to_camel) but accepts snake_case too (populate_by_name), so the messy JSON a local
LLM emits — and the camelCase body the backend sends — both validate. `RoundType`/`Difficulty` are
REUSED from app.models.brief (not redefined) so the round vocabulary stays single-sourced.

The three LLM calls (persona+arc, ladders, probes) each target a small wrapper model here so the
structured wrapper (app/llm/structured.py) can validate-and-repair against a concrete schema.
"""
from __future__ import annotations

from datetime import datetime
from enum import Enum

from pydantic import BaseModel, ConfigDict, Field, field_validator
from pydantic.alias_generators import to_camel

from app.models.brief import Difficulty, RoundType

# ---- tolerant coercion (same spirit as app/models/brief.py: small local LLMs are messy) ----


def _coerce_str(v):
    if isinstance(v, (int, float, bool)):
        return str(v)
    return v


def _coerce_str_list(v):
    if v is None:
        return []
    if isinstance(v, str):
        return [v] if v.strip() else []
    if isinstance(v, list):
        return [str(x) for x in v if x is not None and str(x).strip()]
    return v


def _coerce_float(v):
    if isinstance(v, str):
        try:
            return float(v.strip())
        except ValueError:
            return None
    if isinstance(v, bool):  # bool is an int subclass — don't let True become 1.0 silently
        return float(v)
    return v


def _coerce_int(v):
    if isinstance(v, str):
        s = v.strip()
        try:
            return int(float(s))
        except ValueError:
            return None
    if isinstance(v, float):
        return int(v)
    return v


def _norm_difficulty(v):
    if isinstance(v, str):
        s = v.strip().lower()
        return s if s in {d.value for d in Difficulty} else None
    return v


class _CamelModel(BaseModel):
    """camelCase on the wire, snake_case-friendly in Python, tolerant of extra keys."""
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="ignore")


class RoundPhase(str, Enum):
    INTRO = "intro"
    WARM_UP = "warm-up"
    CORE = "core"
    CURVEBALL = "curveball"
    CANDIDATE_QS = "candidate-qs"
    WRAP = "wrap"


def _norm_phase(v):
    if isinstance(v, str):
        s = v.strip().lower().replace("_", "-").replace(" ", "-")
        aliases = {"warmup": "warm-up", "candidate-questions": "candidate-qs",
                   "candidate-q": "candidate-qs", "wrapup": "wrap", "wrap-up": "wrap",
                   "introduction": "intro", "wrap-": "wrap"}
        s = aliases.get(s, s)
        return s if s in {p.value for p in RoundPhase} else RoundPhase.CORE.value
    return v


# ---------------------------- plan content ----------------------------


class InterviewerPersona(_CamelModel):
    name: str
    seniority: str
    disposition: str
    style_notes: str | None = None
    opening: str | None = None
    closing: str | None = None
    grounded_in: list[str] = Field(default_factory=list)

    _s = field_validator("name", "seniority", "disposition", "style_notes", "opening", "closing",
                         mode="before")(_coerce_str)
    _l = field_validator("grounded_in", mode="before")(_coerce_str_list)


class RoundBeat(_CamelModel):
    phase: RoundPhase = RoundPhase.CORE
    title: str
    description: str | None = None
    timebox_mins: int = 0

    _p = field_validator("phase", mode="before")(_norm_phase)
    _s = field_validator("title", "description", mode="before")(_coerce_str)
    _i = field_validator("timebox_mins", mode="before")(_coerce_int)


class RubricCriterion(_CamelModel):
    criterion: str
    weight: float = 1.0
    strong_descriptor: str | None = None
    weak_descriptor: str | None = None

    _s = field_validator("criterion", "strong_descriptor", "weak_descriptor", mode="before")(_coerce_str)
    _w = field_validator("weight", mode="before")(_coerce_float)


class QuestionLadder(_CamelModel):
    question_slug: str | None = None
    base_prompt: str
    difficulty: Difficulty | None = None
    follow_ups: list[str] = Field(default_factory=list)     # escalating, easiest -> hardest
    hints: list[str] = Field(default_factory=list)          # increasingly explicit
    rubric: list[RubricCriterion] = Field(default_factory=list)
    timebox_mins: int | None = None

    _s = field_validator("question_slug", "base_prompt", mode="before")(_coerce_str)
    _d = field_validator("difficulty", mode="before")(_norm_difficulty)
    _l = field_validator("follow_ups", "hints", mode="before")(_coerce_str_list)
    _i = field_validator("timebox_mins", mode="before")(_coerce_int)


class CandidateProbe(_CamelModel):
    prompt: str
    grounded_in: str | None = None
    what_it_tests: str

    _s = field_validator("prompt", "grounded_in", "what_it_tests", mode="before")(_coerce_str)


class PlanProvenance(_CamelModel):
    plan_version: str
    persona_prompt_version: str | None = None
    ladder_prompt_version: str | None = None
    probes_prompt_version: str | None = None
    brief_generated_at: str | None = None
    profile_hash: str | None = None
    input_hash: str
    model: str
    generated_at: datetime


class InterviewPlan(_CamelModel):
    # linkage
    session_id: str
    candidate_id: str
    company: str
    role: str
    level: str
    specialization: str
    round_type: RoundType
    # provenance / versioning
    provenance: PlanProvenance
    # content
    persona: InterviewerPersona
    round_arc: list[RoundBeat] = Field(default_factory=list)
    question_ladders: list[QuestionLadder] = Field(default_factory=list)
    candidate_probes: list[CandidateProbe] = Field(default_factory=list)
    red_flag_watchlist: list[str] = Field(default_factory=list)
    # Pipeline-2 extension reserve: extra hard ladders used ONLY when the live agent extends a
    # strong candidate toward the ceiling. Empty is valid (the brain falls back to follow_ups).
    reserve: list[QuestionLadder] = Field(default_factory=list)


# ---------------------------- LLM call targets ----------------------------
# Each of the three Stage-2 calls validates into one of these wrappers. List outputs are wrapped
# in an object so parse_json (which salvages the outermost {...}) can recover them reliably.


class PersonaAndArc(_CamelModel):
    persona: InterviewerPersona
    round_arc: list[RoundBeat] = Field(default_factory=list)


class LadderSet(_CamelModel):
    ladders: list[QuestionLadder] = Field(default_factory=list)


class ReserveSet(_CamelModel):
    ladders: list[QuestionLadder] = Field(default_factory=list)


class ProbeSet(_CamelModel):
    probes: list[CandidateProbe] = Field(default_factory=list)


# ---------------------------- request (api -> ai-service) ----------------------------


class PlanSessionContext(_CamelModel):
    session_id: str
    candidate_id: str
    company: str
    role: str
    level: str
    specialization: str = "general"
    round_type: RoundType


class PlanJobDescription(_CamelModel):
    id: str
    title: str
    description: str | None = None
    tech_stack: str | None = None


class PlanEducation(_CamelModel):
    institution: str | None = None
    degree: str | None = None
    field: str | None = None
    start_year: str | None = None
    end_year: str | None = None
    grade: str | None = None

    _s = field_validator("institution", "degree", "field", "start_year", "end_year", "grade",
                         mode="before")(_coerce_str)


class PlanExperience(_CamelModel):
    company: str | None = None
    title: str | None = None
    start_date: str | None = None
    end_date: str | None = None
    location: str | None = None
    bullets: list[str] = Field(default_factory=list)

    _s = field_validator("company", "title", "start_date", "end_date", "location",
                         mode="before")(_coerce_str)
    _l = field_validator("bullets", mode="before")(_coerce_str_list)


class PlanLinks(_CamelModel):
    github: str | None = None
    leetcode: str | None = None
    linkedin: str | None = None


class PlanProject(_CamelModel):
    name: str | None = None
    description: str | None = None
    tech: list[str] = Field(default_factory=list)
    bullets: list[str] = Field(default_factory=list)
    link: str | None = None

    _s = field_validator("name", "description", "link", mode="before")(_coerce_str)
    _l = field_validator("tech", "bullets", mode="before")(_coerce_str_list)


class PlanCodingProfile(_CamelModel):
    """Curated GitHub + LeetCode signals from the Profile Builder. Free-form dicts — the backend
    sends the compact fragment sub-set (github: languages/topRepos/…, leetcode: solved/byTopic/…)."""
    github: dict | None = None
    leetcode: dict | None = None


class PlanCandidateProfile(_CamelModel):
    full_name: str | None = None
    headline: str | None = None
    target_role: str | None = None
    education: list[PlanEducation] = Field(default_factory=list)
    experience: list[PlanExperience] = Field(default_factory=list)
    projects: list[PlanProject] = Field(default_factory=list)
    skills: list[str] = Field(default_factory=list)
    achievements: list[str] = Field(default_factory=list)
    links: PlanLinks = Field(default_factory=PlanLinks)
    coding_profile: PlanCodingProfile | None = None

    _s = field_validator("full_name", "headline", "target_role", mode="before")(_coerce_str)
    _l = field_validator("skills", "achievements", mode="before")(_coerce_str_list)


class GenerateInterviewPlanRequest(_CamelModel):
    session: PlanSessionContext
    job_description: PlanJobDescription
    candidate_profile: PlanCandidateProfile
