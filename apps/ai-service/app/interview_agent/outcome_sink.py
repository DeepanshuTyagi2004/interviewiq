"""POST a finalized SessionOutcome to the backend's internal outcome endpoint."""
from __future__ import annotations

import dataclasses
import logging

import httpx

from app.config import Settings
from app.interview_agent.types import SessionOutcome

logger = logging.getLogger(__name__)


def _serialize(outcome: SessionOutcome) -> dict:
    body = dataclasses.asdict(outcome)
    body["ended_reason"] = outcome.ended_reason.value  # asdict keeps the Enum; send its string value
    return body


async def post_outcome(settings: Settings, outcome: SessionOutcome) -> bool:
    url = settings.api_base_url.rstrip("/") + f"/api/v1/internal/sessions/{outcome.session_id}/outcome"
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                url,
                json=_serialize(outcome),
                headers={"X-Internal-Api-Key": settings.internal_api_key},
            )
            resp.raise_for_status()
        return True
    except Exception as exc:  # noqa: BLE001 — never let outcome delivery crash the worker
        logger.warning("Failed to POST session outcome to %s: %s", url, exc)
        return False
