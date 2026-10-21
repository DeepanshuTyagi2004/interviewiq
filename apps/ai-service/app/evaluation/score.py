"""Deterministic scoring arithmetic (spec §8.1-§8.6). Pure: no I/O, no LLM."""
from __future__ import annotations

from dataclasses import dataclass, field
from decimal import ROUND_HALF_UP, Decimal
from typing import Literal

from app.evaluation.weights import FAMILIES, MUST_HAVE

TIEBREAK_GAP = 1.5
BONUS_CAP = 0.5
HINT_PROBLEM_FLOOR = -0.8
AWAY_PENALTY = -3.0      # leaving the window (x event weight) and staying away past the limit (owner decision 2026-10-21)
ABUSE_PENALTY = -7.0     # a round ended for abusive language (owner decision 2026-10-21)
_HINT_STEP = {1: -0.1, 2: -0.25}
_HINT_LABEL = {1: "Hint: small nudge", 2: "Hint: gave direction", 3: "Hint: near-solution"}
# Event kinds the proctor ledger may hold that are NOT proctor penalties (they arrive via away_overstays).
_NOT_PROCTOR = {"away_overstay", "away_cap"}
# What the candidate did, in their words, for each proctor / integrity event kind (never an internal id on the report).
EVENT_LABELS: dict[str, str] = {
    "tab_hidden": "Switched tabs",
    "window_blur": "Left the window",
    "fullscreen_exit": "Left fullscreen",
    "external_display": "External display",
    "share_stopped": "Stopped screen share",
    "foreign_paste": "Pasted from outside the editor",
    "away_overstay": "Stayed away too long",
}
# Families whose must-have is met when ANY ran part of the family meets it ("at least one real example of the candidate's own").
_ANY_PART_MUST_HAVE = frozenset({"behavioural", "hiring-manager"})


def event_label(kind: str | None) -> str:
    return EVENT_LABELS.get(kind or "", "Left the interview window or screen")


def needs_tiebreak(a: float, b: float) -> bool:
    # rounded so a float artefact (6.8 - 5.3 = 1.5000000000000004) never counts as a gap past the tolerance
    return round(abs(a - b), 6) > TIEBREAK_GAP


def merge_score(a: float, b: float, c: float | None) -> float:
    """Mean of two grader runs, or the median of three when they differ by more than TIEBREAK_GAP."""
    if not needs_tiebreak(a, b):
        return (a + b) / 2
    if c is None:
        raise ValueError("third grade required when the first two differ by more than the gap")
    return sorted((a, b, c))[1]


def majority(a, b, c=None):
    """Categorical merge: a if a == b else the tie-break value c."""
    return a if a == b else c


@dataclass
class PartScore:
    part_id: str
    family: str
    share: float
    areas: dict[str, float]  # 1-10 score keyed by area key of the family
    must_have_met: bool
    bonus: bool = False      # a bonus problem: no base share and no must-have; a solved one counts only through its +0.3 adjustment
    swapped: bool = False    # the candidate asked to switch away from this problem: it keeps its share but is never the main part


def part_shares(planned: dict[str, float | None], round_minutes: float = 0) -> dict[str, float]:
    """Planned-minute shares. Parts with None minutes split max(0, round_minutes - known) equally;
    if every part is known, shares are proportional to the known minutes."""
    if not planned:
        return {}
    known = {k: float(v) for k, v in planned.items() if v is not None}
    unknown = [k for k, v in planned.items() if v is None]
    minutes = dict(known)
    if unknown:
        each = max(0.0, round_minutes - sum(known.values())) / len(unknown)
        minutes.update({k: each for k in unknown})
    total = sum(minutes.values())
    if total <= 0:
        return {k: 1 / len(planned) for k in planned}
    return {k: minutes[k] / total for k in planned}


@dataclass
class Adjustment:
    kind: str
    label: str
    delta: float
    turn_id: int | None = None
    at: float | None = None
    note: str = ""
    event_kind: str = ""   # the proctor ledger's kind of a proctor line (the integrity section groups by it); empty otherwise


