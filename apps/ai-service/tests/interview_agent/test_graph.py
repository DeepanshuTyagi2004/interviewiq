import asyncio

import app.interview_agent.graph as g
from app.interview_agent.state import SessionState, bands_from_settings
from app.interview_agent.types import Action, PacingDirective, PerAnswerScore, TurnClass, TopicScope
from app.config import get_settings

PLAN = {
    "sessionId": "s1", "roundType": "dsa", "persona": {"name": "Ada"},
    "questionLadders": [
        {"questionSlug": "q1", "basePrompt": "b1", "followUps": ["f1"], "hints": ["h1"],
         "rubric": [{"criterion": "c", "weight": 1.0}]},
        {"questionSlug": "q2", "basePrompt": "b2", "followUps": [], "hints": [], "rubric": []},
    ],
    "reserve": [{"questionSlug": "r1", "basePrompt": "hard"}],
}


def _inputs(**over):
    base = dict(turn_class="answer", requested_topic=None, topic_scope="unclear",
                pacing_directive="continue", followups_left=True, hints_left=True,
                has_next_question=True, reserve_available=True, pivot_count=0, pivot_cap=2,
                answer_adequate=False)
    base.update(over)
    return base


def test_decide_wind_down_directive_overrides():
    assert g.decide(_inputs(pacing_directive="wind_down")) == Action.WIND_DOWN


def test_decide_extend_directive_pulls_reserve():
    assert g.decide(_inputs(pacing_directive="extend", reserve_available=True)) == Action.EXTEND_RESERVE


def test_decide_out_of_scope_pivot_refuses():
    assert g.decide(_inputs(turn_class="pivot_request", topic_scope="out")) == Action.REFUSE_OUT_OF_SCOPE


def test_decide_in_scope_pivot_derives_until_cap():
    assert g.decide(_inputs(turn_class="pivot_request", topic_scope="in", pivot_count=0)) == Action.PIVOT_DERIVE
    assert g.decide(_inputs(turn_class="pivot_request", topic_scope="in", pivot_count=2, pivot_cap=2)) == Action.HOLD_GROUND


def test_decide_answer_escalates_then_moves_on():
    assert g.decide(_inputs(turn_class="answer", followups_left=True)) == Action.ESCALATE_FOLLOWUP
    assert g.decide(_inputs(turn_class="answer", followups_left=False, has_next_question=True)) == Action.MOVE_ON
    assert g.decide(_inputs(turn_class="answer", followups_left=False, has_next_question=False)) == Action.WRAP


def test_decide_answer_thin_stays_within_budget():
    # Task 3: thin answer (not adequate) + budget remaining + pacing allows -> keep probing.
    assert g.decide(_inputs(turn_class="answer", pacing_directive="continue",
                             answer_adequate=False, followups_left=True)) == Action.ESCALATE_FOLLOWUP


def test_decide_answer_adequate_advances_even_with_budget_left():
    # Task 3: the new behavior -- adequate answer advances even though follow-up budget remains.
    assert g.decide(_inputs(turn_class="answer", answer_adequate=True, followups_left=True,
                             has_next_question=True)) == Action.MOVE_ON


def test_decide_answer_adequate_wraps_when_no_next_question():
    assert g.decide(_inputs(turn_class="answer", answer_adequate=True,
                             has_next_question=False)) == Action.WRAP


def test_decide_answer_thin_but_budget_exhausted_moves_on():
    assert g.decide(_inputs(turn_class="answer", answer_adequate=False, followups_left=False,
                             has_next_question=True)) == Action.MOVE_ON


def test_decide_pacing_precedence_preserved_over_adequacy():
    # Wind-down/extend precedence must not be overridden by answer_adequate/followups_left.
    assert g.decide(_inputs(turn_class="answer", pacing_directive="wind_down",
                             answer_adequate=True, followups_left=True)) == Action.WIND_DOWN
    assert g.decide(_inputs(turn_class="answer", pacing_directive="wind_down",
                             answer_adequate=False, followups_left=False)) == Action.WIND_DOWN
    assert g.decide(_inputs(turn_class="answer", pacing_directive="extend",
                             reserve_available=True, answer_adequate=True)) == Action.EXTEND_RESERVE


def test_decide_scope_pivot_unchanged_by_adequacy():
    assert g.decide(_inputs(turn_class="pivot_request", topic_scope="out",
                             answer_adequate=True)) == Action.REFUSE_OUT_OF_SCOPE


def test_decide_idk_gives_hint_then_moves_on():
    assert g.decide(_inputs(turn_class="idk_silence", hints_left=True)) == Action.GIVE_HINT
    assert g.decide(_inputs(turn_class="idk_silence", hints_left=False, has_next_question=True)) == Action.MOVE_ON


def test_decide_clarify_distress_challenge():
    assert g.decide(_inputs(turn_class="clarify")) == Action.ANSWER_CLARIFY
    assert g.decide(_inputs(turn_class="distress")) == Action.REASSURE
    assert g.decide(_inputs(turn_class="challenge")) == Action.DEESCALATE
    assert g.decide(_inputs(turn_class="off_topic")) == Action.REDIRECT


def test_run_decision_out_of_scope_uses_marker_guard(monkeypatch):
    # LLM says "in", but the marker guard forces "out" for a cross-round request.
    async def fake_classify(llm, settings, *, round_type, active_item_summary, last_text):
        return TurnClass.PIVOT_REQUEST, "system design"
    monkeypatch.setattr(g.llm_ops, "classify_turn", fake_classify)
    st = SessionState.from_plan(PLAN, bands_from_settings(get_settings()))
    from app.interview_agent.types import Turn
    out = asyncio.run(g.run_decision(st, Turn("candidate", "can we do system design"),
                                     deps=g.GraphDeps(llm=None, settings=get_settings())))
    assert out["action"] == Action.REFUSE_OUT_OF_SCOPE.value


def test_build_inputs_answer_adequate_from_last_score():
    settings = get_settings()
    st = SessionState.from_plan(PLAN, bands_from_settings(settings))

    # No scored answers yet -> not adequate (keep probing).
    inputs = g.build_inputs(st, TurnClass.ANSWER, None, TopicScope.UNCLEAR, settings)
    assert inputs["answer_adequate"] is False

    # Below the high band -> not adequate.
    st.per_answer.append(PerAnswerScore(slug="q1", competency=settings.interview_high_band - 0.05,
                                        behavioral=0.5, answer_score=0.5, weight=1.0))
    inputs = g.build_inputs(st, TurnClass.ANSWER, None, TopicScope.UNCLEAR, settings)
    assert inputs["answer_adequate"] is False

    # At/above the high band -> adequate; only the most recent score matters.
    st.per_answer.append(PerAnswerScore(slug="q1", competency=settings.interview_high_band,
                                        behavioral=0.9, answer_score=0.9, weight=1.0))
    inputs = g.build_inputs(st, TurnClass.ANSWER, None, TopicScope.UNCLEAR, settings)
    assert inputs["answer_adequate"] is True
