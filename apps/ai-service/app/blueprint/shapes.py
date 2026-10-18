"""Round shapes: the order and style of the conversation parts around the coding, so rounds feel different.
A shape moves minutes between conversation parts only; it never changes the coding minutes."""
from __future__ import annotations

import hashlib
import random
from dataclasses import dataclass, field


@dataclass(frozen=True)
class Shape:
    shape_id: str
    order: tuple[str, ...]                 # phase names, "core" included
    shift: dict[str, int] = field(default_factory=dict)    # minutes moved between conversation phases, summing to 0
    styles: dict[str, str] = field(default_factory=dict)
    min_exchanges_before_coding: int = 5
    about: str = ""


SHAPES: tuple[Shape, ...] = (
    Shape("classic", ("greeting", "small_talk", "framing", "candidate_intro", "core", "candidate_questions", "wrap_up"),
          {}, {}, 5, "a short chat, how the round runs, an introduction, then the coding"),
    Shape("straight_in", ("greeting", "framing", "core", "candidate_intro", "candidate_questions", "wrap_up"),
          {"small_talk": -2, "candidate_intro": 2}, {"framing": "one_line", "candidate_intro": "after_coding"}, 1,
          "straight to the coding after a one-line outline; the introduction comes after it"),
    Shape("resume_opener", ("greeting", "candidate_intro", "framing", "core", "candidate_questions", "wrap_up"),
          {"small_talk": -2, "candidate_intro": 2}, {"candidate_intro": "pointed_resume", "framing": "one_line"}, 2,
          "opens with one pointed question about their resume, then a one-line outline and the coding"),
    Shape("chat_first", ("greeting", "small_talk", "candidate_intro", "core", "candidate_questions", "wrap_up"),
          {"framing": -1, "small_talk": 1}, {"small_talk": "rapport", "core": "with_outline"}, 5,
          "a longer, warm chat first; the outline is folded into the move to the coding"),
    Shape("projects_first", ("greeting", "framing", "candidate_intro", "core", "candidate_questions", "wrap_up"),
          {"small_talk": -2, "candidate_intro": 2}, {"candidate_intro": "one_project"}, 4,
          "one of their projects in depth before the coding"),
    Shape("brisk", ("greeting", "framing", "candidate_intro", "core", "candidate_questions", "wrap_up"),
          {"small_talk": -2, "candidate_questions": 2}, {"candidate_intro": "one_minute"}, 2,
          "brisk and to the point: a one-minute introduction, more time for their questions"),
)

_BY_ID = {s.shape_id: s for s in SHAPES}


def shape_by_id(shape_id: str | None) -> Shape:
    """An unknown or missing id (old blueprints) is the classic shape."""
    return _BY_ID.get(shape_id or "", _BY_ID["classic"])


def shapes_for(round_type: str, family: str) -> list[Shape]:
    if round_type == "online-assessment":
        return [_BY_ID["classic"]]
    if family == "dsa":
        return list(SHAPES)
    if family in ("system-design", "lld"):
        return [_BY_ID[i] for i in ("classic", "straight_in", "projects_first")]
    if family == "behavioural":
        return [_BY_ID[i] for i in ("classic", "resume_opener", "chat_first")]
    return [_BY_ID["classic"]]


def choose_shape(seed: str, round_type: str, family: str, exclude: set[str] | frozenset[str] = frozenset()) -> Shape:
    """A reproducible pick for this session, skipping the shapes the candidate's last rounds had; when that leaves
    nothing, any shape the round allows."""
    rng = random.Random(int(hashlib.sha256(f"shape:{seed}".encode()).hexdigest()[:16], 16))
    allowed = shapes_for(round_type, family)
    return rng.choice([s for s in allowed if s.shape_id not in exclude] or allowed)
