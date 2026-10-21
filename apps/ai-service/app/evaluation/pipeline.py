"""Evaluation run orchestration (spec §6, §7, §8, §11.1): start a run in the background, grade the round, compute the score and
store the report as the session's next version. One running run per session (store index); cancellable; time-boxed.

Owner rule: a result is always available. Part grading salvages what it can (`graders.salvage_part`), a synthesis the model cannot
produce is built in code (`graders.fallback_synthesis`), a live run not finalized on the first attempt is graded from its checkpoint on
any later one. Error codes: `llm_unavailable`, `timeout`, `interrupted`, `live_not_final` and `internal_error` (transient: the API
retries), `invalid_grades` and `missing_inputs` (the API retries these too, hourly; only `stale_report` is final). A dispute run re-checks one target and stores version + 1."""
from __future__ import annotations

import asyncio
import logging
import uuid
from dataclasses import asdict

from app.blueprint import store as blueprint_store
from app.config import Settings
from app.evaluation import graders, inputs, practice, report, store
from app.evaluation.graders import GradingError, build_eval_chats
from app.evaluation.models import EvaluationRunRequest, PartGrade, SessionMeta, Synthesis
from app.evaluation.score import (Adjustment, PartScore, ScoreResult, adjustments as make_adjustments, compute, part_shares,
                                  unscorable_reason)
from app.evaluation.weights import EVAL_VERSION, EVAL_WEIGHTS_VERSION, FAMILIES, MUST_HAVE, areas_for

logger = logging.getLogger(__name__)

_TASKS: dict[str, asyncio.Task] = {}
# Tests replace this to inject fake chats: `chat_factory(settings) -> (chat_a, chat_b, chat_c)`.
chat_factory = build_eval_chats
_CODE_FAMILIES = frozenset({"dsa", "online-assessment", "lld"})
_NON_CORE = frozenset({"knowledge", inputs.END_QUESTIONS})


# Failures the API retries: the model was unreachable, the run was cut short, or the live run was not finalized yet.
TRANSIENT_CODES = frozenset({"llm_unavailable", "timeout", "interrupted", "live_not_final", "internal_error"})


class RunError(Exception):
    def __init__(self, code: str, message: str = "") -> None:
        super().__init__(f"{code}: {message}" if message else code)
        self.code, self.message = code, message or code


# ---------------------------------------------------------------- start / cancel

async def start_run(req: EvaluationRunRequest, settings: Settings) -> dict:
    run_id = "evr_" + uuid.uuid4().hex[:20]
    doc = {
        "run_id": run_id, "session_id": req.session_id, "candidate_id": req.candidate_id, "trigger": req.trigger, "status": "running",
        "company": req.meta.company, "role": req.meta.role, "level": req.meta.level, "round_type": req.meta.round_type,
        "request": req.model_dump(mode="json"), "created_at": store.iso(), "updated_at": store.iso(), "error": None, "result": None,
        "outcome": None, "raw": None, "arithmetic": None, "eval_version": EVAL_VERSION, "expires_at": None,
    }
    try:
        await store.insert_run(doc)
    except store.RunAlreadyActive as live:
        return {"run_id": live.run_id, "status": "running", "existing": True}
    task = asyncio.create_task(_execute(run_id, req, settings))
    _TASKS[run_id] = task
    task.add_done_callback(lambda _t: _TASKS.pop(run_id, None))
    return {"run_id": run_id, "status": "running", "existing": False}


async def cancel_run(run_id: str, settings: Settings) -> bool:
    task = _TASKS.get(run_id)
    if task is not None:
        task.cancel()
        return True
    run = await store.get_run(run_id, full=False)
    if run and run.get("status") == "running":
        await store.finish_run(run_id, "cancelled", {"error": {"code": "cancelled", "message": "cancelled", "transient": False}},
                               settings.evaluation_run_retention_days)
        return True
    return False


# ---------------------------------------------------------------- execute

_SLOTS: asyncio.Semaphore | None = None
_SLOTS_SIZE = 0


def _slots(settings: Settings) -> asyncio.Semaphore:
    """Runs grading at once; the rest wait their turn, still "running"."""
    global _SLOTS, _SLOTS_SIZE
    if _SLOTS is None or _SLOTS_SIZE != settings.evaluation_max_parallel_runs:
        _SLOTS, _SLOTS_SIZE = asyncio.Semaphore(settings.evaluation_max_parallel_runs), settings.evaluation_max_parallel_runs
    return _SLOTS


def _error(code: str, message: str) -> dict:
    return {"code": code, "message": message[:600], "transient": code in TRANSIENT_CODES}


