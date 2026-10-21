"""Request, LLM-output and blueprint models (spec §5.1, §6, §8). Snake case on the wire: the API
passes admin payloads through unchanged and maps the candidate-safe parts itself."""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.blueprint.vocabulary import ACTIONS, ALL_CONDITIONS, Phase
from app.models.brief import Difficulty, RoundType
from app.models.engineering_levels import Level


class _M(BaseModel):
    model_config = ConfigDict(extra="ignore")


def _strs(v):
    if v is None:
        return []
    if isinstance(v, str):
        return [v.strip()] if v.strip() else []
    if isinstance(v, list):
        return [str(x).strip() for x in v if x is not None and str(x).strip()]
    return v


def _objects(v):
    if isinstance(v, list):
        return [x for x in v if isinstance(x, (dict, BaseModel))]
    return v


# ================================================================ run request (API -> AI service)

class SessionInput(_M):
    session_id: str | None = None          # None for bench runs: never attached to a session
    candidate_id: str
    candidate_label: str | None = None     # display only (diagnostics); purged with the account
    company: str
    role: str
    level: str                             # frozen target identity from the JD (may be a legacy label)
    specialization: str | None = None
    round_type: RoundType
    scheduled_at: str | None = None
    loop_id: str | None = None
    node_id: str | None = None


class JobDescriptionInput(_M):
    id: str | None = None
    title: str = ""
    description: str | None = None
    tech_stack: str | None = None


class RoundInput(_M):
    type: RoundType
    name: str | None = None
    duration_mins: int | None = Field(None, ge=10, le=180)
    format: str | None = None
    topics: list[str] = Field(default_factory=list)
    problems: list[str] = Field(default_factory=list)   # problems named in real experiences of this round
    difficulty: Difficulty | None = None
    source: Literal["brief", "practice"] = "brief"

    _l = field_validator("topics", "problems", mode="before")(_strs)


class CompanyBriefInput(_M):
    dominant_topics: list[str] = Field(default_factory=list)
    difficulty_calibration: str | None = None
    interviewer_style_notes: str | None = None
    company_specific_patterns: str | None = None
    red_flags: list[str] = Field(default_factory=list)

    _l = field_validator("dominant_topics", "red_flags", mode="before")(_strs)


class ProfileProject(_M):
    name: str
    stack: list[str] = Field(default_factory=list)
    summary: str | None = None

    _l = field_validator("stack", mode="before")(_strs)


class ProfileExperience(_M):
    title: str | None = None
    company: str | None = None
    summary: str | None = None
    start: str | None = None
    end: str | None = None
    internship: bool = False


class ProfileEducation(_M):
    institution: str | None = None
    degree: str | None = None
    field: str | None = None
    year: str | None = None


class CodingSummary(_M):
    total_solved: int | None = None
    easy: int | None = None
    medium: int | None = None
    hard: int | None = None
    top_topics: list[str] = Field(default_factory=list)

    _l = field_validator("top_topics", mode="before")(_strs)


class CandidateProfileInput(_M):
    """A minimal projection: no contact details. `level` is the user's own chosen level (one of the
    eight, or unset), independent of the target JD's level."""
    headline: str | None = None
    level: Level | None = None
    years_experience: float | None = None
    skills: list[str] = Field(default_factory=list)
    projects: list[ProfileProject] = Field(default_factory=list)
    experience: list[ProfileExperience] = Field(default_factory=list)
    education: list[ProfileEducation] = Field(default_factory=list)
    coding: CodingSummary | None = None

    _l = field_validator("skills", mode="before")(_strs)
    _o = field_validator("projects", "experience", "education", mode="before")(_objects)


class RunOptions(_M):
    bypass_blueprint_cache: bool = False
    bypass_answer_key_cache: bool = False
    ignore_exclusions: bool = False


Trigger = Literal["booking", "reconcile", "refresh", "retry", "bench"]


