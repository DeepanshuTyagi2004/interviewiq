"""Internal HTTP surface of the research pipeline (spec §8.2). Called only by interviewiq-api with
the internal key, on behalf of an authenticated ADMIN. Errors use the {code, message} envelope,
which the API forwards as-is."""
from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from app.api.deps import require_internal_key
from app.research.models import InvalidTransition
from app.research.runner import NoCompaniesSelected, ResearchRunner, RunActive, RunNotFound
from app.research.store import EventFilter
from app.research.targets import TargetsUnavailable
from app.research.trace.tracer import hydrate_span, utcnow

router = APIRouter(prefix="/research", dependencies=[Depends(require_internal_key)])

Level = Literal["trace", "debug", "info", "warn", "error"]
_ITEM_HIDDEN = ("state", "target")


def get_runner(request: Request) -> ResearchRunner | None:
    return getattr(request.app.state, "research", None)


RunnerDep = Annotated[ResearchRunner | None, Depends(get_runner)]


def error(status: int, code: str, message: str, **extra) -> JSONResponse:
    return JSONResponse(status_code=status, content={"code": code, "message": message, **extra})


def _disabled() -> JSONResponse:
    return error(503, "research_disabled", "the research pipeline is disabled (RESEARCH_ENABLED=false)")


def _public_run(run: dict) -> dict:
    return {k: v for k, v in run.items() if k != "targets"}


def _public_item(item: dict) -> dict:
    return {k: v for k, v in item.items() if k not in _ITEM_HIDDEN}


class StartRunBody(BaseModel):
    scope: Literal["all", "selected"] = "all"
    company_ids: list[str] = []
    mode: Literal["live", "record", "replay"] | None = None
    requested_by: str | None = None


class BudgetBody(BaseModel):
    exa_cap: int | None = Field(None, ge=0)
    llm_cap: int | None = Field(None, ge=0)


@router.post("/runs", status_code=201)
async def start_run(body: StartRunBody, runner: RunnerDep):
    if runner is None:
        return _disabled()
    try:
        run = await runner.start_run(trigger="admin", scope=body.scope, company_ids=body.company_ids,
                                     mode=body.mode, requested_by=body.requested_by)
    except RunActive as exc:
        return error(409, "run_active", str(exc), run_id=exc.run_id)
    except NoCompaniesSelected as exc:
        return error(400, "no_companies", str(exc))
    except TargetsUnavailable as exc:
        return error(503, "targets_unavailable", str(exc))
    return _public_run(run)


@router.get("/runs")
async def list_runs(runner: RunnerDep, limit: Annotated[int, Query(ge=1, le=100)] = 20):
    if runner is None:
        return _disabled()
    return {"runs": await runner.store.list_runs(limit)}


@router.get("/runs/{run_id}")
async def get_run(run_id: str, runner: RunnerDep):
    if runner is None:
        return _disabled()
    run = await runner.store.get_run(run_id)
    if run is None:
        return error(404, "run_not_found", f"no research run {run_id}")
    items = await runner.store.list_items(run_id)
    return {"run": _public_run(run), "items": [_public_item(i) for i in items]}


async def _control(runner: ResearchRunner | None, run_id: str, action: str):
    if runner is None:
        return _disabled()
    try:
        run = await getattr(runner, action)(run_id)
    except RunNotFound as exc:
        return error(404, "run_not_found", str(exc))
    except InvalidTransition as exc:
        return error(409, "invalid_transition", str(exc))
    return _public_run(run)


@router.post("/runs/{run_id}/pause")
async def pause_run(run_id: str, runner: RunnerDep):
    return await _control(runner, run_id, "pause")


@router.post("/runs/{run_id}/resume")
async def resume_run(run_id: str, runner: RunnerDep):
    return await _control(runner, run_id, "resume")


@router.post("/runs/{run_id}/stop")
async def stop_run(run_id: str, runner: RunnerDep):
    return await _control(runner, run_id, "stop")


