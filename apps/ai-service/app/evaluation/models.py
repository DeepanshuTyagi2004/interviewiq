"""Evaluation request and grade models (spec §7, §8). Snake case on the wire."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

Verdict = Literal["correct", "mostly", "partly", "wrong", "not_answered", "not_reached"]


class _M(BaseModel):
    model_config = ConfigDict(extra="ignore")


class Quote(_M):
    turn_id: int
    text: str


def _clean_tags(value):
    """Tolerant `bank_tags`: a string is one tag, anything that is not a list is "not given", non-strings are dropped, items are
    stripped and deduplicated (a model's malformed tags must never fail grading)."""
    if isinstance(value, str):
        value = [value]
    if not isinstance(value, list):
        return None
    out: list[str] = []
    for v in value:
        if isinstance(v, str) and v.strip() and v.strip() not in out:
            out.append(v.strip())
    return out


class TopicRef(_M):
    subject: str
    topic: str
    bank_tags: list[str] | None = None      # 1-3 problem-bank tags to practise (validated against the round's tag vocabulary); None = not given

    _tags = field_validator("bank_tags", mode="before")(lambda cls, v: _clean_tags(v) if v is not None else None)


class QuestionGrade(_M):
    id: str
    asked: str
    answer_quotes: list[Quote] = Field(default_factory=list)
    verdict: Verdict
    score: float = Field(ge=1, le=10)
    strong_answer: str
    gap: str
    topics: list[TopicRef] = Field(default_factory=list)
    resume_consistency: Literal["consistent", "unsupported", "contradicts", "n/a"] = "n/a"
    resume_note: str = ""
    # "asked": the interviewer put this question to the candidate. "candidate_led": the candidate was working the problem or explaining on their
    # own (always the problem itself, "main"); `intent` then says in one line what they were doing.
    origin: Literal["asked", "candidate_led"] = "asked"
    intent: str = ""


class AreaGrade(_M):
    key: str
    score: float = Field(ge=1, le=10)
    # Items are "turn:<id>", "code" or "board".
    evidence: list[str] = Field(default_factory=list)
    reason: str


class TraceStep(_M):
    example: str
    predicted: str
    expected: str
    matches: bool


class CodeGrade(_M):
    trace: list[TraceStep] = Field(default_factory=list)
    logic_works: Literal["yes", "syntax_only", "partly", "no"]
    syntax_slips: list[str] = Field(default_factory=list)
    complexity_stated: str | None = None
    actual_complexity: str


class HelpRequest(_M):
    turn_id: int
    kind: Literal["clarification", "repeat", "help"]


class Events(_M):
    self_found_bugs: list[Quote] = Field(default_factory=list)
    pointed_out_bugs: list[Quote] = Field(default_factory=list)
    unprompted_edge_cases: list[Quote] = Field(default_factory=list)
    unprompted_complexity: bool = False
    unprompted_dry_run: bool = False
    recovery: Quote | None = None
    beyond_level: bool = False
    bonus_solved: bool = False
    help_requests: list[HelpRequest] = Field(default_factory=list)


class Moment(_M):
    turn_id: int
    kind: Literal["strong", "weak", "bug", "recovery", "edge_case"]
    note: str


class PartGrade(_M):
    part_id: str
    # Field order drives structured-output generation order: the hand trace is written first, so the scores follow from it.
    code: CodeGrade | None = None
    questions: list[QuestionGrade] = Field(default_factory=list)
    areas: list[AreaGrade] = Field(default_factory=list)
    events: Events = Field(default_factory=Events)
    moments: list[Moment] = Field(default_factory=list)
    must_have_met: bool
    # Set by code, never by the model: why this grade had to be salvaged (admin diagnosis only; not part of the report).
    salvage_notes: list[str] = Field(default_factory=list)


class FocusItem(_M):
    title: str
    why: str
    # The round's own example, shown apart from `why`: the candidate's real words, and a coach's note on them.
    example_quote: str = ""
    example_note: str = ""
    turn_ids: list[int] = Field(default_factory=list)


class GapTopic(_M):
    topic: str
    why: str
    bank_tags: list[str] | None = None      # None = not given (old reports, derived gaps): practice falls back to the phrase; [] = no practice

    _tags = field_validator("bank_tags", mode="before")(lambda cls, v: _clean_tags(v) if v is not None else None)


class TopicGap(_M):
    subject: str
    topics: list[GapTopic] = Field(default_factory=list)


class Observation(_M):
    text: str
    examples: list[int] = Field(default_factory=list)


class EndQuestions(_M):
    quality: Literal["none", "basic", "thoughtful"]
    bonus: float = Field(ge=0, le=0.2)
    note: str


class Synthesis(_M):
    summary: str
    strengths: list[str] = Field(default_factory=list)
    focus: list[FocusItem] = Field(default_factory=list)
    topic_gaps: list[TopicGap] = Field(default_factory=list)
    delivery: list[Observation] = Field(default_factory=list)
    end_questions: EndQuestions
    interviewer_note: str


class SessionMeta(_M):
    company: str
    role: str
    level: str
    round_type: str
    round_minutes: int
    pass_mark: float
    code_standard: Literal["runnable", "near_runnable", "pseudo_ok"]
    company_tier: int | None = None
    difficulty: str | None = None
    official: bool


class DisputeInput(_M):
    target_type: Literal["question", "area"]
    target_id: str
    reason: str
    report_version: int


class EvaluationRunRequest(_M):
    session_id: str
    candidate_id: str
    trigger: Literal["completion", "reconcile", "retry", "admin", "dispute"]
    meta: SessionMeta
    candidate_profile: dict = Field(default_factory=dict)
    previous_areas: dict[str, float] | None = None
    exclusions: list[str] = Field(default_factory=list)
    dispute: DisputeInput | None = None
    # The session's end reason as the API recorded it: used when the live run's own record has none.
    ended_reason: str | None = None
