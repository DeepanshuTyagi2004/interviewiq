"""The rich content stored for one question, per round type (`docs/question-bank.md`).

Strict on purpose: the generator rejects thin output (fewer than two examples, three hints, two
rubric criteria…) so a stored problem is always usable by the interview blueprint. Everything a
question needs at interview time is here; the index fields (title, tags, URL) stay on the record.
"""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


def _strs(v):
    if v is None:
        return []
    if isinstance(v, str):
        return [v.strip()] if v.strip() else []
    if isinstance(v, list):
        return [str(x).strip() for x in v if x is not None and str(x).strip()]
    return v


def _objects(v):
    """Lists of objects: the model sometimes pads them with empty strings or nulls; drop those."""
    if isinstance(v, list):
        return [x for x in v if isinstance(x, (dict, BaseModel))]
    return v


class _Model(BaseModel):
    model_config = ConfigDict(extra="ignore")


class RubricItem(_Model):
    criterion: str = Field(min_length=3)
    weight: float = Field(1.0, gt=0, le=10)
    strong: str = Field(min_length=3)
    weak: str = Field(min_length=3)


# ---------------------------------------------------------------- dsa / online assessment

class Example(_Model):
    """A worked example: machine-checkable (`args` → `expected`) and explained to the candidate."""
    args: dict[str, Any]
    expected: Any
    explanation: str = Field(min_length=3)


class JudgeTest(_Model):
    args: dict[str, Any]
    expected: Any = None  # advisory: stored values are recomputed from the verified solutions


class Approach(_Model):
    name: str = Field(min_length=2)
    idea: str = Field(min_length=10)
    time_complexity: str = Field(min_length=1)
    space_complexity: str = Field(min_length=1)


class ReferenceSolution(_Model):
    language: Literal["python"] = "python"
    entry_point: str = Field(pattern=r"^[A-Za-z_][A-Za-z0-9_]*$")
    code: str = Field(min_length=20)


class DsaContent(_Model):
    statement: str = Field(min_length=120)
    input_format: str = Field(min_length=1)
    output_format: str = Field(min_length=1)
    constraints: list[str] = Field(min_length=1)
    examples: list[Example] = Field(min_length=2)
    judge_tests: list[JudgeTest] = Field(default_factory=list)  # only for problems without a validated source
    hints: list[str] = Field(min_length=3)
    follow_ups: list[str] = Field(min_length=1)
    # Answer material (approaches, solutions, rubric) is built at round-preparation time and cached; the bank
    # stores it only for problems generated without a validated source.
    approaches: list[Approach] = Field(default_factory=list)
    reference_solution: ReferenceSolution | None = None
    brute_force_solution: ReferenceSolution | None = None  # cross-check for problems without a validated source
    edge_cases: list[str] = Field(default_factory=list)
    common_mistakes: list[str] = Field(default_factory=list)
    rubric: list[RubricItem] = Field(default_factory=list)
    patterns: list[str] = Field(default_factory=list)
    what_it_tests: str = Field(min_length=10)
    estimated_minutes: int = Field(ge=5, le=120)
    # True when the statement accepts the answer in any order ("return the indices in any order").
    answer_order_irrelevant: bool = False

    _l = field_validator("constraints", "hints", "follow_ups", "edge_cases", "common_mistakes", "patterns", mode="before")(_strs)
    _o = field_validator("examples", "judge_tests", "approaches", "rubric", mode="before")(_objects)


# ---------------------------------------------------------------- system design

class DesignComponent(_Model):
    name: str = Field(min_length=2)
    purpose: str = Field(min_length=5)


class TradeOff(_Model):
    decision: str = Field(min_length=3)
    options: list[str] = Field(min_length=2)
    recommendation: str = Field(min_length=5)

    _l = field_validator("options", mode="before")(_strs)


class ExpectedDesign(_Model):
    components: list[DesignComponent] = Field(min_length=3)
    data_model: str = Field(min_length=10)
    api_sketch: list[str] = Field(default_factory=list)
    data_flow: str = Field(min_length=10)

    _l = field_validator("api_sketch", mode="before")(_strs)
    _o = field_validator("components", mode="before")(_objects)


