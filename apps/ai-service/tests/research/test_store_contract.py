"""One behavioural contract, two stores. The Mongo half runs only when RESEARCH_TEST_MONGO_URL points
at a server you can create throwaway databases on (e.g. the Atlas dev cluster):

    RESEARCH_TEST_MONGO_URL='mongodb+srv://…' .venv/bin/python -m pytest tests/research/test_store_contract.py -q
"""
import asyncio
import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.research.memory_store import InMemoryResearchStore
from app.research.store import LEVEL_RANK, DuplicateKey, EventFilter, MongoResearchStore, ensure_research_indexes

T0 = datetime(2026, 10, 2, 10, 0, tzinfo=timezone.utc)


async def _noop() -> None:
    return None


@pytest.fixture(params=["memory", "mongo"])
def make_store(request):
    if request.param == "memory":
        async def make_memory():
            return InMemoryResearchStore(), _noop
        return make_memory
    url = os.environ.get("RESEARCH_TEST_MONGO_URL")
    if not url:
        pytest.skip("RESEARCH_TEST_MONGO_URL not set")

    async def make_mongo():
        from motor.motor_asyncio import AsyncIOMotorClient
        client = AsyncIOMotorClient(url, tz_aware=True)
        db = client[f"research_contract_{uuid.uuid4().hex[:10]}"]
        await ensure_research_indexes(db, ttl_days=1)

        async def cleanup():
            await client.drop_database(db.name)
            client.close()
        return MongoResearchStore(db), cleanup
    return make_mongo


def _run(make_store, scenario):
    async def go():
        store, cleanup = await make_store()
        try:
            await scenario(store)
        finally:
            await cleanup()
    asyncio.run(go())


def _run_doc(run_id, status="running", created_at=T0):
    return {"run_id": run_id, "status": status, "control": "none", "created_at": created_at,
            "counters": {"done": 0}, "budget": {"exa_used": 0}, "last_seq": 0, "targets": [{"id": "c1"}]}


def _event(seq, *, level="info", type_="log", message="hello", span_id=None, company_id=None, node=None):
    return {"run_id": "r1", "seq": seq, "ts": T0, "level": level, "level_rank": LEVEL_RANK[level],
            "type": type_, "message": message, "span_id": span_id, "company_id": company_id, "node": node}


def test_runs_support_dotted_updates_and_never_leak_mongo_ids(make_store):
    async def scenario(store):
        await store.insert_run(_run_doc("r1"))
        updated = await store.update_run("r1", fields={"status": "paused", "budget.exa_cap": 9}, inc={"counters.done": 2})
        assert updated["status"] == "paused"
        assert updated["budget"] == {"exa_used": 0, "exa_cap": 9}
        assert updated["counters"]["done"] == 2
        assert "_id" not in (await store.get_run("r1"))
        assert await store.get_run("nope") is None
        assert await store.update_run("nope", fields={"status": "x"}) is None
    _run(make_store, scenario)


def test_active_run_and_listing_orders(make_store):
    async def scenario(store):
        await store.insert_run(_run_doc("old", status="completed", created_at=T0))
        await store.insert_run(_run_doc("new", status="paused", created_at=T0 + timedelta(minutes=1)))
        assert (await store.find_active_run())["run_id"] == "new"
        listed = await store.list_runs(10)
        assert [r["run_id"] for r in listed] == ["new", "old"]
        assert all("targets" not in r for r in listed)
        assert [r["run_id"] for r in await store.find_runs_by_status(["completed", "paused"])] == ["old", "new"]
    _run(make_store, scenario)


def test_items_keep_queue_order_and_take_dotted_updates(make_store):
    async def scenario(store):
        await store.insert_items([
            {"run_id": "r1", "company_id": "b", "position": 1, "status": "queued", "nodes": {}},
            {"run_id": "r1", "company_id": "a", "position": 0, "status": "queued", "nodes": {}},
            {"run_id": "r2", "company_id": "a", "position": 0, "status": "queued", "nodes": {}},
        ])
        await store.update_item("r1", "a", fields={"nodes.resolve.status": "ok"}, inc={"nodes.resolve.llm_calls": 1})
        items = await store.list_items("r1")
        assert [i["company_id"] for i in items] == ["a", "b"]
        assert items[0]["nodes"] == {"resolve": {"status": "ok", "llm_calls": 1}}
        assert all("_id" not in i for i in items)
    _run(make_store, scenario)


