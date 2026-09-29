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
    llm: object            # conversation LLMClient | None (None only in tests that stub llm_ops)
    settings: Settings
    scorer: object = None  # F8: cheaper scorer/classifier model; used for classification & derivation


def _active_summary(state: SessionState) -> str:
    lad = state.active_ladder() or {}
    slug = lad.get("questionSlug") or lad.get("question_slug") or ""
    base = lad.get("basePrompt") or lad.get("base_prompt") or ""
    return f"{slug}: {base}"[:300]


def build_inputs(state: SessionState, turn_class: TurnClass, requested_topic: str | None,
                 topic_scope: TopicScope, settings: Settings) -> DecisionInputs:
    # The most recent answer is graded (session._score_last_answer) BEFORE build_inputs runs, so
    # per_answer[-1] is the just-scored answer; on a grade failure it's the last-known answer;
    # empty (no scored answer yet) => not adequate (keep probing).
    answer_adequate = bool(state.per_answer) and state.per_answer[-1].competency >= settings.interview_high_band
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
        answer_adequate=answer_adequate,
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

    # ANSWER (default): stay-until-satisfied — probe while the answer is thin and budget/pacing allow;
    # advance once it's adequate (don't grind follow-ups on a resolved point). Pacing had precedence above.
    if inputs["answer_adequate"]:
        return Action.MOVE_ON if inputs["has_next_question"] else Action.WRAP
    if inputs["followups_left"]:
        return Action.ESCALATE_FOLLOWUP
    return Action.MOVE_ON if inputs["has_next_question"] else Action.WRAP


async def classify_utterance(state: SessionState, utterance: Turn,
                             deps: GraphDeps) -> tuple[TurnClass, str | None, TopicScope]:
    """Classify the candidate turn (LLM, on the cheaper scorer model — F8) and apply the
    deterministic cross-round scope guard. Extracted so the driver (session.py) can classify a turn
    up front and gate scoring on the result — non-answer turns must never be graded (F1)."""
    turn_class, requested_topic = await llm_ops.classify_turn(
        deps.scorer, deps.settings, round_type=state.round_type,
        active_item_summary=_active_summary(state), last_text=utterance.text)

    topic_scope = TopicScope.UNCLEAR
    if turn_class == TurnClass.PIVOT_REQUEST:
        # Deterministic guard wins: a clear cross-round request is OUT no matter what the LLM said.
        if out_of_scope_by_markers(state.round_type, requested_topic or utterance.text):
            topic_scope = TopicScope.OUT
        else:
            topic_scope = TopicScope.IN
    return turn_class, requested_topic, topic_scope


async def run_decision(state: SessionState, utterance: Turn | None, deps: GraphDeps) -> DecisionOutput:
    """Classify the candidate turn, apply the scope guard, then route (pure decide). For the OPEN
    turn (utterance is None) skip classification and return OPEN. Kept for the LangGraph assembly;
    the driver calls classify_utterance + decide directly so it can gate scoring on the class."""
    if utterance is None:
        return DecisionOutput(action=Action.OPEN.value, requested_topic=None)

    turn_class, requested_topic, topic_scope = await classify_utterance(state, utterance, deps)
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
