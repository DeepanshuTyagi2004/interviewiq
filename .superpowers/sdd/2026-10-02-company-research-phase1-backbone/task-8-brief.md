## Task 8: Targets and the run driver (start, pause, resume, stop, budget, recovery)

**Files:**
- Modify (replace the Task 7 minimal versions): `apps/ai-service/app/research/targets.py`, `apps/ai-service/app/research/runner.py`
- Test: `apps/ai-service/tests/research/test_targets.py`, `apps/ai-service/tests/research/test_runner.py`

**Interfaces:**
- Consumes: everything above.
- Produces:
  - `ResearchTarget.from_row(row)`, `fetch_research_targets(settings) -> list[ResearchTarget]` and `TargetsUnavailable`.
  - `RunActive(run_id)`, `RunNotFound` and `NoCompaniesSelected`.
  - `ResearchRunner(*, store, settings, targets, clients, secrets, echo=None, retry_initial_interval=2.0)` with:
    - `.store` and `.busy`;
    - `await .start_run(*, trigger, scope="all", company_ids=None, mode=None, requested_by=None) -> run`;
    - `await .pause(run_id)`, `await .resume(run_id)` and `await .stop(run_id)`, each returning the run;
    - `await .raise_budget(run_id, *, exa_cap=None, llm_cap=None) -> run`;
    - `await .recover_on_startup()`;
    - `await .wait_idle()`.
- **Run document:** `{run_id, trigger, mode, scope, company_ids, targets, status, control, pause_reason, requested_by, counters{total, queued, running, paused, done, failed, skipped, cancelled}, budget{exa_used, exa_cap, llm_used, llm_cap, tokens_in, tokens_out}, last_seq, created_at, started_at, finished_at, error, pipeline_version}`.
- **Item document:** `{run_id, company_id, company_name, company_slug, position, target, status, attempts, current_node, last_node, state, nodes{<node>: {status, started_at, finished_at, exa_calls, llm_calls, error}}, draft_id, error, started_at, finished_at}`.
- **Company state:** `{company_id, last_run_id, last_status, last_researched_at, latest_draft_id, latest_draft_status}`.

- [ ] **Step 1: Write the failing targets tests**

`apps/ai-service/tests/research/test_targets.py`:

```python
import asyncio

import httpx
import pytest

import app.research.targets as targets_mod
from app.config import Settings
from app.research.targets import ResearchTarget, TargetsUnavailable, fetch_research_targets

REAL_CLIENT = httpx.AsyncClient


def _patch(monkeypatch, handler):
    monkeypatch.setattr(targets_mod.httpx, "AsyncClient",
                        lambda **kw: REAL_CLIENT(transport=httpx.MockTransport(handler), **kw))


def test_fetch_parses_rows_sends_the_internal_key_and_skips_malformed(monkeypatch):
    seen = {}

    def handler(req):
        seen["url"], seen["key"] = str(req.url), req.headers.get("x-internal-api-key")
        return httpx.Response(200, json=[
            {"id": "c1", "name": "Meesho", "slug": "meesho", "website": None, "aliases": ["Fashnear"]},
            {"name": "no id"},
        ])
    _patch(monkeypatch, handler)
    settings = Settings(_env_file=None).model_copy(update={"api_base_url": "http://api.test", "internal_api_key": "k"})
    got = asyncio.run(fetch_research_targets(settings))
    assert got == [ResearchTarget(id="c1", name="Meesho", slug="meesho", website=None, aliases=("Fashnear",))]
    assert seen == {"url": "http://api.test/api/v1/internal/research-targets", "key": "k"}


def test_fetch_failure_raises_targets_unavailable(monkeypatch):
    _patch(monkeypatch, lambda req: httpx.Response(503, text="down"))
    with pytest.raises(TargetsUnavailable, match="research-targets"):
        asyncio.run(fetch_research_targets(Settings(_env_file=None)))
```

- [ ] **Step 2: Write the failing runner tests**

`apps/ai-service/tests/research/test_runner.py`:

