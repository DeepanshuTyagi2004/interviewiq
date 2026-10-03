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
        assert [s["name"] for s in meesho_nodes] == ["resolve", "profile", "write_draft"]
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
        assert len(exa.calls) == 7    # three searches each; Razorpay resolve repeats after the pause
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
        assert llm2.calls == ["resolve:razorpay"]                  # Meesho resumed at profile (empty evidence)
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


def test_resume_continues_event_seqs_after_a_crash_between_insert_and_last_seq_update(tmp_path):
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
        stored_max = await store.max_event_seq(run_id)
        assert stored_max > 2
        # The crash: events 1..stored_max were inserted but last_seq never caught up.
        await store.update_run(run_id, fields={"last_seq": 2})

        await runner.resume(run_id)
        await runner.wait_idle()
        assert (await store.get_run(run_id))["status"] == "completed"
        seqs = sorted(e["seq"] for e in await store.list_events(run_id, EventFilter(limit=10_000)))
        assert seqs == list(range(1, len(seqs) + 1)) and len(seqs) > stored_max      # continues, no gaps, no dupes
        control = await store.list_events(run_id, EventFilter(type_prefix="control.resume"))
        assert [e["seq"] for e in control] == [stored_max + 1]       # the detached tracer starts past the stored max
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
        assert items["c-meesho"]["error"]["code_ref"] == "app/research/gateway.py:_extract_json"
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
        everything = json.dumps([store.runs, list(store.items.values()), store.spans, store.events, store.payloads,
                                 store.sources, store.extracts, store.company_states, store.drafts], default=str)
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


class _SlowStore(InMemoryResearchStore):
    """Adds latency to event flushes and fires `hook` once, from the first flush after the run is
    already `paused`/`completed`, i.e. while the drive is tearing down."""
    hook = None

    async def insert_events(self, events):
        await asyncio.sleep(0.005)
        await super().insert_events(events)
        run_id = events[0]["run_id"] if events else None
        if self.hook and run_id in self.runs and self.runs[run_id]["status"] in ("paused", "completed"):
            hook, self.hook = self.hook, None
            hook()


def _assert_contiguous_seqs(events):
    seqs = sorted(e["seq"] for e in events)
    assert seqs == list(range(1, len(seqs) + 1))


def test_stop_during_drive_teardown_is_not_lost(tmp_path):
    async def go():
        store = _SlowStore()
        holder = {}

        async def pause_once(label):
            if "p" not in holder:
                holder["p"] = True
                await runner.pause(holder["run_id"])
        store.hook = lambda: holder.__setitem__("stop", asyncio.ensure_future(runner.stop(holder["run_id"])))
        runner, _ = make_runner(store, tmp_path, llm=company_llm(on_call=pause_once))
        run = await runner.start_run(trigger="admin", scope="all")
        holder["run_id"] = run["run_id"]
        await runner.wait_idle()
        await holder["stop"]
        run = await store.get_run(run["run_id"])
        assert run["status"] == "stopped" and run["control"] == "none"
        assert all(i["status"] == "cancelled" for i in await store.list_items(run["run_id"]))
        events = await store.list_events(run["run_id"], EventFilter(limit=10_000))
        assert len([e for e in events if e["type"] == "control.stop"]) == 1
        _assert_contiguous_seqs(events)
        assert run["last_seq"] == len(events)
    asyncio.run(go())


def test_resume_during_drive_teardown_is_recorded_and_runs(tmp_path):
    async def go():
        store = _SlowStore()
        holder = {}

        async def pause_once(label):
            if "p" not in holder:
                holder["p"] = True
                await runner.pause(holder["run_id"])
        store.hook = lambda: holder.__setitem__("resume", asyncio.ensure_future(runner.resume(holder["run_id"])))
        runner, _ = make_runner(store, tmp_path, llm=company_llm(on_call=pause_once))
        run = await runner.start_run(trigger="admin", scope="all")
        holder["run_id"] = run["run_id"]
        await runner.wait_idle()
        await holder["resume"]
        await runner.wait_idle()
        run = await store.get_run(run["run_id"])
        assert run["status"] == "completed"
        events = await store.list_events(run["run_id"], EventFilter(limit=10_000))
        assert len([e for e in events if e["type"] == "control.resume"]) == 1
        _assert_contiguous_seqs(events)
        assert run["last_seq"] == len(events)
    asyncio.run(go())


class _ItemHookStore(InMemoryResearchStore):
    on_update = None

    async def update_item(self, run_id, company_id, *, fields=None, inc=None):
        if self.on_update:
            await self.on_update(company_id, fields or {})
        return await super().update_item(run_id, company_id, fields=fields, inc=inc)


