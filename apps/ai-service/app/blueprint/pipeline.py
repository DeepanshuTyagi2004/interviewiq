"""Run orchestration (spec §4, §6): start a run in the background, execute the eight stages with a
full trace, store the blueprint as the session's next version, and finish the run with a stable
status and error code. One running run per session (store index); cancellable; time-boxed."""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import uuid

from app.blueprint import assemble as A
from app.blueprint import selection as S
from app.blueprint import store
from app.blueprint.answer_keys import build_answer_keys
from app.blueprint.context import build_context
from app.blueprint.llm import build_blueprint_llm
from app.blueprint.models import Blueprint, BlueprintRunRequest
from app.blueprint.policies import policies as policy_template
from app.blueprint.stages import (culture_minutes, persona_stage, personalization_stage, plan_arc, playbook_stage,
                                  time_plan)
from app.blueprint.vocabulary import is_culture_slot
from app.blueprint.trace import RunTrace, StageError
from app.config import Settings

logger = logging.getLogger(__name__)

_TASKS: dict[str, asyncio.Task] = {}
_LLM = None


def shared_llm(settings: Settings):
    """One client for every run, so the per-key quota ledger is shared (free-tier Groq)."""
    global _LLM
    if _LLM is None:
        _LLM = build_blueprint_llm(settings)
    return _LLM


async def close_shared_llm() -> None:
    global _LLM
    if _LLM is not None:
        await _LLM.aclose()
        _LLM = None


# ---------------------------------------------------------------- fingerprint

_EXCLUDED_FROM_HASH = {"trigger", "options", "input_hash", "input_parts", "rerun_of"}


def fingerprint(req: BlueprintRunRequest) -> tuple[str, dict[str, str]]:
    """Fallback when the API sent none: the same parts the API hashes (spec §5.1)."""
    data = req.model_dump(mode="json", exclude=_EXCLUDED_FROM_HASH)
    session = data.get("session") or {}
    parts = {
        "jd": data.get("job_description"), "round": data.get("round"), "brief": data.get("company_brief"),
        "profile": data.get("candidate_profile"), "exclusions": sorted(data.get("exclusions") or []),
        "level": [session.get("level"), session.get("round_type"), session.get("company"), session.get("role")],
    }
    hashed = {k: hashlib.sha256(json.dumps(v, sort_keys=True, default=str).encode()).hexdigest()[:16] for k, v in parts.items()}
    whole = hashlib.sha256(json.dumps(hashed, sort_keys=True).encode()).hexdigest()
    return whole, hashed


# ---------------------------------------------------------------- start / cancel


