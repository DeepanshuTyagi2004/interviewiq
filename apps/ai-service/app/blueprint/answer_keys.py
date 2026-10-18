"""Stage 3, answer keys (spec §6 stage 3): what a correct answer looks like, built at prep time and
cached per problem (round type + slug + content hash + key version: KEY_VERSION for DSA, EXTRAS_KEY_VERSION
otherwise). Keys are shared across companies, so non-DSA keys are written company-neutral.

- DSA: an LLM writes approaches, complexity, insights, wrong paths, edge cases and a Python reference
  solution, which must reproduce the problem's two source examples in the sandbox (one repair round).
  A problem whose key can't pass is swapped for the slot's next candidate; failed keys are never cached.
- Other rounds: the bank's own expected-design / strong-answer content is the base; an LLM adds
  must-cover points, key insights, common wrong paths and edge cases.
"""
from __future__ import annotations

import asyncio
import json
import logging

from pydantic import ValidationError

from app.blueprint import prompts as P
from app.blueprint import store
from app.blueprint.context import Context
from app.blueprint.llm import run_all, structured
from app.blueprint.models import DsaAnswerKey, DsaKeyReview, KeyExtras
from app.blueprint.selection import SlotPlan, next_fallback
from app.blueprint.trace import RunTrace, StageError
from app.config import Settings
from app.gates.core import run_gated
from app.gates.keys import REVIEW_QUESTIONS, key_state
from app.gates.log import build_gate
from app.questions.content.sandbox import run_collect, same, same_unordered

STAGE = "answer_keys"
logger = logging.getLogger(__name__)

_BASE_FIELDS = {
    "system-design": ("expected_design", "trade_offs", "deep_dives", "strong_answer_summary", "red_flags"),
    "lld": ("expected_design", "sample_api", "strong_answer_summary", "red_flags"),
    "behavioural": ("star_guide", "strong_answer_summary", "weak_answer_summary", "red_flags", "follow_up_probes",
                    "competency", "principle"),
    "hiring-manager": ("star_guide", "strong_answer_summary", "weak_answer_summary", "red_flags", "follow_up_probes",
                       "competency", "deep_dive_guidance"),
}


class KeyFailed(Exception):
    pass


def _short(value) -> str:
    text = json.dumps(value, ensure_ascii=False, default=str)
    return text if len(text) <= 160 else text[:160] + "…"


async def _check_solution(key: DsaAnswerKey, content: dict, settings: Settings) -> list[str]:
    examples = content.get("examples") or []
    if not examples:
        return ["the problem has no examples to check against"]
    sol = key.reference_solution
    run = await asyncio.to_thread(run_collect, sol.code, sol.entry_point, [e.get("args") or {} for e in examples],
                                  timeout_seconds=10.0)
    if not run.ran or run.error:
        return [f"the solution failed to run: {run.error}"]
    eq = same_unordered if content.get("answer_order_irrelevant") else same
    problems = []
    for i, (e, out) in enumerate(zip(examples, run.outputs), start=1):
        if not out.get("ok"):
            problems.append(f"example {i} {_short(e.get('args'))}: raised {out.get('error')}")
        elif not eq(e.get("expected"), out.get("result")):
            problems.append(f"example {i} {_short(e.get('args'))}: expected {_short(e.get('expected'))}, got {_short(out.get('result'))}")
    return problems


