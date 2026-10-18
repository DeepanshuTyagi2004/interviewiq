from __future__ import annotations

import asyncio
import hashlib
import json
import time

import pytest

from app.config import Settings
from app.gates.core import Gate, GateMode, run_gated
from app.gates.log import MemoryGateLog, build_gate
from app.llm.client import LLMError
from app.llm.decisions import DecisionsUnavailable, noul
from tests.gates.fakes import FakeDecisions, decision

QS = {"q": noul("is it?", true="yes", false="no")}
STATE = {"text": "héllo"}


class Counter:
    def __init__(self, value=None, exc=None, delay=0.0):
        self.value, self.exc, self.delay, self.calls = value, exc, delay, 0

    async def __call__(self):
        self.calls += 1
        if self.delay:
            await asyncio.sleep(self.delay)
        if self.exc:
            raise self.exc
        return self.value


def _gate(mode, client, log=None, skip_below=0.05):
    return Gate("key_review", mode=mode, skip_below=skip_below, client=client, log=log or MemoryGateLog())


def _run(gate, llm, **kw):
    return asyncio.run(run_gated(gate, state=STATE, questions=QS, skip_question="q", call_llm=llm,
                                 label_of=lambda v: {"positive": v}, on_skip=lambda: "SKIPPED",
                                 context={"run": "r1"}, **kw))


def test_off_never_asks():
    fake, log, llm = FakeDecisions(decision({"q": 0.2})), MemoryGateLog(), Counter(True)
    res = _run(_gate(GateMode.OFF, fake, log), llm)
    assert fake.calls == 0 and log.docs == [] and res.value is True and res.record_id is None


def test_inactive_without_client():
    log, llm = MemoryGateLog(), Counter(True)
    res = _run(_gate(GateMode.SHADOW, None, log), llm)
    assert log.docs == [] and res.value is True and not res.skipped


def test_none_gate():
    assert _run(None, Counter(7)).value == 7


