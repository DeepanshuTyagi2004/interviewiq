"""FastAPI routes.

- GET  /health                               — public; mongo + LLM connectivity
- GET  /briefs                               — internal key; status summary of all briefs
- GET  /briefs/{company}/{role}/{level}      — internal key; the brief (404 if failed/missing)
- POST /briefs/{company}/{role}/{level}/refresh — internal key; regenerate now, return it
- GET  /experiences/{company}/{role}/{level} — internal key; paginated paste-in experiences
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.api.deps import get_exa, require_internal_key
from app.config import get_settings
from app.db import mongo, repositories as repo
from app.llm.client import build_llm_client
from app.jobs.brief_generation import generate_one
from app.exa.client import ExaClient, ExaConfigError
from app.targets import Combination, fetch_combinations

router = APIRouter()


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