async def _dsa_key(llm, trace: RunTrace, problem: dict, settings: Settings) -> dict:
    content = problem.get("content") or {}
    label = f"answer_key:{problem['slug']}"
    key = await structured(llm, trace, STAGE, label, P.KEY_SYSTEM, P.dsa_key_prompt(problem), DsaAnswerKey, settings)
    problems = await _check_solution(key, content, settings)
    trace.llm(STAGE, {"label": f"sandbox:{problem['slug']}", "attempt": 1, "sandbox": True, "valid": not problems,
                      "validation_errors": problems})
    if problems:
        key = await structured(llm, trace, STAGE, label + ":repair", P.KEY_SYSTEM,
                               P.dsa_key_repair(problem, problems, key.model_dump(mode="json")), DsaAnswerKey, settings)
        problems = await _check_solution(key, content, settings)
        trace.llm(STAGE, {"label": f"sandbox:{problem['slug']}", "attempt": 2, "sandbox": True, "valid": not problems,
                          "validation_errors": problems})
    if problems:
        raise KeyFailed("; ".join(problems)[:400])
    key.reference_solution.verified_against_examples = True
    return (await _review(llm, trace, problem, key, settings)).model_dump(mode="json")


_REVIEWABLE = ("approaches", "complexity_target", "key_insights", "common_wrong_paths", "edge_cases")


def _review_gate(settings):
    """The key-review gate, or None when the settings carry no gate config (or it is off/unusable)."""
    if getattr(settings, "key_review_gate_mode", "off") == "off":
        return None
    try:
        return build_gate(settings, "key_review")
    except Exception as exc:  # noqa: BLE001 - a broken gate never blocks key building
        logger.warning("[gate] key_review gate unavailable: %s", exc)
        return None


def _patch_of(review: DsaKeyReview) -> dict:
    fixes = review.model_dump(mode="json")
    return {f: fixes[f] for f in _REVIEWABLE if fixes.get(f) is not None} if review.errors else {}


async def _review(llm, trace: RunTrace, problem: dict, key: DsaAnswerKey, settings: Settings) -> DsaAnswerKey:
    """A reviewer pass over the prose the sandbox can't check (one key called an O(n) algorithm O(n^2)). Corrections
    replace whole fields; a review that can't run leaves the key unreviewed, and unreviewed keys are not cached.
    The decision gate may skip the pass when it is confident the key has no error."""
    label = f"answer_key:{problem['slug']}:review"
    key_json = key.model_dump(mode="json")

    async def call_llm():
        try:
            return await structured(llm, trace, STAGE, label, P.KEY_REVIEW_SYSTEM,
                                    P.dsa_key_review(problem, key_json), DsaKeyReview, settings)
        except StageError as exc:
            trace.llm(STAGE, {"label": label, "attempt": 0, "valid": False,
                              "validation_errors": [f"review skipped: {exc.code}"]})
            return None

    # The Jev state is built only for an active gate; a failure to build it runs the review ungated.
    gate, state = _review_gate(settings), None
    if gate is not None and gate.active:
        try:
            state = key_state(problem, key_json)
        except Exception as exc:  # noqa: BLE001 - the gate never blocks key building
            logger.warning("[gate] key_review state not built for %s: %s", problem.get("slug"), exc)
            gate = None
    gated = await run_gated(
        gate, state=state, questions=REVIEW_QUESTIONS,
        skip_question="has_error", call_llm=call_llm,
        label_of=lambda r: {"review_ran": r is not None, "errors": len(r.errors) if r else 0,
                            "patched": bool(r and _patch_of(r))},
        on_skip=lambda: "skipped",
        context={"slug": problem["slug"], "run_id": getattr(trace, "run_id", None)})
    review = gated.value
    if gated.skipped:
        trace.llm(STAGE, {"label": f"review:{problem['slug']}", "attempt": 0, "valid": True, "skipped_by_gate": True,
                          "p_has_error": gated.verdict.p_yes if gated.verdict else None})
        return key.model_copy(update={"reviewed": True, "review_source": "gate"})
    if review is None:
        return key
    patch = _patch_of(review)
    try:
        reviewed = DsaAnswerKey.model_validate({**key_json, **patch, "reviewed": True, "review_source": "llm"})
    except ValidationError:
        reviewed = key.model_copy(update={"reviewed": True, "review_source": "llm"})  # unusable corrections: keep the verified original
    trace.llm(STAGE, {"label": f"review:{problem['slug']}", "attempt": 1, "valid": True,
                      "corrections": [e.model_dump() for e in review.errors], "validation_errors": []})
    return reviewed


