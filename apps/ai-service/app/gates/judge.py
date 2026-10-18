"""Quick-screen judge on Jev: one score question per rubric dimension (condensed from scripts/judge_blueprints.py).

A cheap triage next to the Gemini judge, never a replacement: it gives no walkthroughs and no defects.
The rubric is a PRODUCT IP draft; these levels condense its anchors and add no new criteria."""
from __future__ import annotations

import os

from app.llm.decisions import Decision, score

_INTRO = "Judge this mock interview blueprint as a senior interviewer at the named company for the named role and level. "


def _q(what: str, levels: list[str]) -> dict:
    return score(_INTRO + what, levels)


JUDGE_QUESTIONS: dict[str, dict] = {
    "realism": _q("Would a candidate believe this is the company's real interview for this round (format, question choice, tone)?", [
        "Clearly not this company's interview; format, questions and tone are wrong.",
        "Mostly generic; a candidate would doubt it is the real process.",
        "Plausible, but several things feel artificial.",
        "Close to the real interview with small tells.",
        "A candidate would believe it is the real round."]),
    "level_fit": _q("Are the questions, expectations and scenarios right for this level (a fresher is not asked to lead teams)?", [
        "Badly wrong level; far too hard or far too easy.",
        "Several questions or expectations are off level.",
        "Mostly right level with a few mismatches.",
        "Right level with a minor slip.",
        "Every question and expectation fits the level."]),
    "company_fit": _q("Does it stay inside this company (no other company's name, principles or values) and use what is known about it?", [
        "Names or uses another company's principles or values.",
        "Generic; uses little of what is known about the company.",
        "Stays inside the company but uses little of what is known.",
        "Stays inside the company and uses known specifics in places.",
        "Entirely this company and clearly uses what is known about it."]),
    "candidate_grounding": _q("Does it use only real facts about the candidate (no invented employer, project or domain)?", [
        "Invents employers, projects or domains the candidate does not have.",
        "Some invented or misattributed candidate facts.",
        "No inventions, but personalization is thin or slightly stretched.",
        "Grounded in real candidate facts with a minor stretch.",
        "Every personal reference is a real fact about the candidate."]),
    "branch_logic": _q("Does every branch's action and line fit its condition, so the live interviewer reacts the way a good human would?", [
        "Branches contradict their conditions or are missing.",
        "Several branches react in ways a human would not.",
        "Most branches fit; some are off or vague.",
        "Branches fit their conditions with a minor gap.",
        "Every branch reacts as a good human interviewer would."]),
    "hints": _q("Do hint ladders escalate gently, help without giving the answer away, and stay correct?", [
        "Hints are wrong or give the answer away at once.",
        "Hints barely escalate or often leak the answer.",
        "Hints are correct but uneven in escalation.",
        "Hints escalate gently with a minor leak or gap.",
        "Hints escalate gently, help without leaking, and are correct."]),
    "answer_key": _q("Are the answer keys correct (approaches, complexity, must-cover points) and useful for grading?", [
        "Keys are wrong and would grade candidates incorrectly.",
        "Keys have errors or miss key points.",
        "Keys are mostly correct but thin for grading.",
        "Keys are correct and useful with a minor gap.",
        "Keys are correct, complete and useful for grading."]),
    "spoken_naturalness": _q("Do openings, transitions and lines sound like a person speaking, not a document?", [
        "Reads like a document; no one would say it aloud.",
        "Mostly stiff written language.",
        "Mixed; some lines sound spoken, many do not.",
        "Sounds spoken with a few stiff lines.",
        "Sounds like a person speaking throughout."]),
    "flow_and_timing": _q("Do phases, timeboxes, reserves and the order of questions make a coherent session?", [
        "Incoherent order or timing; the session cannot run.",
        "Timeboxes or ordering are clearly off.",
        "Workable but with timing or ordering problems.",
        "Coherent session with a minor timing issue.",
        "Phases, timeboxes, reserves and order make a coherent session."]),
    "persona_fits_shape": _q("Does the interviewer's manner (persona style and disposition) fit the round's shape: brisk for a round that goes straight to the work, warm for one that opens with a longer chat?", [
        "Manner clashes with the shape; a warm chatty persona on a brisk round or the reverse.",
        "Manner mostly mismatches the shape.",
        "Manner is neutral; it neither fits nor clashes with the shape.",
        "Manner fits the shape with a minor slip.",
        "Manner fits the shape throughout."]),
    "overall": _q("Overall, how close is this blueprint to a real interview at this company?", [
        "Would mislead or confuse the candidate.",
        "Poor; artificial in many places.",
        "Usable but clearly artificial in places.",
        "Good; only small tells.",
        "Indistinguishable from a strong real interviewer at this company."]),
}


def _to_1_5(value: float) -> int:
    return max(1, min(5, round(value + 1)))


def verdict_from(decision: Decision) -> dict:
    overall = decision.score_of("overall")
    if overall is None:
        return {"error": "jev gave no overall score"}
    dims = {}
    for name in JUDGE_QUESTIONS:
        if name == "overall":
            continue
        s = decision.score_of(name)
        if s is not None:
            dims[name] = {"score": _to_1_5(s), "why": "jev quick screen"}
    return {"overall": _to_1_5(overall), "dimensions": dims, "walkthroughs": [], "defects": []}


def compare(jev_rows: list[dict], llm_rows: list[dict]) -> dict:
    """Mean absolute error of Jev's screen against the LLM judge, joined on run_id (rows with a verdict only)."""
    llm = {r["run_id"]: r for r in llm_rows if "overall" in r}
    pairs = [(j, llm[j["run_id"]]) for j in jev_rows if "overall" in j and j.get("run_id") in llm]
    dim_errs: dict[str, list[float]] = {}
    for j, l in pairs:
        for d, v in (j.get("dimensions") or {}).items():
            if d in (l.get("dimensions") or {}):
                dim_errs.setdefault(d, []).append(abs(v["score"] - l["dimensions"][d]["score"]))
    return {"n": len(pairs),
            "overall_mae": sum(abs(j["overall"] - l["overall"]) for j, l in pairs) / len(pairs) if pairs else None,
            "dimension_mae": {d: sum(e) / len(e) for d, e in dim_errs.items()}}


def compare_target_ok(compare_path: str, out_dir: str) -> bool:
    """False when the --compare file is the judge.json this run is about to write (it would overwrite its own reference)."""
    return os.path.realpath(compare_path) != os.path.realpath(os.path.join(out_dir, "judge.json"))
