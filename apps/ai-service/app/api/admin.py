"""Admin/ops endpoints for the live ingestion view. All require the internal API
key — they are called by interviewiq-api on behalf of an authenticated ADMIN user,
never directly by a browser.

- POST /admin/scrape/run     trigger a pipeline run (returns immediately; runs in bg)
- GET  /admin/scrape/status  current run state + incremental verbose logs (?after=seq)
"""
from __future__ import annotations

import asyncio
import logging
import uuid

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel

from app.api.deps import get_exa, require_internal_key
from app.config import get_settings
from app.db import repositories as repo
from app.jobs.brief_generation import execute_tracked_run
from app.jobs.pipeline_runs import RUNS
from app.jobs.question_collection import execute_tracked_collection
from app.jobs.run_store import RUN_STORE, new_run_id
from app.interview_prep.schema import GenerateInterviewPlanRequest
from app.interview_prep.tracked_pipeline import run_interview_prep, start_interview_prep_run
from app.models.experience import Level, RawExperience, Source
from app.resume.tracked_parse import run_resume_parse, start_resume_run
from app.exa.client import ExaClient

logger = logging.getLogger(__name__)

_MAX_RESUME_BYTES = 6 * 1024 * 1024

router = APIRouter(prefix="/admin", dependencies=[Depends(require_internal_key)])


class SubmitExperienceRequest(BaseModel):
    company: str
    role: str = "software-engineer"
    level: Level
    raw_content: str
    source_url: str | None = None


@router.post("/experiences")
async def submit_experience(req: SubmitExperienceRequest) -> dict:
    """Accept a first-party (paste-in) interview experience. Stored pending; the
    next extraction run processes it through the same pipeline as scraped data."""
    exp = RawExperience(
        source=Source.USER_SUBMITTED,
        company=req.company.strip().lower(),
        role=req.role.strip().lower().replace(" ", "-"),
        level=req.level,
        raw_content=req.raw_content,
        # synthetic unique key (the source_url index is unique) for paste-ins
        source_url=req.source_url or f"user-submitted:{uuid.uuid4().hex}",
    )
    inserted = await repo.upsert_experiences([exp])
    logger.info("[submit] user experience for %s/%s/%s (inserted=%d)",
                exp.company, exp.role, exp.level.value, inserted)
    return {"inserted": inserted, "status": "pending"}


@router.post("/scrape/run")
async def trigger_run(exa: ExaClient = Depends(get_exa)) -> dict:
    """Start a brief-generation run in the background. If one is already in progress,
    returns that run instead of starting a second (runs never overlap)."""
    run_id = new_run_id()
    if not RUN_STORE.start(run_id, trigger="manual"):
        return {"run_id": RUN_STORE.run_id, "status": RUN_STORE.status, "already_running": True}

    settings = get_settings()
    asyncio.create_task(_background_run(exa, settings, run_id))
    return {"run_id": run_id, "status": "running", "already_running": False}


async def _background_run(exa: ExaClient, settings, run_id: str) -> None:
    try:
        await execute_tracked_run(exa, settings, run_id)
    except Exception:  # noqa: BLE001 — failure already recorded in RUN_STORE
        pass


@router.post("/scrape/stop")
async def stop_run() -> dict:
    """Cooperatively stop the active run — it halts after the current JD finishes (no partial
    brief is left mid-write). No-op if nothing is running."""
    stopping = RUN_STORE.request_cancel()
    return {"stopping": stopping, "status": RUN_STORE.status}


@router.get("/scrape/status")
async def scrape_status(after: int = Query(0, ge=0)) -> dict:
    """Current run snapshot. Pass ?after=<last_seq> to fetch only new log lines."""
    return RUN_STORE.snapshot(after=after)


