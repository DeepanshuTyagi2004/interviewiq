"""Evaluation HTTP routes (spec §11.1). Internal (called by interviewiq-api with the internal key):

- POST /evaluations/runs                    start a run (returns the live run when one is already running)
- GET  /evaluations/runs/{run_id}           compact status: status, error, result
- POST /evaluations/runs/{run_id}/cancel    cancel
- GET  /evaluations/sessions/{session_id}   the current evaluation's report (?version=N for a specific one)

Admin diagnostics (interviewiq-api proxies these for ADMIN users; snake_case passthrough):

- GET  /admin/evaluations/runs                  list (filters, cursor = created_at of the last row)
- GET  /admin/evaluations/runs/{run_id}         full run: request, raw grader outputs (A, B, tiebreak C), disagreements, arithmetic
- POST /admin/evaluations/runs/{run_id}/rerun   run the same request again (a new version when it completes)
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.api.deps import require_internal_key
from app.config import get_settings
from app.evaluation import pipeline, store
from app.evaluation.models import EvaluationRunRequest

router = APIRouter(dependencies=[Depends(require_internal_key)])


def _status_view(run: dict) -> dict:
    return {"run_id": run["run_id"], "session_id": run.get("session_id"), "trigger": run.get("trigger"), "status": run.get("status"),
            "error": run.get("error"), "result": run.get("result"), "created_at": run.get("created_at"), "ended_at": run.get("ended_at")}


@router.post("/evaluations/runs")
async def start_evaluation_run(req: EvaluationRunRequest) -> dict:
    if req.trigger == "dispute" and req.dispute is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="a dispute run needs a dispute")
    return await pipeline.start_run(req, get_settings())


@router.get("/evaluations/runs/{run_id}")
async def evaluation_run_status(run_id: str) -> dict:
    run = await store.get_run(run_id, full=False)
    if run is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="unknown run_id")
    return _status_view(run)


@router.post("/evaluations/runs/{run_id}/cancel")
async def cancel_evaluation_run(run_id: str) -> dict:
    return {"cancelled": await pipeline.cancel_run(run_id, get_settings())}


@router.get("/evaluations/sessions/{session_id}")
async def session_evaluation(session_id: str, version: int | None = Query(None, ge=1)) -> dict:
    doc = await store.current_evaluation(session_id, version)
    if doc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="no evaluation")
    return {"session_id": session_id, "candidate_id": doc.get("candidate_id"), "version": doc["version"], "run_id": doc.get("run_id"),
            "created_at": doc.get("created_at"), "outcome": doc.get("outcome"), "report": doc["report"]}


# ---------------------------------------------------------------- admin diagnostics

admin_router = APIRouter(prefix="/admin/evaluations", dependencies=[Depends(require_internal_key)])


@admin_router.get("/runs")
async def list_evaluation_runs(status_: str | None = Query(None, alias="status"), trigger: str | None = None,
                               candidate_id: str | None = None, session_id: str | None = None, outcome: str | None = None,
                               company: str | None = None, round_type: str | None = None,
                               from_: str | None = Query(None, alias="from"), to: str | None = None,
                               limit: int = Query(50, ge=1, le=200), cursor: str | None = None) -> dict:
    rows = await store.list_runs({"status": status_, "trigger": trigger, "candidate_id": candidate_id, "session_id": session_id,
                                  "outcome": outcome, "company": company, "round_type": round_type, "from": from_, "to": to},
                                 limit, cursor)
    return {"runs": rows, "next_cursor": rows[-1]["created_at"] if len(rows) == limit else None}


@admin_router.get("/runs/{run_id}")
async def evaluation_run_detail(run_id: str) -> dict:
    run = await store.get_run(run_id, full=True)
    if run is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="unknown run_id")
    return run


@admin_router.post("/runs/{run_id}/rerun")
async def rerun_evaluation(run_id: str) -> dict:
    run = await store.get_run(run_id, full=True)
    if run is None or not run.get("request"):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="unknown run_id")
    req = EvaluationRunRequest.model_validate(run["request"])
    req.trigger, req.dispute = "admin", None
    return await pipeline.start_run(req, get_settings())
