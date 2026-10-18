"""Answer-key review gate: skipped review, shadow logging, stage errors, old cached keys."""
import asyncio

import pytest

from app.blueprint import answer_keys as K
from app.blueprint import store
from app.blueprint.models import DsaAnswerKey
from app.gates.core import Gate, GateMode
from app.llm.client import LLMError
from tests.blueprint.fixtures import FakeLLM, MemoryTrace, dsa_doc, dsa_key_reply
from tests.gates.fakes import FakeDecisions, MemoryGateLog, decision


class _Settings:
    blueprint_concurrency = 2
    blueprint_parallel = 2
    blueprint_quota_retries = 0
    blueprint_transient_retries = 0


@pytest.fixture()
def bank(monkeypatch):
    saved: dict[str, dict] = {}

    async def get_key(key_id):
        return saved.get(key_id)

    async def save_key(doc):
        saved[doc["key_id"]] = doc

    monkeypatch.setattr(store, "get_answer_key", get_key)
    monkeypatch.setattr(store, "save_answer_key", save_key)
    return saved


def _install_gate(monkeypatch, mode, client):
    log = MemoryGateLog()
    gate = Gate("key_review", mode=mode, skip_below=0.05, client=client, log=log)
    monkeypatch.setattr(K, "_review_gate", lambda settings: gate)
    return log


def _review_calls(llm):
    return [lbl for lbl, _ in llm.calls if lbl.endswith(":review")]


def test_on_skip_marks_gate_reviewed(bank, monkeypatch):
    log = _install_gate(monkeypatch, GateMode.ON, FakeDecisions(decision({"has_error": 0.01})))
    llm = FakeLLM({"answer_key": dsa_key_reply()})
    trace = MemoryTrace()
    key, _ = asyncio.run(K.key_for(llm, trace, dsa_doc("sum-gate"), _Settings(), bypass_cache=False))
    assert _review_calls(llm) == []
    assert key["reviewed"] is True and key["review_source"] == "gate"
    assert any(r.get("skipped_by_gate") is True for r in trace.records)
    assert log.docs[0]["skipped"] is True


def test_shadow_review_runs_and_logs_patched(bank, monkeypatch):
    class Slow(FakeDecisions):
        async def decide(self, state, questions, **kw):
            await asyncio.sleep(0.05)
            return await super().decide(state, questions, **kw)

    log = _install_gate(monkeypatch, GateMode.SHADOW, Slow(decision({"has_error": 0.9})))
    review = {"errors": [{"field": "complexity_target", "claim": "O(n)", "correction": "O(n log n)"}],
              "complexity_target": "O(n log n) time"}

    class Delayed(FakeLLM):
        async def complete_full(self, system, user, *, label=""):
            if label.endswith(":review"):
                await asyncio.sleep(0.3)
            return await super().complete_full(system, user, label=label)

    llm = Delayed({"answer_key:sum-shadow:review": review, "answer_key": dsa_key_reply()})
    key, _ = asyncio.run(K.key_for(llm, MemoryTrace(), dsa_doc("sum-shadow"), _Settings(), bypass_cache=False))
    assert key["review_source"] == "llm" and key["complexity_target"] == "O(n log n) time"
    assert log.docs[0]["llm_label"]["patched"] is True and log.docs[0]["llm_label"]["errors"] == 1


def test_on_above_threshold_runs_review(bank, monkeypatch):
    _install_gate(monkeypatch, GateMode.ON, FakeDecisions(decision({"has_error": 0.6})))
    llm = FakeLLM({"answer_key:sum-hi:review": {"errors": []}, "answer_key": dsa_key_reply()})
    key, _ = asyncio.run(K.key_for(llm, MemoryTrace(), dsa_doc("sum-hi"), _Settings(), bypass_cache=False))
    assert len(_review_calls(llm)) == 1
    assert key["reviewed"] is True and key["review_source"] == "llm"


