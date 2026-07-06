from app.interview_agent.types import (
    RoundType, TurnClass, TopicScope, PacingGate, PacingDirective, Action, EndedReason,
    UtteranceTiming, Turn, BehavioralSignals, PerAnswerScore, NegativeEvent, SessionOutcome,
)


def test_enums_have_expected_members():
    assert TurnClass.PIVOT_REQUEST.value == "pivot_request"
    assert PacingGate.MUST_WRAP.value == "must_wrap"
    assert PacingDirective.WIND_DOWN.value == "wind_down"
    assert Action.EXTEND_RESERVE.value == "extend_reserve"
    assert EndedReason.EARLY_WEAK.value == "early_weak"
    # Task 7: candidate-left is distinct from a genuine technical/exception failure.
    assert EndedReason.ABANDONED.value == "abandoned"
    assert RoundType.DSA.value == "dsa"   # reused from app.models.brief


def test_value_objects_construct():
    t = Turn(speaker="candidate", text="hi", t_start=1.0, t_end=2.0)
    assert t.speaker == "candidate"
    sig = BehavioralSignals(ttf_word_s=1.0, filler_density=0.1, self_corrections=0, recovered_after_hint=False)
    assert sig.filler_density == 0.1
    o = SessionOutcome(session_id="s1", ended_reason=EndedReason.NATURAL_COMPLETE, live_score_final=0.7,
                       per_answer_evidence=[], negative_events=[], arc_completed=True,
                       extensions_granted=0, derived_topics=[], duration_s=1800.0)
    assert o.live_score_final == 0.7
