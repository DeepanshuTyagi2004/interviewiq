"""Shared FastAPI dependencies: internal API key auth + accessors for app state."""
from __future__ import annotations

import secrets

from fastapi import Header, HTTPException, Request, status

from app.config import get_settings
from app.perplexity.client import PerplexityClient


async def require_internal_key(x_internal_api_key: str = Header(default="")) -> None:
    """Shared-secret gate between interviewiq-api and this service. Constant-time
    compare so the check does not leak the key via timing."""
    expected = get_settings().internal_api_key
    if not secrets.compare_digest(x_internal_api_key, expected):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid internal api key")


def get_perplexity(request: Request) -> PerplexityClient:
    return request.app.state.perplexity
