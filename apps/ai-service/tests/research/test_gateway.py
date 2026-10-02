import asyncio

import pytest

from app.config import Settings
from app.research.budget import Budget, BudgetExhausted
from app.research.fixtures import FixtureMissing, FixtureStore
from app.research.gateway import ResearchIO
from app.research.memory_store import InMemoryResearchStore
from app.research.models import Mode
from app.research.store import EventFilter
from app.research.trace.context import CURRENT_COMPANY, CURRENT_NODE
from app.research.trace.tracer import Tracer, utcnow
from tests.research.fakes import Exploding, FakeExa, FakeLLM, result


def _settings(**kw) -> Settings:
    return Settings(_env_file=None).model_copy(update={"research_results_per_query": 2, **kw})


async def _io(tmp_path, *, mode=Mode.LIVE, exa=None, llm=None, exa_cap=10, llm_cap=10, store=None):
    store = store or InMemoryResearchStore()
    if await store.get_run("run1") is None:
        await store.insert_run({"run_id": "run1", "status": "running", "last_seq": 0, "created_at": utcnow(),
                                "budget": {"exa_used": 0, "llm_used": 0, "tokens_in": 0, "tokens_out": 0}})
        await store.insert_items([{"run_id": "run1", "company_id": "c1", "position": 0, "nodes": {}}])
    tracer = Tracer(store, "run1", secrets={}, flush_interval=0.01)
    budget = Budget(store, "run1", exa_cap=exa_cap, llm_cap=llm_cap)
    io = ResearchIO(mode=mode, exa=exa, llm=llm, fixtures=FixtureStore(tmp_path / "fx"), tracer=tracer,
                    budget=budget, store=store, settings=_settings())
    return io, store, tracer


def _bind():
    return CURRENT_COMPANY.set("c1"), CURRENT_NODE.set("resolve")


def test_live_search_truncates_charges_budget_counts_per_node_and_remembers_sources(tmp_path):
    async def go():
        exa = FakeExa(lambda q: [result("https://a.com"), result("https://b.com"), result("https://c.com")])
        io, store, tracer = await _io(tmp_path, exa=exa)
        c, n = _bind()
        try:
            results = await io.search("Meesho company", company_slug="meesho", kind="resolve")
        finally:
            CURRENT_NODE.reset(n)
            CURRENT_COMPANY.reset(c)
        await tracer.close()
        assert [r["url"] for r in results] == ["https://a.com", "https://b.com"]
        assert exa.calls == ["Meesho company"]
        run = await store.get_run("run1")
        assert run["budget"]["exa_used"] == 1
        (item,) = await store.list_items("run1")
        assert item["nodes"]["resolve"]["exa_calls"] == 1
        assert store.sources["https://a.com"]["kinds"] == ["resolve"]
        assert store.sources["https://a.com"]["content_hash"].startswith("sha256:")
        (span,) = await store.list_spans("run1")
        full = await store.get_span(span["span_id"])
        assert span["kind"] == "exa" and full["output"]["count"] == 2
    asyncio.run(go())


def test_record_then_replay_serves_identical_results_without_calling_exa(tmp_path):
    async def go():
        exa = FakeExa(lambda q: [result("https://a.com")])
        io, _, t1 = await _io(tmp_path, mode=Mode.RECORD, exa=exa)
        recorded = await io.search("Meesho company", company_slug="meesho", kind="resolve")
        await t1.close()
        io2, store2, t2 = await _io(tmp_path, mode=Mode.REPLAY, exa=Exploding())
        replayed = await io2.search("Meesho company", company_slug="meesho", kind="resolve")
        await t2.close()
        assert replayed == recorded
        assert (await store2.get_run("run1"))["budget"]["exa_used"] == 0
        assert list((tmp_path / "fx" / "meesho").glob("exa-*.json"))
    asyncio.run(go())


