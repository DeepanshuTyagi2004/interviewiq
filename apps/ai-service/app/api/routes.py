"""FastAPI routes.

- GET  /health                               — public; mongo + LLM connectivity
- GET  /briefs                               — internal key; status summary of all briefs
- GET  /briefs/{company}/{role}/{level}      — internal key; the brief (404 if failed/missing)
- POST /briefs/{company}/{role}/{level}/refresh — internal key; regenerate now, return it
- GET  /experiences/{company}/{role}/{level} — internal key; paginated paste-in experiences
- POST /interview-plans                       — internal key; build/return the cached InterviewPlan (prep)
- POST /interview-plans/start                  — internal key; start plan gen in background, return run_id
- GET  /interview-plans/runs/{run_id}          — internal key; poll a started run (running|completed|failed)
- POST /resumes/parse                         — internal key; PDF body -> structured JSON (onboarding)
"""
from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import ValidationError

from app.api.deps import get_exa, require_internal_key
from app.config import get_settings
from app.db import mongo, repositories as repo
from app.llm.client import LLMError, build_llm_client
from app.jobs.brief_generation import generate_one
from app.exa.client import ExaClient, ExaConfigError
from app.interview_prep.async_runner import PLAN_RUNS, run_plan_async
from app.interview_prep.pipeline import PrepDataError, generate_interview_plan
from app.interview_prep.schema import GenerateInterviewPlanRequest
from app.models.resume import ParsedResume
from app.prompts.parse_resume import RESUME_SYSTEM, build_parse_resume_prompt
from app.resume.extract import ResumeExtractError, extract_text
from app.resume.formatting import restore_nesting
from app.targets import Combination, fetch_combinations

router = APIRouter()

# Defence in depth — the backend caps the multipart upload at 6 MB; mirror it here so a direct
# internal call can't feed us an unbounded body.
_MAX_RESUME_BYTES = 6 * 1024 * 1024


@router.get("/health")
async def health() -> dict:
    mongo_ok = await mongo.ping()
    return {
        "status": "ok" if mongo_ok else "degraded",
        "mongo": "up" if mongo_ok else "down",
    }


@router.get("/briefs", dependencies=[Depends(require_internal_key)])
async def list_briefs() -> dict:
    """Status summary of every combination (no brief content) — operational monitoring."""
    return {"briefs": await repo.list_brief_summaries()}


@router.get("/briefs/{company}/{role}/{level}/{specialization}", dependencies=[Depends(require_internal_key)])
async def get_brief(company: str, role: str, level: str, specialization: str) -> dict:
    doc = await repo.get_brief(company, role, level, specialization)
    if doc is None or doc.get("generation_status") == "failed":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="no brief for that JD")
    # Flag so the interview session module can treat sparse-data briefs cautiously.
    doc["low_confidence"] = doc.get("data_confidence") == "low"
    return doc


@router.post("/briefs/{company}/{role}/{level}/{specialization}/refresh", dependencies=[Depends(require_internal_key)])
async def refresh_brief(
    company: str,
    role: str,
    level: str,
    specialization: str,
    exa: ExaClient = Depends(get_exa),
) -> dict:
    """Regenerate this JD's brief immediately (synchronous) and return it.
    Uses the JD's real title/content from the catalogue when available."""
    settings = get_settings()
    combos = await fetch_combinations(settings)
    combo = next(
        (c for c in combos if c.company == company and c.role == role
         and c.level == level and c.specialization == specialization),
        Combination(company, role, level, specialization),
    )
    try:
        async with build_llm_client(settings) as llm:
            await generate_one(exa, llm, combo, settings, force=True)
    except ExaConfigError as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc))
    doc = await repo.get_brief(company, role, level, specialization)
    if doc is None or doc.get("generation_status") == "failed":
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="brief generation failed")
    doc["low_confidence"] = doc.get("data_confidence") == "low"
    return doc


