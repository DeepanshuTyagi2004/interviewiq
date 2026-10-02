import asyncio
import json
import logging

import pytest

from app.research.memory_store import InMemoryResearchStore
from app.research.store import EventFilter
from app.research.trace.context import CURRENT_TRACER
from app.research.trace.log_handler import ResearchLogHandler
from app.research.trace.tracer import INLINE_LIMIT_BYTES, Tracer, hydrate_span, utcnow

SECRET = "exa-secret-123"


async def _setup(start_seq=0):
    store = InMemoryResearchStore()
    await store.insert_run({"run_id": "run1", "status": "running", "last_seq": start_seq, "created_at": utcnow()})
    tracer = Tracer(store, "run1", secrets={"EXA_API_KEY": SECRET}, start_seq=start_seq, flush_interval=0.01)
    await tracer.start()
    return store, tracer


def test_spans_nest_inherit_company_and_record_output():
    async def go():
        store, t = await _setup()
        async with t.span("company", "Meesho", company_id="c1"):
            async with t.span("node", "resolve", node="resolve", input={"q": 1}) as inner:
                inner.set_output({"ok": True})
                inner.set_attrs(model="gemma")
        await t.close()
        spans = {s["name"]: s for s in await store.list_spans("run1")}
        assert spans["resolve"]["parent_id"] == spans["Meesho"]["span_id"]
        assert spans["resolve"]["company_id"] == "c1"
        full = await store.get_span(spans["resolve"]["span_id"])
        assert full["input"] == {"q": 1} and full["output"] == {"ok": True}
        assert full["status"] == "ok" and full["attrs"]["model"] == "gemma" and full["duration_ms"] >= 0
        types = [e["type"] for e in await store.list_events("run1", EventFilter())]
        assert types == ["span.start", "span.start", "span.end", "span.end"]
    asyncio.run(go())


def test_errors_are_recorded_redacted_and_reraised():
    async def go():
        store, t = await _setup()
        with pytest.raises(RuntimeError):
            async with t.span("exa", "search"):
                raise RuntimeError(f"401 for key {SECRET}")
        await t.close()
        (span,) = await store.list_spans("run1")
        full = await store.get_span(span["span_id"])
        assert full["status"] == "error"
        assert full["error"]["type"] == "RuntimeError"
        assert "«redacted:EXA_API_KEY»" in full["error"]["message"]
        events = await store.list_events("run1", EventFilter())
        end = next(e for e in events if e["type"] == "span.end")
        assert end["level"] == "error"
        dumped = json.dumps([full, events], default=str)
        assert SECRET not in dumped
    asyncio.run(go())


def test_emit_assigns_monotonic_seq_and_flush_records_last_seq():
    async def go():
        store, t = await _setup(start_seq=41)
        t.emit("log", "a")
        t.emit("log", "b", level="warn", data={"k": SECRET})
        await t.flush()
        events = await store.list_events("run1", EventFilter())
        assert [e["seq"] for e in events] == [42, 43]
        assert events[1]["level_rank"] == 30 and events[1]["data"] == {"k": "«redacted:EXA_API_KEY»"}
        assert (await store.get_run("run1"))["last_seq"] == 43
        assert t.last_seq == 43
        await t.close()
    asyncio.run(go())


def test_large_values_are_offloaded_and_hydrated_back():
    async def go():
        store, t = await _setup()
        big = {"text": "x" * (INLINE_LIMIT_BYTES + 10)}
        async with t.span("llm", "prompt", input=big) as sp:
            sp.set_output(big)
        t.emit("log", "big data", data=big)
        await t.close()
        (span,) = await store.list_spans("run1")
        full = await store.get_span(span["span_id"])
        assert full["input"] is None and full["input_ref"] and full["output_ref"]
        assert (await store.get_payload(full["input_ref"]))["body"] == big
        hydrated = await hydrate_span(store, full)
        assert hydrated["input"] == big and hydrated["output"] == big
        log = next(e for e in await store.list_events("run1", EventFilter()) if e["type"] == "log")
        assert "data" not in log and (await store.get_payload(log["data_ref"]))["body"] == big
    asyncio.run(go())


def test_cancelled_span_is_marked_cancelled():
    async def go():
        store, t = await _setup()

        async def body():
            async with t.span("node", "slow"):
                await asyncio.sleep(10)
        task = asyncio.create_task(body())
        await asyncio.sleep(0.02)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        await t.close()
        (span,) = await store.list_spans("run1")
        assert span["status"] == "cancelled"
    asyncio.run(go())