async def start_run(req: BlueprintRunRequest, settings: Settings) -> dict:
    if not req.input_hash:
        req.input_hash, req.input_parts = fingerprint(req)
    run_id = "bpr_" + uuid.uuid4().hex[:20]
    sess = req.session
    doc = {
        "run_id": run_id, "session_id": sess.session_id, "candidate_id": sess.candidate_id,
        "candidate_label": sess.candidate_label, "trigger": req.trigger, "status": "running", "stage": None,
        "company": sess.company, "company_key": store.company_key(sess.company), "role": sess.role,
        "level": sess.level, "round_type": sess.round_type.value, "input_hash": req.input_hash,
        "input_parts": req.input_parts, "request": req.model_dump(mode="json"), "options": req.options.model_dump(),
        "rerun_of": req.rerun_of, "created_at": store.iso(), "updated_at": store.iso(), "stages": RunTrace(run_id).stages,
        "error": None, "blueprint_version": None, "cached": False, "keep": False, "expires_at": None,
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
        await store.finish_run(run_id, "cancelled", {"error": {"code": "cancelled", "message": "cancelled"}},
                               settings.blueprint_run_retention_days)
        return True
    return False


# ---------------------------------------------------------------- execute


_SLOTS: asyncio.Semaphore | None = None
_SLOTS_SIZE = 0


def _slots(settings: Settings) -> asyncio.Semaphore:
    """Runs executing at once (the rest wait their turn, still "running" with every step pending): a
    few runs at full speed beat many runs crawling on the shared free-tier quota."""
    global _SLOTS, _SLOTS_SIZE
    if _SLOTS is None or _SLOTS_SIZE != settings.blueprint_max_parallel_runs:
        _SLOTS, _SLOTS_SIZE = asyncio.Semaphore(settings.blueprint_max_parallel_runs), settings.blueprint_max_parallel_runs
    return _SLOTS


async def _execute(run_id: str, req: BlueprintRunRequest, settings: Settings) -> None:
    trace = RunTrace(run_id)
    retention = settings.blueprint_run_retention_days
    try:
        async with _slots(settings):
            started = asyncio.get_running_loop().time()
            async with asyncio.timeout(settings.blueprint_run_timeout_seconds):
                outcome = await _pipeline(run_id, req, settings, trace)
    except asyncio.CancelledError:
        await trace.fail(trace.current, "cancelled", "cancelled")
        await store.finish_run(run_id, "cancelled", {"error": {"code": "cancelled", "message": "cancelled"}}, retention)
        return
    except TimeoutError:
        msg = f"the run exceeded {settings.blueprint_run_timeout_seconds:g}s"
        await trace.fail(trace.current, "timeout", msg)
        await store.finish_run(run_id, "failed", {"error": {"code": "timeout", "message": msg}}, retention)
        return
    except StageError as exc:
        logger.warning("[blueprint] run %s failed at %s: %s", run_id, trace.current, exc)
        await trace.fail(trace.current, exc.code, exc.message)
        await store.finish_run(run_id, "failed", {"error": {"code": exc.code, "message": exc.message, "stage": trace.current}}, retention)
        return
    except Exception as exc:  # noqa: BLE001 — a bug must fail the run, never wedge it
        logger.exception("[blueprint] run %s crashed", run_id)
        await trace.fail(trace.current, "internal_error", f"{type(exc).__name__}: {exc}")
        await store.finish_run(run_id, "failed", {"error": {"code": "internal_error", "message": f"{type(exc).__name__}: {exc}"}}, retention)
        return
    elapsed = int((asyncio.get_running_loop().time() - started) * 1000)
    await store.finish_run(run_id, "completed", {**outcome, "duration_ms": elapsed}, retention,
                           keep=bool(outcome.get("keep")))


async def _pipeline(run_id: str, req: BlueprintRunRequest, settings: Settings, trace: RunTrace) -> dict:
    session_id = req.session.session_id

    # Identical inputs reuse the session's current blueprint (spec §6, blueprint cache).
    if session_id and not req.options.bypass_blueprint_cache:
        current = await store.current_blueprint(session_id)
        if current and current.get("input_hash") == req.input_hash:
            for st in trace.stages:
                st["status"], st["summary"] = "skipped", {"skipped": f"inputs unchanged; reused blueprint v{current['version']}"}
            await trace.flush()
            return {"cached": True, "blueprint_version": current["version"], "briefing": current.get("briefing"), "keep": False}

    # 1. context
    await trace.start("context")
    other = await store.active_slugs_for_candidate(req.session.candidate_id, session_id) if not req.options.ignore_exclusions else set()
    ctx = build_context(req, other)
    await trace.done("context", summary=ctx.summary(), detail={"topic_sources": ctx.topic_sources,
                                                               "input_parts": req.input_parts, "input_hash": req.input_hash})

    # 2. selection
    await trace.start("selection")
    pool = await S.load_pool(ctx.round_type, culture=ctx.culture)
    seed = f"{session_id or run_id}"
    plans, summary = S.select(ctx, pool, S.weights(settings.blueprint_selection_weights), seed)
    trace.note("selection", slots=[p.trace() for p in plans], weights=S.weights(settings.blueprint_selection_weights))
    await trace.done("selection", summary=summary)

    llm = shared_llm(settings)

    # 3. answer keys (may swap problems; the selection trace is updated in place)
    await trace.start("answer_keys")
    keyed = await build_answer_keys(ctx, plans, llm, trace, settings)
    trace.note("selection", slots=[p.trace() for p in plans])
    hits = sum(1 for v in keyed.values() if v["answer_key"]["cache_hit"])
    await trace.done("answer_keys", summary={"hits": hits, "misses": len(keyed) - hits,
                                             "swaps": sum(len(p.swaps) for p in plans)},
                     detail={"keys": {sid: {"slug": v["problem"]["slug"], **v["answer_key"]} for sid, v in keyed.items()}})

    # 4. persona + arc
    await trace.start("persona")
    core_slots = sum(1 for p in plans if p.kind == "core" and not is_culture_slot(p.slot_id))
    culture_slots = sum(1 for p in plans if p.kind == "core" and is_culture_slot(p.slot_id))
    arc, per_slot, deep_dive = plan_arc(ctx, core_slots, culture_slots)
    culture_mins = culture_minutes(next(a.timebox_mins for a in arc if a.phase == "core"))
    timeboxes = {p.slot_id: culture_mins if is_culture_slot(p.slot_id) else per_slot for p in plans}
    persona = await persona_stage(ctx, arc, llm, trace, settings, seed=seed,
                                  time_plan=time_plan(ctx, plans, per_slot, culture_mins, deep_dive))
    await trace.done("persona", summary={"name": persona.persona.name, "style": persona.persona.style},
                     detail={"persona": persona.model_dump(mode="json"), "arc": [a.model_dump() for a in arc]})

    # 5. personalization
    await trace.start("personalization")
    personalization = await personalization_stage(ctx, llm, trace, settings,
                                                  planned=[p.pick.title for p in plans if p.pick], seed=seed)
    await trace.done("personalization", summary={"rapport_hooks": len(personalization.rapport_hooks),
                                                 "resume_probes": len(personalization.resume_probes),
                                                 "round_questions": len(personalization.round_questions)},
                     detail={"personalization": personalization.model_dump(mode="json")})

    # 6. playbooks
    await trace.start("playbooks")
    playbooks = await playbook_stage(ctx, plans, keyed, persona, personalization, timeboxes, llm, trace, settings)
    await trace.done("playbooks", summary={"slots": len(playbooks),
                                           "branches": sum(len(p.branches) for p in playbooks.values())})

    # 7. policies
    await trace.start("policies")
    pol = policy_template()
    await trace.done("policies", summary={"version": pol.version, "requests": len(pol.requests)})

    # 8. assemble + validate
    await trace.start("validate")
    slots = A.build_slots(plans, keyed, playbooks, timeboxes)
    models = [c.get("model") for st in trace.stages for c in st["llm_calls"]]
    version = await store.next_version(session_id) if session_id else 0
    bp = Blueprint(
        blueprint_id=f"bp_{uuid.uuid4().hex[:20]}", session_id=session_id, candidate_id=req.session.candidate_id,
        version=version, status="current" if session_id else "bench", input_hash=req.input_hash or "",
        input_parts=req.input_parts, run_id=run_id, created_at=store.iso(), round=A.round_view(ctx, deep_dive),
        persona=persona.persona, arc=arc, personalization=personalization, slots=slots, policies=pol,
        evaluation=A.evaluation(ctx), briefing=A.briefing(ctx, persona, slots),
        provenance=A.provenance(models, ctx, seed, keyed, pol, run_id),
    )
    checks = A.invariants(ctx, bp)
    failed = [c for c in checks if not c["passed"]]
    trace.note("validate", checks=checks)
    if failed:
        raise StageError("validation_failed", "; ".join(f"{c['check']}: {c['detail']}" for c in failed)[:600])
    doc = bp.model_dump(mode="json")
    if session_id:
        previous = await store.save_current_blueprint(doc)
        if previous:
            await store.release_kept_run(previous.get("run_id"), settings.blueprint_run_retention_days)
        await trace.done("validate", summary={"checks": len(checks), "version": version})
        return {"cached": False, "blueprint_version": version, "briefing": doc["briefing"], "keep": True}
    await trace.done("validate", summary={"checks": len(checks), "bench": True})
    return {"cached": False, "blueprint_version": None, "briefing": doc["briefing"], "blueprint": doc, "keep": False}
