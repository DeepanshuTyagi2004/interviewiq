"""FastAPI routes.

- GET  /health                               — public; mongo + LLM connectivity
- GET  /briefs                               — internal key; status summary of all briefs
- GET  /briefs/{company}/{role}/{level}      — internal key; the brief (404 if failed/missing)
- POST /briefs/{company}/{role}/{level}/refresh — internal key; regenerate now, return it
- GET  /experiences/{company}/{role}/{level} — internal key; paginated paste-in experiences
- POST /resumes/parse                         — internal key; PDF body -> structured JSON (onboarding)
- POST /profile-scoring/assess                — internal key; bounded feature inferences from minimized evidence
- POST /profile-scoring/company-context       — internal key; general-knowledge company facts (no score)
- POST /users/purge                           — internal key; account deletion, drop the user's blueprints, runs, live interviews and evaluations
"""
from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field, ValidationError

from app.api.deps import get_exa, require_internal_key
from app.config import get_settings
from app.db import mongo, repositories as repo
from app.llm.client import LLMError, build_llm_client, build_profile_scoring_llm_client
from app.jobs.brief_generation import generate_one
from app.interviewer.lifecycle import worker_ready
from app.exa.client import ExaClient, ExaConfigError, build_exa_client
from app.models.resume import ParsedResume
from app.models.engineering_levels import Level
from app.prompts.parse_resume import RESUME_SYSTEM, build_parse_resume_prompt
from app.profile_scoring.assess import COMPANY_MAX_OUTPUT_TOKENS, run_company_context, run_profile_assessment
from app.profile_scoring.models import CompanyContextRequest, ProfileScoringAssessmentRequest
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
        "interviewer": "ready" if worker_ready(get_settings().interviewer_agent_name) else "down",   # the voice worker, registered with LiveKit
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
    level: Level,
    specialization: str,
    exa: ExaClient = Depends(get_exa),
) -> dict:
    """Regenerate this JD's brief immediately (synchronous) and return it.
    Uses the JD's real title/content from the catalogue when available."""
    level = level.value
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


@router.get("/questions/stats", dependencies=[Depends(require_internal_key)])
async def question_stats() -> dict:
    """Counts per round type and content status (the admin Problem bank panel)."""
    return await repo.question_stats()


@router.get("/questions", dependencies=[Depends(require_internal_key)])
async def list_questions(round_type: str | None = None, company: str | None = None,
                         difficulty: str | None = None, limit: int = 100,
                         content_status: str | None = None, topic: str | None = None,
                         include_content: bool = False) -> dict:
    """Read the question bank: thin index by default, full content with include_content=true."""
    limit = min(limit, 500)
    items = await repo.query_questions(round_type, company, difficulty, limit, content_status=content_status,
                                       topic=topic, include_content=include_content)
    total = await repo.count_questions_matching(round_type, company, difficulty, content_status=content_status, topic=topic)
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


@router.post("/profile-scoring/assess", dependencies=[Depends(require_internal_key)])
async def assess_profile(request: Request) -> dict:
    """Assess requested profile features from caller-minimized evidence.

    The endpoint never accepts or returns an LLM-derived overall profile score. The API remains
    responsible for any deterministic aggregation and policy decisions.
    """
    # Stream with a transport cap too: model-level budgets do not bound an arbitrary raw JSON body.
    # Parsing here keeps Pydantic error inputs (which can contain evidence/secrets) out of FastAPI's
    # default 422 response. No invalid request contents or upstream exceptions are ever echoed.
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > 100_000:
            raise HTTPException(status_code=413, detail="profile scoring assessment input too large")
    try:
        req = ProfileScoringAssessmentRequest.model_validate_json(bytes(body))
    except ValidationError:
        raise HTTPException(status_code=422, detail="invalid minimized profile scoring assessment request") from None
    settings = get_settings()
    try:
        async with build_profile_scoring_llm_client(settings) as llm:
            response = await run_profile_assessment(llm, req, max_repairs=1)
    except LLMError:
        # Do not echo provider responses, prompts, evidence, or credentials into an HTTP error.
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="profile scoring assessment unavailable",
        ) from None
    except ValueError:
        # Includes deterministic feature-set validation after a structurally valid LLM response.
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="profile scoring assessment produced invalid data",
        ) from None
    return response.model_dump(by_alias=True, mode="json")


@router.post("/profile-scoring/company-context", dependencies=[Depends(require_internal_key)])
async def company_context(request: Request) -> dict:
    """Engineering context of one company from general knowledge, for the scoring knowledge base.

    Only a company name is accepted. An unidentifiable company comes back known=false with no facts.
    The response never contains a score, prestige rating or ranking.
    """
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > 2_000:
            raise HTTPException(status_code=413, detail="company context input too large")
    try:
        req = CompanyContextRequest.model_validate_json(bytes(body))
    except ValidationError:
        raise HTTPException(status_code=422, detail="invalid company context request") from None
    settings = get_settings()
    try:
        try:
            exa = build_exa_client(settings)  # web fallback for companies the model does not know
        except (ExaConfigError, AttributeError):
            exa = None
        async with build_profile_scoring_llm_client(settings, max_output_tokens=COMPANY_MAX_OUTPUT_TOKENS) as llm:
            response = await run_company_context(llm, req, max_repairs=1, exa=exa)
    except (LLMError, ValueError):
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="company context unavailable") from None
    return response.model_dump(by_alias=True, mode="json")


class PurgeUserRequest(BaseModel):
    """The deleted account and every interview-session id it owned (the API batches in 1000s)."""

    candidate_id: str | None = None
    session_ids: list[str] = Field(default_factory=list, max_length=1000)


@router.post("/users/purge", dependencies=[Depends(require_internal_key)])
async def purge_user(req: PurgeUserRequest) -> dict:
    """Account deletion: remove the user's interview blueprints, blueprint runs (bench runs
    included) and live interviews (runs, turns, briefs, evidence). Idempotent — purging already-deleted data removes nothing and still succeeds."""
    from app.blueprint import store
    from app.evaluation import store as evaluation_store
    from app.interviewer import store as live_store

    out = await store.purge(req.candidate_id, req.session_ids)
    out.update(await live_store.purge(req.candidate_id, req.session_ids))
    out.update(await evaluation_store.purge(req.candidate_id, req.session_ids))
    return out
