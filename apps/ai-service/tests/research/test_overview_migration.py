"""Overview rollout boundaries: never resume a legacy graph or rewrite detailed history."""
import asyncio
from copy import deepcopy

import pytest

from app.research.memory_store import InMemoryResearchStore
from app.research.models import NODE_ORDER, PIPELINE_VERSION, InvalidTransition, field
from app.research.nodes.write_draft import write_draft
from app.research.trace.tracer import utcnow
from tests.research.fakes import Exploding
from tests.research.helpers import MEESHO, make_runner, wired_deps


@pytest.mark.parametrize("status", ["queued", "running", "pausing", "paused", "stopping"])
@pytest.mark.parametrize("last_node", ["resolve", "profile", "compensation", "roles"])
def test_startup_fails_legacy_runs_without_providers_and_preserves_checkpoints(tmp_path, status, last_node):
    async def go():
        store = InMemoryResearchStore()
        saved = {"company": MEESHO.as_dict(), "compensation": {"legacy": True}, "roles": [{"role_key": "legacy"}]}
        await store.insert_run({"run_id": "old", "pipeline_version": "research-v4", "status": status,
                                "control": "none", "created_at": utcnow(), "last_seq": 0,
                                "counters": {"total": 1, "running": 1, "failed": 0}})
        await store.insert_items([{"run_id": "old", "company_id": MEESHO.id, "position": 0,
                                   "status": "running", "last_node": last_node, "state": saved}])
        runner, _ = make_runner(store, tmp_path, exa=Exploding(), llm=Exploding())
        await runner.recover_on_startup()
        await runner.wait_idle()
        run = await store.get_run("old")
        (item,) = await store.list_items("old")
        assert run["status"] == "failed" and "start a new overview run" in run["error"]
        assert run["counters"]["failed"] == 1 and run["counters"]["running"] == 0
        assert item["error"]["type"] == "PipelineVersionMismatch"
        assert item["state"] == saved and item["last_node"] == last_node
        assert not store.drafts
    asyncio.run(go())


@pytest.mark.parametrize("metadata,last_node", [
    ({}, "resolve"),
    ({"pipeline_version": "research-v4"}, "compensation"),
    ({"pipeline_version": PIPELINE_VERSION, "node_order": list(NODE_ORDER)}, "roles"),
    ({"pipeline_version": PIPELINE_VERSION, "node_order": ["resolve", "roles"]}, "resolve"),
])
def test_manual_resume_rejects_unversioned_or_incompatible_saved_graph(tmp_path, metadata, last_node):
    async def go():
        store = InMemoryResearchStore()
        await store.insert_run({"run_id": "old", "status": "paused", "control": "pause", "last_seq": 0,
                                "created_at": utcnow(), "counters": {"total": 1, "paused": 1, "failed": 0}, **metadata})
        await store.insert_items([{"run_id": "old", "company_id": MEESHO.id, "position": 0,
                                   "status": "paused", "last_node": last_node, "state": {"saved": True}}])
        runner, _ = make_runner(store, tmp_path, exa=Exploding(), llm=Exploding())
        with pytest.raises(InvalidTransition, match="start a new overview run"):
            await runner.resume("old")
        assert not runner.busy
        assert (await store.get_run("old"))["status"] == "failed"
        assert (await store.list_items("old"))[0]["state"] == {"saved": True}
        # The failed legacy run no longer blocks a new overview run.
        fresh, _ = make_runner(store, tmp_path, targets=[MEESHO])
        new = await fresh.start_run(trigger="admin", scope="selected", company_ids=[MEESHO.id])
        await fresh.wait_idle()
        assert (await store.get_run(new["run_id"]))["status"] == "completed"
    asyncio.run(go())


def test_overview_draft_keeps_historical_full_snapshot_readable_and_omits_removal_diff(tmp_path):
    async def go():
        store = InMemoryResearchStore()
        old = {"draft_id": "historical", "company_id": MEESHO.id, "version": 3, "status": "approved",
               "pipeline_version": "research-v4", "created_at": utcnow(),
               "snapshot": {"identity": {}, "profile": {}, "compensation": {"wlb_rating": {"value": 4}},
                            "roles": [{"role_key": "legacy", "jd": {"value": "saved JD"}}]}}
        await store.insert_draft(deepcopy(old))
        deps, tracer, state = await wired_deps(store, tmp_path)
        # Defense in depth: even if a caller supplies old sections, new suggestions cannot contain them.
        out = await write_draft({**state, **old["snapshot"], "profile": {
            "overview": field("A sourced overview", confidence="high", provenance="evidence", source_urls=["https://meesho.com"])
        }}, deps)
        await tracer.close()
        assert await store.get_draft("historical") == old
        new = await store.get_draft(out["draft"]["draft_id"])
        assert new["version"] == 4 and new["scope"] == "overview"
        assert set(new["snapshot"]) == {"identity", "profile"}
        assert all(not d["path"].startswith(("compensation", "roles")) for d in new["diff"])
        assert new["coverage"] == {"filled": 1, "total": 7, "missing": [
            "profile.sector", "profile.business_model", "profile.hq", "profile.headcount_band",
            "profile.revenue_band", "profile.funding_stage"]}
    asyncio.run(go())
