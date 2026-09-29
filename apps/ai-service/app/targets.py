"""The JD targets to generate briefs for — one per JD = (company, role, level, specialization).

Source of truth is the `job_descriptions` table in interviewiq-api (Postgres), read over
HTTP from its internal endpoint with the shared internal API key. If the backend is
unreachable we log and return [] — the run is skipped, not guessed.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass

import httpx

from app.config import Settings

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class Combination:
    company: str
    role: str
    level: str
    specialization: str = "general"  # backend/frontend/fullstack/... — the role discriminator
    title: str | None = None         # real JD title
    jd_url: str | None = None
    description: str | None = None    # JD content, condensed then fed to the search/LLM as context

    def label(self) -> str:
        return f"{self.company}/{self.role}/{self.level}/{self.specialization}"


async def fetch_combinations(settings: Settings) -> list[Combination]:
    url = settings.api_base_url.rstrip("/") + "/api/v1/internal/scrape-targets"
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(url, headers={"X-Internal-Api-Key": settings.internal_api_key})
            resp.raise_for_status()
            rows = resp.json()
    except Exception as exc:  # noqa: BLE001 — missing targets must not crash the scheduler
        logger.warning("Could not fetch JD targets from %s: %s — skipping run", url, exc)
        return []

    combos: list[Combination] = []
    for row in rows:
        try:
            combos.append(Combination(
                row["company"], row["role"], row["level"],
                row.get("specialization") or "general",
                row.get("title"), row.get("jdUrl"), row.get("description"),
            ))
        except (KeyError, TypeError) as exc:
            logger.warning("Ignoring malformed target row %r: %s", row, exc)
    logger.info("Loaded %d JD target(s) from interviewiq-api", len(combos))
    return combos
