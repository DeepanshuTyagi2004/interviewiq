import asyncio

from app.config import Settings
from app.gates.briefs import SOURCE_QUESTIONS, source_state
from app.gates.core import Gate, GateMode
from app.jobs.brief_generation import _extract_all
from app.llm.client import LLMError
from app.llm.decisions import state_bytes
from app.targets import Combination
from tests.gates.fakes import FakeDecisions, MemoryGateLog, decision

COMBO = Combination("razorpay", "software-engineer", "sde2", "backend")
GOOD = {"describes_process": True, "is_first_hand": True,
        "rounds": [{"round_number": 1, "type": "dsa"}]}
NO = {"describes_process": False}


def _sources(n=2):
    return [{"url": f"https://x/{i}", "title": f"t{i}", "content": "body", "date": "2024"} for i in range(n)]


class FakeLLM:
    def __init__(self, *replies, delay=0.0):
        self.replies = list(replies)
        self.calls = 0
        self.delay = delay

    async def complete(self, system, user, *, label=None):
        i = self.calls
        self.calls += 1
        if self.delay:
            await asyncio.sleep(self.delay)
        r = self.replies[min(i, len(self.replies) - 1)]
        if isinstance(r, BaseException):
            raise r
        return dict(r), None


def _gate(mode, client, log, skip_below=0.05):
    return Gate("brief_source", mode=mode, skip_below=skip_below, client=client, log=log)


def _run(llm, gate, n=2):
    return asyncio.run(_extract_all(llm, COMBO, _sources(n), Settings(), gate=gate))


def _statuses(disp):
    return [d["status"] for d in disp]


def test_shadow_logs_label_and_status():
    log = MemoryGateLog()
    # Replies are order-independent only if concurrent calls are sequenced; use per-url replies.
    class ByUrl(FakeLLM):
        async def complete(self, system, user, *, label=None):
            await asyncio.sleep(0.05)
            return dict(GOOD if "https://x/0" in user else NO), None
    gate = _gate(GateMode.SHADOW, FakeDecisions(decision({"describes_process": 0.9, "is_first_hand": 0.9})), log)
    kept, disp = _run(ByUrl(), gate)
    _, base = _run(ByUrl(), None)
    assert _statuses(disp) == _statuses(base) == ["extracted", "no_process"]
    by_url = {d["context"]["url"]: d for d in log.docs}
    d0, d1 = by_url["https://x/0"], by_url["https://x/1"]
    assert d0["llm_label"]["describes_process"] is True and d0["llm_label"]["status"] == "extracted"
    assert d1["llm_label"]["describes_process"] is False and d1["llm_label"]["status"] == "no_process"
    assert len(kept) == 1


def test_on_skip_marks_no_process_without_llm():
    log = MemoryGateLog()
    gate = _gate(GateMode.ON, FakeDecisions(decision({"describes_process": 0.01}),
                                            decision({"describes_process": 0.9})), log)
    llm = FakeLLM(GOOD)
    _, disp = _run(llm, gate)
    assert llm.calls == 1
    assert _statuses(disp) == ["no_process", "extracted"]
    skipped = next(d for d in log.docs if d["skipped"])
    assert skipped["llm_label"] is None   # no status update attempted on a skipped record


def test_state_truncated_under_limit():
    st = source_state("ctx", {"url": "u", "title": "t", "date": "d", "content": "é" * 60_000})
    assert state_bytes(st) <= 28_000
    assert st["text"].endswith("…")
    assert set(SOURCE_QUESTIONS) == {"describes_process", "is_first_hand"}


def test_llm_error_still_extract_failed():
    log = MemoryGateLog()
    gate = _gate(GateMode.SHADOW, FakeDecisions(decision({"describes_process": 0.9})), log)
    _, disp = _run(FakeLLM(LLMError("boom"), delay=0.01), gate, n=1)
    assert _statuses(disp) == ["extract_failed"]
    assert log.docs[0]["llm_error"]


def test_on_skip_disposition_marks_gate_skipped():
    gate = _gate(GateMode.ON, FakeDecisions(decision({"describes_process": 0.01})), MemoryGateLog())
    _, disp = _run(FakeLLM(GOOD), gate, n=1)
    assert disp[0]["status"] == "no_process" and disp[0]["gate_skipped"] is True


def test_llm_no_process_has_no_gate_marker():
    gate = _gate(GateMode.ON, FakeDecisions(decision({"describes_process": 0.9})), MemoryGateLog())
    _, disp = _run(FakeLLM(NO), gate, n=1)
    assert disp[0]["status"] == "no_process" and "gate_skipped" not in disp[0]


def test_state_builder_failure_runs_ungated(monkeypatch):
    import app.jobs.brief_generation as bg

    def boom(context, src):
        raise RuntimeError("state exploded")
    monkeypatch.setattr(bg, "source_state", boom)
    log = MemoryGateLog()
    jev = FakeDecisions(decision({"describes_process": 0.01}))
    llm = FakeLLM(GOOD)
    kept, disp = _run(llm, _gate(GateMode.ON, jev, log))
    assert llm.calls == 2 and jev.calls == 0 and log.docs == []
    assert _statuses(disp) == ["extracted", "extracted"] and len(kept) == 2


def test_inactive_gate_builds_no_state(monkeypatch):
    import app.jobs.brief_generation as bg

    def boom(context, src):
        raise AssertionError("source_state must not run for an inactive gate")
    monkeypatch.setattr(bg, "source_state", boom)
    for gate in (_gate(GateMode.OFF, FakeDecisions(), MemoryGateLog()), _gate(GateMode.SHADOW, None, MemoryGateLog()), None):
        _, disp = _run(FakeLLM(GOOD), gate, n=1)
        assert _statuses(disp) == ["extracted"]