```python
import asyncio
import json
from datetime import timedelta

import pytest

from app.exa.client import ExaError
from app.research.memory_store import InMemoryResearchStore
from app.research.models import InvalidTransition
from app.research.runner import RunActive
from app.research.store import EventFilter
from app.research.trace.tracer import utcnow
from tests.research.fakes import Exploding, FakeLLM, resolve_answer
from tests.research.helpers import MEESHO, RAZORPAY, SECRET, company_exa, company_llm, make_runner


def _statuses(items):
    return {i["company_id"]: i["status"] for i in items}


class HookStore(InMemoryResearchStore):
    """Lets a test act at the moment write_draft persists (i.e. inside the LAST node)."""
    on_draft = None

    async def insert_draft(self, draft):
        await super().insert_draft(draft)
        if self.on_draft:
            await self.on_draft()


def test_run_completes_writes_drafts_and_traces_everything(tmp_path):
    async def go():
        store = InMemoryResearchStore()
        runner, _ = make_runner(store, tmp_path)
        run = await runner.start_run(trigger="admin", scope="all")
        assert run["status"] == "queued" and run["counters"]["total"] == 2
        await runner.wait_idle()
        run = await store.get_run(run["run_id"])
        items = await store.list_items(run["run_id"])
        assert run["status"] == "completed" and run["finished_at"] is not None
        assert _statuses(items) == {"c-meesho": "done", "c-razorpay": "done"}
        c = run["counters"]
        assert (c["done"], c["queued"], c["running"]) == (2, 0, 0)
        assert {d["company_id"]: d["status"] for d in store.drafts} == {"c-meesho": "pending_review", "c-razorpay": "pending_review"}
        state = {s["company_id"]: s for s in await store.list_company_states()}
        assert state["c-meesho"]["last_status"] == "done" and state["c-meesho"]["latest_draft_status"] == "pending_review"
        kinds = {s["kind"] for s in await store.list_spans(run["run_id"])}
        assert kinds == {"run", "company", "node", "exa", "llm"}
        types = [e["type"] for e in await store.list_events(run["run_id"], EventFilter(min_level="info"))]
        assert types[0] == "run.started" and types[-1] == "run.completed"
        assert run["last_seq"] == len(await store.list_events(run["run_id"], EventFilter(limit=10_000)))
    asyncio.run(go())


def test_second_run_with_no_changes_skips_every_company(tmp_path):
    async def go():
        store = InMemoryResearchStore()
        runner, _ = make_runner(store, tmp_path)
        await runner.start_run(trigger="admin", scope="selected", company_ids=["c-meesho"])
        await runner.wait_idle()
        run = await runner.start_run(trigger="admin", scope="selected", company_ids=["c-meesho"])
        await runner.wait_idle()
        assert _statuses(await store.list_items(run["run_id"])) == {"c-meesho": "skipped"}
        assert len(store.drafts) == 1
    asyncio.run(go())


def test_pause_after_first_node_then_resume_runs_each_node_exactly_once(tmp_path):
    async def go():
        store = InMemoryResearchStore()
        holder = {}

        async def pause_on_first(label):
            if label == "resolve:meesho" and "paused" not in holder:
                holder["paused"] = True
                await runner.pause(holder["run_id"])
        llm = company_llm(on_call=pause_on_first)
        runner, _ = make_runner(store, tmp_path, llm=llm)
        run = await runner.start_run(trigger="admin", scope="all")
        holder["run_id"] = run["run_id"]
        await runner.wait_idle()
        run = await store.get_run(run["run_id"])
        items = {i["company_id"]: i for i in await store.list_items(run["run_id"])}
        assert run["status"] == "paused" and run["pause_reason"] == "admin"
        assert items["c-meesho"]["status"] == "paused" and items["c-meesho"]["last_node"] == "resolve"
        assert items["c-razorpay"]["status"] == "queued"
        assert store.drafts == []

        await runner.resume(run["run_id"])
        await runner.wait_idle()
        run = await store.get_run(run["run_id"])
        assert run["status"] == "completed"
        assert _statuses(await store.list_items(run["run_id"])) == {"c-meesho": "done", "c-razorpay": "done"}
        assert llm.calls == ["resolve:meesho", "resolve:razorpay"]           # resolve never re-ran
        meesho_nodes = [s for s in await store.list_spans(run["run_id"], "c-meesho") if s["kind"] == "node"]
        assert [s["name"] for s in meesho_nodes] == ["resolve", "write_draft"]
        resumed = [s for s in await store.list_spans(run["run_id"], "c-meesho") if s["kind"] == "company"]
        assert [s["attrs"]["resumed_after"] for s in resumed] == [None, "resolve"]
        assert len(store.drafts) == 2
    asyncio.run(go())


def test_pause_during_last_node_lets_the_company_finish(tmp_path):
    async def go():
        store = HookStore()
        holder = {}

        async def pause_once():
            if "paused" not in holder:
                holder["paused"] = True
                await runner.pause(holder["run_id"])
        store.on_draft = pause_once
        runner, _ = make_runner(store, tmp_path)
        run = await runner.start_run(trigger="admin", scope="all")
        holder["run_id"] = run["run_id"]
        await runner.wait_idle()
        assert (await store.get_run(run["run_id"]))["status"] == "paused"
        assert _statuses(await store.list_items(run["run_id"])) == {"c-meesho": "done", "c-razorpay": "queued"}
    asyncio.run(go())


def test_stop_cancels_clears_state_and_writes_no_draft(tmp_path):
    async def go():
        store = InMemoryResearchStore()
        holder = {}

        async def stop_on_first(label):
            if "stopped" not in holder:
                holder["stopped"] = True
                await runner.stop(holder["run_id"])
        runner, _ = make_runner(store, tmp_path, llm=company_llm(on_call=stop_on_first))
        run = await runner.start_run(trigger="admin", scope="all")
        holder["run_id"] = run["run_id"]
        await runner.wait_idle()
        run = await store.get_run(run["run_id"])
        items = await store.list_items(run["run_id"])
        assert run["status"] == "stopped" and run["control"] == "none"
        assert _statuses(items) == {"c-meesho": "cancelled", "c-razorpay": "cancelled"}
        assert all(i["state"] is None and i["last_node"] is None for i in items)
        assert store.drafts == []
        assert run["counters"]["cancelled"] == 2
    asyncio.run(go())


def test_stopping_a_paused_run_finishes_without_a_drive(tmp_path):
    async def go():
        store = InMemoryResearchStore()
        holder = {}

        async def pause_once(label):
            if "p" not in holder:
                holder["p"] = True
                await runner.pause(holder["run_id"])
        runner, _ = make_runner(store, tmp_path, llm=company_llm(on_call=pause_once))
        run = await runner.start_run(trigger="admin", scope="all")
        holder["run_id"] = run["run_id"]
        await runner.wait_idle()
        stopped = await runner.stop(run["run_id"])
        assert stopped["status"] == "stopped" and not runner.busy
        assert _statuses(await store.list_items(run["run_id"])) == {"c-meesho": "cancelled", "c-razorpay": "cancelled"}
        stopped_events = await store.list_events(run["run_id"], EventFilter(type_prefix="run.stopped"))
        assert len(stopped_events) == 1
    asyncio.run(go())


def test_budget_exhaustion_auto_pauses_and_resume_after_raise_finishes(tmp_path):
    async def go():
        store = InMemoryResearchStore()
        exa, llm = company_exa(), company_llm()
        runner, _ = make_runner(store, tmp_path, exa=exa, llm=llm, research_max_llm_calls=1)
        run = await runner.start_run(trigger="admin", scope="all")
        await runner.wait_idle()
        run = await store.get_run(run["run_id"])
        assert run["status"] == "paused" and run["pause_reason"] == "budget_exhausted"
        assert _statuses(await store.list_items(run["run_id"])) == {"c-meesho": "done", "c-razorpay": "paused"}
        assert len(await store.list_events(run["run_id"], EventFilter(type_prefix="budget.exhausted"))) == 1

        with pytest.raises(ValueError, match="below calls already made"):
            await runner.raise_budget(run["run_id"], llm_cap=0)
        await runner.raise_budget(run["run_id"], llm_cap=5)
        await runner.resume(run["run_id"])
        await runner.wait_idle()
        run = await store.get_run(run["run_id"])
        assert run["status"] == "completed" and run["budget"]["llm_used"] == 2 and run["budget"]["llm_cap"] == 5
        assert len(exa.calls) == 3     # razorpay's resolve search ran again after the pause
        assert llm.calls == ["resolve:meesho", "resolve:razorpay"]
    asyncio.run(go())


def test_crash_recovery_resumes_from_the_saved_node_then_fails_a_crash_loop(tmp_path):
    async def go():
        store = InMemoryResearchStore()
        holder = {}

        async def pause_once(label):
            if "p" not in holder:
                holder["p"] = True
                await runner.pause(holder["run_id"])
        runner, _ = make_runner(store, tmp_path, llm=company_llm(on_call=pause_once))
        run = await runner.start_run(trigger="admin", scope="all")
        holder["run_id"] = run["run_id"]
        await runner.wait_idle()
        run_id = run["run_id"]
        # Simulate the process dying mid-node: the run and Meesho look "running" in the store.
        await store.update_run(run_id, fields={"status": "running", "control": "none"})
        await store.update_item(run_id, "c-meesho", fields={"status": "running"})

        llm2 = company_llm()
        fresh, _ = make_runner(store, tmp_path, llm=llm2)       # a new process
        await fresh.recover_on_startup()
        await fresh.wait_idle()
        items = {i["company_id"]: i for i in await store.list_items(run_id)}
        assert (await store.get_run(run_id))["status"] == "completed"
        assert items["c-meesho"]["status"] == "done" and items["c-meesho"]["attempts"] == 2
        assert llm2.calls == ["resolve:razorpay"]                  # Meesho resumed at write_draft
        recovered = await store.list_events(run_id, EventFilter(type_prefix="run.recovered"))
        assert len(recovered) == 1

        # Second crash on the same company → crash loop → failed, not retried again.
        await store.update_run(run_id, fields={"status": "running"})
        await store.update_item(run_id, "c-meesho", fields={"status": "running", "attempts": 2})
        again, _ = make_runner(store, tmp_path, llm=Exploding())
        await again.recover_on_startup()
        await again.wait_idle()
        meesho = next(i for i in await store.list_items(run_id) if i["company_id"] == "c-meesho")
        assert meesho["status"] == "failed" and meesho["error"]["type"] == "CrashLoop"
    asyncio.run(go())


def test_paused_runs_are_left_alone_on_restart(tmp_path):
    async def go():
        store = InMemoryResearchStore()
        holder = {}

        async def pause_once(label):
            if "p" not in holder:
                holder["p"] = True
                await runner.pause(holder["run_id"])
        runner, _ = make_runner(store, tmp_path, llm=company_llm(on_call=pause_once))
        run = await runner.start_run(trigger="admin", scope="all")
        holder["run_id"] = run["run_id"]
        await runner.wait_idle()
        fresh, _ = make_runner(store, tmp_path, llm=Exploding())
        await fresh.recover_on_startup()
        assert not fresh.busy and (await store.get_run(run["run_id"]))["status"] == "paused"
    asyncio.run(go())


def test_concurrent_starts_create_exactly_one_run(tmp_path):
    async def go():
        store = InMemoryResearchStore()
        runner, _ = make_runner(store, tmp_path)
        results = await asyncio.gather(
            runner.start_run(trigger="admin", scope="all"), runner.start_run(trigger="admin", scope="all"),
            return_exceptions=True,
        )
        await runner.wait_idle()
        assert sum(isinstance(r, dict) for r in results) == 1
        assert sum(isinstance(r, RunActive) for r in results) == 1
        assert len(store.runs) == 1
    asyncio.run(go())


def test_resume_is_only_allowed_from_paused(tmp_path):
    async def go():
        store = InMemoryResearchStore()
        runner, _ = make_runner(store, tmp_path)
        run = await runner.start_run(trigger="admin", scope="all")
        await runner.wait_idle()
        with pytest.raises(InvalidTransition):
            await runner.resume(run["run_id"])
    asyncio.run(go())


def test_one_company_failing_does_not_stop_the_others(tmp_path):
    async def go():
        store = InMemoryResearchStore()

        def respond(system, user, label):
            return {"is_company": True} if label == "resolve:meesho" else resolve_answer("Razorpay", "https://razorpay.com")
        runner, _ = make_runner(store, tmp_path, llm=FakeLLM(respond))
        run = await runner.start_run(trigger="admin", scope="all")
        await runner.wait_idle()
        run = await store.get_run(run["run_id"])
        items = {i["company_id"]: i for i in await store.list_items(run["run_id"])}
        assert run["status"] == "completed" and run["counters"]["failed"] == 1 and run["counters"]["done"] == 1
        assert items["c-meesho"]["status"] == "failed"
        assert items["c-meesho"]["error"]["code_ref"] == "app/research/nodes/resolve.py:resolve"
        assert items["c-razorpay"]["status"] == "done"
        state = {s["company_id"]: s for s in await store.list_company_states()}
        assert state["c-meesho"]["last_status"] == "failed" and "last_researched_at" not in state["c-meesho"]
    asyncio.run(go())


def test_secrets_in_upstream_errors_are_redacted_everywhere(tmp_path):
    async def go():
        store = InMemoryResearchStore()
        exa = company_exa(fail=ExaError(f"Exa returned 401 for key {SECRET}"))
        runner, _ = make_runner(store, tmp_path, exa=exa, targets=[MEESHO])
        run = await runner.start_run(trigger="admin", scope="all")
        await runner.wait_idle()
        (item,) = await store.list_items(run["run_id"])
        assert item["status"] == "failed" and "«redacted:EXA_API_KEY»" in item["error"]["message"]
        assert len(exa.calls) == 3          # transient → retried 3× by the node RetryPolicy
        everything = json.dumps([store.runs, list(store.items.values()), store.spans, store.events], default=str)
        assert SECRET not in everything
    asyncio.run(go())


def test_replay_reproduces_a_recorded_run_for_free(tmp_path):
    async def go():
        recorded = InMemoryResearchStore()
        rec_runner, _ = make_runner(recorded, tmp_path)
        await rec_runner.start_run(trigger="admin", scope="all", mode="record")
        await rec_runner.wait_idle()

        replayed = InMemoryResearchStore()
        rep_runner, _ = make_runner(replayed, tmp_path, exa=Exploding(), llm=Exploding())
        run = await rep_runner.start_run(trigger="admin", scope="all", mode="replay")
        await rep_runner.wait_idle()
        run = await replayed.get_run(run["run_id"])
        assert run["status"] == "completed"
        assert (run["budget"]["exa_used"], run["budget"]["llm_used"]) == (0, 0)
        snap = lambda store: {d["company_id"]: d["snapshot"] for d in store.drafts}  # noqa: E731
        assert snap(replayed) == snap(recorded)
    asyncio.run(go())


def test_all_scope_skips_recently_researched_companies(tmp_path):
    async def go():
        store = InMemoryResearchStore()
        await store.upsert_company_state("c-meesho", fields={"last_researched_at": utcnow() - timedelta(days=1)})
        await store.upsert_company_state("c-razorpay", fields={"last_researched_at": utcnow() - timedelta(days=30)})
        runner, _ = make_runner(store, tmp_path)
        run = await runner.start_run(trigger="cron", scope="all")
        await runner.wait_idle()
        assert run["company_ids"] == ["c-razorpay"]
    asyncio.run(go())


def test_company_archived_after_queueing_is_skipped(tmp_path):
    async def go():
        store = InMemoryResearchStore()
        runner, live_targets = make_runner(store, tmp_path)
        run = await runner.start_run(trigger="admin", scope="all")
        live_targets.remove(MEESHO)            # archived before the drive refreshes targets
        await runner.wait_idle()
        items = {i["company_id"]: i for i in await store.list_items(run["run_id"])}
        assert items["c-meesho"]["status"] == "skipped"
        assert "no longer an active research target" in items["c-meesho"]["error"]["message"]
        assert items["c-razorpay"]["status"] == "done"
    asyncio.run(go())


def test_nothing_to_research_completes_immediately(tmp_path):
    async def go():
        store = InMemoryResearchStore()
        runner, _ = make_runner(store, tmp_path, targets=[])
        run = await runner.start_run(trigger="cron", scope="all")
        assert run["status"] == "completed" and not runner.busy
    asyncio.run(go())
```

