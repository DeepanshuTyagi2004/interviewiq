"""Run orchestration, the blueprint cache, one run per session, routes, purge and the diff."""
import asyncio

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.deps import require_internal_key
from app.blueprint import api as bp_api
from app.blueprint import pipeline, store
from app.blueprint.diff import diff
from app.blueprint.trace import RunTrace
from tests.blueprint.fixtures import request


class _Settings:
    blueprint_run_retention_days = 30
    blueprint_run_timeout_seconds = 5
    blueprint_selection_weights = ""


def test_fingerprint_ignores_trigger_and_options_but_not_inputs():
    a = pipeline.fingerprint(request())
    b = pipeline.fingerprint(request(trigger="refresh", options={"bypass_answer_key_cache": True}))
    c = pipeline.fingerprint(request(candidate_profile={"skills": ["Go"]}))
    assert a == b
    assert a[0] != c[0] and a[1]["profile"] != c[1]["profile"] and a[1]["jd"] == c[1]["jd"]


def test_identical_inputs_reuse_the_current_blueprint(monkeypatch):
    req = request(input_hash="h1")

    async def current(session_id):
        return {"version": 3, "input_hash": "h1", "briefing": {"interviewer_name": "Asha"}}

    async def update_run(run_id, patch):
        pass

    monkeypatch.setattr(store, "current_blueprint", current)
    monkeypatch.setattr(store, "update_run", update_run)
    trace = RunTrace("r1")
    out = asyncio.run(pipeline._pipeline("r1", req, _Settings(), trace))
    assert out == {"cached": True, "blueprint_version": 3, "briefing": {"interviewer_name": "Asha"}, "keep": False}
    assert all(s["status"] == "skipped" for s in trace.stages)


def test_a_second_start_for_the_same_session_returns_the_live_run(monkeypatch):
    async def insert(doc):
        raise store.RunAlreadyActive("bpr_live")

    monkeypatch.setattr(store, "insert_run", insert)
    out = asyncio.run(pipeline.start_run(request(), _Settings()))
    assert out == {"run_id": "bpr_live", "status": "running", "existing": True}


def _client() -> TestClient:
    app = FastAPI()
    app.include_router(bp_api.router)
    app.include_router(bp_api.admin_router)
    app.dependency_overrides[require_internal_key] = lambda: None
    return TestClient(app)


def test_session_runs_need_a_session_id_and_bench_runs_never_get_one(monkeypatch):
    started = []

    async def start(req, settings):
        started.append(req)
        return {"run_id": "bpr_x", "status": "running", "existing": False}

    monkeypatch.setattr(pipeline, "start_run", start)
    client = _client()
    body = request().model_dump(mode="json")
    body["session"]["session_id"] = None
    assert client.post("/blueprints/runs", json=body).status_code == 400
    assert client.post("/admin/blueprints/bench", json=request().model_dump(mode="json")).status_code == 200
    assert started[-1].session.session_id is None and started[-1].trigger == "bench"


def test_status_view_is_compact(monkeypatch):
    async def get_run(run_id, full=True):
        return {"run_id": run_id, "session_id": "s1", "status": "running", "stage": "selection",
                "stages": RunTrace(run_id).stages, "input_hash": "h"}

    monkeypatch.setattr(store, "get_run", get_run)
    body = _client().get("/blueprints/runs/bpr_1").json()
    assert body["stage"] == "selection" and len(body["steps"]) == 8 and "request" not in body


def test_purge_removes_blueprints_and_runs_by_candidate_and_sessions(monkeypatch):
    calls = []

    class _Coll:
        async def delete_many(self, q):
            calls.append(q)

            class R:
                deleted_count = 2
            return R()

    monkeypatch.setattr(store, "get_db", lambda: {store.BLUEPRINTS: _Coll(), store.RUNS: _Coll()})
    out = asyncio.run(store.purge("c1", ["s1"]))
    assert out == {"deleted_blueprints": 2, "deleted_runs": 2}
    assert calls[0] == {"$or": [{"candidate_id": "c1"}, {"session_id": {"$in": ["s1"]}}]}
    assert asyncio.run(store.purge(None, [])) == {"deleted_blueprints": 0, "deleted_runs": 0}


def test_diff_reports_changed_inputs_and_problems():
    old = {"version": 1, "input_parts": {"profile": "a", "jd": "x"}, "persona": {"name": "Asha"},
           "slots": [{"slot_id": "core-1", "problem": {"slug": "two-sum"}}]}
    new = {"version": 2, "input_parts": {"profile": "b", "jd": "x"}, "persona": {"name": "Asha"},
           "slots": [{"slot_id": "core-1", "problem": {"slug": "three-sum"}}]}
    d = diff(old, new)
    assert d["inputs_changed"] == ["profile"] and d["problems_changed"] == {"core-1": {"from": "two-sum", "to": "three-sum"}}
    assert not d["persona_changed"]


def test_startup_recovery_only_fails_runs_older_than_the_timeout(monkeypatch):
    seen = {}

    class _Coll:
        async def update_many(self, q, update):
            seen["q"] = q

            class R:
                modified_count = 1
            return R()

    monkeypatch.setattr(store, "get_db", lambda: {store.RUNS: _Coll()})
    assert asyncio.run(store.recover_interrupted_runs(30, 600)) == 1
    assert seen["q"]["status"] == "running" and "$lt" in seen["q"]["created_at"]
