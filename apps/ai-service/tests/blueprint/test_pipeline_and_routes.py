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


def test_fingerprint_carries_the_prep_version_hashed_the_way_the_api_does():
    import hashlib
    assert pipeline.PREP_VERSION == "packs-1"
    assert pipeline.fingerprint(request())[1]["prep"] == hashlib.sha256(b'"packs-1"').hexdigest()[:16]


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


def _assembled(round_type: str, level: str = "sde1"):
    """What the pipeline's last stages put on a Blueprint: the pack's policies and the composed rules block."""
    from app.blueprint.models import RulesBlock
    from app.blueprint.policies import policies as policy_template
    from app.rounds.compose import compose_rules
    pol = policy_template(round_type)
    rules = RulesBlock(**compose_rules(round_type, level, focus=None))
    return pol, rules


def test_a_system_design_blueprint_carries_its_rules_block_and_pol2_without_change_language():
    pol, rules = _assembled("system-design")
    doc = {"rules": rules.model_dump(mode="json"), "policies": pol.model_dump(mode="json")}
    assert doc["rules"]["pack"] == "system-design" and doc["rules"]["version"] == "rules2" and doc["rules"]["focus"] is None
    assert doc["policies"]["version"] == "pol2"
    assert "change_language" not in [r["kind"] for r in doc["policies"]["requests"]]


def test_a_dsa_blueprint_keeps_todays_fourteen_request_policies():
    from app.blueprint.policies import _REQUESTS
    pol, rules = _assembled("dsa")
    assert [(r.kind, r.decision, r.how) for r in pol.requests] == list(_REQUESTS) and rules.pack == "dsa"
    assert pol.time_management.endswith("then move on. Never cut the candidate questions or wrap-up phases.")
    assert "final approach and complexity" in pol.time_management


def test_policies_without_a_round_type_is_todays_content_as_pol2():
    from app.blueprint.policies import _GENERAL, _REQUESTS, policies
    pol = policies()
    assert pol.version == "pol2" and [(r.kind, r.decision, r.how) for r in pol.requests] == list(_REQUESTS)
    assert pol.time_management == _GENERAL["time_management"]


def test_pack_overrides_replace_drop_and_append_request_policies_and_general_text():
    from app.blueprint.policies import policies
    hm = {r.kind: r for r in policies("hiring-manager").requests}
    assert "change_language" not in hm and hm["ask_about_compensation"].decision == "decline" and len(hm) == 14
    assert hm["ask_hint"].decision == "comply" and "kind of example" in hm["ask_hint"].how
    assert "final approach" not in policies("online-assessment").time_management
    for rt in ("system-design", "lld"):
        assert "main trade-off" in policies(rt).time_management
    for rt in ("behavioural", "hiring-manager"):
        assert "finish the answer" in policies(rt).time_management


def test_the_saved_persona_seniority_is_the_drawn_title_whatever_the_model_returns():
    from app.blueprint import realism as R
    from app.blueprint import stages as ST
    from app.blueprint.context import build_context
    from app.rounds.compose import band_for, pack_for
    from tests.blueprint.fixtures import FakeLLM, MemoryTrace

    class _S:
        blueprint_concurrency = 2
        blueprint_parallel = 2
        blueprint_quota_retries = 0
        blueprint_transient_retries = 0
    reply = {"persona": {"name": "Asha Rao", "seniority": "Intern Wizard", "style": "calm, asks why", "disposition": "patient and kind",
                         "opening": "Hi, I'm Asha. How's your day?", "closing": "Thanks for your time today!"},
             "phase_guidance": [{"phase": "greeting", "guidance": "warm hello and name"}]}
    for round_type in ("system-design", "dsa"):
        ctx = build_context(request(round_type, round={"type": round_type, "duration_mins": 45}))
        pack, band = pack_for(round_type), band_for(ctx.level)
        wanted = R.draw_seniority(7, pack, band, ctx.level)
        llm = FakeLLM({"persona": dict(reply)})
        out = asyncio.run(ST.persona_stage(ctx, [], llm, MemoryTrace(), _S(), seed="x", pack=pack, band=band, seniority=wanted))
        assert out.persona.seniority == wanted != "Intern Wizard"
        assert f"The persona's seniority is {wanted}." in llm.calls[0][1]
        assert ("Who this interviewer is" in llm.calls[0][1]) == bool(pack.archetype)
    assert pack_for("dsa").focuses == () and pack_for("system-design").focuses