class BlueprintRunRequest(_M):
    session: SessionInput
    job_description: JobDescriptionInput
    round: RoundInput | None = None                         # None: the API found no such round -> round_not_found
    company_brief: CompanyBriefInput | None = None
    candidate_profile: CandidateProfileInput = Field(default_factory=CandidateProfileInput)
    exclusions: list[str] = Field(default_factory=list)   # bank slugs this user must not get
    trigger: Trigger = "booking"
    options: RunOptions = Field(default_factory=RunOptions)
    input_hash: str | None = None                          # the API's fingerprint (spec §5.1)
    input_parts: dict[str, str] = Field(default_factory=dict)
    rerun_of: str | None = None

    _l = field_validator("exclusions", mode="before")(_strs)


# ================================================================ answer keys (stage 3)

class KeyApproach(_M):
    name: str = Field(min_length=2)
    idea: str = Field(min_length=10)
    time_complexity: str = Field(min_length=1)
    space_complexity: str = Field(min_length=1)


class WrongPath(_M):
    path: str = Field(min_length=5)
    why_wrong: str = Field(min_length=5)
    nudge: str = Field(min_length=5)


class KeySolution(_M):
    language: Literal["python"] = "python"
    entry_point: str = Field(pattern=r"^[A-Za-z_][A-Za-z0-9_]*$")
    code: str = Field(min_length=20)
    verified_against_examples: bool = False


class DsaAnswerKey(_M):
    approaches: list[KeyApproach] = Field(min_length=2)
    complexity_target: str = Field(min_length=3)
    key_insights: list[str] = Field(min_length=2)
    common_wrong_paths: list[WrongPath] = Field(min_length=2)
    edge_cases: list[str] = Field(min_length=2)
    reference_solution: KeySolution
    reviewed: bool = False          # a reviewer pass checked the prose (complexity, insights, edge cases)
    review_source: Literal["llm", "gate"] | None = None   # who vouched for it: the LLM reviewer, or the gate skipping it


class KeyCorrection(_M):
    field: str = ""
    claim: str = ""
    correction: str = ""


class DsaKeyReview(_M):
    """A reviewer's verdict on a DSA key's prose: the errors found and corrected fields (only those that change)."""
    errors: list[KeyCorrection] = Field(default_factory=list)
    approaches: list[KeyApproach] | None = None
    complexity_target: str | None = None
    key_insights: list[str] | None = None
    common_wrong_paths: list[WrongPath] | None = None
    edge_cases: list[str] | None = None

    _l = field_validator("key_insights", "edge_cases", mode="before")(_strs)
    _o = field_validator("approaches", "common_wrong_paths", mode="before")(_objects)


class KeyExtras(_M):
    """What the LLM adds to the bank's own expected-design / strong-answer content."""
    must_cover: list[str] = Field(default_factory=list)
    key_insights: list[str] = Field(min_length=2)
    common_wrong_paths: list[WrongPath] = Field(min_length=2)
    edge_cases: list[str] = Field(min_length=2)

    _l = field_validator("must_cover", "key_insights", "edge_cases", mode="before")(_strs)
    _o = field_validator("common_wrong_paths", mode="before")(_objects)


# ================================================================ persona + arc (stage 4)

class PersonaOut(_M):
    name: str = Field(min_length=2, max_length=60)
    seniority: str = Field(min_length=2, max_length=80)
    style: str = Field(min_length=5, max_length=160)
    disposition: str = Field(min_length=5, max_length=240)
    opening: str = Field(min_length=10)
    closing: str = Field(min_length=10)
    grounded_in: list[str] = Field(default_factory=list)

    _l = field_validator("grounded_in", mode="before")(_strs)


class PhaseGuidance(_M):
    phase: Phase
    guidance: str = Field(min_length=10)


class PersonaStageOut(_M):
    persona: PersonaOut
    phase_guidance: list[PhaseGuidance] = Field(default_factory=list)

    _o = field_validator("phase_guidance", mode="before")(_objects)


class ArcPhase(_M):
    phase: Phase
    timebox_mins: int = Field(ge=0, le=180)
    scored: bool
    guidance: str = ""
    style: str = ""


# ================================================================ personalization (stage 5)

class RapportHook(_M):
    line: str = Field(min_length=5)
    source: str = Field(min_length=2)


