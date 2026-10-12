## Task 7: Resolve prompt, nodes and the company graph

**Files:**
- Create: `apps/ai-service/app/prompts/research/__init__.py`, `apps/ai-service/app/prompts/research/resolve_company.py`, `apps/ai-service/app/research/nodes/__init__.py`, `apps/ai-service/app/research/nodes/resolve.py`, `apps/ai-service/app/research/nodes/write_draft.py`, `apps/ai-service/app/research/graph.py`
- Test: `apps/ai-service/tests/research/helpers.py`, `apps/ai-service/tests/research/test_nodes.py`, `apps/ai-service/tests/research/test_graph.py`

**Interfaces:**
- Consumes: `ResearchIO` (Task 5), identity and drafts helpers (Task 6), `field`/`unavailable`/`NODE_ORDER`/`PIPELINE_VERSION` (Task 1), `Tracer`/`utcnow`/`new_id` (Task 4).
- Produces:
  - `CompanyState` (TypedDict, `total=False`): `company`, `others`, `identity`, `conflicts`, `draft`.
  - `NodeDeps(io, store, tracer, settings, run_id)` (dataclass).
  - `NODES: dict[str, Callable]`.
  - `is_transient(exc) -> bool`.
  - `build_company_graph(deps, *, retry_initial_interval=2.0)`, a compiled LangGraph with `InMemorySaver`.
  - `resolve(state, deps) -> {"identity", "conflicts"}`.
  - `write_draft(state, deps) -> {"draft": {"status": "created"|"unchanged", "draft_id", "version"}}`.
- **Draft document:** `{draft_id, company_id, version, run_id, status: "pending_review", created_at, snapshot: {"identity": {...}}, conflicts, diff, excluded_role_keys: [], pipeline_version}`.

- [ ] **Step 1: Write the shared test helpers**

`apps/ai-service/tests/research/helpers.py`:

```python
"""Shared scaffolding for research tests: settings, fake clients, wired NodeDeps, and a runner over
the in-memory store. Not a test module (no test_ prefix), so pytest does not collect it."""
from __future__ import annotations

import re
from contextlib import asynccontextmanager

from app.config import Settings
from app.research.budget import Budget
from app.research.fixtures import FixtureStore
from app.research.gateway import ResearchIO
from app.research.graph import NodeDeps
from app.research.models import Mode
from app.research.runner import ResearchRunner
from app.research.targets import ResearchTarget
from app.research.trace.tracer import Tracer, utcnow
from tests.research.fakes import FakeExa, FakeLLM, resolve_answer, result

SECRET = "exa-secret-123"
MEESHO = ResearchTarget(id="c-meesho", name="Meesho", slug="meesho")
RAZORPAY = ResearchTarget(id="c-razorpay", name="Razorpay", slug="razorpay", website="https://razorpay.com")


def research_settings(**overrides) -> Settings:
    return Settings(_env_file=None).model_copy(update={"research_concurrency": 1, **overrides})


def company_exa(**kw) -> FakeExa:
    """Answers "<Name> company official website India" with https://<name>.com."""
    def respond(query: str) -> list[dict]:
        name = query.split()[0]
        return [result(f"https://{name.lower()}.com", title=f"{name} — official site")]
    return FakeExa(respond, **kw)


def company_llm(**kw) -> FakeLLM:
    def respond(system: str, user: str, label: str):
        name = re.search(r"Company name as entered: (.+)", user).group(1).strip()
        return resolve_answer(name, f"https://{name.lower()}.com")
    return FakeLLM(respond, **kw)


async def wired_deps(store, tmp_path, *, exa=None, llm=None, mode=Mode.LIVE, run_id="run1",
                     company=MEESHO, others=(), exa_cap=100, llm_cap=100):
    settings = research_settings()
    await store.insert_run({"run_id": run_id, "status": "running", "control": "none", "created_at": utcnow(),
                            "last_seq": 0, "counters": {},
                            "budget": {"exa_used": 0, "exa_cap": exa_cap, "llm_used": 0, "llm_cap": llm_cap,
                                       "tokens_in": 0, "tokens_out": 0}})
    await store.insert_items([{"run_id": run_id, "company_id": company.id, "company_name": company.name,
                               "company_slug": company.slug, "position": 0, "status": "running", "nodes": {}}])
    tracer = Tracer(store, run_id, secrets={"EXA_API_KEY": SECRET}, flush_interval=0.01)
    await tracer.start()
    budget = Budget(store, run_id, exa_cap=exa_cap, llm_cap=llm_cap)
    io = ResearchIO(mode=mode, exa=exa or company_exa(), llm=llm or company_llm(),
                    fixtures=FixtureStore(tmp_path / "fixtures"), tracer=tracer, budget=budget,
                    store=store, settings=settings)
    deps = NodeDeps(io=io, store=store, tracer=tracer, settings=settings, run_id=run_id)
    state = {"company": company.as_dict(), "others": [o.as_dict() for o in others]}
    return deps, tracer, state


def make_runner(store, tmp_path, *, targets=None, exa=None, llm=None, **overrides):
    """A runner over `store` with fake clients. Returns (runner, live_targets); mutate
    live_targets to simulate an admin archiving a company mid-run."""
    settings = research_settings(research_fixtures_dir=str(tmp_path / "fixtures"), **overrides)
    live_targets = list(targets if targets is not None else [MEESHO, RAZORPAY])
    exa = exa or company_exa()
    llm = llm or company_llm()

    @asynccontextmanager
    async def clients():
        yield exa, llm

    async def fetch():
        return list(live_targets)

    runner = ResearchRunner(store=store, settings=settings, targets=fetch, clients=clients,
                            secrets={"EXA_API_KEY": SECRET}, retry_initial_interval=0.01)
    return runner, live_targets
```

