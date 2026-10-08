"""Named problems from our own research briefs ("Design a parking lot" at Amazon's LLD round).

Each brief round carries `problems`: the questions first-hand accounts said were asked. They join
the index as `brief/<slug>` records, round type from the round, company tag from the brief, so the
bank knows they were reported there (`company_evidence: reported`). No URL: the brief is the source.
Two stores hold briefs: this service's own (AI-generated) and the API's admin-published ones, read
over `GET /api/v1/internal/brief-problems`.
"""
from __future__ import annotations

import logging
import re

import httpx

from app.db import repositories as repo
from app.models.brief import RoundType
from app.questions.models import QuestionRecord

logger = logging.getLogger(__name__)

_SLUG_RE = re.compile(r"[^a-z0-9]+")
_ROUND_TYPES = {r.value for r in RoundType}


def problem_slug(title: str) -> str:
    return "brief/" + _SLUG_RE.sub("-", title.lower()).strip("-")[:80]


def records_from_briefs(briefs: list[dict]) -> list[QuestionRecord]:
    """Deterministic merge of every round's problems across briefs: one record per (round, slug)."""
    by_key: dict[tuple[str, str], QuestionRecord] = {}
    for brief in briefs:
        company = str(brief.get("company") or "").strip().lower()
        rounds = (brief.get("final_experience") or {}).get("rounds") or []
        for round_ in rounds:
            round_type = str(round_.get("type") or "")
            if round_type not in _ROUND_TYPES:
                continue
            for problem in round_.get("problems") or []:
                title = str(problem or "").strip()
                if len(title) < 4:
                    continue
                key = (round_type, problem_slug(title))
                existing = by_key.get(key)
                if existing is None:
                    by_key[key] = QuestionRecord(
                        slug=key[1], round_type=round_type, title=title[:200], url="", sources=["briefs"],
                        company_tags=[company] if company else [], difficulty=round_.get("difficulty"),
                        topic_tags=[str(t) for t in (round_.get("topics") or [])][:10],
                        company_evidence={company: "reported"} if company else {},
                    )
                elif company and company not in existing.company_tags:
                    existing.company_tags.append(company)
                    existing.company_evidence[company] = "reported"
    return list(by_key.values())


async def fetch_published_briefs(settings) -> list[dict]:
    """The API's admin-published briefs (company + rounds with problems); [] when unreachable."""
    url = f"{settings.api_base_url.rstrip('/')}/api/v1/internal/brief-problems"
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(url, headers={"X-Internal-Api-Key": settings.internal_api_key})
        if resp.status_code != 200:
            logger.warning("[questions] published briefs: HTTP %d from %s", resp.status_code, url)
            return []
        briefs = resp.json().get("briefs") or []
        return briefs if isinstance(briefs, list) else []
    except Exception as exc:  # noqa: BLE001
        logger.warning("[questions] published briefs unreachable: %s", exc)
        return []


async def collect_brief_problems(settings) -> list[QuestionRecord]:
    """Fail-safe like the other collectors: any store error yields []."""
    try:
        own = await repo.brief_rounds()
    except Exception as exc:  # noqa: BLE001
        logger.warning("[questions] briefs collector failed: %s", exc)
        own = []
    published = await fetch_published_briefs(settings)
    records = records_from_briefs([*own, *published])
    logger.info("[questions] briefs: %d named problems from %d own + %d published briefs", len(records), len(own), len(published))
    return records
