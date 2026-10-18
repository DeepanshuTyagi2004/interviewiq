"""Research window gate: Jev beside (shadow) or before (on) each source-window extraction."""
import asyncio
import json

import pytest

from app.gates.log import MemoryGateLog, build_gate
from app.llm.client import LLMError
from app.prompts.research.evidence import build_user
from app.research.budget import Budget
from app.research.fixtures import FixtureStore
from app.research.gateway import ResearchIO
from app.research.memory_store import InMemoryResearchStore
from app.research.models import Mode
from app.research.trace.tracer import Tracer, utcnow
from tests.gates.fakes import FakeDecisions, decision
from tests.research.fakes import Exploding, FakeLLM
from tests.research.test_gateway import CLAIMS_KW, _settings

QUESTIONS = ("has_field_info", "about_company")


def _user(text):
    return build_user(company="Example", source={"url": "https://example.test/careers", "title": "Careers",
                                                "content": text}, fields=("jd", "skill"))


def _d(has, about=1.0):
    return decision({"has_field_info": has, "about_company": about})


async def _gated_io(tmp_path, *, gate_mode, jev, llm, mode=Mode.LIVE, run_id=None):
    settings = _settings(research_window_gate_mode=gate_mode, research_window_gate_audit_rate=0.0)
    log = MemoryGateLog()
    gate = build_gate(settings, "research_window", log=log, client=jev)
    store = InMemoryResearchStore()
    await store.insert_run({"run_id": "run1", "status": "running", "last_seq": 0, "created_at": utcnow(),
                            "budget": {"exa_used": 0, "llm_used": 0, "tokens_in": 0, "tokens_out": 0}})
    await store.insert_items([{"run_id": "run1", "company_id": "c1", "position": 0, "nodes": {}}])
    tracer = Tracer(store, "run1", secrets={}, flush_interval=0.01)
    budget = Budget(store, "run1", exa_cap=10, llm_cap=10)
    io = ResearchIO(mode=mode, exa=None, llm=llm, fixtures=FixtureStore(tmp_path / "fx"), tracer=tracer,
                    budget=budget, store=store, settings=settings, gate=gate, run_id=run_id)
    return io, store, tracer, log


def _respond(s, u, label):
    return {"claims": [{"field": "skill", "value": "Python", "quote": "Python"}]}


def test_non_source_request_not_gated(tmp_path):
    async def go():
        jev = FakeDecisions(_d(0.0))
        llm = FakeLLM(_respond)
        io, _, tracer, log = await _gated_io(tmp_path, gate_mode="on", jev=jev, llm=llm)
        claims = await io.extract_claims(**CLAIMS_KW)
        await tracer.close()
        assert jev.calls == 0 and len(llm.calls) == 1 and len(claims) == 1 and log.docs == []
    asyncio.run(go())


def test_shadow_logs_each_window(tmp_path):
    async def go():
        user = _user("Python " * 800)
        jev = FakeDecisions(("sleep", 0.0, _d(0.9)))
        io, _, tracer, log = await _gated_io(tmp_path, gate_mode="shadow", jev=jev, llm=FakeLLM(_respond))
        claims = await io.extract_claims(**{**CLAIMS_KW, "user": user})
        io0, _, tracer0, _ = await _gated_io(tmp_path / "b", gate_mode="off", jev=None, llm=FakeLLM(_respond))
        plain = await io0.extract_claims(**{**CLAIMS_KW, "user": user})
        await tracer.close(); await tracer0.close()
        assert list(claims) == list(plain)
        assert len(log.docs) == 2
        for doc in log.docs:
            assert doc["context"]["end"] > doc["context"]["start"] >= 0
            assert doc["llm_label"]["raw_claims"] == 1
        assert [d["context"]["start"] for d in log.docs] == sorted(d["context"]["start"] for d in log.docs)
        assert claims.skipped_windows == 0
    asyncio.run(go())


def test_on_skip_window_no_budget_no_cache(tmp_path):
    async def go():
        jev = FakeDecisions(_d(0.0), _d(0.9))
        llm = FakeLLM(_respond)
        io, store, tracer, log = await _gated_io(tmp_path, gate_mode="on", jev=jev, llm=llm)
        puts = []
        orig = store.put_extract

        async def put(doc):
            puts.append(doc)
            return await orig(doc)
        store.put_extract = put
        claims = await io.extract_claims(**{**CLAIMS_KW, "user": _user("Python " * 800)})
        await tracer.close()
        assert len(llm.calls) == 1
        assert (await store.get_run("run1"))["budget"]["llm_used"] == 1
        assert len(puts) == 1
        assert claims.skipped_windows == 1
        assert sum(1 for d in log.docs if d["skipped"]) == 1
    asyncio.run(go())


def test_all_windows_skipped_returns_empty_not_error(tmp_path):
    async def go():
        llm = FakeLLM(_respond)
        io, _, tracer, _ = await _gated_io(tmp_path, gate_mode="on", jev=FakeDecisions(_d(0.0)), llm=llm)
        claims = await io.extract_claims(**{**CLAIMS_KW, "user": _user("Python " * 800)})
        await tracer.close()
        assert list(claims) == [] and llm.calls == [] and claims.skipped_windows == 2
        assert claims.diagnostics == []
    asyncio.run(go())


def test_replay_mode_bypasses_gate(tmp_path):
    async def go():
        from app.research.fixtures import FixtureMissing
        import pytest
        jev = FakeDecisions(_d(0.0))
        io, _, tracer, log = await _gated_io(tmp_path, gate_mode="on", jev=jev, llm=Exploding(), mode=Mode.REPLAY)
        with pytest.raises(FixtureMissing):
            await io.extract_claims(**{**CLAIMS_KW, "user": _user("Python " * 100)})
        await tracer.close()
        assert jev.calls == 0 and log.docs == []
    asyncio.run(go())


