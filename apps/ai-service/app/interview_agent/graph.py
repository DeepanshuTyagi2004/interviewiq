"""The per-turn decision graph — the LangGraph 'brain'. classify (LLM) → scope guard (deterministic)
→ decide (pure router). decide() is a pure function of a DecisionInputs snapshot so the routing is
unit-tested without LangGraph; build_interview_graph wires the same steps as a StateGraph for
inspectability. run_decision is what the driver (session.py) calls each turn."""
from __future__ import annotations

from dataclasses import dataclass

from langgraph.graph import END, StateGraph

from app.config import Settings
from app.interview_agent import llm_ops
from app.interview_agent.scope import out_of_scope_by_markers
from app.interview_agent.state import DecisionInputs, DecisionOutput, SessionState
from app.interview_agent.types import Action, PacingDirective, RoundType, TopicScope, Turn, TurnClass


@dataclass
class GraphDeps:
    llm: object            # LLMClient | None (None only in tests that stub llm_ops)
    settings: Settings


def _active_summary(state: SessionState) -> str:
    lad = state.active_ladder() or {}
    slug = lad.get("questionSlug") or lad.get("question_slug") or ""
    base = lad.get("basePrompt") or lad.get("base_prompt") or ""
    return f"{slug}: {base}"[:300]


def build_inputs(state: SessionState, turn_class: TurnClass, requested_topic: str | None,
                 topic_scope: TopicScope, settings: Settings) -> DecisionInputs:
    return DecisionInputs(
        turn_class=turn_class.value,
        requested_topic=requested_topic,
        topic_scope=topic_scope.value,
        pacing_directive=state.pacing_directive.value,
        followups_left=state.followups_left(),
        hints_left=state.hints_left(),
        has_next_question=state.has_next_question(),
        reserve_available=state.reserve_available(),
        pivot_count=state.pivot_count,
        pivot_cap=settings.interview_pivot_cap,
    )


def decide(inputs: DecisionInputs) -> Action:
    """Pure router. Precedence: pacing directive (wind-down/extend) overrides everything, then
    steering by turn class, then plan navigation."""
    directive = inputs["pacing_directive"]
    if directive == PacingDirective.WIND_DOWN.value:
        return Action.WIND_DOWN
    if directive == PacingDirective.EXTEND.value:
        return Action.EXTEND_RESERVE if inputs["reserve_available"] else Action.ESCALATE_FOLLOWUP

    tc = inputs["turn_class"]
    if tc == TurnClass.PIVOT_REQUEST.value:
        if inputs["topic_scope"] == TopicScope.OUT.value:
            return Action.REFUSE_OUT_OF_SCOPE
        if inputs["pivot_count"] >= inputs["pivot_cap"]:
            return Action.HOLD_GROUND
        return Action.PIVOT_DERIVE
    if tc == TurnClass.CLARIFY.value:
        return Action.ANSWER_CLARIFY
    if tc == TurnClass.DISTRESS.value:
        return Action.REASSURE
    if tc == TurnClass.CHALLENGE.value:
        return Action.DEESCALATE
    if tc == TurnClass.OFF_TOPIC.value:
        return Action.REDIRECT
    if tc == TurnClass.IDK_SILENCE.value:
        if inputs["hints_left"]:
            return Action.GIVE_HINT
        return Action.MOVE_ON if inputs["has_next_question"] else Action.WRAP

    # ANSWER (default)
    if inputs["followups_left"]:
        return Action.ESCALATE_FOLLOWUP
    return Action.MOVE_ON if inputs["has_next_question"] else Action.WRAP


async def run_decision(state: SessionState, utterance: Turn | None, deps: GraphDeps) -> DecisionOutput:
    """Classify the candidate turn (LLM), apply the deterministic cross-round scope guard, then
    route. For the OPEN turn (utterance is None) skip classification and return OPEN."""
    if utterance is None:
        return DecisionOutput(action=Action.OPEN.value, requested_topic=None)

    turn_class, requested_topic = await llm_ops.classify_turn(
        deps.llm, deps.settings, round_type=state.round_type,
        active_item_summary=_active_summary(state), last_text=utterance.text)

    topic_scope = TopicScope.UNCLEAR
    if turn_class == TurnClass.PIVOT_REQUEST:
        # Deterministic guard wins: a clear cross-round request is OUT no matter what the LLM said.
        if out_of_scope_by_markers(state.round_type, requested_topic or utterance.text):
            topic_scope = TopicScope.OUT
        else:
            topic_scope = TopicScope.IN

    inputs = build_inputs(state, turn_class, requested_topic, topic_scope, deps.settings)
    action = decide(inputs)
    return DecisionOutput(action=action.value, requested_topic=requested_topic)


def build_interview_graph(deps: GraphDeps):
    """LangGraph assembly of the same steps (classify → scope_guard → decide) for inspectability.
    State is a working dict carrying the SessionState + utterance + result. Not required by the
    driver (which calls run_decision), but kept so the decision flow is a visible graph."""
    async def _classify(s: dict) -> dict:
        out = await run_decision(s["state"], s["utterance"], deps)
        return {"result": out}

    sg = StateGraph(dict)
    sg.add_node("decide", _classify)
    sg.set_entry_point("decide")
    sg.add_edge("decide", END)
    return sg.compile()