async def _execute(run_id: str, req: EvaluationRunRequest, settings: Settings) -> None:
    retention = settings.evaluation_run_retention_days
    try:
        async with _slots(settings):
            started = asyncio.get_running_loop().time()
            async with asyncio.timeout(settings.evaluation_run_timeout_seconds):
                patch = await (_dispute_pipeline if req.trigger == "dispute" else _pipeline)(run_id, req, settings)
    except asyncio.CancelledError:
        await store.finish_run(run_id, "cancelled", {"error": _error("cancelled", "cancelled")}, retention)
        return
    except TimeoutError:
        msg = f"the run exceeded {settings.evaluation_run_timeout_seconds:g}s"
        await store.finish_run(run_id, "failed", {"error": _error("timeout", msg)}, retention)
        return
    except RunError as exc:
        logger.warning("[evaluation] run %s failed: %s", run_id, exc)
        await store.finish_run(run_id, "failed", {"error": _error(exc.code, exc.message)}, retention)
        return
    except GradingError as exc:
        logger.warning("[evaluation] run %s failed: %s", run_id, exc)
        await store.finish_run(run_id, "failed", {"error": _error(exc.code, exc.detail or exc.code)}, retention)
        return
    except Exception as exc:  # noqa: BLE001 - a bug must fail the run, never wedge it
        logger.exception("[evaluation] run %s crashed", run_id)
        await store.finish_run(run_id, "failed", {"error": _error("internal_error", f"{type(exc).__name__}: {exc}")}, retention)
        return
    elapsed = int((asyncio.get_running_loop().time() - started) * 1000)
    await store.finish_run(run_id, "completed", {**patch, "duration_ms": elapsed}, retention)


# ---------------------------------------------------------------- shared pieces

def _result(version: int, outcome: str, score: float | None, verdict: str | None, pass_mark: float) -> dict:
    return {"version": version, "outcome": outcome, "score": score, "verdict": verdict, "pass_mark": pass_mark}


def _structure(run: dict) -> tuple[dict[str, str], dict[str, dict]]:
    items = (run.get("checkpoint") or {}).get("items") or []
    parents = {i["item_id"]: i["parent"] for i in items if i.get("kind") == "thread" and i.get("parent")}
    return parents, {i["item_id"]: i for i in items}  # type: ignore[return-value]


def _owner(item_id: str | None, parents: dict[str, str]) -> str | None:
    seen = 0
    while item_id in parents and seen < 5:
        item_id, seen = parents[item_id], seen + 1
    return item_id


def hint_turn_ids(turns: list[dict], visible: list[inputs.VisibleTurn]) -> list[int]:
    """Interviewer turns where a hint step was given (a successful `give_hint` call on the turn), in order."""
    shown = {v.turn_id for v in visible}
    out = []
    for t in sorted(turns, key=lambda d: int(d.get("seq") or 0)):
        if t.get("speaker") == "interviewer" and int(t.get("seq") or 0) in shown and any(
                c.get("name") == "give_hint" and (c.get("result") or {}).get("ok", True) for c in t.get("tool_calls") or []):
            out.append(int(t["seq"]))
    return out


def _core_minutes(parts: list[inputs.PartInput], run: dict) -> tuple[float, float]:
    """Planned minutes and minutes run of the core parts that ran. A part's run time is read from its item's clock marks;
    without them a part with candidate turns counts as run in full and one without as not run."""
    planned = ran_min = 0.0
    by_id = {i["item_id"]: i for i in (run.get("checkpoint") or {}).get("items") or []}
    for p in parts:
        if not p.ran or p.family in _NON_CORE or not p.planned_min:
            continue
        planned += p.planned_min
        item = by_id.get(p.part_id) or {}
        a, b = item.get("started_at"), item.get("ended_at")
        if isinstance(a, (int, float)) and isinstance(b, (int, float)) and b >= a:
            ran_min += min(p.planned_min, (b - a) / 60.0)
        elif any(t.speaker == "candidate" for t in p.turns):
            ran_min += p.planned_min
    return planned, ran_min


def _graded(parts: list[inputs.PartInput]) -> list[inputs.PartInput]:
    return [p for p in parts if p.ran and p.family in FAMILIES]


def _shares(parts: list[inputs.PartInput], round_minutes: float) -> dict[str, float]:
    """Round shares of the graded parts. A bonus part gets none (a reached bonus counts only through the +0.3 bonus adjustment); its
    planned minutes still count when the parts without planned minutes split what is left of the round."""
    scored = _graded(parts)
    raw = part_shares({p.part_id: p.planned_min for p in scored}, round_minutes)
    bonus = {p.part_id for p in scored if p.is_bonus}
    total = sum(v for k, v in raw.items() if k not in bonus)
    return {k: (0.0 if k in bonus or total <= 0 else v / total) for k, v in raw.items()}