- [ ] **Step 3: Run them to verify they fail**

Run: `.venv/bin/python -m pytest tests/research/test_targets.py tests/research/test_runner.py -q`
Expected: FAIL. `TargetsUnavailable` and `RunActive` can't be imported, and the runner raises `NotImplementedError`.

- [ ] **Step 4: Implement the targets module**

Replace `apps/ai-service/app/research/targets.py` with:

```python
"""Research targets: the active companies interviewiq-api says to research (spec §3.1), read from its
internal endpoint with the shared key. Unlike the brief pipeline's targets, failure is an error:
an admin pressing Start must hear why nothing ran."""
from __future__ import annotations

import logging
from dataclasses import dataclass

import httpx

from app.config import Settings

logger = logging.getLogger(__name__)


class TargetsUnavailable(RuntimeError):
    """interviewiq-api could not be reached or returned an error."""


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

    @classmethod
    def from_row(cls, row: dict) -> "ResearchTarget":
        return cls(id=row["id"], name=row["name"], slug=row["slug"], website=row.get("website"),
                   aliases=tuple(row.get("aliases") or ()))


async def fetch_research_targets(settings: Settings) -> list[ResearchTarget]:
    url = settings.api_base_url.rstrip("/") + "/api/v1/internal/research-targets"
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(url, headers={"X-Internal-Api-Key": settings.internal_api_key})
            resp.raise_for_status()
            rows = resp.json()
    except Exception as exc:  # noqa: BLE001
        raise TargetsUnavailable(f"could not load research targets from {url}: {exc}") from exc
    targets: list[ResearchTarget] = []
    for row in rows:
        try:
            targets.append(ResearchTarget.from_row(row))
        except (KeyError, TypeError) as exc:
            logger.warning("ignoring malformed research target %r: %s", row, exc)
    return targets
```

