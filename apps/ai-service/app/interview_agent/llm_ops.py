"""All LLM I/O for the live brain, in one place so the graph/driver stay pure and tests can stub it.
Each op wraps complete_structured against a tiny response model and returns plain Python. Errors
propagate as LLMError; callers (session.py) decide fallbacks (spec §10)."""
from __future__ import annotations

from pydantic import BaseModel, Field

from app.config import Settings
from app.interview_agent.prompts import classify as classify_p
from app.interview_agent.prompts import converse as converse_p
from app.interview_agent.prompts import derive as derive_p
from app.interview_agent.prompts import grade as grade_p
from app.interview_agent.prompts import pacing_judge as pacing_p
from app.interview_agent.scope import scope_prompt_context
from app.interview_agent.types import PacingDirective, RoundType, TurnClass
from app.interview_prep.schema import QuestionLadder
from app.llm.client import LLMClient
from app.llm.structured import complete_structured


def _scorer_max_repairs(settings: Settings) -> int:
    return settings.interview_max_repairs


# ---- tiny response models (local; snake_case in, we read plainly) ----

class _Classify(BaseModel):
    turn_class: str
    requested_topic: str | None = None
    topic_scope: str = "unclear"


class _Criterion(BaseModel):
    criterion: str = ""
    score: float = 0.0


class _Grade(BaseModel):
    criteria: list[_Criterion] = Field(default_factory=list)
    coherence: float = 0.0


class _Directive(BaseModel):
    directive: str = "continue"


class _Line(BaseModel):
    line: str = ""


async def classify_turn(llm: LLMClient, settings: Settings, *, round_type, active_item_summary: str,
                        last_text: str) -> tuple[TurnClass, str | None]:
    rt = round_type if isinstance(round_type, RoundType) else RoundType(round_type)
    res = await complete_structured(
        llm, classify_p.CLASSIFY_SYSTEM,
        classify_p.build_classify_prompt(scope_prompt_context(rt), active_item_summary, last_text),
        _Classify, max_repairs=_scorer_max_repairs(settings), label="iv-classify")
    try:
        tc = TurnClass(res.turn_class)
    except ValueError:
        tc = TurnClass.ANSWER
    return tc, (res.requested_topic or None)


async def grade_answer(llm: LLMClient, settings: Settings, *, rubric: list[dict], question: str,
                       answer: str, artifact=None) -> tuple[float, float]:
    """Return (competency, coherence). competency = rubric-weighted mean of per-criterion scores;
    falls back to a simple mean if weights are absent."""
    res = await complete_structured(
        llm, grade_p.GRADE_SYSTEM, grade_p.build_grade_prompt(rubric, question, answer, artifact),
        _Grade, max_repairs=_scorer_max_repairs(settings), label="iv-grade")
    weights = {(c.get("criterion") or "").lower(): float(c.get("weight") or 0.0) for c in rubric}
    total_w = sum(weights.values())
    if res.criteria and total_w > 0:
        comp = sum(c.score * weights.get(c.criterion.lower(), 0.0) for c in res.criteria) / total_w
    elif res.criteria:
        comp = sum(c.score for c in res.criteria) / len(res.criteria)
    else:
        comp = 0.0
    return max(0.0, min(1.0, comp)), max(0.0, min(1.0, res.coherence))


async def judge_pacing(llm: LLMClient, settings: Settings, *, gate: str, rolling: float,
                       transcript_summary: str) -> PacingDirective:
    res = await complete_structured(
        llm, pacing_p.PACING_JUDGE_SYSTEM,
        pacing_p.build_pacing_judgment_prompt(gate, rolling, transcript_summary),
        _Directive, max_repairs=_scorer_max_repairs(settings), label="iv-pacing")
    try:
        return PacingDirective(res.directive)
    except ValueError:
        return PacingDirective.CONTINUE


async def generate_line(llm: LLMClient, settings: Settings, *, action: str, persona: dict,
                        active_item: dict, transcript_tail: list[dict], extra: dict) -> str:
    res = await complete_structured(
        llm, converse_p.CONVERSE_SYSTEM,
        converse_p.build_turn_prompt(action, persona, active_item, transcript_tail, extra),
        _Line, max_repairs=_scorer_max_repairs(settings), label="iv-converse")
    return res.line


async def derive_ladder(llm: LLMClient, settings: Settings, *, round_type, topic: str,
                        grounding: str) -> dict:
    """Return a QuestionLadder-shaped dict (camelCase, ready to slot into state.ladders). `grounding`
    is a real-plan-fields context string (company/role/level/round/focus) — F4."""
    rt = round_type.value if isinstance(round_type, RoundType) else str(round_type)
    res = await complete_structured(
        llm, derive_p.DERIVE_SYSTEM, derive_p.build_derive_prompt(rt, topic, grounding),
        QuestionLadder, max_repairs=_scorer_max_repairs(settings), label="iv-derive")
    return res.model_dump(by_alias=True, mode="json")