@router.get("/questions", dependencies=[Depends(require_internal_key)])
async def list_questions(round_type: str | None = None, company: str | None = None,
                         difficulty: str | None = None, limit: int = 100) -> dict:
    """Read the collected question bank (thin metadata + url). Filter by round/company/difficulty."""
    items = await repo.query_questions(round_type, company, difficulty, min(limit, 500))
    total = await repo.count_questions_matching(round_type, company, difficulty)
    # count = TRUE total matching the filter (may exceed the returned page); returned = this page size.
    return {"questions": items, "count": total, "returned": len(items)}


@router.get("/experiences/{company}/{role}/{level}", dependencies=[Depends(require_internal_key)])
async def list_experiences(
    company: str,
    role: str,
    level: str,
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
) -> dict:
    total, items = await repo.paginate_experiences(company, role, level, page, size)
    return {"total": total, "page": page, "size": size, "items": items}


@router.post("/interview-plans", dependencies=[Depends(require_internal_key)])
async def generate_plan(req: GenerateInterviewPlanRequest) -> dict:
    """Build (or return the cached) InterviewPlan for a session (Pipeline 1).

    The backend assembles the session context + JD + candidate profile and posts it here. Cache-
    gated on the fused input hash, so an identical re-request returns the stored plan with no LLM
    calls. Returns the camelCase plan doc (interviewiq-infra openapi.yaml InterviewPlan)."""
    settings = get_settings()
    try:
        return await generate_interview_plan(req, settings)
    except PrepDataError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc))
    except LLMError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY,
                            detail=f"interview plan generation failed: {exc}")


@router.post("/interview-plans/start", dependencies=[Depends(require_internal_key)])
async def start_interview_plan(req: GenerateInterviewPlanRequest) -> dict:
    """Fire-and-poll variant of POST /interview-plans. Start plan generation (the same cache-gated,
    persisted production path) in the background and return a ``run_id`` immediately, so the caller
    never holds one long HTTP call open for the concurrent Stage-2 LLM work. Poll
    GET /interview-plans/runs/{run_id} until status is ``completed`` (carries the plan) or ``failed``.
    """
    settings = get_settings()
    run_id = PLAN_RUNS.create()
    asyncio.create_task(run_plan_async(req, run_id, settings))
    return {"run_id": run_id, "status": "running"}


@router.get("/interview-plans/runs/{run_id}", dependencies=[Depends(require_internal_key)])
async def interview_plan_run_status(run_id: str) -> dict:
    """Poll a run started by /interview-plans/start. Returns ``{run_id, status, plan, error}`` where
    status is ``running`` | ``completed`` (``plan`` set) | ``failed`` (``error`` = {code, message})."""
    rec = PLAN_RUNS.get(run_id)
    if rec is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="unknown run_id")
    return rec


@router.post("/resumes/parse", dependencies=[Depends(require_internal_key)])
async def parse_resume(request: Request) -> dict:
    """Parse a résumé PDF into structured JSON to prefill onboarding.

    The body is the raw PDF (Content-Type: application/pdf) — no multipart, so this service needs
    no python-multipart dependency; the backend owns the upload and forwards the bytes. Stateless:
    nothing is persisted here. Returns a ParsedResume dict; the backend maps it onto CandidateProfile.
    """
    pdf_bytes = await request.body()
    if len(pdf_bytes) > _MAX_RESUME_BYTES:
        raise HTTPException(status_code=status.HTTP_413_CONTENT_TOO_LARGE,
                            detail="resume exceeds 6 MB")
    try:
        text = extract_text(pdf_bytes)
    except ResumeExtractError as exc:
        # Unreadable / image-only PDF — the UI falls back to manual entry.
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc))

    settings = get_settings()
    try:
        async with build_llm_client(settings, model=settings.resume_llm_model or None) as llm:
            data = await llm.complete_json(
                RESUME_SYSTEM, build_parse_resume_prompt(text), label="resume-parse")
    except LLMError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY,
                            detail=f"resume parsing failed: {exc}")

    try:
        parsed = ParsedResume.model_validate(data)
    except ValidationError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY,
                            detail=f"resume parse produced invalid data: {exc.errors()[:3]}")
    return restore_nesting(parsed, text).model_dump()