- [ ] **Step 5: Implement the runner**

Replace `apps/ai-service/app/research/runner.py` with:

```python
"""Drives research runs (spec §3.1, §5).

start_run() builds the queue and launches the drive loop as a background task. The loop runs each
company's LangGraph (a few companies at a time), saves the merged state + last node on the item
after EVERY node, and checks the run's `control` flag between nodes:
  pause → the company parks as `paused` and later resumes at the next node;
  stop  → the company is `cancelled`, its saved state cleared, no draft written.
A company in its LAST node always finishes (no wasted re-run). BudgetExhausted auto-pauses the run.

recover_on_startup() picks up runs a crash left behind, resuming from saved state; a company
caught mid-run more than RESEARCH_MAX_ATTEMPTS-1 times is failed as a crash loop.

One process, one active run (asyncio.Lock around start)."""
from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from contextlib import AbstractAsyncContextManager
from datetime import timedelta
from typing import Any

from app.config import Settings
from app.research.budget import Budget, BudgetExhausted
from app.research.fixtures import FixtureStore
from app.research.gateway import ResearchIO
from app.research.graph import NodeDeps, build_company_graph
from app.research.models import (
    NODE_ORDER,
    PIPELINE_VERSION,
    Control,
    InvalidTransition,
    ItemStatus,
    Mode,
    RunStatus,
    check_transition,
)
from app.research.store import ResearchStore
from app.research.targets import ResearchTarget
from app.research.trace.context import CURRENT_COMPANY, CURRENT_TRACER
from app.research.trace.errors import error_info
from app.research.trace.redact import redact
from app.research.trace.tracer import Tracer, new_id, utcnow

logger = logging.getLogger(__name__)

TargetsFetcher = Callable[[], Awaitable[list[ResearchTarget]]]
ClientsFactory = Callable[[], AbstractAsyncContextManager[tuple[Any, Any]]]

_TERMINAL_ITEM = (ItemStatus.DONE, ItemStatus.SKIPPED, ItemStatus.FAILED, ItemStatus.CANCELLED)


class RunActive(Exception):
    def __init__(self, run_id: str):
        super().__init__(f"run {run_id} is still active; resume or stop it first")
        self.run_id = run_id


class RunNotFound(LookupError):
    pass


class NoCompaniesSelected(ValueError):
    pass


def _counters(n: int) -> dict[str, int]:
    return {"total": n, **{s.value: 0 for s in ItemStatus}, "queued": n}


class ResearchRunner:
    def __init__(self, *, store: ResearchStore, settings: Settings, targets: TargetsFetcher,
                 clients: ClientsFactory, secrets: dict[str, str],
                 echo: Callable[[dict], None] | None = None, retry_initial_interval: float = 2.0):
        self._store = store
        self._settings = settings
        self._targets = targets
        self._clients = clients
        self._secrets = secrets
        self._echo = echo
        self._retry_interval = retry_initial_interval
        self._task: asyncio.Task | None = None
        self._start_lock = asyncio.Lock()
        self._tracer: Tracer | None = None
        self._budget: Budget | None = None
        self._active_run_id: str | None = None

    @property
    def store(self) -> ResearchStore:
        return self._store

    @property
    def busy(self) -> bool:
        return self._task is not None and not self._task.done()

    async def wait_idle(self) -> None:
        while self.busy:
            await asyncio.wait({self._task})

    # --- admin API ---------------------------------------------------------------------------------
    async def start_run(self, *, trigger: str, scope: str = "all", company_ids: list[str] | None = None,
                        mode: str | None = None, requested_by: str | None = None) -> dict:
        async with self._start_lock:
            active = await self._store.find_active_run()
            if active is not None:
                raise RunActive(active["run_id"])
            targets = await self._targets()
            chosen = await self._choose(targets, scope, company_ids or [])
            run_id, now = new_id(), utcnow()
            run = {
                "run_id": run_id, "trigger": trigger, "mode": Mode(mode or self._settings.research_mode).value,
                "scope": scope, "company_ids": [t.id for t in chosen], "targets": [t.as_dict() for t in targets],
                "status": RunStatus.QUEUED.value, "control": Control.NONE.value, "pause_reason": None,
                "requested_by": requested_by, "counters": _counters(len(chosen)),
                "budget": {"exa_used": 0, "exa_cap": self._settings.research_max_exa_calls,
                           "llm_used": 0, "llm_cap": self._settings.research_max_llm_calls,
                           "tokens_in": 0, "tokens_out": 0},
                "last_seq": 0, "created_at": now, "started_at": None, "finished_at": None, "error": None,
                "pipeline_version": PIPELINE_VERSION,
            }
            await self._store.insert_run(run)
            await self._store.insert_items([self._new_item(run_id, i, t) for i, t in enumerate(chosen)])
            for t in chosen:
                await self._store.upsert_company_state(t.id, fields={"last_run_id": run_id, "last_status": ItemStatus.QUEUED.value})
            if chosen:
                self._launch(run_id)
            else:
                await self._store.update_run(run_id, fields={"status": RunStatus.COMPLETED.value, "started_at": now, "finished_at": now})
            return await self._store.get_run(run_id)

    async def pause(self, run_id: str) -> dict:
        run = await self._require(run_id)
        check_transition(run["status"], "pause")
        await self._store.update_run(run_id, fields={"control": Control.PAUSE.value, "status": RunStatus.PAUSING.value,
                                                     "pause_reason": "admin"})
        await self._note(run_id, "control.pause", "pause requested: companies finish their current step, then park")
        if not self.busy:
            await self._finalize(run_id)
        return await self._store.get_run(run_id)

    async def resume(self, run_id: str) -> dict:
        run = await self._require(run_id)
        check_transition(run["status"], "resume")
        if self.busy:
            raise InvalidTransition("the previous drive is still winding down; try again in a moment")
        await self._store.update_run(run_id, fields={"control": Control.NONE.value, "status": RunStatus.QUEUED.value,
                                                     "pause_reason": None})
        await self._note(run_id, "control.resume", "resume requested")
        self._launch(run_id)
        return await self._store.get_run(run_id)

    async def stop(self, run_id: str) -> dict:
        run = await self._require(run_id)
        check_transition(run["status"], "stop")
        await self._store.update_run(run_id, fields={"control": Control.STOP.value, "status": RunStatus.STOPPING.value})
        await self._note(run_id, "control.stop", "stop requested: companies finish their current step, then cancel")
        if not self.busy:   # paused (or orphaned): nothing is driving it, so complete the stop here
            await self._finalize(run_id)
        return await self._store.get_run(run_id)

    async def raise_budget(self, run_id: str, *, exa_cap: int | None = None, llm_cap: int | None = None) -> dict:
        run = await self._require(run_id)
        budget = run["budget"]
        fields: dict[str, int] = {}
        for kind, cap in (("exa", exa_cap), ("llm", llm_cap)):
            if cap is None:
                continue
            if cap < budget[f"{kind}_used"]:
                raise ValueError(f"{kind}_cap {cap} is below calls already made ({budget[f'{kind}_used']})")
            fields[f"budget.{kind}_cap"] = cap
        if fields:
            await self._store.update_run(run_id, fields=fields)
            if self._budget is not None and self._active_run_id == run_id:
                self._budget.set_caps(exa_cap=exa_cap, llm_cap=llm_cap)
            await self._note(run_id, "budget.raised", f"budget caps raised: {fields}")
        return await self._store.get_run(run_id)

    async def recover_on_startup(self) -> None:
        runs = await self._store.find_runs_by_status(
            [RunStatus.QUEUED, RunStatus.RUNNING, RunStatus.PAUSING, RunStatus.STOPPING])
        for run in runs:
            run_id = run["run_id"]
            for item in await self._store.list_items(run_id):
                if item["status"] != ItemStatus.RUNNING:
                    continue
                attempts = item.get("attempts", 1) + 1
                if attempts > self._settings.research_max_attempts:
                    await self._set_item_status(run_id, item["company_id"], ItemStatus.RUNNING, ItemStatus.FAILED, extra={
                        "attempts": attempts, "current_node": None, "finished_at": utcnow(),
                        "error": {"type": "CrashLoop", "code_ref": None, "traceback": "",
                                  "message": f"the service restarted mid-run {attempts - 1} times while researching this company"},
                    })
                    await self._store.upsert_company_state(item["company_id"], fields={"last_status": ItemStatus.FAILED.value})
                else:
                    await self._store.update_item(run_id, item["company_id"], fields={"attempts": attempts})
            if run["status"] == RunStatus.STOPPING:
                await self._finalize(run_id)
            elif run["status"] == RunStatus.PAUSING:
                for item in await self._store.list_items(run_id):
                    if item["status"] == ItemStatus.RUNNING:
                        await self._set_item_status(run_id, item["company_id"], ItemStatus.RUNNING, ItemStatus.PAUSED)
                await self._store.update_run(run_id, fields={"status": RunStatus.PAUSED.value})
                await self._note(run_id, "run.recovered", "service restarted while pausing: run is paused", level="warn")
            elif self.busy:
                await self._store.update_run(run_id, fields={"status": RunStatus.FAILED.value, "finished_at": utcnow(),
                                                             "error": "orphaned: another run was already being resumed"})
            else:
                await self._note(run_id, "run.recovered", "service restarted mid-run: resuming from saved state", level="warn")
                self._launch(run_id)

    # --- drive loop --------------------------------------------------------------------------------
    def _launch(self, run_id: str) -> None:
        self._task = asyncio.create_task(self._drive(run_id), name=f"research-run-{run_id}")

    async def _drive(self, run_id: str) -> None:
        run = await self._store.get_run(run_id)
        tracer = Tracer(self._store, run_id, secrets=self._secrets, start_seq=run.get("last_seq", 0), echo=self._echo)
        await tracer.start()
        self._tracer, self._active_run_id = tracer, run_id
        token = CURRENT_TRACER.set(tracer)
        resumed = run.get("started_at") is not None
        try:
            fields: dict[str, Any] = {"status": RunStatus.RUNNING.value}
            if not resumed:
                fields["started_at"] = utcnow()
            await self._store.update_run(run_id, fields=fields)
            tracer.emit("run.resumed" if resumed else "run.started",
                        f"{'resuming' if resumed else 'starting'} run · mode={run['mode']} · {run['counters']['total']} company(ies)",
                        data={"mode": run["mode"], "trigger": run["trigger"], "scope": run["scope"], "budget": run["budget"]})
            budget = Budget.from_run(self._store, run)
            self._budget = budget
            active_ids = await self._active_target_ids()
            async with tracer.span("run", "resume" if resumed else "run", attrs={"mode": run["mode"], "trigger": run["trigger"]}):
                async with self._clients() as (exa, llm):
                    io = ResearchIO(mode=Mode(run["mode"]), exa=exa, llm=llm,
                                    fixtures=FixtureStore(self._settings.research_fixtures_dir), tracer=tracer,
                                    budget=budget, store=self._store, settings=self._settings)
                    await self._process_items(run, io, tracer, active_ids)
            await self._finalize(run_id, tracer)
        except Exception as exc:  # noqa: BLE001 — a failed run is recorded, never raised into the event loop
            logger.exception("research run %s failed", run_id)
            info = redact(error_info(exc), self._secrets)
            await self._store.update_run(run_id, fields={"status": RunStatus.FAILED.value, "control": Control.NONE.value,
                                                         "error": info["message"], "finished_at": utcnow()})
            tracer.emit("run.failed", f"run failed: {info['type']}: {info['message']}", level="error", data=info)
        finally:
            CURRENT_TRACER.reset(token)
            await tracer.close()
            self._tracer = None
            self._budget = None
            self._active_run_id = None

    async def _active_target_ids(self) -> set[str] | None:
        try:
            return {t.id for t in await self._targets()}
        except Exception as exc:  # noqa: BLE001
            logger.warning("could not refresh research targets (%s); researching the queued companies as-is", exc)
            return None

    async def _process_items(self, run: dict, io: ResearchIO, tracer: Tracer, active_ids: set[str] | None) -> None:
        run_id = run["run_id"]
        items = await self._store.list_items(run_id)
        order = [i for i in items if i["status"] in (ItemStatus.RUNNING, ItemStatus.PAUSED)]
        order += [i for i in items if i["status"] == ItemStatus.QUEUED]
        sem = asyncio.Semaphore(self._settings.research_concurrency)
        tasks: list[asyncio.Task] = []
        for item in order:
            await sem.acquire()
            if await self._control(run_id) is not Control.NONE:
                sem.release()
                break
            if active_ids is not None and item["company_id"] not in active_ids:
                await self._skip_inactive(run_id, item, tracer)
                sem.release()
                continue
            tasks.append(asyncio.create_task(self._run_item_slot(run, item, io, tracer, sem)))
        await asyncio.gather(*tasks)

    async def _run_item_slot(self, run: dict, item: dict, io: ResearchIO, tracer: Tracer, sem: asyncio.Semaphore) -> None:
        try:
            await self._run_item(run, item, io, tracer)
        finally:
            sem.release()

    async def _run_item(self, run: dict, item: dict, io: ResearchIO, tracer: Tracer) -> None:
        run_id, cid = run["run_id"], item["company_id"]
        company = item["target"]
        others = [t for t in run["targets"] if t["id"] != cid]
        state: dict = item.get("state") or {"company": company, "others": others}
        last_node: str | None = item.get("last_node")
        outcome, err = ItemStatus.DONE, None
        token = CURRENT_COMPANY.set(cid)
        try:
            await self._set_item_status(run_id, cid, ItemStatus(item["status"]), ItemStatus.RUNNING,
                                        extra={"started_at": utcnow(), "error": None})
            await self._store.upsert_company_state(cid, fields={"last_run_id": run_id, "last_status": ItemStatus.RUNNING.value})
            deps = NodeDeps(io=io, store=self._store, tracer=tracer, settings=self._settings, run_id=run_id)
            graph = build_company_graph(deps, retry_initial_interval=self._retry_interval)
            config = {"configurable": {"thread_id": f"{run_id}:{cid}:{new_id()[:8]}"}}
            interrupted: Control | None = None
            async with tracer.span("company", company["name"], company_id=cid,
                                   attrs={"slug": company["slug"], "resumed_after": last_node}):
                if last_node:
                    await graph.aupdate_state(config, state, as_node=last_node)
                    tracer.emit("item.resumed", f"{company['name']}: resuming after {last_node}")
                    graph_input = None
                else:
                    tracer.emit("item.started", f"{company['name']}: starting")
                    graph_input = state
                stream = graph.astream(graph_input, config, stream_mode="updates")
                try:
                    async for update in stream:
                        for node_name, delta in update.items():
                            state = {**state, **(delta or {})}
                            last_node = node_name
                        await self._store.update_item(run_id, cid, fields={"state": state, "last_node": last_node})
                        control = await self._control(run_id)
                        if control is not Control.NONE and last_node != NODE_ORDER[-1]:
                            interrupted = control
                            break
                finally:
                    await stream.aclose()
            if interrupted is Control.PAUSE:
                outcome = ItemStatus.PAUSED
            elif interrupted is Control.STOP:
                outcome = ItemStatus.CANCELLED
            elif (state.get("draft") or {}).get("status") == "unchanged":
                outcome = ItemStatus.SKIPPED
        except BudgetExhausted as exc:
            outcome = ItemStatus.PAUSED
            await self._store.update_run(run_id, fields={"control": Control.PAUSE.value, "status": RunStatus.PAUSING.value,
                                                         "pause_reason": "budget_exhausted"})
            tracer.emit("budget.exhausted", f"{exc}: pausing the run; raise the cap, then resume", level="warn",
                        data={"kind": exc.kind, "used": exc.used, "cap": exc.cap})
        except Exception as exc:  # noqa: BLE001 — one company's failure never stops the run
            outcome, err = ItemStatus.FAILED, redact(error_info(exc), self._secrets)
        finally:
            CURRENT_COMPANY.reset(token)
        await self._finish_item(run_id, item, outcome, state, err, tracer)

    async def _finish_item(self, run_id: str, item: dict, outcome: ItemStatus, state: dict,
                           err: dict | None, tracer: Tracer) -> None:
        cid, name = item["company_id"], item["company_name"]
        draft = state.get("draft") or {}
        extra: dict[str, Any] = {"current_node": None}
        if outcome in _TERMINAL_ITEM:
            extra["finished_at"] = utcnow()
        if outcome is ItemStatus.CANCELLED:
            extra.update(state=None, last_node=None)
        if outcome is ItemStatus.FAILED:
            extra["error"] = err
        if outcome in (ItemStatus.DONE, ItemStatus.SKIPPED):
            extra["draft_id"] = draft.get("draft_id")
        await self._set_item_status(run_id, cid, ItemStatus.RUNNING, outcome, extra=extra)

        company_state: dict[str, Any] = {"last_status": outcome.value}
        if outcome in (ItemStatus.DONE, ItemStatus.SKIPPED):
            company_state["last_researched_at"] = utcnow()
            if draft.get("status") == "created":
                company_state["latest_draft_id"] = draft["draft_id"]
                company_state["latest_draft_status"] = "pending_review"
        await self._store.upsert_company_state(cid, fields=company_state)

        message = {
            ItemStatus.DONE: f"done · draft v{draft.get('version')}",
            ItemStatus.SKIPPED: "no changes since the last draft: skipped",
            ItemStatus.PAUSED: "paused",
            ItemStatus.CANCELLED: "cancelled",
            ItemStatus.FAILED: f"failed · {err['type']}: {err['message']}" if err else "failed",
        }[outcome]
        tracer.emit(f"item.{outcome.value}", f"{name}: {message}", level="error" if outcome is ItemStatus.FAILED else "info",
                    company_id=cid, data=err if outcome is ItemStatus.FAILED else {"draft": draft or None})

    async def _skip_inactive(self, run_id: str, item: dict, tracer: Tracer) -> None:
        reason = "company is no longer an active research target (archived or deleted after the run was queued)"
        await self._set_item_status(run_id, item["company_id"], ItemStatus(item["status"]), ItemStatus.SKIPPED, extra={
            "finished_at": utcnow(), "error": {"type": "NotATarget", "message": reason, "traceback": "", "code_ref": None}})
        await self._store.upsert_company_state(item["company_id"], fields={"last_status": ItemStatus.SKIPPED.value})
        tracer.emit("item.skipped", f"{item['company_name']}: {reason}", level="warn", company_id=item["company_id"])

    async def _finalize(self, run_id: str, tracer: Tracer | None = None) -> None:
        run = await self._store.get_run(run_id)
        control = run["control"]
        if control == Control.STOP:
            for item in await self._store.list_items(run_id):
                if item["status"] in (ItemStatus.QUEUED, ItemStatus.PAUSED, ItemStatus.RUNNING):
                    await self._set_item_status(run_id, item["company_id"], ItemStatus(item["status"]), ItemStatus.CANCELLED,
                                                extra={"state": None, "last_node": None, "current_node": None,
                                                       "finished_at": utcnow()})
                    await self._store.upsert_company_state(item["company_id"], fields={"last_status": ItemStatus.CANCELLED.value})
            fields = {"status": RunStatus.STOPPED.value, "control": Control.NONE.value, "finished_at": utcnow()}
        elif control == Control.PAUSE:
            fields = {"status": RunStatus.PAUSED.value}
        else:
            fields = {"status": RunStatus.COMPLETED.value, "finished_at": utcnow()}
        run = await self._store.update_run(run_id, fields=fields)
        c = run["counters"]
        summary = f"run {fields['status']} · done {c['done']} · skipped {c['skipped']} · failed {c['failed']} · cancelled {c['cancelled']}"
        data = {"counters": c, "budget": run["budget"], "pause_reason": run.get("pause_reason")}
        if tracer is not None:
            tracer.emit(f"run.{fields['status']}", summary, data=data)
        else:
            await self._note(run_id, f"run.{fields['status']}", summary, data=data)

    # --- helpers -----------------------------------------------------------------------------------
    async def _require(self, run_id: str) -> dict:
        run = await self._store.get_run(run_id)
        if run is None:
            raise RunNotFound(f"no research run {run_id}")
        return run

    async def _control(self, run_id: str) -> Control:
        run = await self._store.get_run(run_id)
        return Control(run["control"])

    async def _set_item_status(self, run_id: str, company_id: str, old: ItemStatus, new: ItemStatus,
                               extra: dict | None = None) -> None:
        await self._store.update_item(run_id, company_id, fields={"status": new.value, **(extra or {})})
        if old is not new:
            await self._store.update_run(run_id, inc={f"counters.{old.value}": -1, f"counters.{new.value}": 1})

    async def _note(self, run_id: str, type_: str, message: str, *, level: str = "info", data: Any = None) -> None:
        """Emit into the live trace when this run is being driven; otherwise write it directly."""
        if self._tracer is not None and self._active_run_id == run_id:
            self._tracer.emit(type_, message, level=level, data=data)
            return
        run = await self._store.get_run(run_id)
        detached = Tracer(self._store, run_id, secrets=self._secrets, start_seq=run.get("last_seq", 0), echo=self._echo)
        detached.emit(type_, message, level=level, data=data)
        await detached.flush()

    @staticmethod
    def _new_item(run_id: str, position: int, target: ResearchTarget) -> dict:
        return {"run_id": run_id, "company_id": target.id, "company_name": target.name, "company_slug": target.slug,
                "position": position, "target": target.as_dict(), "status": ItemStatus.QUEUED.value, "attempts": 1,
                "current_node": None, "last_node": None, "state": None, "nodes": {}, "draft_id": None,
                "error": None, "started_at": None, "finished_at": None}

    async def _choose(self, targets: list[ResearchTarget], scope: str, company_ids: list[str]) -> list[ResearchTarget]:
        if scope == "selected":
            wanted = set(company_ids)
            chosen = [t for t in targets if t.id in wanted]
            if not chosen:
                raise NoCompaniesSelected("none of the selected companies are active research targets")
            return chosen
        states = {s["company_id"]: s for s in await self._store.list_company_states([t.id for t in targets])}
        cutoff = utcnow() - timedelta(days=self._settings.research_stale_after_days)

        def stale(t: ResearchTarget) -> bool:
            last = states.get(t.id, {}).get("last_researched_at")
            return last is None or last < cutoff
        return [t for t in targets if stale(t)]
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/research -q`
Expected: PASS, including all 17 runner tests.

If `test_crash_recovery…` fails on `attempts == 2`, check that `recover_on_startup` increments attempts only for items whose status is `running`.

- [ ] **Step 7: Run the full ai-service suite**

Run: `.venv/bin/python -m pytest -q`
Expected: PASS, with no regressions in the brief, question or interview tests.

- [ ] **Step 8: Checkpoint**

Run `git status`; leave the changes uncommitted.

---

