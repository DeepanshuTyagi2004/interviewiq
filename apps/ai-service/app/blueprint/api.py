"""Blueprint HTTP routes (spec §6, §10). Internal (called by interviewiq-api with the internal key):

- POST /blueprints/runs                    start a run (returns the live run when one is already running)
- GET  /blueprints/runs/{run_id}           compact status: stage, steps, error, version, briefing
- POST /blueprints/runs/{run_id}/cancel    cancel
- GET  /blueprints/sessions/{session_id}   the current blueprint (?version=N for a specific one)

Admin diagnostics (interviewiq-api proxies these for ADMIN users; snake_case passthrough):

- GET  /admin/blueprints/runs                            list (filters, cursor = created_at of the last row)
- GET  /admin/blueprints/runs/{run_id}                   full run: trace, request, blueprint
- POST /admin/blueprints/bench                           start a bench run (never attached to a session)
- POST /admin/blueprints/runs/{run_id}/rerun             re-run a run's inputs as a bench run
- GET  /admin/blueprints/sessions/{session_id}/versions  version list
- GET  /admin/blueprints/sessions/{session_id}/diff      ?from=&to=
- GET  /admin/blueprints/answer-keys/{round_type}/{slug} cached keys for a problem
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel

from app.api.deps import require_internal_key
from app.blueprint import pipeline, store
from app.blueprint.diff import diff as blueprint_diff
from app.blueprint.models import BlueprintRunRequest, RunOptions
from app.blueprint.trace import steps_of
from app.config import get_settings

router = APIRouter(dependencies=[Depends(require_internal_key)])


def _status_view(run: dict) -> dict:
    return {
        "run_id": run["run_id"], "session_id": run.get("session_id"), "status": run.get("status"),
        "stage": run.get("stage"), "steps": steps_of(run.get("stages")), "error": run.get("error"),
        "blueprint_version": run.get("blueprint_version"), "cached": run.get("cached", False),
        "input_hash": run.get("input_hash"), "briefing": run.get("briefing"),
        "created_at": run.get("created_at"), "ended_at": run.get("ended_at"),
    }


@router.post("/blueprints/runs")
async def start_blueprint_run(req: BlueprintRunRequest) -> dict:
    if req.trigger == "bench" or not req.session.session_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="session runs need a session_id; use the bench route")
    return await pipeline.start_run(req, get_settings())


@router.get("/blueprints/runs/{run_id}")
async def blueprint_run_status(run_id: str) -> dict:
    run = await store.get_run(run_id, full=False)
    if run is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="unknown run_id")
    return _status_view(run)


@router.post("/blueprints/runs/{run_id}/cancel")
async def cancel_blueprint_run(run_id: str) -> dict:
    return {"cancelled": await pipeline.cancel_run(run_id, get_settings())}


@router.get("/blueprints/sessions/{session_id}")
async def session_blueprint(session_id: str, version: int | None = Query(None, ge=1)) -> dict:
    doc = await (store.blueprint_version(session_id, version) if version else store.current_blueprint(session_id))
    if doc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="no blueprint")
    return doc


# ---------------------------------------------------------------- admin diagnostics

admin_router = APIRouter(prefix="/admin/blueprints", dependencies=[Depends(require_internal_key)])


@admin_router.get("/runs")
async def list_blueprint_runs(status_: str | None = Query(None, alias="status"), company: str | None = None,
                              round_type: str | None = None, trigger: str | None = None,
                              candidate_id: str | None = None, session_id: str | None = None,
                              from_: str | None = Query(None, alias="from"), to: str | None = None,
                              limit: int = Query(50, ge=1, le=200), cursor: str | None = None) -> dict:
    rows = await store.list_runs({"status": status_, "company": company, "round_type": round_type, "trigger": trigger,
                                  "candidate_id": candidate_id, "session_id": session_id, "from": from_, "to": to},
                                 limit, cursor)
    for r in rows:
        r["steps"] = steps_of(r.pop("stages", None))
    return {"runs": rows, "next_cursor": rows[-1]["created_at"] if len(rows) == limit else None}


@admin_router.get("/runs/{run_id}")
async def blueprint_run_detail(run_id: str) -> dict:
    run = await store.get_run(run_id, full=True)
    if run is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="unknown run_id")
    if run.get("blueprint") is None and run.get("session_id") and run.get("blueprint_version"):
        run["blueprint"] = await store.blueprint_version(run["session_id"], run["blueprint_version"])
    return run


@admin_router.post("/bench")
async def start_bench_run(req: BlueprintRunRequest) -> dict:
    req.trigger = "bench"
    req.session.session_id = None
    return await pipeline.start_run(req, get_settings())


class RerunBody(BaseModel):
    bypass_blueprint_cache: bool = True
    bypass_answer_key_cache: bool = False
    ignore_exclusions: bool = False


@admin_router.post("/runs/{run_id}/rerun")
async def rerun_blueprint(run_id: str, body: RerunBody) -> dict:
    """Admin re-runs never touch a session: they run the same inputs as a bench run."""
    run = await store.get_run(run_id, full=True)
    if run is None or not run.get("request"):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="unknown run_id")
    req = BlueprintRunRequest.model_validate(run["request"])
    req.trigger, req.rerun_of = "bench", run_id
    req.session.session_id = None
    req.options = RunOptions(**body.model_dump())
    return await pipeline.start_run(req, get_settings())


@admin_router.get("/sessions/{session_id}/versions")
async def blueprint_versions(session_id: str) -> dict:
    return {"versions": await store.list_versions(session_id)}


@admin_router.get("/sessions/{session_id}/diff")
async def blueprint_versions_diff(session_id: str, from_: int = Query(..., alias="from", ge=1), to: int = Query(..., ge=1)) -> dict:
    old, new = await store.blueprint_version(session_id, from_), await store.blueprint_version(session_id, to)
    if old is None or new is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="unknown version")
    return blueprint_diff(old, new)


@admin_router.get("/answer-keys/{round_type}/{slug:path}")
async def answer_keys(round_type: str, slug: str) -> dict:
    return {"keys": await store.answer_keys_for(round_type, slug)}