`helpers.py` imports `app.research.runner` and `app.research.targets`, which Task 8 creates. Task 7's tests import only `wired_deps`, `MEESHO` and `RAZORPAY`. To keep Task 7 green on its own, create **minimal** versions of both modules now (Task 8 replaces them in full).

`apps/ai-service/app/research/targets.py` (minimal; Task 8 adds fetching):

```python
"""Research targets: the active companies interviewiq-api says to research (spec §3.1)."""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ResearchTarget:
    id: str
    name: str
    slug: str
    website: str | None = None
    aliases: tuple[str, ...] = ()

    def as_dict(self) -> dict:
        return {"id": self.id, "name": self.name, "slug": self.slug, "website": self.website,
                "aliases": list(self.aliases)}
```

`apps/ai-service/app/research/runner.py` (placeholder, replaced in full by Task 8):

```python
"""Replaced in full by Task 8 (the run driver)."""


class ResearchRunner:  # pragma: no cover — Task 8 replaces this module
    def __init__(self, **kwargs):
        raise NotImplementedError("ResearchRunner is implemented in Task 8")
```

- [ ] **Step 2: Write the failing node and graph tests**

`apps/ai-service/tests/research/test_nodes.py`:

```python
import asyncio

import pytest
from pydantic import ValidationError

from app.research.memory_store import InMemoryResearchStore
from app.research.nodes.resolve import resolve
from app.research.nodes.write_draft import write_draft
from app.research.store import EventFilter
from app.research.targets import ResearchTarget
from tests.research.fakes import FakeExa, FakeLLM, resolve_answer, result
from tests.research.helpers import MEESHO, RAZORPAY, wired_deps


def test_resolve_takes_identity_from_evidence_backed_llm_output(tmp_path):
    async def go():
        store = InMemoryResearchStore()
        deps, tracer, state = await wired_deps(store, tmp_path)
        out = await resolve(state, deps)
        await tracer.close()
        ident = out["identity"]
        assert ident["name"] == {"value": "Meesho", "confidence": "high", "provenance": "evidence",
                                 "source_urls": ["https://meesho.com"], "note": None}
        assert ident["website"]["value"] == "https://meesho.com" and ident["website"]["provenance"] == "evidence"
        assert out["conflicts"] == []
    asyncio.run(go())


def test_admin_website_wins_and_disagreement_is_noted(tmp_path):
    async def go():
        store = InMemoryResearchStore()
        llm = FakeLLM(lambda s, u, label: resolve_answer("Razorpay", "https://razorpay-mirror.com") | {
            "evidence_urls": ["https://razorpay.com"]})
        exa = FakeExa(lambda q: [result("https://razorpay.com")])
        deps, tracer, state = await wired_deps(store, tmp_path, company=RAZORPAY, llm=llm, exa=exa)
        out = await resolve(state, deps)
        await tracer.close()
        site = out["identity"]["website"]
        assert site["value"] == "https://razorpay.com" and site["provenance"] == "admin_override"
        assert site["note"] == "research found https://razorpay-mirror.com"
    asyncio.run(go())


def test_evidence_not_in_results_downgrades_confidence(tmp_path):
    async def go():
        store = InMemoryResearchStore()
        llm = FakeLLM(lambda s, u, label: resolve_answer("Meesho", "https://meesho.com") | {
            "evidence_urls": ["https://invented.example"]})
        deps, tracer, state = await wired_deps(store, tmp_path, llm=llm)
        out = await resolve(state, deps)
        await tracer.close()
        assert out["identity"]["name"]["confidence"] == "low"
        assert out["identity"]["name"]["provenance"] == "derived"
        assert out["identity"]["name"]["source_urls"] == []
    asyncio.run(go())


def test_not_a_company_and_duplicates_become_conflicts(tmp_path):
    async def go():
        store = InMemoryResearchStore()
        llm = FakeLLM(lambda s, u, label: resolve_answer("Meesho", "https://meesho.com") | {
            "is_company": False, "reasoning": "a shopping term"})
        twin = ResearchTarget(id="c-twin", name="Meesho India", slug="meesho-india")
        deps, tracer, state = await wired_deps(store, tmp_path, llm=llm, others=[twin])
        out = await resolve(state, deps)
        await tracer.close()
        types = [c["type"] for c in out["conflicts"]]
        assert types == ["not_a_company", "possible_duplicate"]
        assert out["conflicts"][1]["company_id"] == "c-twin"
    asyncio.run(go())


def test_resolve_rejects_output_without_a_name(tmp_path):
    async def go():
        store = InMemoryResearchStore()
        llm = FakeLLM(lambda s, u, label: {"is_company": True})
        deps, tracer, state = await wired_deps(store, tmp_path, llm=llm)
        with pytest.raises(ValidationError):
            await resolve(state, deps)
        await tracer.close()
    asyncio.run(go())


def test_write_draft_creates_then_skips_unchanged_then_versions_changes(tmp_path):
    async def go():
        store = InMemoryResearchStore()
        deps, tracer, state = await wired_deps(store, tmp_path)
        state = {**state, **(await resolve(state, deps))}
        first = await write_draft(state, deps)
        again = await write_draft(state, deps)
        changed = {**state, "identity": {**state["identity"], "aliases": {**state["identity"]["aliases"], "value": ["Fashnear"]}}}
        third = await write_draft(changed, deps)
        await tracer.close()
        assert first["draft"]["status"] == "created" and first["draft"]["version"] == 1
        assert again["draft"] == {"status": "unchanged", "draft_id": first["draft"]["draft_id"], "version": 1}
        assert third["draft"]["status"] == "created" and third["draft"]["version"] == 2
        v1, v2 = sorted(store.drafts, key=lambda d: d["version"])
        assert v1["status"] == "superseded" and v2["status"] == "pending_review"
        assert {c["path"] for c in v1["diff"]} == {"identity.aliases", "identity.name", "identity.website"}
        assert v2["snapshot"] == {"identity": changed["identity"]}
        created = await store.list_events("run1", EventFilter(type_prefix="draft.created"))
        assert len(created) == 2
    asyncio.run(go())
```

