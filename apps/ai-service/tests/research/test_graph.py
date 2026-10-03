import asyncio

from app.research.graph import build_company_graph, is_transient
from app.research.memory_store import InMemoryResearchStore
from app.exa.client import ExaConfigError, ExaError
from app.llm.client import LLMError
from app.research.budget import BudgetExhausted
from app.research.fixtures import FixtureMissing
from tests.research.helpers import wired_deps


def test_graph_runs_all_nodes_in_order_and_tracks_node_progress(tmp_path):
    async def go():
        store = InMemoryResearchStore()
        deps, tracer, state = await wired_deps(store, tmp_path)
        graph = build_company_graph(deps, retry_initial_interval=0.01)
        updates = [u async for u in graph.astream(state, {"configurable": {"thread_id": "t"}}, stream_mode="updates")]
        await tracer.close()
        assert [next(iter(u)) for u in updates] == ["resolve", "profile", "write_draft"]
        (item,) = await store.list_items("run1")
        assert item["nodes"]["resolve"]["status"] == "ok" and item["nodes"]["write_draft"]["status"] == "ok"
        assert item["nodes"]["resolve"]["llm_calls"] == 1 and item["nodes"]["resolve"]["exa_calls"] == 1
        node_spans = [s for s in await store.list_spans("run1") if s["kind"] == "node"]
        assert [s["name"] for s in node_spans] == ["resolve", "profile", "write_draft"]
        resolve_span = await store.get_span(node_spans[0]["span_id"])
        assert "others" not in resolve_span["input"] and resolve_span["input"]["others_count"] == 0
    asyncio.run(go())


def test_transient_errors_are_exactly_the_retryable_ones():
    assert is_transient(ExaError("503"))
    assert is_transient(LLMError("429"))
    assert not is_transient(ExaConfigError("bad key"))
    assert not is_transient(BudgetExhausted("llm", 1, 1))
    assert not is_transient(FixtureMissing("x"))
    assert not is_transient(ValueError("bad output"))


from app.research import graph as graph_mod
from app.research.memory_store import InMemoryResearchStore as _Store
from tests.research.fakes import FakeExa, FakeLLM, resolve_answer, result
from tests.research.helpers import MEESHO, make_runner


def _clients(fail_label=None, fail_times=99):
    calls = {"n": 0}

    def search(q):
        if "company official website India" in q:
            return [result("https://meesho.com", title="Meesho — official site")]
        return [result("https://www.ambitionbox.com/reviews/meesho", title="Meesho Reviews",
                       content="Meesho reviews. Work-life balance 3.7.")]

    def extract(system, user, label):
        if label.startswith("resolve:"):
            return resolve_answer("Meesho", "https://meesho.com")
        if label == fail_label and calls["n"] < fail_times:
            calls["n"] += 1
            return LLMError("provider down")
        return {"claims": []}
    return FakeExa(search), FakeLLM(extract)


def test_failed_optional_section_is_unavailable_and_the_company_still_gets_a_draft(tmp_path):
    async def go():
        store = _Store()
        exa, llm = _clients(fail_label="profile:meesho")
        runner, _ = make_runner(store, tmp_path, targets=[MEESHO], exa=exa, llm=llm)
        run = await runner.start_run(trigger="admin", scope="all")
        await runner.wait_idle()
        (item,) = await store.list_items(run["run_id"])
        assert item["status"] == "done" and item["nodes"]["profile"]["status"] == "error"
        # Three graph attempts, each with one stored-source extraction retry, then degraded.
        assert llm.calls.count("profile:meesho") == 6
        draft = await store.get_draft(item["draft_id"])
        section = draft["snapshot"]["profile"]
        assert section["overview"]["provenance"] == "unavailable"
        assert section["overview"]["note"].startswith("Research failed: LLMError")
        assert any(n.startswith("profile: research failed (LLMError)") for n in draft["notes"])
        assert item["nodes"]["write_draft"]["status"] == "ok"
    asyncio.run(go())


def test_a_transient_error_that_clears_on_retry_is_ok(tmp_path):
    async def go():
        store = _Store()
        exa, llm = _clients(fail_label="profile:meesho", fail_times=1)
        runner, _ = make_runner(store, tmp_path, targets=[MEESHO], exa=exa, llm=llm)
        run = await runner.start_run(trigger="admin", scope="all")
        await runner.wait_idle()
        (item,) = await store.list_items(run["run_id"])
        assert item["status"] == "done" and item["nodes"]["profile"]["status"] == "ok"
        assert llm.calls.count("profile:meesho") == 2  # One stored-source retry recovers.
    asyncio.run(go())


def test_a_bug_in_an_optional_node_fails_the_company(tmp_path, monkeypatch):
    async def broken(state, deps):
        raise KeyError("oops")
    monkeypatch.setitem(graph_mod.NODES, "profile", broken)

    async def go():
        store = _Store()
        exa, llm = _clients()
        runner, _ = make_runner(store, tmp_path, targets=[MEESHO], exa=exa, llm=llm)
        run = await runner.start_run(trigger="admin", scope="all")
        await runner.wait_idle()
        (item,) = await store.list_items(run["run_id"])
        assert item["status"] == "failed" and item["error"]["type"] == "KeyError"
    asyncio.run(go())


def test_only_profile_is_optional():
    assert graph_mod.OPTIONAL_NODES == frozenset({"profile"})
