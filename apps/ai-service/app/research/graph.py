"""The per-company research graph (spec §3.2): a LangGraph StateGraph over CompanyState, one node per
NODE_ORDER entry, each wrapped in a traced span plus item progress updates, with a RetryPolicy for
transient Exa/LLM failures.

Durability does NOT come from a LangGraph checkpointer (spec §3.2): the runner saves the merged state
and last completed node on the research item after every node, and on resume seeds a fresh
InMemorySaver thread with aupdate_state(state, as_node=last_node)."""
from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from itertools import pairwise
from typing import Any, TypedDict

import httpx
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import END, START, StateGraph
from langgraph.types import RetryPolicy

from app.config import Settings
from app.exa.client import ExaConfigError, ExaError
from app.llm.client import LLMError
from app.research.gateway import ResearchIO
from app.research.models import NODE_ORDER
from app.research.nodes.resolve import resolve
from app.research.nodes.write_draft import write_draft
from app.research.store import ResearchStore
from app.research.trace.tracer import Tracer, utcnow


class CompanyState(TypedDict, total=False):
    company: dict          # the target {id, name, slug, website, aliases}
    others: list[dict]     # every other target, for duplicate detection
    identity: dict         # resolve → {name, website, aliases} Fields
    conflicts: list[dict]
    draft: dict            # write_draft → {status, draft_id, version}


@dataclass
class NodeDeps:
    io: ResearchIO
    store: ResearchStore
    tracer: Tracer
    settings: Settings
    run_id: str


NodeFn = Callable[[CompanyState, NodeDeps], Awaitable[dict]]
NODES: dict[str, NodeFn] = {"resolve": resolve, "write_draft": write_draft}


def is_transient(exc: BaseException) -> bool:
    """Retry only what a retry can fix: network blips, 429s, 5xx. Bad keys, exhausted budgets,
    missing fixtures and invalid model output fail immediately."""
    if isinstance(exc, ExaConfigError):
        return False
    return isinstance(exc, (ExaError, LLMError, httpx.TransportError))


def _node_input(state: CompanyState) -> dict[str, Any]:
    shown: dict[str, Any] = {k: v for k, v in state.items() if k != "others"}
    shown["others_count"] = len(state.get("others") or [])
    return shown


def _traced(name: str, fn: NodeFn, deps: NodeDeps):
    async def run(state: CompanyState) -> dict:
        company_id = state["company"]["id"]
        await deps.store.update_item(deps.run_id, company_id, fields={
            "current_node": name, f"nodes.{name}.status": "running", f"nodes.{name}.started_at": utcnow(),
        })
        try:
            async with deps.tracer.span("node", name, input=_node_input(state), node=name,
                                        company_id=company_id) as sp:
                out = await fn(state, deps)
                sp.set_output(out)
        except Exception as exc:
            await deps.store.update_item(deps.run_id, company_id, fields={
                f"nodes.{name}.status": "error", f"nodes.{name}.error": deps.tracer.redact(f"{type(exc).__name__}: {exc}")[:500],
                f"nodes.{name}.finished_at": utcnow(),
            })
            raise
        await deps.store.update_item(deps.run_id, company_id, fields={
            f"nodes.{name}.status": "ok", f"nodes.{name}.finished_at": utcnow(),
        })
        return out
    run.__name__ = name
    return run


def build_company_graph(deps: NodeDeps, *, retry_initial_interval: float = 2.0):
    retry = RetryPolicy(max_attempts=3, initial_interval=retry_initial_interval, backoff_factor=2.0,
                        retry_on=is_transient)
    g = StateGraph(CompanyState)
    for name in NODE_ORDER:
        g.add_node(name, _traced(name, NODES[name], deps), retry_policy=retry)
    g.add_edge(START, NODE_ORDER[0])
    for a, b in pairwise(NODE_ORDER):
        g.add_edge(a, b)
    g.add_edge(NODE_ORDER[-1], END)
    return g.compile(checkpointer=InMemorySaver())