class SystemDesignContent(_Model):
    prompt: str = Field(min_length=40)
    clarifying_questions: list[str] = Field(min_length=3)
    functional_requirements: list[str] = Field(min_length=2)
    non_functional_requirements: list[str] = Field(min_length=2)
    scale_assumptions: list[str] = Field(min_length=1)
    expected_design: ExpectedDesign
    deep_dives: list[str] = Field(min_length=2)
    trade_offs: list[TradeOff] = Field(min_length=1)
    follow_ups: list[str] = Field(min_length=2)
    rubric: list[RubricItem] = Field(min_length=2)
    red_flags: list[str] = Field(default_factory=list)
    strong_answer_summary: str = Field(min_length=40)
    what_it_tests: str = Field(min_length=10)
    estimated_minutes: int = Field(ge=10, le=120)

    _l = field_validator("clarifying_questions", "functional_requirements", "non_functional_requirements", "scale_assumptions",
                         "deep_dives", "follow_ups", "red_flags", mode="before")(_strs)
    _o = field_validator("trade_offs", "rubric", mode="before")(_objects)


# ---------------------------------------------------------------- lld / machine coding

class ClassDesign(_Model):
    name: str = Field(min_length=2)
    responsibilities: str = Field(min_length=5)
    key_methods: list[str] = Field(default_factory=list)

    _l = field_validator("key_methods", mode="before")(_strs)


class LldDesign(_Model):
    classes: list[ClassDesign] = Field(min_length=2)
    relationships: list[str] = Field(default_factory=list)
    patterns: list[str] = Field(default_factory=list)

    _l = field_validator("relationships", "patterns", mode="before")(_strs)
    _o = field_validator("classes", mode="before")(_objects)


def _evaluation_mode(v):
    """The model sometimes elaborates ("working-code; candidate implements…"): keep the mode it named."""
    if isinstance(v, str):
        text = v.strip().lower()
        return "working-code" if any(k in text for k in ("working-code", "working code", "machine", "implement", "coding")) else "discussion"
    return v


class LldContent(_Model):
    prompt: str = Field(min_length=40)
    requirements: list[str] = Field(min_length=1)
    entities: list[str] = Field(min_length=2)
    expected_design: LldDesign
    sample_api: list[str] = Field(default_factory=list)
    evaluation_mode: Literal["discussion", "working-code"] = "discussion"

    _mode = field_validator("evaluation_mode", mode="before")(_evaluation_mode)
    follow_ups: list[str] = Field(min_length=2)
    rubric: list[RubricItem] = Field(min_length=2)
    red_flags: list[str] = Field(default_factory=list)
    strong_answer_summary: str = Field(min_length=40)
    what_it_tests: str = Field(min_length=10)
    estimated_minutes: int = Field(ge=10, le=120)

    _l = field_validator("requirements", "entities", "sample_api", "follow_ups", "red_flags", mode="before")(_strs)
    _o = field_validator("rubric", mode="before")(_objects)


# ---------------------------------------------------------------- behavioural / hiring manager

class StarGuide(_Model):
    situation: str = Field(min_length=5)
    task: str = Field(min_length=5)
    action: str = Field(min_length=5)
    result: str = Field(min_length=5)


class BehaviouralContent(_Model):
    question: str = Field(min_length=10)
    competency: str = Field(min_length=3)
    what_it_tests: str = Field(min_length=10)
    star_guide: StarGuide
    strong_answer_summary: str = Field(min_length=30)
    weak_answer_summary: str = Field(min_length=20)
    follow_up_probes: list[str] = Field(min_length=2)
    red_flags: list[str] = Field(default_factory=list)
    principle: str | None = None
    deep_dive_guidance: str | None = None
    estimated_minutes: int = Field(ge=2, le=30)

    _l = field_validator("follow_up_probes", "red_flags", mode="before")(_strs)


# ---------------------------------------------------------------- envelope

class Inferred(_Model):
    """Index facts the model may fill in when the sources left them empty (`docs/question-bank.md`)."""
    difficulty: Literal["easy", "medium", "hard"] | None = None
    level_tags: list[str] = Field(default_factory=list)
    topic_tags: list[str] = Field(default_factory=list)
    company_tags: list[str] = Field(default_factory=list)

    _l = field_validator("level_tags", "topic_tags", "company_tags", mode="before")(_strs)


class GeneratedEnvelope(_Model):
    inferred: Inferred = Field(default_factory=Inferred)
    content: dict[str, Any]


CONTENT_MODELS: dict[str, type[_Model]] = {
    "dsa": DsaContent,
    "online-assessment": DsaContent,
    "system-design": SystemDesignContent,
    "lld": LldContent,
    "behavioural": BehaviouralContent,
    "hiring-manager": BehaviouralContent,
}


def content_model_for(round_type: str) -> type[_Model]:
    try:
        return CONTENT_MODELS[round_type]
    except KeyError as exc:
        raise ValueError(f"no content model for round type {round_type!r}") from exc


def validate_content(round_type: str, data: dict) -> _Model:
    return content_model_for(round_type).model_validate(data)
