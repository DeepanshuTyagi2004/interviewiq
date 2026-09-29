from app.interview_agent.pacing import PacingBands, evaluate_gate
from app.interview_agent.types import PacingGate

BANDS = PacingBands(min_s=18*60, base_s=45*60, max_s=60*60, low=0.40, high=0.70,
                    extend_lookahead_s=300.0, min_coverage=0.34)


def test_locked_before_floor_even_if_weak():
    assert evaluate_gate(elapsed_s=10*60, rolling=0.1, cov=0.9, reserve_available=True, bands=BANDS) == PacingGate.LOCKED


def test_may_wind_down_after_floor_when_weak_and_enough_coverage():
    assert evaluate_gate(elapsed_s=20*60, rolling=0.30, cov=0.5, reserve_available=False, bands=BANDS) == PacingGate.MAY_WIND_DOWN


def test_weak_but_thin_coverage_does_not_wind_down():
    assert evaluate_gate(elapsed_s=20*60, rolling=0.30, cov=0.2, reserve_available=False, bands=BANDS) == PacingGate.CONTINUE


def test_may_extend_when_strong_near_base_and_reserve_present():
    assert evaluate_gate(elapsed_s=41*60, rolling=0.80, cov=0.9, reserve_available=True, bands=BANDS) == PacingGate.MAY_EXTEND


def test_no_extend_without_reserve():
    assert evaluate_gate(elapsed_s=41*60, rolling=0.80, cov=0.9, reserve_available=False, bands=BANDS) == PacingGate.CONTINUE


def test_must_wrap_at_ceiling():
    assert evaluate_gate(elapsed_s=60*60, rolling=0.95, cov=0.9, reserve_available=True, bands=BANDS) == PacingGate.MUST_WRAP


def test_continue_when_mid_and_middling():
    assert evaluate_gate(elapsed_s=30*60, rolling=0.55, cov=0.6, reserve_available=True, bands=BANDS) == PacingGate.CONTINUE