`apps/ai-service/tests/research/test_graph.py`:

```python
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
```

- [ ] **Step 3: Run them to verify they fail**

Run: `.venv/bin/python -m pytest tests/research/test_nodes.py tests/research/test_graph.py -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.research.graph'`.

- [ ] **Step 4: Implement the prompt**

`apps/ai-service/app/prompts/research/__init__.py`:

```python
"""Prompts for the company research pipeline. Every prompt here is a DRAFT for human review before
production use (prompts are product IP; spec §14)."""
```

`apps/ai-service/app/prompts/research/resolve_company.py`:

```python
"""Company identity resolution: DRAFT v1, for human review before production use.

Input: the admin-entered name / website / aliases plus the top Exa results.
Output: the company's canonical identity, with evidence URLs drawn ONLY from those results."""
from __future__ import annotations

import json

PROMPT_NAME = "resolve_company"
PROMPT_VERSION = "v1"
_SNIPPET_CHARS = 1500

SYSTEM = """You identify companies for an Indian interview-preparation platform.
You get the name an admin typed, optional hints, and web search results.
Answer ONLY with one JSON object, no prose:
{
  "is_company": true or false,
  "canonical_name": "the name the company uses for itself, e.g. Meesho",
  "website": "the official homepage URL, or null",
  "aliases": ["other names people use: legal entity, former names, Indian subsidiary"],
  "confidence": "high" or "medium" or "low",
  "evidence_urls": ["URLs from the results that support this"],
  "reasoning": "one or two sentences"
}
Rules:
- Use ONLY the search results. Never invent a website or alias they do not support.
- website is the company's own homepage: never a job board, news site, Wikipedia or LinkedIn.
- At most 6 aliases, and do not repeat canonical_name.
- Copy evidence_urls exactly from the results.
- If the results describe something that is not a company (a person, a product category, nothing relevant), set is_company to false.
- confidence: high = the official site is in the results; medium = consistent third-party evidence only; low = thin or conflicting evidence."""


def build_user(*, name: str, website_hint: str | None, aliases_hint: list[str], results: list[dict]) -> str:
    lines = [
        f"Company name as entered: {name}",
        f"Website hint from admin: {website_hint or 'none'}",
        f"Known aliases: {', '.join(aliases_hint) if aliases_hint else 'none'}",
        "",
        "Search results:",
    ]
    for i, r in enumerate(results, 1):
        lines.append(json.dumps({"n": i, "url": r.get("url"), "title": r.get("title"), "date": r.get("date"),
                                 "text": (r.get("content") or "")[:_SNIPPET_CHARS]}, ensure_ascii=False))
    if not results:
        lines.append("(no results)")
    return "\n".join(lines)
```

