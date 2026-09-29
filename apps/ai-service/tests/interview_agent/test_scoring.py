import pytest

from app.interview_agent import scoring
from app.interview_agent.types import UtteranceTiming, BehavioralSignals, PerAnswerScore, NegativeEvent


def test_extract_behavioral_counts_fillers_and_corrections():
    text = "um so I think, uh, actually no wait, I mean we use a hash map"
    timing = UtteranceTiming(t_start=0.0, t_end=10.0, time_to_first_word_s=1.5)
    sig = scoring.extract_behavioral(text, timing, hint_was_given=True)
    assert sig.ttf_word_s == 1.5
    assert sig.filler_density > 0           # um, uh present
    assert sig.self_corrections >= 1        # "actually no wait" / "I mean"
    assert sig.recovered_after_hint is True


def test_behavioral_score_is_bounded_0_1():
    good = BehavioralSignals(ttf_word_s=0.5, filler_density=0.0, self_corrections=0, recovered_after_hint=False)
    bad = BehavioralSignals(ttf_word_s=12.0, filler_density=0.5, self_corrections=6, recovered_after_hint=False)
    assert 0.0 <= scoring.behavioral_score(bad) <= scoring.behavioral_score(good) <= 1.0


def test_answer_score_weights():
    assert scoring.answer_score(competency=1.0, behavioral=0.0, w_c=0.75, w_b=0.25) == pytest.approx(0.75)
    assert scoring.answer_score(competency=0.0, behavioral=1.0, w_c=0.75, w_b=0.25) == pytest.approx(0.25)


def test_rolling_score_weighted_mean_then_penalized():
    per = [
        PerAnswerScore(slug="a", competency=0.8, behavioral=0.6, answer_score=0.75, weight=1.0),
        PerAnswerScore(slug="b", competency=0.4, behavioral=0.4, answer_score=0.40, weight=1.0),
    ]
    base = scoring.rolling_score(per, negatives=[])
    assert base == pytest.approx((0.75 + 0.40) / 2)
    penalized = scoring.rolling_score(per, negatives=[NegativeEvent("out_of_scope", 0.30, "r", 100.0)])
    assert penalized == pytest.approx(base - 0.30)


def test_rolling_score_clamped_and_empty():
    assert scoring.rolling_score([], negatives=[]) == 0.0
    per = [PerAnswerScore(slug="a", competency=0.1, behavioral=0.1, answer_score=0.1, weight=1.0)]
    assert scoring.rolling_score(per, [NegativeEvent("x", 0.9, "r", 1.0)]) == 0.0  # clamped >= 0


def test_coverage():
    assert scoring.coverage(0, 6) == 0.0
    assert scoring.coverage(3, 6) == pytest.approx(0.5)
    assert scoring.coverage(2, 0) == 1.0   # no core → treated as fully covered