class ResumeProbe(_M):
    prompt: str = Field(min_length=10)
    grounded_in: str = Field(min_length=2)
    what_it_tests: str = Field(min_length=5)


class RoundQuestion(_M):
    """A question the round's own description calls for that no bank slot covers (e.g. OOP basics through the
    candidate's project, relocation and shifts). Asked in the hiring-manager deep-dive time."""
    prompt: str = Field(min_length=10)
    covers: str = Field(min_length=2)
    what_it_tests: str = Field(min_length=3)
    expected: str = ""


class PersonalizationOut(_M):
    rapport_hooks: list[RapportHook] = Field(default_factory=list)
    resume_probes: list[ResumeProbe] = Field(default_factory=list)
    level_expectations: str = Field(min_length=10)
    round_questions: list[RoundQuestion] = Field(default_factory=list, max_length=6)

    _o = field_validator("rapport_hooks", "resume_probes", mode="before")(_objects)


# ================================================================ playbooks (stage 6)

class Clarification(_M):
    question: str = Field(min_length=3)
    answer: str = Field(min_length=1)


class Ask(_M):
    opening: str = Field(min_length=10)
    clarifications: list[Clarification] = Field(default_factory=list)

    _o = field_validator("clarifications", mode="before")(_objects)


class HintStep(_M):
    step: int = Field(ge=1, le=10)
    hint: str = Field(min_length=5)


class Branch(_M):
    condition: str
    action: str
    say: str = Field(min_length=3)
    notes: str = ""

    @field_validator("condition")
    @classmethod
    def _condition(cls, v: str) -> str:
        v = v.strip().lower()
        if v not in ALL_CONDITIONS:
            raise ValueError(f"unknown condition {v!r}")
        return v

    @field_validator("action")
    @classmethod
    def _action(cls, v: str) -> str:
        v = v.strip().lower()
        if v not in ACTIONS:
            raise ValueError(f"unknown action {v!r}")
        return v


class Expectations(_M):
    must_show: list[str] = Field(min_length=1)
    strong_signals: list[str] = Field(default_factory=list)
    weak_signals: list[str] = Field(default_factory=list)

    _l = field_validator("must_show", "strong_signals", "weak_signals", mode="before")(_strs)


class Signal(_M):
    signal: str = Field(min_length=2)
    observe: str = Field(min_length=5)


class PlaybookOut(_M):
    ask: Ask
    hint_ladder: list[HintStep] = Field(min_length=3)
    branches: list[Branch] = Field(min_length=1)
    probes: list[str] = Field(default_factory=list)
    follow_ups: list[str] = Field(default_factory=list)
    # Optional on parse: a weaker fallback model sometimes stops after the probes. The playbook stage asks for them in
    # its repair round and then fills what is still missing from the answer key (stages.fill_missing).
    expectations: Expectations | None = None
    evaluation_signals: list[Signal] = Field(default_factory=list)

    _l = field_validator("probes", "follow_ups", mode="before")(_strs)
    _o = field_validator("hint_ladder", "evaluation_signals", mode="before")(_objects)

    @field_validator("branches", mode="before")
    @classmethod
    def _drop_unknown(cls, v):
        """Keep the branches written in the vocabulary; coverage is checked separately, so a stray
        invented condition is dropped rather than failing the whole slot."""
        if not isinstance(v, list):
            return v
        out = []
        for b in v:
            if isinstance(b, dict) and str(b.get("condition", "")).strip().lower() in ALL_CONDITIONS \
                    and str(b.get("action", "")).strip().lower() in ACTIONS:
                out.append(b)
        return out


# ================================================================ policies, evaluation, briefing

class RequestPolicy(_M):
    kind: str
    decision: Literal["comply", "decline", "partial"]
    how: str


class Policies(_M):
    version: str
    requests: list[RequestPolicy]
    off_topic: str
    time_management: str
    integrity: str
    fallback: str


class Briefing(_M):
    """The ONLY part of a blueprint a candidate ever sees (spec §9.2): no topics, problems or difficulty."""
    interviewer_name: str
    interviewer_style: str
    format: str
    duration_mins: int