def _part_scores(parts: list[inputs.PartInput], merged: dict[str, PartGrade], shares: dict[str, float]) -> list[PartScore]:
    out = []
    for p in _graded(parts):
        g = merged.get(p.part_id)
        if g is None:
            continue
        needs = p.family in MUST_HAVE and not p.is_bonus
        out.append(PartScore(p.part_id, p.family, shares.get(p.part_id, 0.0), {a.key: a.score for a in g.areas},
                             g.must_have_met if needs else True, bonus=p.is_bonus, swapped=p.swapped))
    return out


def _main_family(scores: list[PartScore]) -> str:
    core = [s for s in scores if s.family not in _NON_CORE and not s.bonus] or scores
    return max(core, key=lambda s: s.share).family if core else "dsa"


def _locate(adjs: list[Adjustment], raw_turns: list[dict], hint_turns: list[int]) -> list[Adjustment]:
    """Link each adjustment to the moment behind it: a hint to the interviewer turn that gave it, an event with a time to the last turn
    said before it."""
    stamps = [(float(t["at"]), int(t["seq"])) for t in raw_turns if isinstance(t.get("at"), (int, float)) and not isinstance(t.get("at"), bool)]
    hint_iter = iter(hint_turns)
    for a in adjs:
        if a.kind == "hint" and a.turn_id is None:
            a.turn_id = next(hint_iter, None)
        elif a.turn_id is None and a.at is not None and (e := report.epoch(a.at)) is not None:
            before = [seq for at, seq in stamps if at <= e]
            a.turn_id = before[-1] if before else None
    return adjs


def _assemble(req: EvaluationRunRequest, parts, visible, run: dict, merged: dict[str, PartGrade], synthesis: Synthesis,
              stats: inputs.DeliveryStats, adjs: list[Adjustment], prac: dict, hint_turns: list[int], disputes: list[dict],
              auto_fail: bool) -> tuple[dict, ScoreResult, list[PartScore], str]:
    shares = _shares(parts, req.meta.round_minutes)
    scores = _part_scores(parts, merged, shares)
    main = _main_family(scores)
    result = compute(scores, adjs, req.meta.pass_mark, main, auto_fail)
    doc = report.build_report(req.meta, parts, merged, synthesis, result, adjs, stats, visible, prac, run, req.previous_areas,
                              shares=shares, hint_turns=hint_turns, disputes=disputes)
    return doc, result, scores, main


def _adj_doc(a: Adjustment) -> dict:
    return asdict(a)


async def _load(req: EvaluationRunRequest):
    run, turns, evidence = await store.load_live(req.session_id)
    bp = await blueprint_store.current_blueprint(req.session_id)
    if run is None or bp is None:
        raise RunError("missing_inputs", "no live run or no blueprint for this session")
    if not run.get("ended_at") and not run.get("end_reason") and req.trigger == "completion":
        # the live worker writes its final record just before it ends the session in the API: the first attempt (trigger "completion",
        # which always carries `ended_reason`) always waits for it. A later attempt (retry, reconcile, admin) grades the saved
        # checkpoint and turns, using `ended_reason` as the end reason.
        raise RunError("live_not_final", "the live run has not been finalized yet")
    if not run.get("end_reason") and req.ended_reason:
        run = {**run, "end_reason": req.ended_reason}          # the session's own end reason, when the live record lacks one
    visible = inputs.visible_transcript(turns)
    parts = inputs.build_parts(bp, run, visible, evidence)
    return run, turns, bp, visible, parts


# ---------------------------------------------------------------- the grading run

