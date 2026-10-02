"""POST /users/purge (account deletion): drops the user's interview plans by session id.

Route called directly with the HTTP layer bypassed, same style as test_interview_plan_endpoint.
"""
import asyncio

import pytest
from pydantic import ValidationError

import app.api.routes as routes
from app.db import repositories as repo


def test_purge_route_deletes_and_reports_count(monkeypatch):
    seen = {}

    async def _delete(ids):
        seen["ids"] = ids
        return 2

    monkeypatch.setattr(repo, "delete_plans_for_sessions", _delete)
    out = asyncio.run(routes.purge_user(routes.PurgeUserRequest(session_ids=["s1", "s2"])))
    assert out == {"deleted_plans": 2}
    assert seen["ids"] == ["s1", "s2"]


def test_purge_request_caps_ids_at_1000():
    routes.PurgeUserRequest(session_ids=[str(i) for i in range(1000)])
    with pytest.raises(ValidationError):
        routes.PurgeUserRequest(session_ids=[str(i) for i in range(1001)])


def test_purge_route_requires_the_internal_key():
    route = next(r for r in routes.router.routes if getattr(r, "path", "") == "/users/purge")
    assert "POST" in route.methods
    assert any(d.dependency is routes.require_internal_key for d in route.dependencies)


class _FakePlans:
    def __init__(self):
        self.filter = None

    async def delete_many(self, flt):
        self.filter = flt

        class _Result:
            deleted_count = 3

        return _Result()


def test_delete_plans_filters_by_session_ids(monkeypatch):
    plans = _FakePlans()
    monkeypatch.setattr(repo, "get_db", lambda: {repo.INTERVIEW_PLANS: plans})
    assert asyncio.run(repo.delete_plans_for_sessions(["a", "b"])) == 3
    assert plans.filter == {"sessionId": {"$in": ["a", "b"]}}


def test_delete_plans_is_a_noop_for_no_sessions(monkeypatch):
    def _no_db():
        raise AssertionError("the database must not be touched")

    monkeypatch.setattr(repo, "get_db", _no_db)
    assert asyncio.run(repo.delete_plans_for_sessions([])) == 0