@router.post("/questions/collect")
async def trigger_question_collection(force: bool = False) -> dict:
    """Start a question-bank collection run in the background. Reuses the single run slot —
    if a scrape or collection is already running, returns that run instead of starting a second.
    Pass ?force=true to re-enrich even questions that haven't changed."""
    run_id = new_run_id()
    if not RUN_STORE.start(run_id, trigger="questions"):
        return {"run_id": RUN_STORE.run_id, "status": RUN_STORE.status, "already_running": True}
    settings = get_settings()
    asyncio.create_task(_background_collection(settings, run_id, force=force))
    return {"run_id": run_id, "status": "running", "already_running": False}


async def _background_collection(settings, run_id: str, *, force: bool = False) -> None:
    try:
        await execute_tracked_collection(settings, run_id, force=force)
    except Exception:  # noqa: BLE001 — failure already recorded in RUN_STORE
        pass


@router.post("/briefs/clear")
async def clear_briefs() -> dict:
    """Delete ALL generated interview briefs (destructive). The catalogue (Postgres) is untouched."""
    removed = await repo.clear_briefs()
    logger.info("[admin] cleared %d generated brief(s)", removed)
    return {"deleted": removed}


# --- Résumé parse observability console (admin test-bench) ---------------------------------------
# A parallel, instrumented copy of POST /resumes/parse: start a run (returns immediately, executes
# in the background recording every step), then poll its snapshot. The production onboarding route
# is untouched. Unlike the brief/question RUN_STORE, these are keyed (concurrent) runs.

@router.post("/resume/parse/run")
async def start_resume_parse_run(
    request: Request, filename: str = Query("résumé.pdf")
) -> dict:
    """Start an instrumented résumé-parse run. Body is the raw PDF (Content-Type: application/pdf),
    same contract as /resumes/parse. Returns the run_id to poll."""
    pdf_bytes = await request.body()
    if not pdf_bytes:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="empty file")
    if len(pdf_bytes) > _MAX_RESUME_BYTES:
        raise HTTPException(status_code=status.HTTP_413_CONTENT_TOO_LARGE, detail="résumé exceeds 6 MB")
    settings = get_settings()
    run_id = start_resume_run(filename, len(pdf_bytes))
    asyncio.create_task(run_resume_parse(pdf_bytes, filename, run_id, settings))
    return {"run_id": run_id, "status": "running"}


@router.get("/resume/parse/runs")
async def list_resume_parse_runs() -> dict:
    """Recent résumé-parse runs (newest first) — the monitor-later hook."""
    return {"runs": RUNS.list_runs("resume_parse")}


@router.get("/resume/parse/runs/{run_id}")
async def resume_parse_run_status(run_id: str, after: int = Query(0, ge=0)) -> dict:
    """Snapshot of one run. Pass ?after=<last_seq> to fetch only new log lines."""
    snap = RUNS.snapshot(run_id, after=after)
    if snap is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="unknown run_id")
    return snap


# --- Interview-prep observability console (admin test-bench) ------------------------------------
# Same request body as POST /interview-plans; runs the plan pipeline in the background with per-stage
# instrumentation (context → cache gate → persona/ladders/probes → assemble), bypassing the cache
# and NOT persisting the plan. The production /interview-plans route is untouched.

@router.post("/interview-prep/run")
async def start_interview_prep_run_endpoint(req: GenerateInterviewPlanRequest) -> dict:
    """Start an instrumented interview-prep run. Returns the run_id to poll."""
    settings = get_settings()
    run_id = start_interview_prep_run(req)
    asyncio.create_task(run_interview_prep(req, run_id, settings))
    return {"run_id": run_id, "status": "running"}


@router.get("/interview-prep/runs")
async def list_interview_prep_runs() -> dict:
    """Recent interview-prep runs (newest first)."""
    return {"runs": RUNS.list_runs("interview_prep")}


@router.get("/interview-prep/runs/{run_id}")
async def interview_prep_run_status(run_id: str, after: int = Query(0, ge=0)) -> dict:
    """Snapshot of one run. Pass ?after=<last_seq> to fetch only new log lines."""
    snap = RUNS.snapshot(run_id, after=after)
    if snap is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="unknown run_id")
    return snap


