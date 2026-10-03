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
        self._driving_run_id: str | None = None
        self._control_lock = asyncio.Lock()

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
                "pipeline_version": PIPELINE_VERSION, "node_order": list(NODE_ORDER),
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
        async with self._control_lock:
            run = await self._require(run_id)
            check_transition(run["status"], "pause")
            await self._store.update_run(run_id, fields={"control": Control.PAUSE.value, "status": RunStatus.PAUSING.value,
                                                         "pause_reason": "admin"})
            await self._note(run_id, "control.pause", "pause requested: companies finish their current step, then park")
            if self._driving_run_id != run_id:
                await self._finalize(run_id)
        return await self._store.get_run(run_id)

    async def resume(self, run_id: str) -> dict:
        async with self._control_lock:
            run = await self._require(run_id)
            check_transition(run["status"], "resume")
            if self._driving_run_id == run_id:
                raise InvalidTransition("the previous drive is still winding down; try again in a moment")
            if not await self._check_compatible(run):
                raise InvalidTransition("incompatible research checkpoint; start a new overview run (history retained)")
            await self._store.update_run(run_id, fields={"control": Control.NONE.value, "status": RunStatus.QUEUED.value,
                                                         "pause_reason": None})
            await self._note(run_id, "control.resume", "resume requested")
            self._launch(run_id)
        return await self._store.get_run(run_id)

    async def stop(self, run_id: str) -> dict:
        async with self._control_lock:
            run = await self._require(run_id)
            check_transition(run["status"], "stop")
            await self._store.update_run(run_id, fields={"control": Control.STOP.value, "status": RunStatus.STOPPING.value})
            await self._note(run_id, "control.stop", "stop requested: companies finish their current step, then cancel")
            if self._driving_run_id != run_id:   # paused (or orphaned): nothing is driving it, so complete the stop here
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
            [RunStatus.QUEUED, RunStatus.RUNNING, RunStatus.PAUSING, RunStatus.STOPPING, RunStatus.PAUSED])
        for run in runs:
            run_id = run["run_id"]
            if not await self._check_compatible(run):
                continue
            if run["status"] == RunStatus.PAUSED:
                continue
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
        self._driving_run_id = run_id
        self._task = asyncio.create_task(self._drive(run_id), name=f"research-run-{run_id}")

    async def _drive(self, run_id: str) -> None:
        run = await self._store.get_run(run_id)
        if not await self._check_compatible(run):
            self._driving_run_id = None
            return
        tracer = Tracer(self._store, run_id, secrets=self._secrets, start_seq=await self._resume_seq(run), echo=self._echo)
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
            async with self._control_lock:
                await self._finalize(run_id, tracer)
                await self._teardown(run_id, tracer)
        except Exception as exc:  # noqa: BLE001 — a failed run is recorded, never raised into the event loop
            logger.exception("research run %s failed", run_id)
            info = redact(error_info(exc), self._secrets)
            async with self._control_lock:
                await self._store.update_run(run_id, fields={"status": RunStatus.FAILED.value, "control": Control.NONE.value,
                                                             "error": info["message"], "finished_at": utcnow()})
                await self._fail_running_items(run_id, info["message"])
                tracer.emit("run.failed", f"run failed: {info['type']}: {info['message']}", level="error", data=info)
                await self._teardown(run_id, tracer)
        finally:
            CURRENT_TRACER.reset(token)
            if self._driving_run_id == run_id:      # neither path above got to tear down
                await self._teardown(run_id, tracer)

    async def _teardown(self, run_id: str, tracer: Tracer) -> None:
        """Flush and close the tracer BEFORE the run stops counting as driven (callers hold the control
        lock), so a control note arriving afterwards uses a detached tracer past a fully flushed seq."""
        try:
            await tracer.close()
        except Exception:  # noqa: BLE001
            logger.exception("research run %s: closing the tracer failed", run_id)
        if self._tracer is tracer:
            self._tracer = None
            self._budget = None
            self._active_run_id = None
        if self._driving_run_id == run_id:
            self._driving_run_id = None

    async def _fail_running_items(self, run_id: str, message: str) -> None:
        """A failed run must not leave companies `running`: reconcile them (best effort)."""
        try:
            for item in await self._store.list_items(run_id):
                if item["status"] != ItemStatus.RUNNING:
                    continue
                await self._set_item_status(run_id, item["company_id"], ItemStatus.RUNNING, ItemStatus.FAILED, extra={
                    "current_node": None, "finished_at": utcnow(),
                    "error": {"type": "RunFailed", "message": message, "traceback": "", "code_ref": None}})
                await self._store.upsert_company_state(item["company_id"], fields={"last_status": ItemStatus.FAILED.value})
        except Exception:  # noqa: BLE001
            logger.exception("could not reconcile running companies of failed run %s", run_id)

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
        try:
            for item in order:
                await sem.acquire()
                try:
                    if await self._control(run_id) is not Control.NONE:
                        sem.release()
                        break
                    if active_ids is not None and item["company_id"] not in active_ids:
                        await self._skip_inactive(run_id, item, tracer)
                        sem.release()
                        continue
                except BaseException:
                    sem.release()
                    raise
                tasks.append(asyncio.create_task(self._run_item_slot(run, item, io, tracer, sem)))
            await asyncio.gather(*tasks)
        except BaseException:
            # No company task may outlive its drive (the clients and tracer are about to close).
            for t in tasks:
                t.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            raise

    async def _run_item_slot(self, run: dict, item: dict, io: ResearchIO, tracer: Tracer, sem: asyncio.Semaphore) -> None:
        try:
            await self._run_item(run, item, io, tracer)
        except Exception as exc:  # noqa: BLE001 — a bookkeeping failure fails only this company
            logger.exception("research run %s: bookkeeping failed for %s", run["run_id"], item["company_id"])
            await self._fail_item_after_bookkeeping_error(run["run_id"], item, exc)
        finally:
            sem.release()

    async def _fail_item_after_bookkeeping_error(self, run_id: str, item: dict, exc: Exception) -> None:
        try:
            current = next((i for i in await self._store.list_items(run_id) if i["company_id"] == item["company_id"]), None)
            if current is None or current["status"] != ItemStatus.RUNNING:
                return
            info = redact(error_info(exc), self._secrets)
            await self._set_item_status(run_id, item["company_id"], ItemStatus.RUNNING, ItemStatus.FAILED, extra={
                "current_node": None, "finished_at": utcnow(), "error": info})
            await self._store.upsert_company_state(item["company_id"], fields={"last_status": ItemStatus.FAILED.value})
        except Exception:  # noqa: BLE001
            logger.exception("could not mark %s failed after a bookkeeping error", item["company_id"])

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
            async with self._control_lock:
                control = await self._control(run_id)
                if control is Control.STOP:
                    outcome = ItemStatus.CANCELLED      # a stop wins: finalize will stop the run
                    follow_up = "stopping the run"
                else:
                    outcome = ItemStatus.PAUSED
                    follow_up = "the run is already pausing; raise the cap, then resume"
                    if control is Control.NONE:
                        follow_up = "pausing the run; raise the cap, then resume"
                        await self._store.update_run(run_id, fields={
                            "control": Control.PAUSE.value, "status": RunStatus.PAUSING.value,
                            "pause_reason": "budget_exhausted"})
            tracer.emit("budget.exhausted", f"{exc}: {follow_up}", level="warn",
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
            if draft.get("coverage"):
                extra["coverage"] = draft["coverage"]
        await self._set_item_status(run_id, cid, ItemStatus.RUNNING, outcome, extra=extra)

        company_state: dict[str, Any] = {"last_status": outcome.value}
        if outcome in (ItemStatus.DONE, ItemStatus.SKIPPED):
            company_state["last_researched_at"] = utcnow()
            if draft.get("status") == "created":
                company_state["latest_draft_id"] = draft["draft_id"]
                company_state["latest_draft_status"] = "pending_review"
            if draft.get("coverage"):
                company_state["latest_draft_coverage"] = draft["coverage"]
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
        elif control == Control.PAUSE and any(
                i["status"] in (ItemStatus.QUEUED, ItemStatus.PAUSED, ItemStatus.RUNNING)
                for i in await self._store.list_items(run_id)):
            fields = {"status": RunStatus.PAUSED.value}
        else:
            fields = {"status": RunStatus.COMPLETED.value, "control": Control.NONE.value, "finished_at": utcnow()}
        run = await self._store.update_run(run_id, fields=fields)
        c = run["counters"]
        summary = f"run {fields['status']} · done {c['done']} · skipped {c['skipped']} · failed {c['failed']} · cancelled {c['cancelled']}"
        data = {"counters": c, "budget": run["budget"], "pause_reason": run.get("pause_reason")}
        if tracer is not None:
            tracer.emit(f"run.{fields['status']}", summary, data=data)
        else:
            await self._note(run_id, f"run.{fields['status']}", summary, data=data)

    # --- helpers -----------------------------------------------------------------------------------
    async def _check_compatible(self, run: dict) -> bool:
        """Fail closed before opening clients or seeding a graph with an old/unknown node.

        Saved states, completed items and drafts remain intact for inspection. A fresh run is
        required after a graph migration; never silently treat a full-research checkpoint as overview.
        """
        items = await self._store.list_items(run["run_id"])
        pending = [i for i in items if i["status"] not in _TERMINAL_ITEM]
        compatible = (run.get("pipeline_version") == PIPELINE_VERSION
                      and run.get("node_order") == list(NODE_ORDER)
                      and all(i.get("last_node") in (None, *NODE_ORDER)
                              and i.get("current_node") in (None, *NODE_ORDER) for i in pending))
        if compatible:
            return True
        message = "Incompatible research checkpoint; start a new overview run. Saved state and draft history retained."
        info = {"type": "PipelineVersionMismatch", "message": message, "traceback": "", "code_ref": None}
        for item in pending:
            await self._set_item_status(run["run_id"], item["company_id"], ItemStatus(item["status"]), ItemStatus.FAILED,
                                        extra={"error": info, "finished_at": utcnow()})
            await self._store.upsert_company_state(item["company_id"], fields={"last_status": ItemStatus.FAILED.value})
        await self._store.update_run(run["run_id"], fields={"status": RunStatus.FAILED.value,
            "control": Control.NONE.value, "pause_reason": None, "error": message, "finished_at": utcnow()})
        await self._note(run["run_id"], "run.incompatible", message, level="error", data=info)
        return False

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
        detached = Tracer(self._store, run_id, secrets=self._secrets, start_seq=await self._resume_seq(run), echo=self._echo)
        detached.emit(type_, message, level=level, data=data)
        await detached.flush()

    async def _resume_seq(self, run: dict) -> int:
        """Next-event baseline: a crash between a flush's insert_events and its last_seq update leaves
        last_seq behind the stored events, so also look at the highest stored seq."""
        return max(run.get("last_seq", 0), await self._store.max_event_seq(run["run_id"]))

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