@router.patch("/runs/{run_id}/budget")
async def patch_budget(run_id: str, body: BudgetBody, runner: RunnerDep):
    if runner is None:
        return _disabled()
    try:
        run = await runner.raise_budget(run_id, exa_cap=body.exa_cap, llm_cap=body.llm_cap)
    except RunNotFound as exc:
        return error(404, "run_not_found", str(exc))
    except ValueError as exc:
        return error(400, "invalid_budget", str(exc))
    return _public_run(run)


@router.get("/runs/{run_id}/events")
async def run_events(
    run_id: str,
    runner: RunnerDep,
    after_seq: Annotated[int, Query(ge=0)] = 0,
    before_seq: Annotated[int | None, Query(ge=1)] = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 500,
    level: Annotated[Level | None, Query()] = None,
    company_id: Annotated[str | None, Query()] = None,
    node: Annotated[str | None, Query()] = None,
    type_: Annotated[str | None, Query(alias="type")] = None,
    span_id: Annotated[str | None, Query()] = None,
    q: Annotated[str | None, Query(max_length=200)] = None,
):
    if runner is None:
        return _disabled()
    run = await runner.store.get_run(run_id)
    if run is None:
        return error(404, "run_not_found", f"no research run {run_id}")
    events = await runner.store.list_events(run_id, EventFilter(
        after_seq=after_seq, before_seq=before_seq, limit=limit, min_level=level, company_id=company_id,
        node=node, type_prefix=type_, span_id=span_id, q=q,
    ))
    return {"events": events, "last_seq": run.get("last_seq", 0)}


@router.get("/runs/{run_id}/spans")
async def run_spans(run_id: str, runner: RunnerDep, company_id: Annotated[str | None, Query()] = None):
    if runner is None:
        return _disabled()
    if await runner.store.get_run(run_id) is None:
        return error(404, "run_not_found", f"no research run {run_id}")
    return {"spans": await runner.store.list_spans(run_id, company_id)}


@router.get("/spans/{span_id}")
async def get_span(span_id: str, runner: RunnerDep):
    if runner is None:
        return _disabled()
    span = await runner.store.get_span(span_id)
    if span is None:
        return error(404, "span_not_found", f"no span {span_id}")
    span = await hydrate_span(runner.store, span)
    logs = await runner.store.list_events(span["run_id"], EventFilter(span_id=span_id, limit=500))
    return {"span": span, "logs": logs}


@router.get("/companies/state")
async def companies_state(runner: RunnerDep, ids: Annotated[str, Query(max_length=20_000)] = ""):
    if runner is None:
        return _disabled()
    wanted = [i for i in ids.split(",") if i]
    return {"states": await runner.store.list_company_states(wanted or None)}


@router.get("/companies/{company_id}/draft")
async def latest_draft(company_id: str, runner: RunnerDep):
    """The newest draft for a company, whatever its status: what the admin reviews."""
    if runner is None:
        return _disabled()
    draft = await runner.store.latest_draft(company_id)
    if draft is None:
        return error(404, "draft_not_found", "this company has no research draft yet")
    return draft


class DraftDecisionBody(BaseModel):
    decision: Literal["approve", "reject"]
    note: str | None = Field(None, max_length=1000)
    decided_by: str | None = None


@router.post("/drafts/{draft_id}/decision")
async def decide_draft(draft_id: str, body: DraftDecisionBody, runner: RunnerDep):
    """pending_review → approved | rejected. Only a pending draft can be decided (409 otherwise)."""
    if runner is None:
        return _disabled()
    draft = await runner.store.get_draft(draft_id)
    if draft is None:
        return error(404, "draft_not_found", f"no draft {draft_id}")
    status = "approved" if body.decision == "approve" else "rejected"
    fields = {"decided_at": utcnow(), "decided_by": body.decided_by, "decision_note": body.note}
    if not await runner.store.decide_draft(draft_id, status=status, fields=fields):
        return error(409, "draft_not_pending", f"draft is {draft['status']}, only a pending_review draft can be decided")
    state = {c["company_id"]: c for c in await runner.store.list_company_states([draft["company_id"]])}.get(draft["company_id"])
    if state and state.get("latest_draft_id") == draft_id:
        await runner.store.upsert_company_state(draft["company_id"], fields={"latest_draft_status": status})
    return {**draft, **fields, "status": status}
