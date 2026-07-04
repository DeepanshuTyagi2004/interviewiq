"""Mutable session state for a live interview + the graph's TypedDict I/O shapes. The driver
(session.py) owns and mutates a SessionState across turns; the decision graph reads a snapshot of it
(DecisionInputs) and returns a DecisionOutput. Navigation helpers keep ladder/follow-up/hint/reserve
position and the asked-slug dedupe set in one place."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import TypedDict

from app.config import Settings
from app.interview_agent.pacing import PacingBands
from app.interview_agent.types import (
    Action, EndedReason, NegativeEvent, PacingDirective, PerAnswerScore, RoundType, Turn,
)


def bands_from_settings(settings: Settings) -> PacingBands:
    return PacingBands(
        min_s=settings.interview_min_duration_min * 60,
        base_s=settings.interview_base_duration_min * 60,
        max_s=settings.interview_max_duration_min * 60,
        low=settings.interview_low_band,
        high=settings.interview_high_band,
        extend_lookahead_s=settings.interview_extend_lookahead_s,
        min_coverage=settings.interview_min_coverage,
    )


class DecisionInputs(TypedDict):
    turn_class: str                 # TurnClass value ("" for the OPEN turn)
    requested_topic: str | None
    topic_scope: str                # TopicScope value
    pacing_directive: str           # PacingDirective value
    followups_left: bool
    hints_left: bool
    has_next_question: bool
    reserve_available: bool
    pivot_count: int
    pivot_cap: int


class DecisionOutput(TypedDict):
    action: str                     # Action value
    requested_topic: str | None


@dataclass
class SessionState:
    session_id: str
    round_type: RoundType
    plan: dict
    bands: PacingBands
    transcript: list[Turn] = field(default_factory=list)
    ladders: list[dict] = field(default_factory=list)
    reserve: list[dict] = field(default_factory=list)
    ladder_idx: int = 0
    followup_idx: int = -1
    hint_idx: int = -1
    reserve_idx: int = 0
    asked_slugs: set[str] = field(default_factory=set)
    attempted_core: int = 0
    per_answer: list[PerAnswerScore] = field(default_factory=list)
    negative_events: list[NegativeEvent] = field(default_factory=list)
    rolling: float = 0.0
    pacing_directive: PacingDirective = PacingDirective.CONTINUE
    extensions_granted: int = 0
    pivot_count: int = 0
    derived_topics: list[str] = field(default_factory=list)
    hint_just_given: bool = False
    elapsed_s: float = 0.0
    session_over: bool = False
    ended_reason: EndedReason | None = None

    @classmethod
    def from_plan(cls, plan: dict, bands: PacingBands) -> "SessionState":
        return cls(
            session_id=plan.get("sessionId") or plan.get("session_id") or "",
            round_type=RoundType(plan.get("roundType") or plan.get("round_type") or "dsa"),
            plan=plan,
            bands=bands,
            ladders=list(plan.get("questionLadders") or plan.get("question_ladders") or []),
            reserve=list(plan.get("reserve") or []),
        )

    def active_ladder(self) -> dict | None:
        if 0 <= self.ladder_idx < len(self.ladders):
            return self.ladders[self.ladder_idx]
        return None

    def advance_to_next_question(self) -> None:
        self.ladder_idx += 1
        self.followup_idx = -1
        self.hint_idx = -1
        self.hint_just_given = False

    def next_followup(self) -> str | None:
        lad = self.active_ladder()
        ups = (lad or {}).get("followUps") or (lad or {}).get("follow_ups") or []
        self.followup_idx += 1
        if 0 <= self.followup_idx < len(ups):
            return ups[self.followup_idx]
        return None

    def next_hint(self) -> str | None:
        lad = self.active_ladder()
        hints = (lad or {}).get("hints") or []
        self.hint_idx += 1
        if 0 <= self.hint_idx < len(hints):
            self.hint_just_given = True
            return hints[self.hint_idx]
        return None

    def take_reserve(self) -> dict | None:
        if self.reserve_idx < len(self.reserve):
            item = self.reserve[self.reserve_idx]
            self.reserve_idx += 1
            return item
        return None

    def mark_asked(self, slug: str | None) -> None:
        if slug:
            self.asked_slugs.add(slug)

    def followups_left(self) -> bool:
        lad = self.active_ladder() or {}
        ups = lad.get("followUps") or lad.get("follow_ups") or []
        return (self.followup_idx + 1) < len(ups)

    def hints_left(self) -> bool:
        lad = self.active_ladder() or {}
        hints = lad.get("hints") or []
        return (self.hint_idx + 1) < len(hints)

    def has_next_question(self) -> bool:
        return (self.ladder_idx + 1) < len(self.ladders)

    def reserve_available(self) -> bool:
        return self.reserve_idx < len(self.reserve)