def test_log_handler_forwards_only_inside_a_bound_run():
    async def go():
        store, t = await _setup()
        handler = ResearchLogHandler()
        log = logging.getLogger("app.research.test_logger")
        log.setLevel(logging.DEBUG)
        log.addHandler(handler)
        log.propagate = False
        try:
            log.info("outside any run")
            token = CURRENT_TRACER.set(t)
            try:
                async with t.span("node", "resolve", node="resolve"):
                    log.debug("inside %s", "node")
                    try:
                        raise ValueError("bad")
                    except ValueError:
                        log.exception("it failed")
            finally:
                CURRENT_TRACER.reset(token)
            await t.flush()
        finally:
            log.removeHandler(handler)
        logs = [e for e in await store.list_events("run1", EventFilter()) if e["type"] == "log"]
        assert [e["message"] for e in logs] == ["inside node", "it failed"]
        assert logs[0]["level"] == "debug" and logs[0]["node"] == "resolve"
        assert logs[0]["data"]["logger"] == "app.research.test_logger"
        assert logs[1]["level"] == "error" and "ValueError: bad" in logs[1]["data"]["exc"]
        await t.close()
    asyncio.run(go())


def test_duplicate_key_batch_is_dropped_not_requeued():
    from app.research.store import DuplicateKey

    class FlakyStore(InMemoryResearchStore):
        def __init__(self):
            super().__init__()
            self.calls = 0

        async def insert_events(self, events):
            self.calls += 1
            if self.calls == 1:
                raise DuplicateKey("dup")
            return await super().insert_events(events)

    async def go():
        store = FlakyStore()
        await store.insert_run({"run_id": "run1", "status": "running", "last_seq": 0, "created_at": utcnow()})
        t = Tracer(store, "run1", secrets={}, flush_interval=10)
        t.emit("log", "lost")
        await t.flush()
        assert t._buffer == []
        t.emit("log", "kept")
        await t.flush()
        events = await store.list_events("run1", EventFilter())
        assert [e["message"] for e in events] == ["kept"]
    asyncio.run(go())


def test_failed_payload_write_keeps_payload_pending_and_defers_events():
    class FlakyPayloads(InMemoryResearchStore):
        def __init__(self):
            super().__init__()
            self.failed = False

        async def put_payload(self, payload):
            if not self.failed:
                self.failed = True
                raise RuntimeError("payload write down")
            return await super().put_payload(payload)

    async def go():
        store = FlakyPayloads()
        await store.insert_run({"run_id": "run1", "status": "running", "last_seq": 0, "created_at": utcnow()})
        t = Tracer(store, "run1", secrets={}, flush_interval=10)
        big = {"text": "x" * (INLINE_LIMIT_BYTES + 10)}
        t.emit("log", "big", data=big)
        with pytest.raises(RuntimeError):
            await t.flush()
        assert await store.list_events("run1", EventFilter()) == []
        await t.flush()
        (event,) = await store.list_events("run1", EventFilter())
        assert (await store.get_payload(event["data_ref"]))["body"] == big
    asyncio.run(go())


def test_failed_event_insert_requeues_batch_with_same_seqs():
    class FlakyEvents(InMemoryResearchStore):
        def __init__(self):
            super().__init__()
            self.failed = False

        async def insert_events(self, events):
            if not self.failed:
                self.failed = True
                raise RuntimeError("insert down")
            return await super().insert_events(events)

    async def go():
        store = FlakyEvents()
        await store.insert_run({"run_id": "run1", "status": "running", "last_seq": 0, "created_at": utcnow()})
        t = Tracer(store, "run1", secrets={}, flush_interval=10)
        t.emit("log", "a")
        t.emit("log", "b")
        with pytest.raises(RuntimeError):
            await t.flush()
        await t.flush()
        events = await store.list_events("run1", EventFilter())
        assert [e["seq"] for e in events] == [1, 2]
    asyncio.run(go())


def test_close_mid_flush_stores_every_event_exactly_once(caplog):
    class SlowStore(InMemoryResearchStore):
        async def insert_events(self, events):
            await asyncio.sleep(0.05)
            await super().insert_events(events)

    async def go():
        store = SlowStore()
        await store.insert_run({"run_id": "run1", "status": "running", "last_seq": 0, "created_at": utcnow()})
        t = Tracer(store, "run1", secrets={}, flush_interval=0.01)
        await t.start()
        for i in range(15):
            t.emit("x", f"event {i}")
        await asyncio.sleep(0.03)             # the loop is now inside a slow insert_events
        t.emit("x", "late")
        await t.close()
        events = await store.list_events("run1", EventFilter(limit=10_000))
        assert sorted(e["seq"] for e in events) == list(range(1, 17))
        assert (await store.get_run("run1"))["last_seq"] == 16
    with caplog.at_level(logging.ERROR):
        asyncio.run(go())
    assert "duplicate" not in caplog.text
