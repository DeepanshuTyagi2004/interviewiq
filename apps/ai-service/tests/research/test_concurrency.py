"""gather_ordered: bounded fan-out that keeps order and re-raises the real error (spec §11)."""
import asyncio

import pytest

from app.research.budget import BudgetExhausted
from app.research.concurrency import gather_ordered


def test_results_keep_input_order():
    async def job(value, delay):
        await asyncio.sleep(delay)
        return value
    assert asyncio.run(gather_ordered([job("a", 0.03), job("b", 0.0), job("c", 0.01)])) == ["a", "b", "c"]


def test_empty_input():
    assert asyncio.run(gather_ordered([])) == []


def test_gather_ordered_reraises_budget_exhausted_unwrapped():
    async def ok():
        await asyncio.sleep(0.05)
        return 1

    async def broke():
        raise BudgetExhausted("llm", 5, 5)

    with pytest.raises(BudgetExhausted):
        asyncio.run(gather_ordered([ok(), broke()]))


def test_a_failure_cancels_the_siblings():
    finished = []

    async def slow():
        await asyncio.sleep(0.5)
        finished.append("slow")

    async def boom():
        raise RuntimeError("provider down")

    with pytest.raises(RuntimeError, match="provider down"):
        asyncio.run(gather_ordered([slow(), boom()]))
    assert finished == []


def test_a_child_raising_cancelled_error_propagates():
    async def cancelled():
        raise asyncio.CancelledError()

    async def go():
        with pytest.raises(asyncio.CancelledError):
            await gather_ordered([cancelled()])
    asyncio.run(go())


def test_gateway_timeout_includes_semaphore_queue_before_budget_charge(tmp_path, monkeypatch):
    from app.llm.client import LLMError
    from tests.research.fakes import Exploding
    from tests.research.test_gateway import CLAIMS_KW, _io, _settings

    async def go():
        loop = asyncio.get_running_loop()
        clock = [loop.time()]
        monkeypatch.setattr(loop, "time", lambda: clock[0])
        io, store, tracer = await _io(tmp_path, llm=Exploding(), settings=_settings(
            research_llm_concurrency=1, research_operation_timeout_seconds=1,
        ))
        await io._llm_slots.acquire()
        task = asyncio.create_task(io.extract_json(**CLAIMS_KW))
        await asyncio.sleep(0)
        assert not task.done()
        clock[0] += 2
        with pytest.raises(LLMError, match="timed out"):
            await task
        assert (await store.get_run("run1"))["budget"]["llm_used"] == 0
        io._llm_slots.release()
        assert io._llm_slots._value == 1
        await tracer.close()
    asyncio.run(go())


def test_gateway_cancellation_releases_slot_and_preserves_type(tmp_path):
    from tests.research.fakes import FakeLLM
    from tests.research.test_gateway import CLAIMS_KW, _io, _settings

    async def go():
        entered = asyncio.Event()
        async def wait(label):
            entered.set()
            await asyncio.Event().wait()
        io, _, tracer = await _io(tmp_path, llm=FakeLLM(lambda s, u, label: {}, on_call=wait),
                                  settings=_settings(research_llm_concurrency=1))
        task = asyncio.create_task(io.extract_json(**CLAIMS_KW))
        await entered.wait()
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert io._llm_slots._value == 1
        await tracer.close()
    asyncio.run(go())


def test_source_deadline_is_shared_by_initial_call_and_envelope_repair(tmp_path, monkeypatch):
    from app.llm.client import LLMError
    from tests.research.fakes import FakeLLM
    from tests.research.test_gateway import CLAIMS_KW, _io, _settings

    async def go():
        loop = asyncio.get_running_loop()
        clock = [loop.time()]
        monkeypatch.setattr(loop, "time", lambda: clock[0])
        repair_entered = asyncio.Event()
        async def wait(label):
            if label.endswith("#repair"):
                repair_entered.set()
                await asyncio.Event().wait()
            else:
                clock[0] += 0.75
        llm = FakeLLM(lambda s, u, label: {"bad": []}, on_call=wait)
        io, store, tracer = await _io(tmp_path, llm=llm, settings=_settings(research_operation_timeout_seconds=1))
        task = asyncio.create_task(io.extract_claims(**CLAIMS_KW))
        await repair_entered.wait()
        clock[0] += 0.3  # source deadline exceeded; the repair's own deadline has not expired
        with pytest.raises(LLMError, match="timed out"):
            await task
        assert llm.calls == ["t", "t#repair"]
        assert (await store.get_run("run1"))["budget"]["llm_used"] == 2
        await tracer.close()
    asyncio.run(go())


def test_source_deadline_keeps_completed_chunks_and_cancels_queued_chunks(tmp_path, monkeypatch):
    from tests.research.fakes import FakeLLM
    from tests.research.test_extraction_chunks import _user
    from tests.research.test_gateway import CLAIMS_KW, _io, _settings

    async def go():
        loop = asyncio.get_running_loop()
        clock = [loop.time()]
        monkeypatch.setattr(loop, "time", lambda: clock[0])
        blocked = asyncio.Event()
        async def wait(label):
            if label.endswith("chunk-2"):
                blocked.set()
                await asyncio.Event().wait()
        llm = FakeLLM(lambda s, u, label: {"claims": [{"field": "skill", "value": "Python", "quote": "Python"}]},
                      on_call=wait)
        io, store, tracer = await _io(tmp_path, llm=llm, settings=_settings(
            research_llm_concurrency=1, research_operation_timeout_seconds=1,
        ))
        task = asyncio.create_task(io.extract_claims(**{**CLAIMS_KW, "user": _user("Python " * 1600)}))
        await blocked.wait()
        clock[0] += 2
        claims = await task
        assert len(claims) == 1
        assert [d["chunk_index"] for d in claims.diagnostics] == [1, 2]
        assert llm.calls == ["t#chunk-1", "t#chunk-2"]
        assert (await store.get_run("run1"))["budget"]["llm_used"] == 2
        assert io._llm_slots._value == 1
        await tracer.close()
    asyncio.run(go())