def test_budget_exhaustion_does_not_override_a_pending_stop(tmp_path):
    async def go():
        store = _ItemHookStore()
        holder = {}

        async def stop_in_razorpay_resolve(company_id, fields):
            if company_id == "c-razorpay" and fields.get("current_node") == "resolve" and "s" not in holder:
                holder["s"] = True
                await runner.stop(holder["run_id"])
        store.on_update = stop_in_razorpay_resolve
        runner, _ = make_runner(store, tmp_path, research_max_llm_calls=1)
        run = await runner.start_run(trigger="admin", scope="all")
        holder["run_id"] = run["run_id"]
        await runner.wait_idle()
        run = await store.get_run(run["run_id"])
        assert run["status"] == "stopped" and run["control"] == "none"
        assert _statuses(await store.list_items(run["run_id"])) == {"c-meesho": "done", "c-razorpay": "cancelled"}
    asyncio.run(go())


def _only_current_task():
    return [t for t in asyncio.all_tasks() if t is not asyncio.current_task()]


def test_bookkeeping_error_in_one_company_fails_only_that_company(tmp_path):
    async def go():
        store = _ItemHookStore()
        boom = {}

        async def fail_meesho_done_once(company_id, fields):
            if company_id == "c-meesho" and fields.get("status") == "done" and "b" not in boom:
                boom["b"] = True
                raise RuntimeError("mongo hiccup")
        store.on_update = fail_meesho_done_once
        runner, _ = make_runner(store, tmp_path, research_concurrency=2)
        run = await runner.start_run(trigger="admin", scope="all")
        await runner.wait_idle()
        run = await store.get_run(run["run_id"])
        assert run["status"] == "completed"
        assert _statuses(await store.list_items(run["run_id"])) == {"c-meesho": "failed", "c-razorpay": "done"}
        assert run["counters"]["failed"] == 1 and run["counters"]["done"] == 1 and run["counters"]["running"] == 0
        assert _only_current_task() == []
    asyncio.run(go())


def test_dispatcher_failure_cancels_in_flight_companies_and_fails_the_run(tmp_path):
    async def go():
        store = InMemoryResearchStore()
        async def slow_llm(label):
            await asyncio.sleep(30)          # Meesho stays in flight until the drive cancels it
        runner, live_targets = make_runner(store, tmp_path, llm=company_llm(on_call=slow_llm), research_concurrency=2)

        async def broken_skip(*a, **kw):
            await asyncio.sleep(0.05)
            raise RuntimeError("store down")
        runner._skip_inactive = broken_skip
        run = await runner.start_run(trigger="admin", scope="all")
        live_targets.remove(RAZORPAY)           # dispatcher hits _skip_inactive while Meesho is in flight
        await runner.wait_idle()
        run = await store.get_run(run["run_id"])
        assert run["status"] == "failed" and "store down" in run["error"]
        items = await store.list_items(run["run_id"])
        assert not any(i["status"] == "running" for i in items)
        assert next(i for i in items if i["company_id"] == "c-meesho")["error"]["type"] == "RunFailed"
        assert run["counters"]["running"] == 0
        assert _only_current_task() == []
    asyncio.run(go())


def test_drive_starts_its_tracer_past_the_highest_stored_seq(tmp_path, monkeypatch):
    import app.research.runner as runner_mod
    started = []
    real = runner_mod.Tracer

    def spy(*args, **kw):
        started.append(kw.get("start_seq"))
        return real(*args, **kw)

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
        stored_max = await store.max_event_seq(run["run_id"])
        await store.update_run(run["run_id"], fields={"last_seq": 2})
        monkeypatch.setattr(runner_mod, "Tracer", spy)
        runner._note = lambda *a, **kw: asyncio.sleep(0)     # isolate the _drive half
        await runner.resume(run["run_id"])
        await runner.wait_idle()
        assert started == [stored_max]
    asyncio.run(go())


def test_pause_with_nothing_left_to_resume_completes(tmp_path):
    async def go():
        store = HookStore()
        holder = {}

        async def pause_on_last_company_draft():
            if len(store.drafts) == 2:
                await runner.pause(holder["run_id"])
        store.on_draft = pause_on_last_company_draft
        runner, _ = make_runner(store, tmp_path)
        run = await runner.start_run(trigger="admin", scope="all")
        holder["run_id"] = run["run_id"]
        await runner.wait_idle()
        run = await store.get_run(run["run_id"])
        assert run["status"] == "completed" and run["control"] == "none"
    asyncio.run(go())
