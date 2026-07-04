"""Pure pacing rails (spec §7). The DETERMINISTIC guardrails of adaptive pacing: given elapsed time,
the rolling score, coverage, and reserve availability, decide whether a pacing gate is OPEN. The LLM
(llm_ops.judge_pacing) only ever runs when a gate opens, and can only confirm — it can never make the
session end before the floor or run past the ceiling, because those are decided here."""
from __future__ import annotations

from dataclasses import dataclass

from app.interview_agent.types import PacingGate


@dataclass(frozen=True)
class PacingBands:
    min_s: float          # floor — no wind-down before this
    base_s: float         # target duration
    max_s: float          # hard ceiling
    low: float            # rolling below this (after floor) → may wind down
    high: float           # rolling above this (near base) → may extend
    extend_lookahead_s: float   # how long before base_s the extend gate opens
    min_coverage: float   # coverage floor before a wind-down is allowed


def evaluate_gate(elapsed_s: float, rolling: float, cov: float,
                  reserve_available: bool, bands: PacingBands) -> PacingGate:
    """Rails first, then bands. Order matters: the ceiling is absolute; the floor blocks all
    wind-downs; extend only near/after base with strong score AND material to extend with."""
    if elapsed_s >= bands.max_s:
        return PacingGate.MUST_WRAP
    if elapsed_s < bands.min_s:
        return PacingGate.LOCKED
    # Past the floor:
    if rolling < bands.low and cov >= bands.min_coverage:
        return PacingGate.MAY_WIND_DOWN
    if (elapsed_s >= bands.base_s - bands.extend_lookahead_s
            and rolling > bands.high and reserve_available):
        return PacingGate.MAY_EXTEND
    return PacingGate.CONTINUE
