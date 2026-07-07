"""Task A3: the contextvar-bound diagnostics emitter + the pure decide_with_reason wrapper.

Three properties are pinned here:
  * no-op safety   — every emit.* call is inert when no diagnostic session is bound (the
                     production run_session path, which never binds, must stay unchanged);
  * emit routing   — once a run_id is bound, emit.* forwards to the bound AgentSessionStore;
  * purity         — decide_with_reason returns the SAME Action as bare graph.decide, plus a
                     non-empty human-readable branch label.
Plain sync tests (no asyncio_mode configured in this repo — mirrors test_session.py)."""
from app.interview_agent import diagnostics_emit as emit
from app.interview_agent.graph import decide
from app.jobs.agent_sessions import AgentSessionStore


def test_emit_is_noop_when_unbound():
    # Must not raise when no session is bound (production path safety).
    emit.step_begin("classify")
    emit.step_end("ok", {"x": 1})
    emit.step_skipped("scope")


def test_emit_routes_to_bound_session(monkeypatch):
    store = AgentSessionStore()
    store.start("r", {}, label="x")
    monkeypatch.setattr(emit, "AGENT_SESSIONS", store)
    tok = emit.bind_emitter("r")
    try:
        emit.step_begin("classify", llm_label="iv-classify")
        emit.step_end("ok", {"decision": "answer"})
    finally:
        emit.unbind_emitter(tok)
    step = store.snapshot("r", 0)["turns"][0]["steps"][-1]
    assert step["name"] == "classify" and step["detail"]["decision"] == "answer"


def test_emit_skipped_routes_to_bound_session(monkeypatch):
    store = AgentSessionStore()
    store.start("r", {}, label="x")
    monkeypatch.setattr(emit, "AGENT_SESSIONS", store)
    tok = emit.bind_emitter("r")
    try:
        emit.step_skipped("scope")
    finally:
        emit.unbind_emitter(tok)
    step = store.snapshot("r", 0)["turns"][0]["steps"][-1]
    assert step["name"] == "scope" and step["status"] == "skipped"


def test_unbind_restores_noop(monkeypatch):
    # After unbind the emitter must be inert again even if AGENT_SESSIONS still points at a store.
    store = AgentSessionStore()
    store.start("r", {}, label="x")
    monkeypatch.setattr(emit, "AGENT_SESSIONS", store)
    tok = emit.bind_emitter("r")
    emit.unbind_emitter(tok)
    emit.step_begin("classify")   # unbound again → no-op, must not touch the store
    emit.step_end("ok", {})
    assert store.snapshot("r", 0)["turns"][0]["steps"] == []


def test_record_thought_noop_when_unbound():
    # Production path safety: with no session bound the thoughts contextvar is None, so
    # record_thought must be a pure no-op (must not raise, must not create state).
    emit.record_thought("iv-classify#1", "because X")


def test_thought_attaches_to_llm_step_by_base_label(monkeypatch):
    store = AgentSessionStore()
    store.start("r", {}, label="x")
    monkeypatch.setattr(emit, "AGENT_SESSIONS", store)
    tok = emit.bind_emitter("r")
    try:
        emit.step_begin("classify", llm_label="iv-classify")
        emit.record_thought("iv-classify#2", "chose answer because it addressed the prompt")  # #N stripped
        emit.step_end("ok", {"decision": "answer"})
    finally:
        emit.unbind_emitter(tok)
    step = store.snapshot("r", 0)["turns"][0]["steps"][-1]
    assert step["detail"]["thought"] == "chose answer because it addressed the prompt"
    assert step["detail"]["decision"] == "answer"


def test_decide_with_reason_matches_bare_decide_and_labels():
    from app.interview_agent.state import DecisionInputs   # TypedDict lives in state.py
    from app.interview_agent.types import PacingDirective
    # sample a range of inputs; the action must equal bare decide, and reason is non-empty
    samples = [
        dict(turn_class="answer", requested_topic=None, topic_scope="in",
             pacing_directive=PacingDirective.CONTINUE.value, followups_left=True, hints_left=True,
             has_next_question=True, reserve_available=True, pivot_count=0, pivot_cap=2,
             answer_adequate=True),
        dict(turn_class="pivot_request", requested_topic="ml", topic_scope="out",
             pacing_directive=PacingDirective.CONTINUE.value, followups_left=False, hints_left=False,
             has_next_question=False, reserve_available=False, pivot_count=3, pivot_cap=2,
             answer_adequate=False),
    ]
    for s in samples:
        di = DecisionInputs(**s)
        action, reason = emit.decide_with_reason(di)
        assert action == decide(di)
        assert isinstance(reason, str) and reason


def test_decide_with_reason_is_pure_across_the_precedence_ladder():
    """Exhaustively walk the branches of graph.decide and assert the wrapper's Action always
    equals bare decide (the label is only required to be a non-empty string)."""
    from app.interview_agent.state import DecisionInputs
    from app.interview_agent.types import PacingDirective, TopicScope, TurnClass

    base = dict(requested_topic=None, topic_scope=TopicScope.IN.value,
                pacing_directive=PacingDirective.CONTINUE.value, followups_left=True,
                hints_left=True, has_next_question=True, reserve_available=True,
                pivot_count=0, pivot_cap=2, answer_adequate=False)

    variants = [
        {**base, "pacing_directive": PacingDirective.WIND_DOWN.value},
        {**base, "pacing_directive": PacingDirective.EXTEND.value, "reserve_available": True},
        {**base, "pacing_directive": PacingDirective.EXTEND.value, "reserve_available": False},
        {**base, "turn_class": TurnClass.PIVOT_REQUEST.value, "topic_scope": TopicScope.OUT.value},
        {**base, "turn_class": TurnClass.PIVOT_REQUEST.value, "topic_scope": TopicScope.IN.value,
         "pivot_count": 3, "pivot_cap": 2},
        {**base, "turn_class": TurnClass.PIVOT_REQUEST.value, "topic_scope": TopicScope.IN.value,
         "pivot_count": 0, "pivot_cap": 2},
        {**base, "turn_class": TurnClass.CLARIFY.value},
        {**base, "turn_class": TurnClass.DISTRESS.value},
        {**base, "turn_class": TurnClass.CHALLENGE.value},
        {**base, "turn_class": TurnClass.OFF_TOPIC.value},
        {**base, "turn_class": TurnClass.IDK_SILENCE.value, "hints_left": True},
        {**base, "turn_class": TurnClass.IDK_SILENCE.value, "hints_left": False,
         "has_next_question": True},
        {**base, "turn_class": TurnClass.IDK_SILENCE.value, "hints_left": False,
         "has_next_question": False},
        {**base, "turn_class": TurnClass.ANSWER.value, "answer_adequate": True,
         "has_next_question": True},
        {**base, "turn_class": TurnClass.ANSWER.value, "answer_adequate": True,
         "has_next_question": False},
        {**base, "turn_class": TurnClass.ANSWER.value, "answer_adequate": False,
         "followups_left": True},
        {**base, "turn_class": TurnClass.ANSWER.value, "answer_adequate": False,
         "followups_left": False, "has_next_question": True},
        {**base, "turn_class": TurnClass.ANSWER.value, "answer_adequate": False,
         "followups_left": False, "has_next_question": False},
    ]
    for v in variants:
        di = DecisionInputs(**{"turn_class": TurnClass.ANSWER.value, **v})
        action, reason = emit.decide_with_reason(di)
        assert action == decide(di)
        assert isinstance(reason, str) and reason
