"""POST /users/purge (account deletion): drops the user's interview blueprints and blueprint runs.

Route called directly with the HTTP layer bypassed."""
import asyncio

import pytest
from pydantic import ValidationError

import app.api.routes as routes
from app.blueprint import store


def test_purge_route_deletes_blueprints_and_runs(monkeypatch):
    seen = {}

    async def _purge(candidate_id, session_ids):
        seen.update(candidate_id=candidate_id, session_ids=session_ids)
        return {"deleted_blueprints": 2, "deleted_runs": 3}

    monkeypatch.setattr(store, "purge", _purge)
    out = asyncio.run(routes.purge_user(routes.PurgeUserRequest(candidate_id="c1", session_ids=["s1", "s2"])))
    assert out == {"deleted_blueprints": 2, "deleted_runs": 3}
    assert seen == {"candidate_id": "c1", "session_ids": ["s1", "s2"]}


def test_purge_request_caps_ids_at_1000():
    routes.PurgeUserRequest(session_ids=[str(i) for i in range(1000)])
    with pytest.raises(ValidationError):
        routes.PurgeUserRequest(session_ids=[str(i) for i in range(1001)])


def test_purge_route_requires_the_internal_key():
    route = next(r for r in routes.router.routes if getattr(r, "path", "") == "/users/purge")
    assert "POST" in route.methods
    assert any(d.dependency is routes.require_internal_key for d in route.dependencies)