- [ ] **Step 5: Implement the nodes**

`apps/ai-service/app/research/nodes/__init__.py`:

```python
"""LangGraph nodes for the per-company research graph (spec §3.2)."""
```

`apps/ai-service/app/research/nodes/resolve.py`:

```python
"""resolve (spec §3.2 node 1): canonical name, official website and aliases, plus a duplicate check
against the other companies in the catalogue. A likely duplicate never blocks the run: it lands
on the draft as a `possible_duplicate` conflict for the admin to decide."""
from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Literal

from pydantic import BaseModel, Field as PField

from app.prompts.research import resolve_company as prompt
from app.research.models import field, unavailable
from app.research.normalize.identity import domain_of, find_possible_duplicates, name_key

if TYPE_CHECKING:
    from app.research.graph import CompanyState, NodeDeps

logger = logging.getLogger(__name__)

QUERY_TEMPLATE = "{name} company official website India"
_MAX_ALIASES = 6


class ResolveOutput(BaseModel):
    is_company: bool = True
    canonical_name: str = PField(min_length=1)
    website: str | None = None
    aliases: list[str] = []
    confidence: Literal["high", "medium", "low"] = "low"
    evidence_urls: list[str] = []
    reasoning: str = ""


async def resolve(state: "CompanyState", deps: "NodeDeps") -> dict:
    company = state["company"]
    query = QUERY_TEMPLATE.format(name=company["name"])
    results = await deps.io.search(query, company_slug=company["slug"], kind="resolve")
    logger.info("resolve %s: %d search result(s)", company["name"], len(results))

    raw = await deps.io.extract_json(
        prompt_name=prompt.PROMPT_NAME, prompt_version=prompt.PROMPT_VERSION, system=prompt.SYSTEM,
        user=prompt.build_user(name=company["name"], website_hint=company.get("website"),
                               aliases_hint=list(company.get("aliases") or []), results=results),
        company_slug=company["slug"], label=f"resolve:{company['slug']}",
    )
    out = ResolveOutput.model_validate(raw)

    result_urls = {r["url"] for r in results}
    evidence = [u for u in out.evidence_urls if u in result_urls]
    dropped = [u for u in out.evidence_urls if u not in result_urls]
    if dropped:
        logger.warning("resolve %s: ignoring %d evidence URL(s) not in the search results: %s",
                       company["name"], len(dropped), dropped)
    confidence = out.confidence if evidence else "low"
    provenance = "evidence" if evidence else "derived"

    name = field(out.canonical_name.strip(), confidence=confidence, provenance=provenance, source_urls=evidence)
    website = _website_field(company.get("website"), out.website, confidence, provenance, evidence)
    aliases = _aliases(company, out)
    identity = {
        "name": name,
        "website": website,
        "aliases": field(aliases, confidence=confidence, provenance=provenance, source_urls=evidence),
    }

    conflicts: list[dict] = []
    if not out.is_company:
        conflicts.append({"type": "not_a_company", "message": out.reasoning or "the search results do not describe a company"})
    conflicts += find_possible_duplicates(
        {"name": name["value"], "website": website["value"], "aliases": aliases}, state.get("others") or [],
    )
    for c in conflicts:
        logger.warning("resolve %s: conflict %s", company["name"], c)
    return {"identity": identity, "conflicts": conflicts}


def _website_field(admin_site: str | None, found: str | None, confidence: str, provenance: str,
                   evidence: list[str]) -> dict:
    if admin_site:
        note = f"research found {found}" if found and domain_of(found) != domain_of(admin_site) else None
        return field(admin_site, confidence="high", provenance="admin_override", note=note)
    if found:
        return field(found, confidence=confidence, provenance=provenance, source_urls=evidence)
    return unavailable("no official website in the search results")


def _aliases(company: dict, out: ResolveOutput) -> list[str]:
    canonical = name_key(out.canonical_name)
    seen: set[str] = set()
    aliases: list[str] = []
    for alias in [*(company.get("aliases") or []), *out.aliases, company["name"]]:
        alias = alias.strip()
        key = name_key(alias)
        if not alias or not key or key == canonical or key in seen:
            continue
        seen.add(key)
        aliases.append(alias)
    return aliases[:_MAX_ALIASES]
```

