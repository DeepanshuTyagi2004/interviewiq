"""Value objects and enums for the live-interview brain (Pipeline 2). No behavior, no I/O —
just the typed vocabulary the graph, driver, and pure modules share. RoundType is REUSED from
app.models.brief so the round vocabulary stays single-sourced."""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum

from app.models.brief import RoundType  # re-exported


class TurnClass(str, Enum):
    ANSWER = "answer"
    CLARIFY = "clarify"
    OFF_TOPIC = "off_topic"
    CHALLENGE = "challenge"
    DISTRESS = "distress"
    IDK_SILENCE = "idk_silence"
    PIVOT_REQUEST = "pivot_request"


class TopicScope(str, Enum):
    IN = "in"
    OUT = "out"
    UNCLEAR = "unclear"


class PacingGate(str, Enum):
    LOCKED = "locked"
    CONTINUE = "continue"
    MAY_WIND_DOWN = "may_wind_down"
    MAY_EXTEND = "may_extend"
    MUST_WRAP = "must_wrap"


class PacingDirective(str, Enum):
    CONTINUE = "continue"
    WIND_DOWN = "wind_down"
    EXTEND = "extend"


class Action(str, Enum):
    OPEN = "open"
    ASK_BASE = "ask_base"
    ESCALATE_FOLLOWUP = "escalate_followup"
    GIVE_HINT = "give_hint"
    MOVE_ON = "move_on"
    ANSWER_CLARIFY = "answer_clarify"
    REDIRECT = "redirect"
    DEESCALATE = "deescalate"
    REASSURE = "reassure"
    PIVOT_DERIVE = "pivot_derive"
    REFUSE_OUT_OF_SCOPE = "refuse_out_of_scope"
    HOLD_GROUND = "hold_ground"
    WIND_DOWN = "wind_down"
    EXTEND_RESERVE = "extend_reserve"
    WRAP = "wrap"
    CLOSE = "close"


class EndedReason(str, Enum):
    NATURAL_COMPLETE = "natural_complete"
    EARLY_WEAK = "early_weak"
    TIME_CEILING = "time_ceiling"
    ABORTED_TECHNICAL = "aborted_technical"


@dataclass(frozen=True)
class UtteranceTiming:
    t_start: float
    t_end: float
    time_to_first_word_s: float


@dataclass(frozen=True)
class Turn:
    speaker: str            # "interviewer" | "candidate"
    text: str
    t_start: float = 0.0
    t_end: float = 0.0


@dataclass(frozen=True)
class BehavioralSignals:
    ttf_word_s: float
    filler_density: float
    self_corrections: int
    recovered_after_hint: bool


@dataclass(frozen=True)
class PerAnswerScore:
    slug: str | None
    competency: float
    behavioral: float
    answer_score: float
    weight: float


@dataclass(frozen=True)
class NegativeEvent:
    type: str
    magnitude: float
    reason: str
    at_s: float


@dataclass(frozen=True)
class SessionOutcome:
    session_id: str
    ended_reason: EndedReason
    live_score_final: float
    per_answer_evidence: list[PerAnswerScore]
    negative_events: list[NegativeEvent]
    arc_completed: bool
    extensions_granted: int
    derived_topics: list[str]
    duration_s: float