class SlotProblem(_M):
    round_type: str
    slug: str
    title: str
    difficulty: str | None = None
    content_hash: str | None = None
    content: dict[str, Any]


class Slot(_M):
    slot_id: str
    kind: Literal["core", "reserve"]
    order: int
    purpose: str = ""                       # e.g. "harder extension", "same-level alternate"
    timebox_mins: int
    bonus: bool = False                     # a problem the round's minutes do not hold (a short round's second): given only if time allows
    problem: SlotProblem
    answer_key: dict[str, Any]              # {key, key_version, cache_hit}
    ask: Ask
    hint_ladder: list[HintStep]
    branches: list[Branch]
    probes: list[str] = Field(default_factory=list)
    follow_ups: list[str] = Field(default_factory=list)
    expectations: Expectations
    evaluation_signals: list[Signal]


# ================================================================ realism (per-session variety, drawn by code at prep)

class SpeechHabits(_M):
    """How this interviewer talks, drawn from the speech vocabulary (`speech_vocab.py`, tagged by trait): 5-8 acknowledgements, 3-4
    backchannels, 2-3 wait fillers per stage (`stage0`, `stage1`, ... as in `app.interviewer.fillers.STAGES`) and 3-5 lead-ins (the
    short ways a turn can begin). A block stored before lead-ins existed has none."""
    acks: list[str]
    backchannels: list[str]
    fillers: dict[str, list[str]]
    lead_ins: list[str] = Field(default_factory=list)


class RealismOutlinePart(_M):
    """One conversation part of the planned outline. `promises` are what the interviewer tells the candidate it will cover, as
    `projects:<name>` or `fundamentals:<area>` (only the deep dive carries any)."""
    part: str
    promises: list[str] = Field(default_factory=list)


class ChangeStance(_M):
    """A prior for how many times the interviewer refuses a problem change before it is convinced. Guidance for the live model, not
    a count the code enforces."""
    firmness: str
    refusals_prior: int


class Realism(_M):
    seed: int
    traits: dict[str, str]
    habits: SpeechHabits
    outline: list[RealismOutlinePart]
    change: ChangeStance


class RulesBlock(_M):
    """The interviewer's rules for the round, composed from its pack and level band at prep (app/rounds/compose.compose_rules)."""
    version: str
    pack: str
    band: str
    talker: str
    director: str
    item_rules: dict[str, dict[str, str]] = Field(default_factory=dict)
    flags: dict[str, Any] = Field(default_factory=dict)
    words: dict[str, Any] = Field(default_factory=dict)
    part_nouns: list[str] = Field(default_factory=list)
    link_examples: str = ""
    link_intent: str = ""
    live_policies: dict[str, str] = Field(default_factory=dict)
    focus: str | None = None
    banned_spoken: list[str] = Field(default_factory=list)


class Blueprint(_M):
    blueprint_id: str
    session_id: str | None
    candidate_id: str
    version: int
    status: Literal["current", "superseded", "bench"]
    input_hash: str
    input_parts: dict[str, str] = Field(default_factory=dict)
    run_id: str
    created_at: str
    round: dict[str, Any]
    persona: PersonaOut
    arc: list[ArcPhase]
    personalization: PersonalizationOut
    slots: list[Slot]
    policies: Policies
    evaluation: dict[str, Any]
    briefing: Briefing
    provenance: dict[str, Any]
    shape_id: str = "classic"
    rules: RulesBlock | None = None         # None: a blueprint prepared before round packs (rules_of composes them from the round)
    realism: Realism | None = None          # None: an old blueprint, or a plan that failed validation (the interviewer behaves as before)
    # The draw behind the plan, kept even when the plan was dropped, so a re-prep keeps the shape-affecting choices (the classic opening's order) and the persona's traits.
    realism_seed: int | None = None
    realism_traits: dict[str, str] | None = None
    realism_habits: dict[str, Any] | None = None       # the speech habits drawn, kept like the traits: a re-prep keeps them, the next persona avoids them
