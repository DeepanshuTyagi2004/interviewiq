### Task 5: AI service — `POST /users/purge`

**Files:**
- Modify: `apps/ai-service/app/db/repositories.py` (append under the `interview_plans` section)
- Modify: `apps/ai-service/app/api/routes.py` (request model + route; module docstring list)
- Test: `apps/ai-service/tests/test_user_purge.py`

**Interfaces:**
- Produces:
  - `repo.delete_plans_for_sessions(session_ids: list[str]) -> int`
  - `routes.PurgeUserRequest(session_ids: list[str], max 1000)`
  - `routes.purge_user(req) -> {"deleted_plans": int}` at `POST /users/purge` (internal key)

- [ ] **Step 1: Write the failing test** (`apps/ai-service/tests/test_user_purge.py`)

```python
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/ai-service && .venv/bin/python -m pytest -q tests/test_user_purge.py`
Expected: FAIL with `AttributeError` (no `purge_user` / `delete_plans_for_sessions`).

- [ ] **Step 3: Repository function** (`apps/ai-service/app/db/repositories.py`, after `get_plan`)

```python
async def delete_plans_for_sessions(session_ids: list[str]) -> int:
    """Account deletion: drop the stored plans for these sessions. Returns how many were removed."""
    if not session_ids:
        return 0
    result = await get_db()[INTERVIEW_PLANS].delete_many({"sessionId": {"$in": session_ids}})
    return result.deleted_count
```

- [ ] **Step 4: Route** (`apps/ai-service/app/api/routes.py`)

Extend the pydantic import to `from pydantic import BaseModel, Field, ValidationError`. Add the line `- POST /users/purge                           — internal key; account deletion, drop the user's interview plans` to the module docstring list. Then add, next to the interview-plan routes:

```python
class PurgeUserRequest(BaseModel):
    """Every interview-session id the deleted account owned (the API batches in 1000s)."""

    session_ids: list[str] = Field(default_factory=list, max_length=1000)


@router.post("/users/purge", dependencies=[Depends(require_internal_key)])
async def purge_user(req: PurgeUserRequest) -> dict:
    """Account deletion: remove everything stored for these sessions (their interview plans).
    Idempotent — purging already-deleted sessions removes nothing and still succeeds."""
    deleted = await repo.delete_plans_for_sessions(req.session_ids)
    return {"deleted_plans": deleted}
```

- [ ] **Step 5: Run the tests**

Run: `cd apps/ai-service && .venv/bin/python -m pytest -q tests/test_user_purge.py tests/test_interview_plan_endpoint.py`
Expected: PASS.

---

