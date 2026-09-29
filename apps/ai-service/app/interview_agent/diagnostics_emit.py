"""Contextvar-bound diagnostics emitter. No-op unless a diagnostic session binds it (mirrors
pipeline_runs.bind_run). Lets session.py carry additive ``emit.*`` taps that are inert on the
production ``run_session`` path — nothing binds the contextvar there, so every call short-circuits
before touching AGENT_SESSIONS — keeping the brain's behaviour (and its interview_agent tests)
unchanged. Also hosts ``decide_with_reason``: a PURE wrapper over ``graph.decide`` that attaches a
stable, human-readable branch label to the routing decision for the diagnostics console."""
from __future__ import annotations

import contextvars
import logging

from app.interview_agent.graph import decide
from app.interview_agent.state import DecisionInputs  # DecisionInputs is a TypedDict in state.py, NOT types.py
from app.interview_agent.types import Action, PacingDirective, TopicScope, TurnClass
from app.jobs.agent_sessions import AGENT_SESSIONS

# Bound only for the duration of an interactive diagnostic session (see the agent-diag runner).
# On the production run_session path this stays at its default of None, so _rid() returns None and
# every emit helper below is inert.
_current: "contextvars.ContextVar[str | None]" = contextvars.ContextVar(
    "diag_emitter_run_id", default=None)

# Per-session scratch for the raw model <thought> of each LLM op, keyed by the op's BASE label
# (the ``#N`` attempt suffix stripped). Default None means "no diagnostic session bound" — so on
# the production run_session path record_thought short-circuits and never allocates or stores.
_thoughts: "contextvars.ContextVar[dict[str, str] | None]" = contextvars.ContextVar(
    "diag_thoughts", default=None)
# LIFO stack of the in-flight steps' llm_labels: step_begin pushes, step_end pops. A STACK (not a
# scalar) so a step nested inside another (the `derive` step inside the `action` step) does NOT
# clobber its parent's label — each step_end pops ITS OWN label and attaches ITS OWN thought, so a
# pivot turn keeps both the derive AND the converse thought. Default None = no session bound
# (production path); every push/pop short-circuits.
_label_stack: "contextvars.ContextVar[list[str | None] | None]" = contextvars.ContextVar(
    "diag_label_stack", default=None)
# Per-session scratch for each LLM op's prompt-in / raw-response, keyed by BASE label — so the
# diagnostics drawer can show what actually went to / came back from the model, not just the parsed
# decision. Same inert-when-None discipline as _thoughts (no allocation on the production path).
_llm_io: "contextvars.ContextVar[dict[str, dict] | None]" = contextvars.ContextVar(
    "diag_llm_io", default=None)


def bind_emitter(run_id: str):
    """Bind the emitter to ``run_id`` for the current context; returns a token for unbind_emitter.
    Also resets a fresh (empty) thoughts dict + label stack so neither leaks across sessions."""
    _thoughts.set({})
    _llm_io.set({})
    _label_stack.set([])
    return _current.set(run_id)


def unbind_emitter(token) -> None:
    _current.reset(token)
    _thoughts.set(None)
    _llm_io.set(None)
    _label_stack.set(None)


def _rid() -> str | None:
    return _current.get()


def record_thought(label: str, thought: str) -> None:
    """Stash the model's raw <thought> for an LLM op so step_end can attach it. No-op when no
    session is bound (thoughts is None → the production path) or the thought is empty. Keyed by the
    op's BASE label (``iv-classify#2`` -> ``iv-classify``); last write wins across retry attempts."""
    d = _thoughts.get()
    if d is None or not thought:
        return
    base = label.split("#", 1)[0]
    d[base] = thought


def record_llm_io(label: str, system: str, user: str, raw_response: str) -> None:
    """Stash an LLM op's prompt-in / raw model response so step_end can attach it to the step,
    keyed by BASE label. No-op when no session is bound (production path). Last write wins across
    retry attempts (the accepted attempt's IO is what the console shows)."""
    d = _llm_io.get()
    if d is None:
        return
    base = label.split("#", 1)[0]
    d[base] = {"prompt_system": system, "prompt_user": user, "raw_response": raw_response}


def record_llm_timing(label: str, llm_ms: int, prompt_tokens=None, completion_tokens=None) -> None:
    """Stash an LLM op's round-trip latency (ms) + token usage so step_end can attach it — the key
    latency signal per step (a slow model, a big prompt, or retries all show here). Merges onto the
    same base-label entry as record_llm_io. No-op unbound; last write wins across retries."""
    d = _llm_io.get()
    if d is None:
        return
    base = label.split("#", 1)[0]
    entry = d.setdefault(base, {})
    entry["llm_ms"] = llm_ms
    if prompt_tokens is not None:
        entry["prompt_tokens"] = prompt_tokens
    if completion_tokens is not None:
        entry["completion_tokens"] = completion_tokens


def step_begin(name, llm_label=None) -> None:
    rid = _rid()
    if rid is not None:
        stack = _label_stack.get()
        if stack is not None:
            stack.append(llm_label)   # push even when None so pops stay balanced with begins
        AGENT_SESSIONS.begin_step(rid, name, llm_label=llm_label)


def step_end(status, detail) -> None:
    rid = _rid()
    if rid is None:
        return
    stack = _label_stack.get()
    label = stack.pop() if stack else None   # LIFO: pop THIS step's own label (not a nested child's)
    if label:
        extra: dict = {}
        io = _llm_io.get() or {}
        if label in io:
            extra.update(io.pop(label))          # prompt_system / prompt_user / raw_response
        thoughts = _thoughts.get() or {}
        if label in thoughts:
            extra["thought"] = thoughts.pop(label)
        # Consume on attach: a later step reusing the same base label with no fresh IO/<thought>
        # must not re-attach this stale one.
        if extra:
            detail = {**(detail or {}), **extra}
    AGENT_SESSIONS.end_step(rid, status, detail)


def begin_turn(kind: str) -> None:
    """Open the diagnostic turn (using the transport's stashed pending candidate). No-op when unbound
    — so the transport no longer opens turns; the session drives turn boundaries via this signal,
    letting opening-phase replies fold into the seeded turn 0 instead of opening empty ``main`` turns."""
    rid = _rid()
    if rid is not None:
        AGENT_SESSIONS.open_pending_turn(rid, kind)


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


class AgentDiagLogHandler(logging.Handler):
    """Routes any log record emitted while a diagnostic session is bound into that session's log
    buffer, keyed by the emitter's run-id contextvar (``_current``). No-op — returns before touching
    the store — when nothing is bound, so it's silent on the production run_session/worker path and
    for every other request. Install once on the root logger (see app.main). This is what makes the
    console's log stream show the [llm]/[iv]/[structured] activity behind each step."""

    def emit(self, record: logging.LogRecord) -> None:
        rid = _current.get()
        if rid is None:
            return
        try:
            AGENT_SESSIONS.log(rid, record.levelname, record.getMessage())
        except Exception:  # logging must never raise
            pass