`apps/ai-service/app/research/nodes/write_draft.py`:

```python
"""write_draft (spec §3.2 node 8): persist the end-result snapshot as a pending_review draft with a
diff against the last APPROVED snapshot. If nothing changed since the latest draft, write nothing
and report "unchanged"; the runner then marks the company `skipped` (no no-op review items)."""
from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from app.research.drafts import snapshot_diff
from app.research.models import PIPELINE_VERSION
from app.research.trace.tracer import new_id, utcnow

if TYPE_CHECKING:
    from app.research.graph import CompanyState, NodeDeps

logger = logging.getLogger(__name__)


async def write_draft(state: "CompanyState", deps: "NodeDeps") -> dict:
    company = state["company"]
    snapshot = {"identity": state["identity"]}
    conflicts = state.get("conflicts") or []

    latest = await deps.store.latest_draft(company["id"])
    if latest and latest["snapshot"] == snapshot and (latest.get("conflicts") or []) == conflicts:
        logger.info("write_draft %s: unchanged since draft v%d", company["name"], latest["version"])
        return {"draft": {"status": "unchanged", "draft_id": latest["draft_id"], "version": latest["version"]}}

    published = await deps.store.latest_draft(company["id"], status="approved")
    version = (latest["version"] if latest else 0) + 1
    diff = snapshot_diff(published["snapshot"] if published else None, snapshot)
    superseded = await deps.store.supersede_pending_drafts(company["id"])
    draft = {
        "draft_id": new_id(), "company_id": company["id"], "version": version, "run_id": deps.run_id,
        "status": "pending_review", "created_at": utcnow(), "snapshot": snapshot, "conflicts": conflicts,
        "diff": diff, "excluded_role_keys": [], "pipeline_version": PIPELINE_VERSION,
    }
    await deps.store.insert_draft(draft)
    deps.tracer.emit(
        "draft.created", f"{company['name']}: draft v{version} · {len(diff)} change(s) · {len(conflicts)} conflict(s)",
        level="info", data={"draft_id": draft["draft_id"], "version": version, "superseded": superseded},
    )
    return {"draft": {"status": "created", "draft_id": draft["draft_id"], "version": version}}
```

- [ ] **Step 6: Implement the graph**

`apps/ai-service/app/research/graph.py`:

```python
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
                f"nodes.{name}.status": "error", f"nodes.{name}.error": f"{type(exc).__name__}: {exc}"[:500],
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
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/research -q`
Expected: PASS.

- [ ] **Step 8: Checkpoint**

Run `git status`; leave the changes uncommitted.

---

