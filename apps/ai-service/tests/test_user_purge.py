"""POST /users/purge (account deletion): drops the user's interview blueprints, blueprint runs and live interviews.

Route called directly with the HTTP layer bypassed."""
import asyncio

import pytest
from pydantic import ValidationError

import app.api.routes as routes
from app.blueprint import store
from app.evaluation import store as evaluation_store
from app.interviewer import store as live_store


def test_purge_route_deletes_blueprints_runs_and_live_interviews(monkeypatch):
    seen = {}

    async def _purge(candidate_id, session_ids):
        seen.update(candidate_id=candidate_id, session_ids=session_ids)
        return {"deleted_blueprints": 2, "deleted_runs": 3}

    async def _purge_live(candidate_id, session_ids):
        seen.update(live=(candidate_id, session_ids))
        return {"deleted_live_runs": 1, "deleted_live_turns": 40, "deleted_live_briefs": 12, "deleted_live_evidence": 5}

    monkeypatch.setattr(store, "purge", _purge)
    monkeypatch.setattr(live_store, "purge", _purge_live)

    async def _purge_evaluations(candidate_id, session_ids):
        seen.update(evaluations=(candidate_id, session_ids))
        return {"deleted_evaluations": 4, "deleted_evaluation_runs": 6}

    monkeypatch.setattr(evaluation_store, "purge", _purge_evaluations)
    out = asyncio.run(routes.purge_user(routes.PurgeUserRequest(candidate_id="c1", session_ids=["s1", "s2"])))
    assert out == {"deleted_blueprints": 2, "deleted_runs": 3, "deleted_live_runs": 1, "deleted_live_turns": 40,
                   "deleted_live_briefs": 12, "deleted_live_evidence": 5, "deleted_evaluations": 4,
                   "deleted_evaluation_runs": 6}
    assert seen == {"candidate_id": "c1", "session_ids": ["s1", "s2"], "live": ("c1", ["s1", "s2"]),
                    "evaluations": ("c1", ["s1", "s2"])}


def test_purge_request_caps_ids_at_1000():
    routes.PurgeUserRequest(session_ids=[str(i) for i in range(1000)])
    with pytest.raises(ValidationError):
        routes.PurgeUserRequest(session_ids=[str(i) for i in range(1001)])


def test_purge_route_requires_the_internal_key():
    route = next(r for r in routes.router.routes if getattr(r, "path", "") == "/users/purge")
    assert "POST" in route.methods
    assert any(d.dependency is routes.require_internal_key for d in route.dependencies)
