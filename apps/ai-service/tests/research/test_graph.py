import asyncio

from app.research.graph import build_company_graph, is_transient
from app.research.memory_store import InMemoryResearchStore
from app.exa.client import ExaConfigError, ExaError
from app.llm.client import LLMError
from app.research.budget import BudgetExhausted
from app.research.fixtures import FixtureMissing
from tests.research.helpers import wired_deps


def test_graph_runs_both_nodes_in_order_and_tracks_node_progress(tmp_path):
    async def go():
        store = InMemoryResearchStore()
        deps, tracer, state = await wired_deps(store, tmp_path)
        graph = build_company_graph(deps, retry_initial_interval=0.01)
        updates = [u async for u in graph.astream(state, {"configurable": {"thread_id": "t"}}, stream_mode="updates")]
        await tracer.close()
        assert [next(iter(u)) for u in updates] == ["resolve", "write_draft"]
        (item,) = await store.list_items("run1")
        assert item["nodes"]["resolve"]["status"] == "ok" and item["nodes"]["write_draft"]["status"] == "ok"
        assert item["nodes"]["resolve"]["llm_calls"] == 1 and item["nodes"]["resolve"]["exa_calls"] == 1
        node_spans = [s for s in await store.list_spans("run1") if s["kind"] == "node"]
        assert [s["name"] for s in node_spans] == ["resolve", "write_draft"]
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
