import asyncio

import httpx
import pytest

from app.interviewer.api_client import ApiClient, ApiError


def client(handler, **kw):
    return ApiClient("http://api.test", "secret", transport=httpx.MockTransport(handler), backoff_s=0, **kw)


def test_context_sends_the_internal_key():
    seen = {}

    def handler(request):
        seen["key"] = request.headers.get("x-internal-api-key")
        seen["path"] = request.url.path
        return httpx.Response(200, json={"session_id": "s1", "profile": {"skills": ["Java"]}})

    out = asyncio.run(client(handler).context("s1"))
    assert out["profile"]["skills"] == ["Java"]
    assert seen == {"key": "secret", "path": "/api/v1/internal/live/sessions/s1/context"}


def test_end_retries_server_errors_and_gives_up_on_client_errors():
    calls = []

    def flaky(request):
        calls.append(request)
        return httpx.Response(503) if len(calls) < 3 else httpx.Response(200, json={"status": "COMPLETED", "ended_reason": "completed", "already_ended": False})

    assert asyncio.run(client(flaky).end("s1", "completed", {"tab_changes": 0}))["status"] == "COMPLETED"
    assert len(calls) == 3

    def conflict(request):
        return httpx.Response(409, json={"code": "session_not_live"})

    with pytest.raises(ApiError):
        asyncio.run(client(conflict).end("s1", "completed", {}))