@dataclass
class AdjustmentInputs:
    # problem id -> ladder step numbers of each hint given (1, 2, 3+)
    hint_steps_by_problem: dict[str, list[int]] = field(default_factory=dict)
    pointed_out_bugs: int = 0
    self_found_bugs: int = 0
    change_requests: int = 0
    change_granted: bool = False
    beyond_level: bool = False
    bonus_solved: bool = False
    end_questions_bonus: float = 0.0
    # dicts with key `kind` in {"warning", "final_warning"}
    conduct_warnings: list[dict] = field(default_factory=list)
    # dicts with keys kind, weight (and optionally turn_id, at)
    proctor: list[dict] = field(default_factory=list)
    pastes: list[dict] = field(default_factory=list)
    away_overstays: list[dict] = field(default_factory=list)
    # dicts with keys turn_id, at: the conduct ledger's abusive entries (the round was ended for abuse)
    abuse: list[dict] = field(default_factory=list)


def _r(x: float) -> float:
    return round(x, 4)


def adjustments(x: AdjustmentInputs, titles: dict[str, str] | None = None) -> list[Adjustment]:
    """The adjustment lines. `titles` maps a part id to its problem title: a hint's note names the problem, never the part id."""
    out: list[Adjustment] = []
    titles = titles or {}

    for problem, steps in x.hint_steps_by_problem.items():
        used = 0.0
        for step in steps:
            delta = _HINT_STEP.get(step, -0.5)
            delta = max(delta, HINT_PROBLEM_FLOOR - used)  # used is <= 0
            if delta >= 0:
                continue
            used += delta
            out.append(Adjustment("hint", _HINT_LABEL[min(step, 3)], _r(delta), note=titles.get(problem) or ""))

    for _ in range(min(x.pointed_out_bugs, 3)):
        out.append(Adjustment("bug_pointed_out", "Bug pointed out by the interviewer", -0.1))
    for _ in range(min(x.self_found_bugs, 2)):
        out.append(Adjustment("bug_self_found", "Found and fixed your own bug", 0.1))

    for i in range(x.change_requests):
        if i == 0:
            out.append(Adjustment("change_request", "Asked to change the problem", -1.0))
        else:
            out.append(Adjustment("change_request", "Asked to change the problem again", -0.5))
    if x.change_granted:
        out.append(Adjustment("change_granted", "Problem was changed for you", -1.0))

    if x.beyond_level:
        out.append(Adjustment("beyond_level", "Better solution than the level expects", 0.2))
    if x.bonus_solved:
        out.append(Adjustment("bonus_solved", "Solved the bonus problem", 0.3))
    if x.end_questions_bonus > 0:
        out.append(Adjustment("end_questions", "Thoughtful questions at the end", _r(x.end_questions_bonus)))

    for w in x.conduct_warnings:
        if w.get("kind") == "final_warning":
            out.append(Adjustment("conduct_final_warning", "Final warning for rudeness", -1.0,
                                  turn_id=w.get("turn_id"), at=w.get("at")))
        else:
            out.append(Adjustment("conduct_warning", "Warning for rudeness", -1.0,
                                  turn_id=w.get("turn_id"), at=w.get("at")))

    for ab in x.abuse:
        out.append(Adjustment("conduct_abuse", "Abusive language", ABUSE_PENALTY, turn_id=ab.get("turn_id"), at=ab.get("at")))

    # Leaving the window costs a flat 3 x the event's weight (owner decision 2026-10-21: no escalation, no free first event).
    for e in x.proctor:
        if e.get("kind") in _NOT_PROCTOR:
            continue
        weight = float(e.get("weight", 1))
        out.append(Adjustment("proctor", "Left the interview window or screen", _r(AWAY_PENALTY * weight),
                              turn_id=e.get("turn_id"), at=e.get("at"), note=event_label(e.get("kind")),
                              event_kind=str(e.get("kind") or "")))

    for p in x.pastes:
        out.append(Adjustment("paste", "Pasted code from outside the editor", -1.0,
                              turn_id=p.get("turn_id"), at=p.get("at")))
    for a in x.away_overstays:
        out.append(Adjustment("away_overstay", "Stayed away past the limit", AWAY_PENALTY,
                              turn_id=a.get("turn_id"), at=a.get("at")))
    return out


Outcome = Literal["passed", "below_pass", "auto_fail", "unscorable"]


@dataclass
class ScoreResult:
    base: float
    bonus_total: float  # >= 0, capped at BONUS_CAP
    penalty_total: float  # <= 0
    cap: str | None
    score: float
    outcome: Outcome
    verdict: str | None
    practical: float | None
    theory: float | None


