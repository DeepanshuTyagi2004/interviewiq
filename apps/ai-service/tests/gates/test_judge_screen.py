from __future__ import annotations

import importlib.util
import os

from app.gates.judge import JUDGE_QUESTIONS, compare, compare_target_ok, verdict_from
from app.llm.decisions import Decision


def decision(scores: dict) -> Decision:
    return Decision(answers=scores, model="typesafe/jev-1.14-test")


def _dimensions() -> dict:
    path = os.path.join(os.path.dirname(__file__), "..", "..", "scripts", "judge_blueprints.py")
    spec = importlib.util.spec_from_file_location("judge_blueprints_script", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.DIMENSIONS


def test_score_index_maps_to_1_5():
    v = verdict_from(decision({"overall": {"score": 3.6}, "realism": {"score": 0.2}}))
    assert v["overall"] == 5
    assert v["dimensions"]["realism"] == {"score": 1, "why": "jev quick screen"}
    assert v["walkthroughs"] == [] and v["defects"] == []


def test_missing_overall_is_error():
    v = verdict_from(decision({"realism": {"score": 2.0}}))
    assert "error" in v and "overall" not in v


def test_missing_dimension_omitted():
    v = verdict_from(decision({"overall": {"score": 2.0}}))
    assert v["overall"] == 3 and v["dimensions"] == {}


def test_compare_mae():
    jev = [{"run_id": "a", "overall": 4, "dimensions": {"realism": {"score": 3}}},
           {"run_id": "b", "overall": 2, "dimensions": {"realism": {"score": 2}}},
           {"run_id": "c", "overall": 1, "dimensions": {}}]
    llm = [{"run_id": "a", "overall": 5, "dimensions": {"realism": {"score": 5}}},
           {"run_id": "b", "overall": 2, "dimensions": {"realism": {"score": 2}}}]
    out = compare(jev, llm)
    assert out["n"] == 2 and out["overall_mae"] == 0.5
    assert out["dimension_mae"] == {"realism": 1.0}


def test_questions_cover_all_dimensions():
    assert set(JUDGE_QUESTIONS) == set(_dimensions()) | {"overall"}
    for q in JUDGE_QUESTIONS.values():
        assert q["type"] == "score" and len(q["criteria"]) == 5


def test_compare_no_overlap_is_none():
    out = compare([{"run_id": "x", "overall": 3, "dimensions": {}}], [{"run_id": "y", "overall": 3, "dimensions": {}}])
    assert out["n"] == 0 and out["overall_mae"] is None


def test_compare_target_guard(tmp_path):
    out = tmp_path / "o"
    assert not compare_target_ok(str(out / "judge.json"), str(out))
    assert not compare_target_ok(str(out / ".." / "o" / "judge.json"), str(out))
    assert compare_target_ok(str(tmp_path / "other" / "judge.json"), str(out))
