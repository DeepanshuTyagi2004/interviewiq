"""Contextvar-bound diagnostics emitter. No-op unless a diagnostic session binds it (mirrors
pipeline_runs.bind_run). Lets session.py carry additive ``emit.*`` taps that are inert on the
production ``run_session`` path — nothing binds the contextvar there, so every call short-circuits
before touching AGENT_SESSIONS — keeping the brain's behaviour (and its interview_agent tests)
unchanged. Also hosts ``decide_with_reason``: a PURE wrapper over ``graph.decide`` that attaches a
stable, human-readable branch label to the routing decision for the diagnostics console."""
from __future__ import annotations

import contextvars

from app.interview_agent.graph import decide
from app.interview_agent.state import DecisionInputs  # DecisionInputs is a TypedDict in state.py, NOT types.py
from app.interview_agent.types import Action, PacingDirective, TopicScope, TurnClass
from app.jobs.agent_sessions import AGENT_SESSIONS

# Bound only for the duration of an interactive diagnostic session (see the agent-diag runner).
# On the production run_session path this stays at its default of None, so _rid() returns None and
# every emit helper below is inert.
_current: "contextvars.ContextVar[str | None]" = contextvars.ContextVar(
    "diag_emitter_run_id", default=None)


def bind_emitter(run_id: str):
    """Bind the emitter to ``run_id`` for the current context; returns a token for unbind_emitter."""
    return _current.set(run_id)


def unbind_emitter(token) -> None:
    _current.reset(token)


def _rid() -> str | None:
    return _current.get()


def step_begin(name, llm_label=None) -> None:
    rid = _rid()
    if rid is not None:
        AGENT_SESSIONS.begin_step(rid, name, llm_label=llm_label)


def step_end(status, detail) -> None:
    rid = _rid()
    if rid is not None:
        AGENT_SESSIONS.end_step(rid, status, detail)


def step_skipped(name) -> None:
    rid = _rid()
    if rid is not None:
        AGENT_SESSIONS.emit_skipped(rid, name)


def decide_with_reason(inputs: DecisionInputs) -> tuple[Action, str]:
    """Pure. Returns bare ``decide(inputs)`` plus a stable branch label mirroring the precedence
    ladder in graph.decide. The Action MUST equal graph.decide(inputs) for every input — the label
    is presentational only and never feeds back into the brain."""
    action = decide(inputs)
    reason = _branch_reason(inputs, action)
    return action, reason


def _branch_reason(inputs: DecisionInputs, action: Action) -> str:
    """Human-readable label of WHY this action was chosen. Mirrors the exact precedence order of
    graph.decide (graph.py:53-88): pacing directive overrides everything, then steering by turn
    class, then plan navigation. Kept honest by the regression test that asserts action equality."""
    d = inputs["pacing_directive"]
    if d == PacingDirective.WIND_DOWN.value:
        return "pacing directive wind_down -> wind down"
    if d == PacingDirective.EXTEND.value:
        return ("pacing directive extend, reserve available -> extend reserve"
                if inputs["reserve_available"] else
                "pacing directive extend, no reserve -> escalate follow-up")

    tc = inputs["turn_class"]
    if tc == TurnClass.PIVOT_REQUEST.value:
        if inputs["topic_scope"] == TopicScope.OUT.value:
            return "pivot_request out of round scope -> refuse"
        if inputs["pivot_count"] >= inputs["pivot_cap"]:
            return "pivot_request past pivot cap -> hold ground"
        return "pivot_request within scope+cap -> derive"
    if tc == TurnClass.CLARIFY.value:
        return "turn_class clarify -> answer clarification"
    if tc == TurnClass.DISTRESS.value:
        return "turn_class distress -> reassure"
    if tc == TurnClass.CHALLENGE.value:
        return "turn_class challenge -> de-escalate"
    if tc == TurnClass.OFF_TOPIC.value:
        return "turn_class off_topic -> redirect"
    if tc == TurnClass.IDK_SILENCE.value:
        if inputs["hints_left"]:
            return "idk/silence, hints left -> give hint"
        return "idk/silence, no hints -> move on / wrap"

    # ANSWER (default): stay-until-satisfied — probe while thin and budget allows, advance once adequate.
    if inputs["answer_adequate"]:
        return "answer adequate -> move on / wrap"
    if inputs["followups_left"]:
        return "answer thin, follow-ups left -> escalate follow-up"
    return "answer thin, no follow-ups left -> move on / wrap"
