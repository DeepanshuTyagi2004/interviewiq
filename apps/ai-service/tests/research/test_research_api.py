"""Route functions are called directly (the repo's pattern: no TestClient, so no lifespan / Mongo).
Annotated[...] parameters keep plain-Python defaults, so a direct call needs only what it sets."""
import asyncio
import json

from fastapi.responses import JSONResponse

import app.research.api as api
from app.research.memory_store import InMemoryResearchStore
from tests.research.helpers import make_runner


def _body(resp):
    assert isinstance(resp, JSONResponse)
    return resp.status_code, json.loads(resp.body)


def test_start_then_conflict_then_detail(tmp_path):
    async def go():
        runner, _ = make_runner(InMemoryResearchStore(), tmp_path)
        run = await api.start_run(api.StartRunBody(scope="all"), runner=runner)
        assert run["status"] == "queued" and "targets" not in run
        status, body = _body(await api.start_run(api.StartRunBody(scope="all"), runner=runner))
        assert status == 409 and body["code"] == "run_active" and body["run_id"] == run["run_id"]
        await runner.wait_idle()
        detail = await api.get_run(run["run_id"], runner=runner)
        assert detail["run"]["status"] == "completed"
        assert all("state" not in i and "target" not in i for i in detail["items"])
        listed = await api.list_runs(runner=runner)
        assert [r["run_id"] for r in listed["runs"]] == [run["run_id"]]
    asyncio.run(go())


def test_selected_scope_with_unknown_ids_is_400(tmp_path):
    async def go():
        runner, _ = make_runner(InMemoryResearchStore(), tmp_path)
        status, body = _body(await api.start_run(api.StartRunBody(scope="selected", company_ids=["nope"]), runner=runner))
        assert status == 400 and body["code"] == "no_companies"
    asyncio.run(go())


def test_controls_map_errors_to_404_and_409(tmp_path):
    async def go():
        runner, _ = make_runner(InMemoryResearchStore(), tmp_path)
        status, body = _body(await api.pause_run("0" * 32, runner=runner))
        assert status == 404 and body["code"] == "run_not_found"
        run = await api.start_run(api.StartRunBody(), runner=runner)
        await runner.wait_idle()
        status, body = _body(await api.resume_run(run["run_id"], runner=runner))
        assert status == 409 and body["code"] == "invalid_transition"
        status, body = _body(await api.patch_budget(run["run_id"], api.BudgetBody(llm_cap=0), runner=runner))
        assert status == 400 and body["code"] == "invalid_budget"
    asyncio.run(go())


def test_events_spans_and_span_detail(tmp_path):
    async def go():
        runner, _ = make_runner(InMemoryResearchStore(), tmp_path)
        run = await api.start_run(api.StartRunBody(), runner=runner)
        await runner.wait_idle()
        page = await api.run_events(run["run_id"], runner=runner, level="info")
        assert page["last_seq"] >= len(page["events"]) > 0
        assert all(e["level_rank"] >= 20 for e in page["events"])
        older = await api.run_events(run["run_id"], runner=runner, before_seq=page["last_seq"], limit=3)
        assert len(older["events"]) == 3 and older["events"][-1]["seq"] == page["last_seq"] - 1
        spans = (await api.run_spans(run["run_id"], runner=runner, company_id="c-meesho"))["spans"]
        llm = next(s for s in spans if s["kind"] == "llm")
        detail = await api.get_span(llm["span_id"], runner=runner)
        assert detail["span"]["input"]["prompt_name"] == "resolve_company"
        assert [e["type"] for e in detail["logs"]][0] == "span.start"
        status, body = _body(await api.get_span("f" * 32, runner=runner))
        assert status == 404 and body["code"] == "span_not_found"
    asyncio.run(go())


def test_company_states_endpoint(tmp_path):
    async def go():
        runner, _ = make_runner(InMemoryResearchStore(), tmp_path)
        await api.start_run(api.StartRunBody(), runner=runner)
        await runner.wait_idle()
        got = await api.companies_state(runner=runner, ids="c-meesho")
        assert [s["company_id"] for s in got["states"]] == ["c-meesho"]
        assert got["states"][0]["latest_draft_status"] == "pending_review"
    asyncio.run(go())


def test_disabled_research_is_503():
    async def go():
        status, body = _body(await api.list_runs(runner=None))
        assert status == 503 and body["code"] == "research_disabled"
    asyncio.run(go())