def test_spans_upsert_and_list_without_payloads(make_store):
    async def scenario(store):
        base = {"span_id": "s1", "run_id": "r1", "company_id": "c1", "parent_id": None, "kind": "node",
                "name": "resolve", "status": "running", "started_at": T0, "input": {"q": 1}, "output": None}
        await store.put_span(base)
        await store.put_span({**base, "status": "ok", "output": {"ok": True}})
        full = await store.get_span("s1")
        assert full["status"] == "ok" and full["input"] == {"q": 1} and full["output"] == {"ok": True}
        listed = await store.list_spans("r1")
        assert len(listed) == 1 and "input" not in listed[0] and "output" not in listed[0]
        assert await store.list_spans("r1", company_id="other") == []
    _run(make_store, scenario)


def test_event_filters_and_pages(make_store):
    async def scenario(store):
        await store.insert_events([
            _event(1, type_="run.started", message="starting run"),
            _event(2, level="debug", type_="span.start", span_id="s1", company_id="c1", node="resolve"),
            _event(3, level="warn", message="Meesho is slow", company_id="c1", node="resolve"),
            _event(4, level="error", type_="span.end", span_id="s1", company_id="c1", node="resolve"),
            _event(5, message="other company", company_id="c2"),
        ])
        seqs = lambda rows: [e["seq"] for e in rows]  # noqa: E731
        assert seqs(await store.list_events("r1", EventFilter(after_seq=2))) == [3, 4, 5]
        assert seqs(await store.list_events("r1", EventFilter(before_seq=5, limit=2))) == [3, 4]
        assert seqs(await store.list_events("r1", EventFilter(min_level="warn"))) == [3, 4]
        assert seqs(await store.list_events("r1", EventFilter(type_prefix="span."))) == [2, 4]
        assert seqs(await store.list_events("r1", EventFilter(q="MEESHO"))) == [3]
        assert seqs(await store.list_events("r1", EventFilter(span_id="s1"))) == [2, 4]
        assert seqs(await store.list_events("r1", EventFilter(company_id="c1", node="resolve"))) == [2, 3, 4]
        assert seqs(await store.list_events("r1", EventFilter(limit=2))) == [1, 2]
    _run(make_store, scenario)


def test_drafts_latest_by_version_and_supersede(make_store):
    async def scenario(store):
        await store.insert_draft({"draft_id": "d1", "company_id": "c1", "version": 1, "status": "approved"})
        await store.insert_draft({"draft_id": "d2", "company_id": "c1", "version": 2, "status": "pending_review"})
        assert (await store.latest_draft("c1"))["draft_id"] == "d2"
        assert (await store.latest_draft("c1", status="approved"))["draft_id"] == "d1"
        assert await store.supersede_pending_drafts("c1") == 1
        assert (await store.latest_draft("c1"))["status"] == "superseded"
        assert await store.latest_draft("nope") is None
    _run(make_store, scenario)


def test_company_state_upsert_and_filter(make_store):
    async def scenario(store):
        await store.upsert_company_state("c1", fields={"last_status": "queued"})
        await store.upsert_company_state("c1", fields={"last_status": "done", "last_researched_at": T0})
        await store.upsert_company_state("c2", fields={"last_status": "failed"})
        one = await store.list_company_states(["c1"])
        assert one == [{"company_id": "c1", "last_status": "done", "last_researched_at": T0}]
        assert len(await store.list_company_states()) == 2
    _run(make_store, scenario)


def test_sources_merge_kinds_and_extract_cache_roundtrip(make_store):
    async def scenario(store):
        await store.upsert_source({"url": "https://a.com", "text": "v1", "kinds": ["resolve"]})
        await store.upsert_source({"url": "https://a.com", "text": "v2", "kinds": ["resolve", "profile"]})
        source = await store.get_source("https://a.com")
        assert source["kinds"] == ["resolve", "profile"]
        assert source["text"] == "v2"
        await store.put_payload({"payload_id": "p1", "run_id": "r1", "body": {"big": True}, "created_at": T0})
        assert (await store.get_payload("p1"))["body"] == {"big": True}
        await store.put_extract({"key": "k1", "output": {"a": 1}, "created_at": T0})
        await store.put_extract({"key": "k1", "output": {"a": 2}, "created_at": T0})
        assert (await store.get_extract("k1"))["output"] == {"a": 2}
        assert await store.get_extract("missing") is None
    _run(make_store, scenario)