def test_stage_error_keeps_unreviewed(bank, monkeypatch):
    class Slow(FakeDecisions):
        async def decide(self, state, questions, **kw):
            await asyncio.sleep(0.05)
            return await super().decide(state, questions, **kw)

    log = _install_gate(monkeypatch, GateMode.SHADOW, Slow(decision({"has_error": 0.9})))

    class Delayed(FakeLLM):
        async def complete_full(self, system, user, *, label=""):
            if label.endswith(":review"):
                await asyncio.sleep(0.3)
            return await super().complete_full(system, user, label=label)

    llm = Delayed({"answer_key:sum-err:review": LLMError("Research LLM failed (groq:http_400)"),
                   "answer_key": dsa_key_reply()})
    key, hit = asyncio.run(K.key_for(llm, MemoryTrace(), dsa_doc("sum-err"), _Settings(), bypass_cache=False))
    assert not key.get("reviewed") and not hit and len(bank) == 0
    assert log.docs[0]["llm_label"]["review_ran"] is False


def test_old_cached_key_without_review_source_validates():
    raw = dsa_key_reply()
    raw["reference_solution"]["verified_against_examples"] = True
    raw["reviewed"] = True
    assert DsaAnswerKey.model_validate(raw).review_source is None


def test_gate_skipped_key_is_cached_with_gate_source(bank, monkeypatch):
    _install_gate(monkeypatch, GateMode.ON, FakeDecisions(decision({"has_error": 0.01})))
    llm = FakeLLM({"answer_key": dsa_key_reply()})
    key, hit = asyncio.run(K.key_for(llm, MemoryTrace(), dsa_doc("sum-cache"), _Settings(), bypass_cache=False))
    assert not hit and len(bank) == 1
    saved = next(iter(bank.values()))
    assert saved["key"]["review_source"] == "gate" and saved["key"]["reviewed"] is True
    again, hit2 = asyncio.run(K.key_for(llm, MemoryTrace(), dsa_doc("sum-cache"), _Settings(), bypass_cache=False))
    assert hit2 and again["review_source"] == "gate"


def test_on_jev_error_falls_through_to_llm_review(bank, monkeypatch):
    from app.llm.decisions import DecisionsUnavailable
    log = _install_gate(monkeypatch, GateMode.ON, FakeDecisions(DecisionsUnavailable("down")))
    llm = FakeLLM({"answer_key:sum-down:review": {"errors": []}, "answer_key": dsa_key_reply()})
    key, _ = asyncio.run(K.key_for(llm, MemoryTrace(), dsa_doc("sum-down"), _Settings(), bypass_cache=False))
    assert len(_review_calls(llm)) == 1 and key["review_source"] == "llm" and key["reviewed"] is True
    assert "DecisionsUnavailable" in log.docs[0]["jev_error"] and log.docs[0]["skipped"] is False


def test_key_state_failure_runs_review_ungated(bank, monkeypatch):
    def boom(problem, key):
        raise RuntimeError("state exploded")
    monkeypatch.setattr(K, "key_state", boom)
    jev = FakeDecisions(decision({"has_error": 0.01}))
    log = _install_gate(monkeypatch, GateMode.ON, jev)
    llm = FakeLLM({"answer_key:sum-st:review": {"errors": []}, "answer_key": dsa_key_reply()})
    key, _ = asyncio.run(K.key_for(llm, MemoryTrace(), dsa_doc("sum-st"), _Settings(), bypass_cache=False))
    assert len(_review_calls(llm)) == 1 and jev.calls == 0 and log.docs == []
    assert key["review_source"] == "llm" and key["reviewed"] is True


def test_log_context_carries_run_id(bank, monkeypatch):
    log = _install_gate(monkeypatch, GateMode.ON, FakeDecisions(decision({"has_error": 0.9})))
    llm = FakeLLM({"answer_key:sum-run:review": {"errors": []}, "answer_key": dsa_key_reply()})
    trace = MemoryTrace()
    trace.run_id = "run-42"
    asyncio.run(K.key_for(llm, trace, dsa_doc("sum-run"), _Settings(), bypass_cache=False))
    assert log.docs[0]["context"] == {"slug": "sum-run", "run_id": "run-42"}