async def _pipeline(run_id: str, req: EvaluationRunRequest, settings: Settings) -> dict:
    run, turns, bp, visible, parts = await _load(req)
    meta = req.meta
    parents, _ = _structure(run)

    planned, ran_min = _core_minutes(parts, run)
    # An auto-fail (the interviewer ended the round for conduct or integrity) is judged first: a round ended that way is never
    # "too short to score" (spec §8.4, §8.6). A technical end stays unscorable.
    reason = report.auto_fail_reason(run)
    why = unscorable_reason(run.get("end_reason") or "", planned, ran_min,
                            run.get("end_reason") == "candidate_ended" or reason is not None,
                            any(v.speaker == "candidate" for v in visible))
    version = await store.next_version(req.session_id)
    if why:
        doc = report.unscorable_report(meta, visible, why)
        await store.save_evaluation({"session_id": req.session_id, "candidate_id": req.candidate_id, "version": version, "run_id": run_id,
                                     "created_at": store.iso(), "outcome": "unscorable", "report": doc, "disputes": []})
        return {"result": _result(version, "unscorable", None, None, meta.pass_mark), "outcome": "unscorable"}

    coding_items = {p.part_id for p in parts if p.family in _CODE_FAMILIES and p.code is not None}
    stats = inputs.delivery_stats(turns, visible, coding_items=coding_items, parents=parents)
    pastes: dict[str, list[dict]] = {}
    for p in (run.get("checkpoint") or {}).get("pastes") or []:
        if (o := _owner(p.get("item_id"), parents)) is not None:
            pastes.setdefault(o, []).append(p)

    chat_a, chat_b, chat_c = chat_factory(settings)
    bank = await practice.load_bank(meta.round_type)                    # loaded once: the tag vocabulary and the practice step both use it
    vocab = practice.tag_vocabulary(bank)
    graded = await graders.grade_round(chat_a, chat_b, chat_c, parts, meta, pastes=pastes, profile=req.candidate_profile or None, vocab=vocab)
    merged = graded.merged
    synthesis, fallback_error = await graders.synthesize_or_fallback(chat_a, parts, merged, stats, meta, vocab)

    synthesis_fallback = fallback_error is not None
    ran = [p for p in parts if p.ran]
    events = {pid: g.events for pid, g in merged.items()}
    events["end_questions_bonus"] = synthesis.end_questions.bonus      # type: ignore[assignment]
    hint_turns = hint_turn_ids(turns, visible)
    titles = {p.part_id: p.title for p in parts}
    adjs = _locate(make_adjustments(inputs.adjustment_inputs(run, ran, events), titles), turns, hint_turns)
    if not synthesis.topic_gaps:
        synthesis.topic_gaps = report.weak_question_gaps(parts, merged)
    report.inherit_bank_tags(synthesis.topic_gaps, parts, merged, vocab)
    all_gaps = [*synthesis.topic_gaps, *report.abandoned_gaps(parts, vocab)]
    prac = await practice.suggest(all_gaps, meta.round_type, meta.company, req.exclusions, max_difficulty=meta.difficulty,
                                  fallback_topics=report.round_topics(parts), default_difficulty=report.main_difficulty(parts),
                                  sources=report.source_maps(report.gap_entries(all_gaps), parts, merged), pool=bank)

    doc, result, scores, main = _assemble(req, parts, visible, run, merged, synthesis, stats, adjs, prac, hint_turns, [], reason is not None)
    if synthesis_fallback:
        # the fallback summary quotes the score, which depends on the rest of the synthesis (no end-question bonus): assemble twice
        synthesis = graders.fallback_synthesis(parts, merged, meta, result.score, result.verdict)
        if not synthesis.topic_gaps:
            synthesis.topic_gaps = report.weak_question_gaps(parts, merged)
        doc, result, scores, main = _assemble(req, parts, visible, run, merged, synthesis, stats, adjs, prac, hint_turns, [], reason is not None)
    arithmetic = {"pass_mark": meta.pass_mark, "main_family": main, "auto_fail": reason is not None, "auto_fail_reason": reason, "synthesis_fallback": synthesis_fallback, "synthesis_fallback_error": fallback_error,
                  "salvaged": sorted(pid for pid, g in merged.items() if g.salvage_notes), "parts": [asdict(s) for s in scores], "adjustments": [_adj_doc(a) for a in adjs],
                  "base": result.base, "bonus_total": result.bonus_total, "penalty_total": result.penalty_total, "cap": result.cap,
                  "score": result.score, "verdict": result.verdict}
    await store.save_evaluation({
        "session_id": req.session_id, "candidate_id": req.candidate_id, "version": version, "run_id": run_id, "created_at": store.iso(),
        "outcome": result.outcome, "report": doc, "merged": {k: g.model_dump(mode="json") for k, g in merged.items()},
        "raw": {pid: {v: g.model_dump(mode="json") for v, g in by.items()} for pid, by in graded.raw.items()},
        "synthesis": synthesis.model_dump(mode="json"), "stats": asdict(stats), "practice": prac, "hint_turns": hint_turns,
        "adjustments": [_adj_doc(a) for a in adjs], "auto_fail": reason is not None, "disputes": [],
        "request": req.model_dump(mode="json"),
    })
    raw = {"disagreements": graded.disagreements, "synthesis_fallback": synthesis_fallback, "synthesis_fallback_error": fallback_error,
           "salvaged": {pid: g.salvage_notes for pid, g in merged.items() if g.salvage_notes},
           "graders": {pid: {v: g.model_dump(mode="json") for v, g in by.items()} for pid, by in graded.raw.items()}}
    await store.update_run(run_id, {"raw": raw, "arithmetic": arithmetic, "outcome": result.outcome})
    return {"result": _result(version, result.outcome, result.score, result.verdict, meta.pass_mark), "outcome": result.outcome}