def test_replay_miss_fails_loudly_with_how_to_fix(tmp_path):
    async def go():
        io, _, t = await _io(tmp_path, mode=Mode.REPLAY, exa=Exploding())
        with pytest.raises(FixtureMissing, match="RESEARCH_MODE=record"):
            await io.search("never recorded", company_slug="meesho", kind="resolve")
        await t.close()
    asyncio.run(go())


def test_extract_cache_reuses_identical_calls_and_emits_cache_hit(tmp_path):
    async def go():
        llm = FakeLLM(lambda s, u, label: {"answer": 42})
        io, store, tracer = await _io(tmp_path, llm=llm)
        kwargs = dict(prompt_name="p", prompt_version="v1", system="sys", user="user", company_slug="meesho", label="t")
        first = await io.extract_json(**kwargs)
        second = await io.extract_json(**kwargs)
        await tracer.close()
        assert first == second == {"answer": 42}
        assert llm.calls == ["t"]
        run = await store.get_run("run1")
        assert run["budget"]["llm_used"] == 1
        assert (run["budget"]["tokens_in"], run["budget"]["tokens_out"]) == (100, 20)
        events = await store.list_events("run1", EventFilter(type_prefix="cache.hit"))
        assert len(events) == 1
        llm_spans = [s for s in await store.list_spans("run1") if s["kind"] == "llm"]
        assert [s["attrs"]["cache"] for s in llm_spans] == ["miss", "hit"]
        assert llm_spans[0]["attrs"]["tokens_in"] == 100
    asyncio.run(go())


def test_record_mode_bypasses_the_extract_cache(tmp_path):
    async def go():
        llm = FakeLLM(lambda s, u, label: {"answer": 1})
        io, _, tracer = await _io(tmp_path, mode=Mode.RECORD, llm=llm)
        kwargs = dict(prompt_name="p", prompt_version="v1", system="s", user="u", company_slug="meesho", label="t")
        await io.extract_json(**kwargs)
        await io.extract_json(**kwargs)
        await tracer.close()
        assert llm.calls == ["t", "t"]
    asyncio.run(go())


def test_exhausted_budget_raises_before_any_call(tmp_path):
    async def go():
        llm = FakeLLM(lambda s, u, label: {"a": 1})
        io, _, tracer = await _io(tmp_path, llm=llm, llm_cap=0)
        with pytest.raises(BudgetExhausted) as caught:
            await io.extract_json(prompt_name="p", prompt_version="v1", system="s", user="u", company_slug="m", label="t")
        await tracer.close()
        assert caught.value.kind == "llm" and llm.calls == []
    asyncio.run(go())


def _needs_answer(data: dict) -> None:
    if "answer" not in data:
        raise ValueError("missing answer")


def test_response_failing_validate_is_not_cached(tmp_path):
    async def go():
        llm = FakeLLM(lambda s, u, label: {"bad": 1})
        io, store, tracer = await _io(tmp_path, llm=llm)
        kwargs = dict(prompt_name="p", prompt_version="v1", system="s", user="u", company_slug="m", label="t",
                      validate=_needs_answer)
        for _ in range(2):
            with pytest.raises(ValueError, match="missing answer"):
                await io.extract_json(**kwargs)
        await tracer.close()
        assert llm.calls == ["t", "t"]
        llm_spans = [s for s in await store.list_spans("run1") if s["kind"] == "llm"]
        assert [s["status"] for s in llm_spans] == ["error", "error"]
    asyncio.run(go())


def test_cached_value_failing_validate_is_asked_again(tmp_path):
    async def go():
        llm = FakeLLM(lambda s, u, label: {"answer": 2})
        io, store, tracer = await _io(tmp_path, llm=llm)
        base = dict(prompt_name="p", prompt_version="v1", system="s", user="u", company_slug="m", label="t")
        await io.extract_json(**base)  # caches {"answer": 2}
        key = next(iter(store.extracts))
        store.extracts[key]["output"] = {"stale": True}
        out = await io.extract_json(**base, validate=_needs_answer)
        again = await io.extract_json(**base, validate=_needs_answer)
        await tracer.close()
        assert out == again == {"answer": 2}
        assert llm.calls == ["t", "t"]
    asyncio.run(go())