def test_on_cached_window_skips_jev(tmp_path):
    async def go():
        user = _user("Python " * 100)   # one window
        jev = FakeDecisions(_d(0.0))
        llm = FakeLLM(_respond)
        io, _, tracer, log = await _gated_io(tmp_path, gate_mode="on", jev=jev, llm=llm)
        gate, io._gate = io._gate, None
        first = await io.extract_claims(**{**CLAIMS_KW, "user": user})   # ungated: fills the extract cache
        io._gate = gate
        cached = await io.extract_claims(**{**CLAIMS_KW, "user": user})
        assert jev.calls == 0 and len(llm.calls) == 1 and log.docs == []
        assert list(cached) == list(first) and len(cached) == 1 and cached.skipped_windows == 0
        missed = await io.extract_claims(**{**CLAIMS_KW, "user": _user("Java " * 100)})   # a cache miss is gated
        await tracer.close()
        assert jev.calls == 1 and len(llm.calls) == 1 and list(missed) == [] and missed.skipped_windows == 1
    asyncio.run(go())


def test_shadow_cached_window_still_logged(tmp_path):
    async def go():
        user = _user("Python " * 100)
        llm = FakeLLM(_respond)
        io, _, tracer, log = await _gated_io(tmp_path, gate_mode="shadow", jev=FakeDecisions(_d(0.9)), llm=llm)
        await io.extract_claims(**{**CLAIMS_KW, "user": user})
        await io.extract_claims(**{**CLAIMS_KW, "user": user})
        await tracer.close()
        # SHADOW is unchanged: the cache hit (no second LLM call) is still gated and logged.
        assert len(llm.calls) == 1 and len(log.docs) == 2 and all(not d["skipped"] for d in log.docs)
    asyncio.run(go())


def test_gated_window_llm_error_keeps_partial_result(tmp_path):
    async def go():
        def respond(s, u, label):
            return LLMError("provider down") if label.endswith("#chunk-1") else _respond(s, u, label)
        io, _, tracer, log = await _gated_io(tmp_path, gate_mode="on", jev=FakeDecisions(_d(0.9)),
                                             llm=FakeLLM(respond))
        claims = await io.extract_claims(**{**CLAIMS_KW, "user": _user("Python " * 800)})
        await tracer.close()
        assert len(claims) == 1 and claims.skipped_windows == 0
        assert [(d["kind"], d["chunk_index"], d["error"]) for d in claims.diagnostics] == [
            ("extract_chunk", 0, "LLMError")]
        assert sum(1 for d in log.docs if d["llm_error"]) == 1
    asyncio.run(go())


def test_gated_windows_all_failed_still_raise(tmp_path):
    async def go():
        io, _, tracer, _ = await _gated_io(tmp_path, gate_mode="shadow", jev=FakeDecisions(_d(0.9)),
                                           llm=FakeLLM(lambda *_: LLMError("provider down")))
        try:
            with pytest.raises(LLMError, match="provider down"):
                await io.extract_claims(**{**CLAIMS_KW, "user": _user("Python " * 800)})
        finally:
            await tracer.close()
    asyncio.run(go())


def test_log_context_carries_run_id(tmp_path):
    async def go():
        io, _, tracer, log = await _gated_io(tmp_path, gate_mode="on", jev=FakeDecisions(_d(0.9)),
                                             llm=FakeLLM(_respond), run_id="run1")
        await io.extract_claims(**{**CLAIMS_KW, "user": _user("Python " * 100)})
        await tracer.close()
        assert [d["context"]["run_id"] for d in log.docs] == ["run1"]
    asyncio.run(go())


def test_off_gate_builds_no_state(tmp_path, monkeypatch):
    import app.research.gateway as gw

    def boom(_user):
        raise AssertionError("window_state must not run for an inactive gate")
    monkeypatch.setattr(gw, "window_state", boom)

    async def go():
        io, _, tracer, log = await _gated_io(tmp_path, gate_mode="off", jev=FakeDecisions(_d(0.0)),
                                             llm=FakeLLM(_respond))
        claims = await io.extract_claims(**{**CLAIMS_KW, "user": _user("Python " * 100)})
        await tracer.close()
        assert len(claims) == 1 and log.docs == []
    asyncio.run(go())


def test_research_outcome_counts_gate_skips(tmp_path):
    from app.prompts.research import company_profile
    from app.research.memory_store import InMemoryResearchStore
    from app.research.nodes.evidence import research
    from tests.research.fakes import FakeExa, result
    from tests.research.helpers import wired_deps

    async def go():
        store = InMemoryResearchStore()
        page = result("https://example.com/meesho", title="Meesho profile", content="Meesho HQ: Bengaluru")
        deps, tracer, state = await wired_deps(store, tmp_path, exa=FakeExa(lambda _: [page]),
                                               llm=FakeLLM(lambda *_: {"claims": []}))
        settings = _settings(research_window_gate_mode="on", research_window_gate_audit_rate=0.0)
        deps.io._gate = build_gate(settings, "research_window", log=MemoryGateLog(), client=FakeDecisions(_d(0.0)))
        try:
            out = await research(state, deps, company_profile, kind="profile", queries=(("Meesho", None),))
        finally:
            await tracer.close()
        assert out.stats["gate_skipped_windows"] == 1
        events = [e for e in store.events if e["type"] == "research.gate.skipped"]
        assert len(events) == 1 and events[0]["level"] == "debug" and events[0]["data"]["count"] == 1
    asyncio.run(go())