def _round1(x: float) -> float:
    return float(Decimal(repr(x)).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP))


def _part_score(p: PartScore) -> float:
    areas = FAMILIES[p.family]
    present = [(a.weight, p.areas[a.key]) for a in areas if a.key in p.areas]
    total_w = sum(w for w, _ in present)
    if total_w <= 0:
        return 1.0
    return sum(w * s for w, s in present) / total_w


def verdict_for(score: float, pass_mark: float) -> str:
    d = round(score - pass_mark, 6)
    if d >= 1.5:
        return "Strong Hire"
    if d >= 0.5:
        return "Hire"
    if d >= 0:
        return "Lean Hire"
    if d >= -0.75:
        return "Lean No Hire"
    if d >= -2.0:
        return "No Hire"
    return "Strong No Hire"


def _split(parts: list[PartScore], shares: dict[int, float]) -> tuple[float | None, float | None]:
    sums = {True: [0.0, 0.0], False: [0.0, 0.0]}  # practical flag -> [weighted score, weight]
    for i, p in enumerate(parts):
        for a in FAMILIES[p.family]:
            if a.key not in p.areas:
                continue
            w = shares[i] * a.weight
            sums[a.practical][0] += w * p.areas[a.key]
            sums[a.practical][1] += w
    def mean(flag: bool) -> float | None:
        s, w = sums[flag]
        return None if w <= 0 else _round1(s / w)
    return mean(True), mean(False)


def must_have_missed(parts: list[PartScore], main_family: str) -> bool:
    """The must-have is judged on the MAIN part only: the first core (non-bonus), non-swapped part of the main family in plan order (`parts` is in
    plan order; the last one when every such part was swapped). Behavioural and hiring-manager: met when any ran core part of the family meets it. Bonus parts never count."""
    main = [p for p in parts if p.family == main_family and not p.bonus]
    if not main:
        return False
    if main_family in _ANY_PART_MUST_HAVE:
        return not any(p.must_have_met for p in main)
    chosen = next((p for p in main if not p.swapped), main[-1])      # an abandoned problem is the main part only when every one was
    return not chosen.must_have_met


def compute(parts: list[PartScore], adjustments: list[Adjustment], pass_mark: float,
            main_family: str, auto_fail: bool) -> ScoreResult:
    weighted = [(i, p) for i, p in enumerate(parts) if p.share > 0 and not p.bonus]
    total_share = sum(p.share for _, p in weighted)
    shares = {i: (p.share / total_share if total_share > 0 else 0.0) for i, p in weighted}
    base = sum(shares[i] * _part_score(p) for i, p in weighted) if weighted else 1.0

    bonus_total = min(sum(a.delta for a in adjustments if a.delta > 0), BONUS_CAP)
    penalty_total = sum(a.delta for a in adjustments if a.delta < 0)
    adjusted = base + bonus_total + penalty_total

    cap_note: str | None = None
    capped = adjusted
    if must_have_missed(parts, main_family):
        cap_value = pass_mark - 0.5
        if adjusted > cap_value:
            capped = cap_value
            cap_note = f"Capped at {cap_value:.1f}: {MUST_HAVE[main_family]}"

    score = min(10.0, max(1.0, _round1(capped)))
    verdict = verdict_for(score, pass_mark)
    if auto_fail:
        outcome: Outcome = "auto_fail"
        if verdict in ("Strong Hire", "Hire", "Lean Hire", "Lean No Hire"):
            verdict = "No Hire"
    else:
        outcome = "passed" if score >= pass_mark else "below_pass"

    practical, theory = _split(parts, {i: shares.get(i, 0.0) for i in range(len(parts))})
    return ScoreResult(base=_round1(base), bonus_total=_r(bonus_total), penalty_total=_r(penalty_total),
                       cap=cap_note, score=score, outcome=outcome, verdict=verdict,
                       practical=practical, theory=theory)


def unscorable_reason(end_reason: str, core_planned_min: float, core_ran_min: float,
                      candidate_ended: bool, has_turns: bool) -> str | None:
    if end_reason == "technical":
        return "The round ended because of a technical problem."
    if not has_turns:
        return "Nothing was recorded from the round."
    if not candidate_ended and core_planned_min > 0 and core_ran_min < 0.4 * core_planned_min:
        return "Too little of the round ran to score it fairly."
    return None
