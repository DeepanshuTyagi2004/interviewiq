"""Pure scoring math for the live interview (spec §6). No LLM, no I/O. The COMPETENCY grade itself
comes from an LLM (llm_ops.grade_answer); everything here — behavioral signal extraction from the
transcript, combining into an answer score, and aggregating the rolling score with penalties — is
deterministic and unit-tested."""
from __future__ import annotations

import re

from app.interview_agent.types import BehavioralSignals, NegativeEvent, PerAnswerScore, UtteranceTiming

_FILLERS = ("um", "uh", "erm", "hmm", "like", "so")
_CORRECTION_MARKERS = ("actually no", "no wait", "i mean", "sorry", "let me restart", "scratch that")


def _clamp01(x: float) -> float:
    return max(0.0, min(1.0, x))


def extract_behavioral(text: str, timing: UtteranceTiming, hint_was_given: bool) -> BehavioralSignals:
    """Derive transcript+timing behavioral signals (spec §6). recovered_after_hint is True when a
    hint was given before this answer AND the answer is substantive (>= 12 words)."""
    words = re.findall(r"[a-zA-Z']+", text.lower())
    n = len(words) or 1
    fillers = sum(1 for w in words if w in _FILLERS)
    low = text.lower()
    corrections = sum(low.count(m) for m in _CORRECTION_MARKERS)
    recovered = bool(hint_was_given and n >= 12)
    return BehavioralSignals(
        ttf_word_s=timing.time_to_first_word_s,
        filler_density=fillers / n,
        self_corrections=corrections,
        recovered_after_hint=recovered,
    )


def behavioral_score(sig: BehavioralSignals) -> float:
    """Map signals to 0..1 (higher = more confident/fluent). Each penalty is bounded so no single
    signal can dominate; a hint recovery adds a small bonus."""
    hesitation = _clamp01(sig.ttf_word_s / 8.0)          # 8s+ to first word → maxed out
    filler = _clamp01(sig.filler_density / 0.25)          # 25%+ fillers → maxed out
    corrections = _clamp01(sig.self_corrections / 5.0)    # 5+ restarts → maxed out
    penalty = 0.5 * hesitation + 0.3 * filler + 0.2 * corrections
    score = 1.0 - penalty
    if sig.recovered_after_hint:
        score += 0.1
    return _clamp01(score)


def answer_score(competency: float, behavioral: float, w_c: float, w_b: float) -> float:
    return _clamp01(w_c * _clamp01(competency) + w_b * _clamp01(behavioral))


def rolling_score(per_answer: list[PerAnswerScore], negatives: list[NegativeEvent]) -> float:
    """Weight-averaged answer scores, then subtract the summed negative-event magnitudes. Clamped
    to [0,1]. Empty history → 0.0 (no evidence yet)."""
    if not per_answer:
        return 0.0
    total_w = sum(p.weight for p in per_answer) or 1.0
    weighted = sum(p.answer_score * p.weight for p in per_answer) / total_w
    penalty = sum(e.magnitude for e in negatives)
    return _clamp01(weighted - penalty)


def coverage(attempted_core: int, total_core: int) -> float:
    """Fraction of the plan's core questions meaningfully attempted. total_core == 0 → 1.0 (nothing
    to cover, so coverage is not a blocker)."""
    if total_core <= 0:
        return 1.0
    return _clamp01(attempted_core / total_core)
