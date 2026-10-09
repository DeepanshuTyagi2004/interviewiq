"""The worker's calls into the API (spec §8.2), guarded by the shared X-Internal-Api-Key: the round's
context at the start, and the end of the session (retried; the API's sweep is the backstop)."""
from __future__ import annotations

import asyncio
from typing import Any

import httpx


class ApiError(Exception):
    def __init__(self, status: int, body: str) -> None:
        super().__init__(f"API {status}: {body[:200]}")
        self.status = status


class ApiClient:
    def __init__(self, base_url: str, internal_key: str, *, transport: httpx.AsyncBaseTransport | None = None,
                 retries: int = 3, backoff_s: float = 1.0) -> None:
        self._http = httpx.AsyncClient(base_url=base_url.rstrip("/"), headers={"X-Internal-Api-Key": internal_key},
                                       timeout=15.0, transport=transport)
        self.retries = retries
        self.backoff_s = backoff_s

    async def _call(self, method: str, path: str, body: dict[str, Any] | None = None, retry: bool = False) -> dict[str, Any]:
        attempts = self.retries if retry else 1
        last: Exception | None = None
        for attempt in range(attempts):
            try:
                response = await self._http.request(method, path, json=body)
            except httpx.TransportError as exc:
                last = exc
            else:
                if response.status_code < 300:
                    return response.json()
                last = ApiError(response.status_code, response.text)
                if response.status_code < 500:
                    raise last
            if attempt < attempts - 1:
                await asyncio.sleep(self.backoff_s * (2 ** attempt))
        raise last if isinstance(last, ApiError) else ApiError(0, str(last))

    async def context(self, session_id: str) -> dict[str, Any]:
        return await self._call("GET", f"/api/v1/internal/live/sessions/{session_id}/context")

    async def end(self, session_id: str, reason: str, live_summary: dict[str, Any]) -> dict[str, Any]:
        return await self._call("POST", f"/api/v1/internal/live/sessions/{session_id}/end",
                                {"reason": reason, "live_summary": live_summary}, retry=True)

    async def aclose(self) -> None:
        await self._http.aclose()
