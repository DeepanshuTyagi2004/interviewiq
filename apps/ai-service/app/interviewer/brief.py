"""The director's brief (spec §5.2): the structured output the background LLM writes every few turns."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class _M(BaseModel):
    model_config = ConfigDict(extra="ignore")


class NextMove(_M):
    action: str = ""
    detail: str = ""


class PlanChange(_M):
    op: Literal["reorder", "skip", "use_reserve", "insert_filler", "add_follow_up"]
    target: str = ""
    before: str = ""
    replace: str = ""
    question: str = ""
    skill: str = ""
    sound_answer: str = ""
    text: str = ""
    reason: str = ""


class EvidenceNote(_M):
    item_id: str
    signal: str
    observation: str
    turn_ids: list[int] = Field(default_factory=list)


class Conduct(_M):
    concern: Literal["none", "warn", "end"] = "none"
    reason: str = ""


class LeakReview(_M):
    revealed_too_much: bool = False
    detail: str = ""


class Brief(_M):
    for_position: int
    goal: str = ""
    next_move: NextMove = Field(default_factory=NextMove)
    plan_changes: list[PlanChange] = Field(default_factory=list)
    tone: str = ""
    evidence: list[EvidenceNote] = Field(default_factory=list)
    summary: str = ""
    conduct: Conduct = Field(default_factory=Conduct)
    leak_review: LeakReview = Field(default_factory=LeakReview)


BRIEF_SCHEMA = Brief.model_json_schema()
