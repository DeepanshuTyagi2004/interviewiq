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


@router.post("/questions/generate")
async def trigger_question_content(round_type: str | None = None, limit: int | None = None, force: bool = False) -> dict:
    """Start content generation over the question index in the background (docs/question-bank.md).
    Shares the single run slot and the /scrape/status feed. Runs the collection first when the index
    is empty. ?force=true regenerates records whose content is current."""
    run_id = new_run_id()
    if not RUN_STORE.start(run_id, trigger="question-content"):
        return {"run_id": RUN_STORE.run_id, "status": RUN_STORE.status, "already_running": True}
    settings = get_settings()
    asyncio.create_task(_background_generation(settings, run_id, round_type=round_type, limit=limit, force=force))
    return {"run_id": run_id, "status": "running", "already_running": False}


async def _background_generation(settings, run_id: str, *, round_type: str | None, limit: int | None, force: bool) -> None:
    from app.jobs.question_content import execute_tracked_generation
    try:
        await execute_tracked_generation(settings, run_id, round_type=round_type, limit=limit, force=force)
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
    request: Request, filename: str = Query("resume.pdf")
) -> dict:
    """Start an instrumented résumé-parse run. Body is the raw PDF (Content-Type: application/pdf),
    same contract as /resumes/parse. Returns the run_id to poll."""
    pdf_bytes = await request.body()
    if not pdf_bytes:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="empty file")
    if len(pdf_bytes) > _MAX_RESUME_BYTES:
        raise HTTPException(status_code=status.HTTP_413_CONTENT_TOO_LARGE, detail="resume exceeds 6 MB")
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