# --- Interview-agent diagnostics console (interactive brain harness) ----------------------------
# Drive the live interview brain by hand: start a session (POST /run → mints a run_id, kicks off the
# in-process run_session behind a DiagnosticTransport), poll its turn/step tree (GET /runs/{id}),
# and feed it typed candidate turns (POST /runs/{id}/turn) or force-end it (POST /runs/{id}/end).
# The session runs in the background; the endpoints only produce inbox input + read snapshots. No
# outcome is posted to interviewiq-api — this is a bench for watching the brain, not a live seat.
from app.interview_agent.diagnostic_runner import (  # noqa: E402
    TRANSPORTS, TooManyActiveSessions, start_agent_session,
)
from app.jobs.agent_sessions import AGENT_SESSIONS  # noqa: E402


@router.post("/interview-agent/run")
async def start_agent_run(plan: dict = Body(...), settings=Depends(get_settings)) -> dict:
    """Start an interactive diagnostic interview session from an InterviewPlan dict. Returns the
    run_id to poll. 429 if the concurrent-session cap is already reached."""
    try:
        run_id, _ = start_agent_session(plan, settings)
    except TooManyActiveSessions:
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="sessions_at_capacity")
    return {"run_id": run_id, "status": "running"}


@router.post("/interview-agent/runs/{run_id}/turn")
async def submit_agent_turn(run_id: str, body: dict = Body(...)) -> dict:
    """Feed one candidate turn (spoken text + optional artifact) or a silence window into a session
    that is awaiting input. 404 if the run/transport is unknown; 409 if it is not currently awaiting
    input (double-submit / out-of-turn). Async: returns as soon as the input is enqueued."""
    transport = TRANSPORTS.get(run_id)
    if transport is None or AGENT_SESSIONS.status_of(run_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="run_not_found")
    # Atomic accept: only when the session is parked awaiting input AND its inbox is drained. This
    # whole check→flip runs in one handler tick with no await between, so a rapid second submit sees
    # status == "running" (flipped below) and takes the 409 branch — no double-enqueue.
    if AGENT_SESSIONS.status_of(run_id) != "awaiting_input" or not transport.inbox_empty():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="not_awaiting_input")
    # Parse advance_seconds ONCE, null-safely, BEFORE flipping status — a bad value must 400 while
    # the session is still cleanly awaiting_input (an explicit null or non-numeric string otherwise
    # TypeErrors AFTER the status flip, wedging the session in "running" with an empty inbox).
    # An explicit 0 is preserved (only None falls back to the 60.0 default).
    raw = body.get("advance_seconds")
    try:
        advance_seconds = 60.0 if raw is None else float(raw)
    except (TypeError, ValueError):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="advance_seconds must be numeric")
    AGENT_SESSIONS.set_status(run_id, "running")
    if body.get("silence"):
        transport.submit_silence(advance_seconds=advance_seconds)
    else:
        transport.submit_turn(text=body.get("text", ""), artifact=body.get("artifact"),
                              advance_seconds=advance_seconds)
    return {"status": "accepted"}


@router.get("/interview-agent/runs/{run_id}")
async def get_agent_run(run_id: str, after: int = Query(0, ge=0)) -> dict:
    """Snapshot of one session (turn/step tree, transcript, status). Pass ?after=<last_seq> for only
    new log lines. 404 if the run is unknown or has been evicted."""
    snap = AGENT_SESSIONS.snapshot(run_id, after)
    if snap is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="run_not_found")
    return snap


@router.get("/interview-agent/runs")
async def list_agent_runs() -> dict:
    """Recent diagnostic sessions (newest first)."""
    return {"runs": AGENT_SESSIONS.list_sessions()}


@router.post("/interview-agent/runs/{run_id}/end")
async def end_agent_run(run_id: str) -> dict:
    """Force-end a session — pushes _END into its inbox; the brain aborts on its next read and the
    runner records the terminal outcome. Async: does NOT wait for the session to reach terminal."""
    transport = TRANSPORTS.get(run_id)
    if transport is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="run_not_found")
    transport.submit_end()
    return {"status": "accepted"}