def test_shadow_runs_both_and_logs():
    fake, log, llm = FakeDecisions(decision({"q": 0.2})), MemoryGateLog(), Counter(True, delay=0.01)
    res = _run(_gate(GateMode.SHADOW, fake, log), llm)
    assert fake.calls == 1 and llm.calls == 1 and res.value is True and not res.skipped
    assert len(log.docs) == 1
    d = log.docs[0]
    assert d["skipped"] is False and d["p_yes"] == 0.2 and d["llm_label"] == {"positive": True}
    assert d["model"] == "typesafe/jev-1.14-test" and d["state"] == STATE
    assert d["state_hash"] == hashlib.sha256(json.dumps(STATE, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
    assert d["questions"] == ["q"] and d["context"] == {"run": "r1"} and d["stage"] == "key_review"
    assert res.record_id == "0"


def test_shadow_is_concurrent():
    fake, log = FakeDecisions(("sleep", 0.1, decision({"q": 0.2}))), MemoryGateLog()
    t = time.monotonic()
    _run(_gate(GateMode.SHADOW, fake, log), Counter(True, delay=0.2))
    assert time.monotonic() - t < 0.3
    assert log.docs[0]["p_yes"] == 0.2 and log.docs[0]["jev_error"] is None


def test_shadow_does_not_wait_for_slow_jev():
    fake, log = FakeDecisions(("sleep", 1.0, decision({"q": 0.2}))), MemoryGateLog()

    async def main():
        t = time.monotonic()
        await run_gated(_gate(GateMode.SHADOW, fake, log), state=STATE, questions=QS, skip_question="q",
                        call_llm=Counter(True, delay=0.01), label_of=lambda v: {}, on_skip=lambda: None, context={})
        assert time.monotonic() - t < 0.2
        assert [t for t in asyncio.all_tasks() if not t.done()] == [asyncio.current_task()]

    asyncio.run(main())
    assert log.docs[0]["jev_error"] == "slower_than_llm" and log.docs[0]["p_yes"] is None
    assert fake.cancelled


def test_label_of_error_never_breaks_pipeline():
    log = MemoryGateLog()

    def bad(v):
        raise ValueError("nope")

    res = asyncio.run(run_gated(_gate(GateMode.SHADOW, FakeDecisions(decision({"q": 0.2})), log), state=STATE,
                                questions=QS, skip_question="q", call_llm=Counter(True), label_of=bad,
                                on_skip=lambda: None, context={}))
    assert res.value is True
    assert log.docs[0]["llm_label"] == {"label_error": "ValueError: nope"}


def test_shadow_jev_error_ignored():
    log = MemoryGateLog()
    res = _run(_gate(GateMode.SHADOW, FakeDecisions(DecisionsUnavailable("boom")), log), Counter(True, delay=0.01))
    assert res.value is True
    assert "DecisionsUnavailable" in log.docs[0]["jev_error"] and log.docs[0]["p_yes"] is None


def test_shadow_llm_error_propagates_and_no_pending_task():
    log, err = MemoryGateLog(), LLMError("x")

    async def main():
        gate = _gate(GateMode.SHADOW, FakeDecisions(("sleep", 0.1, decision({"q": 0.2}))), log)
        with pytest.raises(LLMError) as ei:
            await run_gated(gate, state=STATE, questions=QS, skip_question="q", call_llm=Counter(exc=err),
                            label_of=lambda v: {}, on_skip=lambda: None, context={})
        assert ei.value is err
        pending = [t for t in asyncio.all_tasks() if not t.done()]
        assert pending == [asyncio.current_task()]

    asyncio.run(main())
    assert "LLMError" in log.docs[0]["llm_error"] and log.docs[0]["llm_label"] is None


def test_on_skips_below_threshold():
    log, llm = MemoryGateLog(), Counter(True)
    res = _run(_gate(GateMode.ON, FakeDecisions(decision({"q": 0.01})), log), llm)
    assert llm.calls == 0 and res.value == "SKIPPED" and res.skipped
    assert log.docs[0]["skipped"] is True and log.docs[0]["llm_label"] is None


def test_on_runs_llm_at_or_above_threshold():
    llm = Counter(True)
    res = _run(_gate(GateMode.ON, FakeDecisions(decision({"q": 0.05}))), llm)
    assert llm.calls == 1 and not res.skipped and res.value is True


def test_on_jev_error_runs_llm():
    llm = Counter(True)
    res = _run(_gate(GateMode.ON, FakeDecisions(DecisionsUnavailable("x"))), llm)
    assert llm.calls == 1 and not res.skipped


def test_on_unknown_answer_runs_llm():
    llm = Counter(True)
    res = _run(_gate(GateMode.ON, FakeDecisions(decision({"other": 0.0}))), llm)
    assert llm.calls == 1 and not res.skipped


def test_on_llm_error_logged_and_raised():
    log = MemoryGateLog()
    with pytest.raises(LLMError):
        _run(_gate(GateMode.ON, FakeDecisions(decision({"q": 0.5})), log), Counter(exc=LLMError("y")))
    assert "LLMError" in log.docs[0]["llm_error"]


class BrokenLog(MemoryGateLog):
    async def insert(self, doc):
        raise RuntimeError("mongo down")


def test_log_failure_never_raises():
    res = _run(_gate(GateMode.SHADOW, FakeDecisions(decision({"q": 0.2})), BrokenLog()), Counter(True))
    assert res.value is True and res.record_id is None
    res = _run(_gate(GateMode.ON, FakeDecisions(decision({"q": 0.0})), BrokenLog()), Counter(True))
    assert res.value == "SKIPPED" and res.record_id is None


def test_cancellation_propagates():
    for mode in (GateMode.SHADOW, GateMode.ON):
        log = MemoryGateLog()
        fake = FakeDecisions(("sleep", 5, decision({"q": 0.5}))) if mode == GateMode.SHADOW \
            else FakeDecisions(decision({"q": 0.5}))

        async def main():
            gate = _gate(mode, fake, log)
            with pytest.raises(asyncio.CancelledError):
                await run_gated(gate, state=STATE, questions=QS, skip_question="q",
                                call_llm=Counter(exc=asyncio.CancelledError(), delay=0.01),
                                label_of=lambda v: {}, on_skip=lambda: None, context={})
            await asyncio.sleep(0)
            assert [t for t in asyncio.all_tasks() if not t.done()] == [asyncio.current_task()]

        asyncio.run(main())
        assert log.docs == []
        if mode == GateMode.SHADOW:
            assert fake.cancelled


def test_memory_log_dotted_update_and_find():
    async def main():
        log = MemoryGateLog()
        rid = await log.insert({"stage": "s", "created_at": 1, "llm_label": {"a": 1}})
        await log.update(rid, {"llm_label.grounded": True, "llm_label.status": "extracted", "new.deep.k": 2})
        assert log.docs[0]["llm_label"] == {"a": 1, "grounded": True, "status": "extracted"}
        assert log.docs[0]["new"] == {"deep": {"k": 2}}
        assert await log.find("s", limit=5) == log.docs
        assert await log.find("other", limit=5) == []

    asyncio.run(main())


def test_build_gate_reads_settings():
    s = Settings(_env_file=None, KEY_REVIEW_GATE_MODE="on", KEY_REVIEW_GATE_SKIP_BELOW="0.1")
    g = build_gate(s, "key_review", log=MemoryGateLog(), client=FakeDecisions())
    assert g.mode == GateMode.ON and g.skip_below == 0.1 and g.stage == "key_review" and g.active


def test_build_gate_defaults_shadow():
    s = Settings(_env_file=None)
    for stage in ("research_window", "brief_source", "key_review"):
        assert build_gate(s, stage, log=MemoryGateLog(), client=None).mode == GateMode.SHADOW


def test_memory_log_update_into_null_raises_like_mongo():
    log = MemoryGateLog()
    rid = asyncio.run(log.insert({"llm_label": None}))
    with pytest.raises(ValueError, match="llm_label.status"):
        asyncio.run(log.update(rid, {"llm_label.status": "x"}))
    rid2 = asyncio.run(log.insert({}))
    asyncio.run(log.update(rid2, {"a.b": 1}))
    assert log.docs[int(rid2)]["a"] == {"b": 1}


def _audit_gate(rate, rng, log, client=None):
    return Gate("key_review", mode=GateMode.ON, skip_below=0.05, client=client or FakeDecisions(decision({"q": 0.01})),
                log=log, audit_rate=rate, rng=rng)


def test_on_audit_runs_llm_and_labels():
    log, llm = MemoryGateLog(), Counter(True)
    res = _run(_audit_gate(0.05, lambda: 0.0, log), llm)
    assert llm.calls == 1 and res.value is True and not res.skipped
    d = log.docs[0]
    assert d["audit"] is True and d["skipped"] is False and d["llm_label"] == {"positive": True} and d["p_yes"] == 0.01


def test_on_audit_not_drawn_skips():
    log, llm = MemoryGateLog(), Counter(True)
    res = _run(_audit_gate(0.05, lambda: 0.99, log), llm)
    assert llm.calls == 0 and res.skipped and log.docs[0]["audit"] is False and log.docs[0]["skipped"] is True


def test_audit_rate_zero_never_audits():
    log, llm, draws = MemoryGateLog(), Counter(True), []
    res = _run(_audit_gate(0.0, lambda: draws.append(1) or 0.0, log), llm)
    assert llm.calls == 0 and res.skipped and draws == []


def test_non_audit_docs_log_audit_false():
    log = MemoryGateLog()
    _run(_gate(GateMode.SHADOW, FakeDecisions(decision({"q": 0.2})), log), Counter(True, delay=0.01))
    _run(_gate(GateMode.ON, FakeDecisions(decision({"q": 0.5})), log), Counter(True))
    assert [d["audit"] for d in log.docs] == [False, False]


def test_outer_cancel_while_draining_ends_cancelled():
    class Stubborn:
        async def decide(self, state, questions, **kw):
            try:
                await asyncio.sleep(5)
            except asyncio.CancelledError:
                await asyncio.sleep(0.2)   # slow cleanup: the shadow drain waits on it
                raise

    log = MemoryGateLog()

    async def main():
        task = asyncio.ensure_future(run_gated(
            _gate(GateMode.SHADOW, Stubborn(), log), state=STATE, questions=QS, skip_question="q",
            call_llm=Counter(True, delay=0.01), label_of=lambda v: {}, on_skip=lambda: None, context={}))
        await asyncio.sleep(0.05)          # the LLM is done; run_gated is draining the slow Jev task
        task.cancel()
        await asyncio.wait([task])
        return task

    task = asyncio.run(main())
    assert task.cancelled() and log.docs == []


def test_ask_error_records_elapsed_latency():
    v = asyncio.run(_gate(GateMode.ON, FakeDecisions(("sleep", 0.05, DecisionsUnavailable("x")))).ask(
        STATE, QS, skip_question="q"))
    assert v.p_yes is None and v.latency_ms >= 40


def test_ask_uses_configured_bound():
    gate = Gate("key_review", mode=GateMode.ON, skip_below=0.05, client=FakeDecisions(("sleep", 2, decision({"q": 0.5}))),
                log=MemoryGateLog(), ask_timeout_seconds=0.05)
    t = time.monotonic()
    v = asyncio.run(gate.ask(STATE, QS, skip_question="q"))
    assert time.monotonic() - t < 0.5 and v.p_yes is None and v.error.startswith("TimeoutError")
    assert v.latency_ms >= 40


def test_build_gate_bound_and_audit_from_settings():
    s = Settings(_env_file=None, DECISIONS_TIMEOUT_SECONDS="2.5", KEY_REVIEW_GATE_AUDIT_RATE="0.2")
    g = build_gate(s, "key_review", log=MemoryGateLog(), client=FakeDecisions())
    assert g.ask_timeout_seconds == 3.5 and g.audit_rate == 0.2
    assert build_gate(Settings(_env_file=None), "brief_source", log=MemoryGateLog(), client=None).audit_rate == 0.05


@pytest.mark.parametrize("env", [{"KEY_REVIEW_GATE_SKIP_BELOW": "0.9"}, {"RESEARCH_WINDOW_GATE_SKIP_BELOW": "-0.1"},
                                 {"DECISION_GATE_LOG_TTL_DAYS": "0"}, {"BRIEF_SOURCE_GATE_AUDIT_RATE": "1.5"}])
def test_gate_settings_are_bounded(env):
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        Settings(_env_file=None, **env)


class _FakeCol:
    def __init__(self):
        self.created = []

    async def create_index(self, keys, *, name, **kw):
        from pymongo.errors import OperationFailure
        if "expireAfterSeconds" in kw:
            raise OperationFailure("An equivalent index already exists with different options", code=85)
        self.created.append(name)


class _FakeDb:
    def __init__(self):
        self.col, self.commands = _FakeCol(), []

    def __getitem__(self, name):
        return self.col

    async def command(self, *args, **kw):
        self.commands.append((args, kw))


def test_ttl_change_falls_back_to_collmod():
    from app.gates.log import COLLECTION, TTL_INDEX, ensure_gate_log_indexes
    db = _FakeDb()
    asyncio.run(ensure_gate_log_indexes(db, 30))
    assert db.col.created == ["stage_created_at"]
    assert db.commands == [(("collMod", COLLECTION), {"index": {"name": TTL_INDEX, "expireAfterSeconds": 30 * 86400}})]


def test_gate_index_failure_never_blocks_startup(monkeypatch):
    import app.gates.log as gate_log
    from app.db import mongo

    hit = []

    async def boom(db, ttl_days):
        hit.append(ttl_days)
        raise RuntimeError("index exploded")

    async def fine(*a, **kw):
        return None

    class AnyDb:
        def __getitem__(self, name):
            return self

        async def create_index(self, *a, **kw):
            return None

        async def command(self, *a, **kw):
            return None

    monkeypatch.setattr(gate_log, "ensure_gate_log_indexes", boom)
    import app.blueprint.store as bp_store
    import app.interviewer.store as live_store
    monkeypatch.setattr(bp_store, "ensure_blueprint_indexes", fine)
    monkeypatch.setattr(live_store, "ensure_live_indexes", fine)
    asyncio.run(mongo.ensure_indexes(AnyDb()))   # no raise
    assert hit, "the gate index call was reached"