# ---------------------------------------------------------------- dispute

def _shift_part(g: PartGrade, delta: float) -> None:
    for a in g.areas:
        a.score = round(min(10.0, max(1.0, a.score + delta)), 1)


async def _dispute_pipeline(run_id: str, req: EvaluationRunRequest, settings: Settings) -> dict:
    d = req.dispute
    if d is None:
        raise RunError("missing_inputs", "a dispute run needs a dispute")
    cur = await store.current_evaluation(req.session_id)
    if cur is None or not cur.get("merged"):
        raise RunError("missing_inputs", "there is no graded evaluation to re-check")
    if int(d.report_version) != int(cur["version"]):
        raise RunError("stale_report", f"the dispute is about version {d.report_version}; the current report is version {cur['version']}")
    run, turns, bp, visible, parts = await _load(req)
    merged = {k: PartGrade.model_validate(v) for k, v in cur["merged"].items()}
    raw = {pid: [PartGrade.model_validate(g) for g in by.values()] for pid, by in (cur.get("raw") or {}).items()}

    part_id, old = None, None
    if d.target_type == "question":
        part_id, qid = report.question_ids(merged).get(d.target_id, (None, None))
        if part_id is not None:
            old = next(q.score for q in merged[part_id].questions if q.id == qid)
            d = d.model_copy(update={"target_id": qid})
    else:
        owners = [p for p in _graded(parts) if any(a.key == d.target_id for a in merged.get(p.part_id, PartGrade(part_id="", must_have_met=True)).areas)]
        if owners:
            shares = _shares(parts, req.meta.round_minutes)
            part_id = max(owners, key=lambda p: shares.get(p.part_id, 0)).part_id
            old = next(a.score for a in merged[part_id].areas if a.key == d.target_id)
    if part_id is None or part_id not in raw:
        raise RunError("invalid_grades", f"no {d.target_type} {d.target_id} in this evaluation")
    part = next(p for p in parts if p.part_id == part_id)

    chat_c = chat_factory(settings)[2]
    decision, new_score, explanation = await graders.recheck(chat_c, part, raw[part_id], d, req.meta)
    new_score = max(new_score, old)                                   # a re-check keeps or raises, never lowers
    if decision == "revised" and new_score > old:
        g = merged[part_id]
        if d.target_type == "question":
            next(q for q in g.questions if q.id == d.target_id).score = new_score
            _shift_part(g, (new_score - old) / max(1, len(g.questions)))   # the part's areas move by the question's share of the part (R7)
        else:
            next(a for a in g.areas if a.key == d.target_id).score = new_score
    else:
        decision, new_score = "upheld", old

    disputes = list(cur.get("disputes") or []) + [{
        "target_type": req.dispute.target_type, "target_id": req.dispute.target_id, "reason": req.dispute.reason,
        "decision": decision, "old_score": old, "new_score": new_score, "explanation": explanation,
        "report_version": req.dispute.report_version, "created_at": store.iso()}]
    synthesis = Synthesis.model_validate(cur["synthesis"])
    stats = inputs.DeliveryStats(**cur["stats"])
    adjs = [Adjustment(**a) for a in cur.get("adjustments") or []]
    doc, result, scores, main = _assemble(req, parts, visible, run, merged, synthesis, stats, adjs, cur.get("practice") or {},
                                          cur.get("hint_turns") or [], disputes, bool(cur.get("auto_fail")))
    version = await store.next_version(req.session_id)
    await store.save_evaluation({**{k: v for k, v in cur.items() if k not in ("report", "merged", "disputes", "version", "run_id", "created_at", "outcome")},
                                 "session_id": req.session_id, "candidate_id": req.candidate_id, "version": version, "run_id": run_id,
                                 "created_at": store.iso(), "outcome": result.outcome, "report": doc,
                                 "merged": {k: g.model_dump(mode="json") for k, g in merged.items()}, "disputes": disputes})
    await store.update_run(run_id, {"outcome": result.outcome, "arithmetic": {"dispute": disputes[-1], "score": result.score}})
    return {"result": _result(version, result.outcome, result.score, result.verdict, req.meta.pass_mark), "outcome": result.outcome}
