import asyncio

import app.interview_agent.llm_ops as ops
from app.interview_agent.types import TurnClass, PacingDirective
from app.config import get_settings


def _run(coro):
    return asyncio.run(coro)


def _stub_structured(monkeypatch, payload):
    async def fake(llm, system, user, response_model, *, max_repairs, label):
        return response_model.model_validate(payload)
    monkeypatch.setattr(ops, "complete_structured", fake)


def test_classify_turn_maps_result(monkeypatch):
    _stub_structured(monkeypatch, {"turn_class": "pivot_request", "requested_topic": "dp", "topic_scope": "in"})
    tc, topic = _run(ops.classify_turn(llm=None, settings=get_settings(),
                                       round_type="dsa", active_item_summary="two-sum", last_text="ask dp"))
    assert tc == TurnClass.PIVOT_REQUEST and topic == "dp"


def test_grade_answer_aggregates_criteria(monkeypatch):
    _stub_structured(monkeypatch, {"criteria": [{"criterion": "c1", "score": 0.8},
                                                 {"criterion": "c2", "score": 0.6}], "coherence": 0.5})
    comp, coh = _run(ops.grade_answer(llm=None, settings=get_settings(),
                                      rubric=[{"criterion": "c1", "weight": 0.5},
                                              {"criterion": "c2", "weight": 0.5}],
                                      question="q", answer="a"))
    assert 0.6 <= comp <= 0.8 and coh == 0.5


def test_judge_pacing_maps_directive(monkeypatch):
    _stub_structured(monkeypatch, {"directive": "wind_down"})
    d = _run(ops.judge_pacing(llm=None, settings=get_settings(), gate="may_wind_down",
                              rolling=0.3, transcript_summary="weak"))
    assert d == PacingDirective.WIND_DOWN


def test_generate_line_returns_text(monkeypatch):
    _stub_structured(monkeypatch, {"line": "So, let's start — walk me through two sum."})
    line = _run(ops.generate_line(llm=None, settings=get_settings(), action="ask_base",
                                  persona={"name": "Ada"}, active_item={"basePrompt": "two sum"},
                                  transcript_tail=[], extra={}))
    assert "two sum" in line.lower()


def test_derive_ladder_returns_dict(monkeypatch):
    _stub_structured(monkeypatch, {"base_prompt": "longest increasing subsequence",
                                   "follow_ups": ["optimize to n log n"], "hints": ["patience sorting"],
                                   "rubric": [{"criterion": "approach", "weight": 1.0}]})
    lad = _run(ops.derive_ladder(llm=None, settings=get_settings(), round_type="dsa",
                                 topic="dp", brief="b", jd="j"))
    assert lad["basePrompt"] == "longest increasing subsequence"   # camelCase out