async def _extras_key(llm, trace: RunTrace, problem: dict, settings: Settings, band: str) -> dict:
    content = problem.get("content") or {}
    base = {f: content.get(f) for f in _BASE_FIELDS.get(problem["round_type"], ()) if content.get(f) not in (None, "", [], {})}
    if problem.get("category") not in P.PRINCIPLE_CATEGORIES:
        base.pop("principle", None)   # a generic question's "principle" is usually another company's (bank habit)
    extras = await structured(llm, trace, STAGE, f"answer_key:{problem['slug']}", P.KEY_SYSTEM,
                              P.extras_prompt(problem, base, band), KeyExtras, settings)
    return {"base": base, **extras.model_dump(mode="json")}


async def key_for(llm, trace: RunTrace, problem: dict, settings: Settings, *, bypass_cache: bool,
                  band: str = "early") -> tuple[dict, bool]:
    """(key, cache_hit). Raises KeyFailed when a DSA solution can't reproduce its examples. Non-DSA keys are
    per level band."""
    version = P.key_version(problem["round_type"], band)
    key_id = store.answer_key_id(problem["round_type"], problem["slug"], problem.get("content_hash"), version)
    if not bypass_cache:
        cached = await store.get_answer_key(key_id)
        if cached:
            return cached["key"], True
    if problem["round_type"] in ("dsa", "online-assessment"):
        key = await _dsa_key(llm, trace, problem, settings)
        if not key.get("reviewed"):
            return key, False          # used for this run, regenerated (and reviewed) next time
    else:
        key = await _extras_key(llm, trace, problem, settings, band)
    await store.save_answer_key({"key_id": key_id, "round_type": problem["round_type"], "slug": problem["slug"],
                                 "content_hash": problem.get("content_hash"), "key_version": version,
                                 "key": key, "created_at": store.iso()})
    return key, False


async def build_answer_keys(ctx: Context, plans: list[SlotPlan], llm, trace: RunTrace, settings: Settings) -> dict[str, dict]:
    """{slot_id: {"problem": <bank doc with content>, "answer_key": {key, key_version, cache_hit}}}.
    Swaps a slot's problem when its key fails; records every swap on the slot's selection trace."""
    taken = {p.pick.slug for p in plans if p.pick}
    lock = asyncio.Lock()
    sem = asyncio.Semaphore(settings.blueprint_parallel)
    bypass = ctx.request.options.bypass_answer_key_cache
    band = P.level_band(ctx.level)

    async def one(plan: SlotPlan) -> tuple[str, dict]:
        cand = plan.pick
        while cand is not None:
            problem = await store.bank_problem(cand.round_type, cand.slug)
            if problem and problem.get("content"):
                try:
                    async with sem:
                        key, hit = await key_for(llm, trace, problem, settings, bypass_cache=bypass, band=band)
                    plan.pick = cand
                    return plan.slot_id, {"problem": problem,
                                          "answer_key": {"key": key, "key_version": P.key_version(problem["round_type"], band),
                                                         "cache_hit": hit}}
                except KeyFailed as exc:
                    reason = str(exc)
            else:
                reason = "the problem has no stored content"
            async with lock:
                plan.swaps.append({"slug": cand.slug, "reason": reason})
                for row in plan.considered:
                    if row["slug"] == cand.slug:
                        row["outcome"], row["reason"] = "swapped_out", reason
                cand = next_fallback(plan, taken)
                if cand is not None:
                    taken.add(cand.slug)
                    for row in plan.considered:
                        if row["slug"] == cand.slug:
                            row["outcome"], row["reason"] = "picked", "swapped in after an answer-key failure"
        raise StageError("answer_key_failed", f"slot {plan.slot_id}: no candidate produced a passing answer key "
                                              f"({'; '.join(s['slug'] for s in plan.swaps)})")

    results = await run_all([one(p) for p in plans])
    return dict(results)