def test_duplicate_keys_raise_on_all_collections(make_store):
    async def scenario(store):
        # runs: verify state unchanged after duplicate attempt
        await store.insert_run(_run_doc("r1"))
        with pytest.raises(DuplicateKey):
            await store.insert_run(_run_doc("r1"))
        assert (await store.get_run("r1"))["status"] == "running"  # original intact
        # items: verify state unchanged after duplicate attempts
        await store.insert_items([{"run_id": "r1", "company_id": "c1", "position": 0, "status": "queued", "nodes": {}}])
        with pytest.raises(DuplicateKey):
            await store.insert_items([{"run_id": "r1", "company_id": "c1", "position": 1, "status": "queued", "nodes": {}}])
        items = await store.list_items("r1")
        assert len(items) == 1 and items[0]["company_id"] == "c1"  # not added
        with pytest.raises(DuplicateKey):
            await store.insert_items([
                {"run_id": "r1", "company_id": "c2", "position": 1, "status": "queued", "nodes": {}},
                {"run_id": "r1", "company_id": "c2", "position": 2, "status": "queued", "nodes": {}},
            ])
        items = await store.list_items("r1")
        assert len(items) == 1  # neither added (batch rejected)
        # events: verify state unchanged after duplicate attempts
        await store.insert_events([_event(1)])
        with pytest.raises(DuplicateKey):
            await store.insert_events([_event(1)])
        assert await store.max_event_seq("r1") == 1
        with pytest.raises(DuplicateKey):
            await store.insert_events([_event(2), _event(2)])
        assert await store.max_event_seq("r1") == 1  # neither 2 added (batch rejected)
        # payloads: verify state unchanged after duplicate attempt
        await store.put_payload({"payload_id": "p1", "run_id": "r1", "body": {}, "created_at": T0})
        with pytest.raises(DuplicateKey):
            await store.put_payload({"payload_id": "p1", "run_id": "r1", "body": {}, "created_at": T0})
        assert (await store.get_payload("p1"))["body"] == {}  # original intact
        # drafts: verify state unchanged after duplicate attempts
        await store.insert_draft({"draft_id": "d1", "company_id": "c1", "version": 1, "status": "pending_review"})
        with pytest.raises(DuplicateKey):
            await store.insert_draft({"draft_id": "d1", "company_id": "c2", "version": 2, "status": "pending_review"})
        assert (await store.latest_draft("c1"))["draft_id"] == "d1"  # original intact
        with pytest.raises(DuplicateKey):
            await store.insert_draft({"draft_id": "d2", "company_id": "c1", "version": 1, "status": "pending_review"})
        assert (await store.latest_draft("c1"))["version"] == 1  # no d2 added
    _run(make_store, scenario)


def test_max_event_seq(make_store):
    async def scenario(store):
        assert await store.max_event_seq("r1") == 0
        await store.insert_events([_event(1), _event(5), _event(3)])
        assert await store.max_event_seq("r1") == 5
        assert await store.max_event_seq("r2") == 0
    _run(make_store, scenario)


def test_ttl_indexes_can_be_reindexed(request):
    """Mongo-only: verify ensure_research_indexes creates and updates TTL indexes."""
    url = os.environ.get("RESEARCH_TEST_MONGO_URL")
    if not url:
        pytest.skip("RESEARCH_TEST_MONGO_URL not set")

    async def go():
        from motor.motor_asyncio import AsyncIOMotorClient
        client = AsyncIOMotorClient(url, tz_aware=True)
        db = client[f"research_contract_{uuid.uuid4().hex[:10]}"]
        try:
            # Create indexes with ttl_days=1 (86400 seconds)
            await ensure_research_indexes(db, ttl_days=1)
            indexes_events = await db["research_events"].index_information()
            assert "ts_ttl" in indexes_events
            assert indexes_events["ts_ttl"]["expireAfterSeconds"] == 86400
            indexes_payloads = await db["research_payloads"].index_information()
            assert "created_at_ttl" in indexes_payloads
            assert indexes_payloads["created_at_ttl"]["expireAfterSeconds"] == 86400
            # Re-run with ttl_days=2 (172800 seconds)
            await ensure_research_indexes(db, ttl_days=2)
            indexes_events = await db["research_events"].index_information()
            assert indexes_events["ts_ttl"]["expireAfterSeconds"] == 172800
            indexes_payloads = await db["research_payloads"].index_information()
            assert indexes_payloads["created_at_ttl"]["expireAfterSeconds"] == 172800
        finally:
            await client.drop_database(db.name)
            client.close()
    asyncio.run(go())
