"""The per-company research graph (spec §3.2): a LangGraph StateGraph over CompanyState, one node per
NODE_ORDER entry, each wrapped in a traced span plus item progress updates, with a RetryPolicy for
transient Exa/LLM failures.

Durability does NOT come from a LangGraph checkpointer (spec §3.2): the runner saves the merged state
and last completed node on the research item after every node, and on resume seeds a fresh
InMemorySaver thread with aupdate_state(state, as_node=last_node)."""
from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from itertools import pairwise
from typing import Any, TypedDict

from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import END, START, StateGraph
from langgraph.types import RetryPolicy

from app.config import Settings
from app.research.failures import is_degradable, is_transient  # noqa: F401  (is_transient: re-exported)
from app.research.gateway import ResearchIO
from app.research.models import NODE_ORDER, unavailable
from app.research.nodes import profile as profile_node
from app.research.nodes.resolve import resolve
from app.research.nodes.profile import profile
from app.research.nodes.write_draft import write_draft
from app.research.store import ResearchStore
from app.research.trace.tracer import Tracer, utcnow


class CompanyState(TypedDict, total=False):
    company: dict          # the target {id, name, slug, website, aliases}
    others: list[dict]     # every other target, for duplicate detection
    identity: dict         # resolve → {name, website, aliases} Fields
    profile: dict
    compensation: dict
    roles: list[dict]
    notes: list[str]
    conflicts: list[dict]
    followups_used: int    # follow-up searches spent so far (shared RESEARCH_FOLLOWUP_MAX_QUERIES budget)
    draft: dict            # write_draft → {status, draft_id, version, coverage}


@dataclass
class NodeDeps:
    io: ResearchIO
    store: ResearchStore
    tracer: Tracer
    settings: Settings
    run_id: str


NodeFn = Callable[[CompanyState, NodeDeps], Awaitable[dict]]
NODES: dict[str, NodeFn] = {
    "resolve": resolve, "profile": profile, "write_draft": write_draft,
}


# Optional sections (spec §3.2 failure policy, evidence-hardening §10): after their own retries, a
# provider failure leaves the section `unavailable` with the error attached, and the company still
# gets a draft. Required nodes keep LangGraph's RetryPolicy and fail the company.
OPTIONAL_NODES: frozenset[str] = frozenset({"profile"})
SECTION_FIELDS: dict[str, tuple[str, ...]] = {"profile": profile_node.OUTPUT_FIELDS}
_OPTIONAL_ATTEMPTS = 3


def _node_input(state: CompanyState) -> dict[str, Any]:
    shown: dict[str, Any] = {k: v for k, v in state.items() if k != "others"}
    shown["others_count"] = len(state.get("others") or [])
    return shown


def _degraded(name: str, state: CompanyState, exc: BaseException, deps: NodeDeps) -> dict:
    message = deps.tracer.redact(f"{type(exc).__name__}: {exc}")[:200]
    section: dict[str, Any] = {f: unavailable(f"Research failed: {message}") for f in SECTION_FIELDS[name]}
    section["unverified"] = []
    return {name: section, "notes": [*(state.get("notes") or []),
                                     f"{name}: research failed ({type(exc).__name__}); its fields are unavailable"]}


def _traced(name: str, fn: NodeFn, deps: NodeDeps, *, retry_initial_interval: float):
    optional = name in OPTIONAL_NODES

    async def run(state: CompanyState) -> dict:
        company_id = state["company"]["id"]
        await deps.store.update_item(deps.run_id, company_id, fields={
            "current_node": name, f"nodes.{name}.status": "running", f"nodes.{name}.started_at": utcnow(),
        })
        attempt = 0
        while True:
            attempt += 1
            try:
                async with deps.tracer.span("node", name, input=_node_input(state), node=name,
                                            company_id=company_id) as sp:
                    out = await fn(state, deps)
                    sp.set_output(out)
                break
            except Exception as exc:
                if optional and is_transient(exc) and attempt < _OPTIONAL_ATTEMPTS:
                    deps.tracer.emit("log", f"{name}: {type(exc).__name__}, retrying (attempt {attempt}/{_OPTIONAL_ATTEMPTS})",
                                     level="warn")
                    await asyncio.sleep(retry_initial_interval * 2 ** (attempt - 1))
                    continue
                await deps.store.update_item(deps.run_id, company_id, fields={
                    f"nodes.{name}.status": "error", f"nodes.{name}.error": deps.tracer.redact(f"{type(exc).__name__}: {exc}")[:500],
                    f"nodes.{name}.finished_at": utcnow(),
                })
                if optional and is_degradable(exc):
                    deps.tracer.emit("log", f"{name}: research failed after {attempt} attempt(s); its fields are unavailable",
                                     level="warn", data={"error": deps.tracer.redact(f"{type(exc).__name__}: {exc}")[:500]})
                    return _degraded(name, state, exc, deps)
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
        g.add_node(name, _traced(name, NODES[name], deps, retry_initial_interval=retry_initial_interval),
                   retry_policy=None if name in OPTIONAL_NODES else retry)
    g.add_edge(START, NODE_ORDER[0])
    for a, b in pairwise(NODE_ORDER):
        g.add_edge(a, b)
    g.add_edge(NODE_ORDER[-1], END)
    return g.compile(checkpointer=InMemorySaver())
