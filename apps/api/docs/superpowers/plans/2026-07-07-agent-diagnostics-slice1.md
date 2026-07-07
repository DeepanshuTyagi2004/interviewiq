# Agent Diagnostics — Slice 1 Implementation Plan (text diagnostics)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an admin "Agent Diagnostics" tab where an admin picks a role+user, runs the interview-prep pipeline (reusing the prep-bench console), then drives the real interview brain (`run_session`) with typed candidate turns in-process, seeing every decision (inputs, chosen action, branch reason, prompt-in/out), a decision timeline, and the full log stream, with a Copy-as-Markdown export. (No react-flow canvas and no `<thought>` capture yet — those are Slice 2.)

**Architecture:** A queue-backed `DiagnosticTransport` implements the existing `Transport` Protocol so `run_session` runs unmodified in the FastAPI process. A dedicated in-memory `AgentSessionStore` (sibling to `PipelineRunStore`) holds turn→step trees + logs, polled 1:1 by the frontend via a Spring BFF proxy. A contextvar-bound emitter records structured per-step decisions from additive taps in `session.py`/`graph.py`. Everything reuses the prep-bench observability substrate (run store conventions, `bind_run` log capture, `?after=` cursor, `useRunPolling`, `RunTimeline`/`RunLogStream`).

**Tech Stack:** Python 3.11 / FastAPI / asyncio / pytest (ai-service); Java 25 / Spring Boot 4 / JUnit + MockMvc (backend); Next.js 16 / React 19 / TanStack Query v5 / TypeScript / Vitest + Testing Library (frontend).

## Global Constraints

- **No brain decision-logic changes.** Taps are additive and no-op when the diagnostic contextvar is unbound. The brain's existing 148 tests (`cd interviewiq-ai-service && pytest`) MUST stay green after every ai-service task.
- **Two behavior-preserving return-value refactors are required** (verified necessary in Task A3): `_update_pacing` (session.py:144-162) and `_score_last_answer` (session.py:113-141) currently return `None`, holding the pacing `gate`/`directive` and grade `competency`/`coherence` as locals. Add return values so the emitter can record the real pacing/grade decisions. This is a **pure return-value addition** — it changes no control flow and no value passed to the brain (callers may ignore the returns); the 148-test suite guards it. (Refines spec §6.3's "additive taps".)
- **Ephemeral store**: in-memory, `_MAX_RUNS = 25` LRU, but **never evict a non-terminal session** (`running`/`awaiting_input`); on eviction of a terminal session, no task remains. `MAX_ACTIVE_SESSIONS` default `3`.
- **Auth**: ai-service `/admin/*` guarded by `require_internal_key` (header `X-Internal-Api-Key`). Spring `/api/v1/intelligence/**` is `hasRole("ADMIN")`. Browser never holds the internal key.
- **Session status enum** (exact strings): `running | awaiting_input | completed | failed | abandoned | aborted`.
- **AgentStep.status enum** (exact strings, reuse frontend `RunStepStatus`): `pending | running | ok | failed | skipped`.
- **Reuse, don't reinvent**: prep-bench console, `bind_run`/`PipelineRunLogHandler`, `useRunPolling`, `RunTimeline`, `RunLogStream`, `TranscriptPanel`, `apiFetch`, `useJds()`, `usePrepCandidates()`.
- **Repos & branches**: `interviewiq-ai-service` (branch `feat/agent-diagnostics`), `interviewiq-backend` (branch `feat/agent-diagnostics`, already created), `interviewIQ-frontend` (branch `feat/agent-diagnostics`). Create the branch in each repo before its first task.
- **Spec**: `interviewiq-backend/docs/superpowers/specs/2026-07-07-agent-diagnostics-design.md` — the source of truth for data shapes; §ref given per task.

---

## File Structure

**ai-service (`interviewiq-ai-service`)**
- Create `app/jobs/agent_sessions.py` — `AgentSessionStore` + singleton `AGENT_SESSIONS`; turn/step model, snapshot, eviction+task-cancel, capacity.
- Create `app/interview_agent/diagnostics_emit.py` — contextvar emitter (no-op when unbound) + `bind_emitter`/`unbind_emitter` + `decide_with_reason` pure wrapper.
- Create `app/interview_agent/diagnostic_transport.py` — `DiagnosticTransport` (Transport impl) + `_TurnInput`/`_SILENCE`/`_END` + `DiagnosticSessionAborted`.
- Create `app/interview_agent/diagnostic_runner.py` — `start_agent_session`, `_run`, `terminal_status`.
- Modify `app/interview_agent/session.py` — insert additive `emit_*` calls at tap points; swap `graph.decide(...)` → `decide_with_reason(...)`.
- Modify `app/api/admin.py` — add the `/admin/interview-agent/*` endpoints.
- Create `tests/jobs/test_agent_sessions.py`, `tests/interview_agent/test_diagnostic_transport.py`, `tests/interview_agent/test_diagnostics_emit.py`, `tests/interview_agent/test_diagnostic_runner.py`, `tests/api/test_admin_interview_agent.py`.

**backend (`interviewiq-backend`)**
- Modify `.../integrations/aiservice/AiServiceClient.java` — add interview-agent client methods.
- Create `.../controllers/AdminInterviewAgentController.java` — BFF proxy.
- Create `.../controllers/AdminInterviewAgentControllerTest.java` — MockMvc tests.

**frontend (`interviewIQ-frontend`)**
- Modify `lib/constants/observability/index.ts` — add `INTERVIEW_AGENT_ENDPOINTS`.
- Create `features/agent-diagnostics/{types.ts,api.ts,hooks.ts,index.ts}`.
- (No change to `features/observability/hooks.ts` — `useRunPolling` is hardcoded to `RunSnapshot` (`snap.logs`/`snap.last_seq`, terminal = `completed|failed`) and can't serve the 6-status `AgentSession` with `_logs`; ship a standalone `useAgentSession` poller instead.)
- Create `app/(app)/intelligence/_components/AgentDiagnosticsPanel.tsx` + `_components/agent/{TurnComposer.tsx,DecisionTimeline.tsx,markdownExport.ts}`.
- Modify `app/(app)/intelligence/page.tsx` — add the 7th tab.
- Create `features/agent-diagnostics/__tests__/*` + component tests.

---

## Phase A — ai-service (foundation)

### Task A0: Branch
- [ ] **Step 1: Create the branch**

Run: `cd /Users/salescode/Desktop/project/interviewiq-ai-service && git checkout -b feat/agent-diagnostics && git branch --show-current`
Expected: `feat/agent-diagnostics`

- [ ] **Step 2: Baseline the suite**

Run: `pytest -q`
Expected: all green (record the count, e.g. `148 passed`). This is the regression floor.

---

### Task A1: `AgentSessionStore`

**Files:**
- Create: `app/jobs/agent_sessions.py`
- Test: `tests/jobs/test_agent_sessions.py`

**Interfaces:**
- Consumes: `app/jobs/pipeline_runs.py::new_run_id` (reuse), `bind_run`/`unbind_run` (used by the runner, not here).
- Produces:
  - `AGENT_SESSIONS: AgentSessionStore` (module singleton).
  - `AgentSessionStore.start(run_id: str, plan: dict, label: str) -> None` — seeds session with synthetic opening **turn 0** (`kind="opening"`), `status="running"`, `current_turn=0`.
  - `.open_turn(run_id, kind: str, candidate_text: str | None, artifact_present_this_turn: bool, artifact_available: bool, elapsed_s_at_turn: float) -> int` — appends an `AgentTurn`, returns its index, sets `current_turn`.
  - `.begin_step(run_id, name, llm_label=None) -> None` / `.end_step(run_id, status, detail: dict) -> None` — operate on the current turn's step list; `end_step` computes `duration_ms`.
  - `.emit_skipped(run_id, name) -> None` — append a `status="skipped"` step to the current turn.
  - `.log(run_id, level, message) -> None`, `.append_transcript(run_id, speaker, text) -> None`.
  - `.set_result(run_id, outcome: dict, ended_reason: str | None) -> None`, `.finish(run_id, status: str) -> None`.
  - `.snapshot(run_id, after: int) -> dict | None` — full session dict with `_logs` filtered `seq > after`, `last_seq`; `None` if unknown.
  - `.list_sessions() -> list[dict]` (summaries, newest first).
  - `.active_count() -> int` (count of `running`+`awaiting_input`), `.attach_task(run_id, task)`, `.set_status(run_id, status)`, `.current_step(run_id) -> str | None`.
  - Eviction: on insert past `_MAX_RUNS=25`, evict oldest **terminal** session; never evict `running`/`awaiting_input`; on evicting, if a task is attached and not done, `task.cancel()`.

- [ ] **Step 1: Write the failing test (core lifecycle + opening turn 0 + snapshot cursor)**

```python
# tests/jobs/test_agent_sessions.py
import pytest
from app.jobs.agent_sessions import AgentSessionStore

def test_start_seeds_opening_turn_zero():
    s = AgentSessionStore()
    s.start("r1", {"round": "DSA"}, label="meesho·dsa")
    snap = s.snapshot("r1", after=0)
    assert snap["status"] == "running"
    assert snap["current_turn"] == 0
    assert len(snap["turns"]) == 1
    assert snap["turns"][0]["kind"] == "opening"
    assert snap["turns"][0]["index"] == 0

def test_steps_attach_to_current_turn_and_compute_duration():
    s = AgentSessionStore()
    s.start("r1", {}, label="x")
    s.begin_step("r1", "opening_classify", llm_label="iv-opening-classify")
    s.end_step("r1", "ok", {"parsed_output": "ready"})
    step = s.snapshot("r1", 0)["turns"][0]["steps"][-1]
    assert step["name"] == "opening_classify"
    assert step["status"] == "ok"
    assert step["llm_label"] == "iv-opening-classify"
    assert step["duration_ms"] is not None

def test_emit_skipped_records_skipped_step():
    s = AgentSessionStore()
    s.start("r1", {}, label="x")
    s.open_turn("r1", "main", "my answer", False, False, 60.0)
    s.emit_skipped("r1", "scope")
    steps = s.snapshot("r1", 0)["turns"][1]["steps"]
    assert any(st["name"] == "scope" and st["status"] == "skipped" for st in steps)

def test_snapshot_after_cursor_filters_logs():
    s = AgentSessionStore()
    s.start("r1", {}, label="x")
    s.log("r1", "INFO", "one")
    s.log("r1", "INFO", "two")
    full = s.snapshot("r1", 0)
    assert [l["message"] for l in full["_logs"]] == ["one", "two"]
    tail = s.snapshot("r1", full["_logs"][0]["seq"])
    assert [l["message"] for l in tail["_logs"]] == ["two"]
    assert tail["last_seq"] == full["last_seq"]

def test_finish_sets_terminal_status_and_result():
    s = AgentSessionStore()
    s.start("r1", {}, label="x")
    s.set_result("r1", {"ended_reason": "natural_complete"}, "natural_complete")
    s.finish("r1", "completed")
    snap = s.snapshot("r1", 0)
    assert snap["status"] == "completed"
    assert snap["ended_reason"] == "natural_complete"
    assert snap["result"] == {"ended_reason": "natural_complete"}
    assert snap["finished_at"] is not None
```

- [ ] **Step 2: Write the failing eviction/capacity test**

```python
def test_eviction_never_drops_non_terminal_and_cancels_terminal_task():
    s = AgentSessionStore()
    # fill with terminal sessions past the cap
    for i in range(30):
        rid = f"t{i}"
        s.start(rid, {}, label="x")
        s.finish(rid, "completed")
    assert len(s.list_sessions()) <= 25
    # a live session must survive eviction pressure
    s.start("live", {}, label="x")            # running
    for i in range(30, 60):
        rid = f"t{i}"; s.start(rid, {}, label="x"); s.finish(rid, "completed")
    assert s.snapshot("live", 0) is not None   # never evicted while running

def test_active_count_counts_only_non_terminal():
    s = AgentSessionStore()
    s.start("a", {}, label="x")                # running
    s.start("b", {}, label="x"); s.set_status("b", "awaiting_input")
    s.start("c", {}, label="x"); s.finish("c", "completed")
    assert s.active_count() == 2
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pytest tests/jobs/test_agent_sessions.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.jobs.agent_sessions'`.

- [ ] **Step 4: Implement `AgentSessionStore`**

```python
# app/jobs/agent_sessions.py
"""In-memory keyed store for interactive agent-diagnostic sessions. Sibling to
pipeline_runs.PipelineRunStore, sharing its seq-cursor / ring-buffer / LRU conventions
but modelling an interactive turn->step tree. Ephemeral: lost on restart. A session in a
non-terminal status (running / awaiting_input) is NEVER evicted; evicting a terminal
session cancels any attached (already-finished) task defensively."""
from __future__ import annotations

import threading
import time
from collections import OrderedDict, deque
from typing import Any

from app.jobs.pipeline_runs import new_run_id  # reuse uuid hex id

_MAX_RUNS = 25
_MAX_LOGS = 2000
_TERMINAL = {"completed", "failed", "abandoned", "aborted"}


def _now() -> float:
    return time.time()


class AgentSessionStore:
    def __init__(self) -> None:
        self._runs: "OrderedDict[str, dict]" = OrderedDict()
        self._tasks: dict[str, Any] = {}
        self._lock = threading.RLock()

    # ---- lifecycle -------------------------------------------------------
    def start(self, run_id: str, plan: dict, label: str) -> None:
        with self._lock:
            self._runs[run_id] = {
                "run_id": run_id,
                "pipeline": "interview_agent",
                "label": label,
                "status": "running",
                "plan_summary": {
                    "round": plan.get("round"),
                    "persona_name": (plan.get("persona") or {}).get("name"),
                    "question_count": len(plan.get("questions") or []),
                },
                "current_turn": 0,
                "current_step": None,
                "turns": [self._new_turn(0, "opening", None, False, False, 0.0)],
                "transcript": [],
                "result": None,
                "ended_reason": None,
                "error": None,
                "started_at": _now(),
                "finished_at": None,
                "_logs": deque(maxlen=_MAX_LOGS),
                "_seq": 0,
            }
            self._evict_locked()

    @staticmethod
    def _new_turn(index, kind, candidate_text, present, available, elapsed) -> dict:
        return {
            "index": index, "kind": kind, "candidate_text": candidate_text,
            "artifact_present_this_turn": present, "artifact_available": available,
            "steps": [], "started_at": _now(), "finished_at": None,
            "duration_ms": None, "elapsed_s_at_turn": elapsed,
        }

    def open_turn(self, run_id, kind, candidate_text, artifact_present_this_turn,
                  artifact_available, elapsed_s_at_turn) -> int:
        with self._lock:
            r = self._runs[run_id]
            # close the previous turn's timing
            if r["turns"]:
                prev = r["turns"][-1]
                if prev["finished_at"] is None:
                    prev["finished_at"] = _now()
                    prev["duration_ms"] = int((prev["finished_at"] - prev["started_at"]) * 1000)
            idx = len(r["turns"])
            r["turns"].append(self._new_turn(idx, kind, candidate_text,
                                             artifact_present_this_turn, artifact_available,
                                             elapsed_s_at_turn))
            r["current_turn"] = idx
            return idx

    # ---- steps -----------------------------------------------------------
    def begin_step(self, run_id, name, llm_label=None) -> None:
        with self._lock:
            r = self._runs[run_id]
            r["current_step"] = name
            r["turns"][-1]["steps"].append({
                "name": name, "status": "running", "llm_label": llm_label,
                "started_at": _now(), "finished_at": None, "duration_ms": None, "detail": {},
            })

    def end_step(self, run_id, status, detail) -> None:
        with self._lock:
            step = self._runs[run_id]["turns"][-1]["steps"][-1]
            step["status"] = status
            step["finished_at"] = _now()
            step["duration_ms"] = int((step["finished_at"] - step["started_at"]) * 1000)
            step["detail"] = {**step.get("detail", {}), **(detail or {})}
            self._runs[run_id]["current_step"] = None

    def emit_skipped(self, run_id, name) -> None:
        with self._lock:
            self._runs[run_id]["turns"][-1]["steps"].append({
                "name": name, "status": "skipped", "llm_label": None,
                "started_at": None, "finished_at": None, "duration_ms": None, "detail": {},
            })

    # ---- logs / transcript ----------------------------------------------
    def log(self, run_id, level, message) -> None:
        with self._lock:
            r = self._runs.get(run_id)
            if not r:
                return
            r["_seq"] += 1
            r["_logs"].append({"seq": r["_seq"], "ts": _now(),
                               "level": level, "message": message})

    def append_transcript(self, run_id, speaker, text) -> None:
        with self._lock:
            self._runs[run_id]["transcript"].append({"speaker": speaker, "text": text})

    # ---- terminal --------------------------------------------------------
    def set_result(self, run_id, outcome, ended_reason) -> None:
        with self._lock:
            r = self._runs[run_id]
            r["result"] = outcome
            r["ended_reason"] = ended_reason

    def fail(self, run_id, step, error) -> None:
        with self._lock:
            r = self._runs[run_id]
            r["status"] = "failed"
            r["error"] = {"step": step, "type": type(error).__name__, "message": str(error)}
            r["finished_at"] = _now()

    def finish(self, run_id, status) -> None:
        with self._lock:
            r = self._runs[run_id]
            r["status"] = status
            r["finished_at"] = _now()

    # ---- status / tasks --------------------------------------------------
    def set_status(self, run_id, status) -> None:
        with self._lock:
            self._runs[run_id]["status"] = status

    def current_step(self, run_id) -> str | None:
        with self._lock:
            r = self._runs.get(run_id)
            return r["current_step"] if r else None

    def attach_task(self, run_id, task) -> None:
        with self._lock:
            self._tasks[run_id] = task

    def active_count(self) -> int:
        with self._lock:
            return sum(1 for r in self._runs.values() if r["status"] not in _TERMINAL)

    def status_of(self, run_id) -> str | None:
        with self._lock:
            r = self._runs.get(run_id)
            return r["status"] if r else None

    def inbox_empty(self, run_id) -> bool:
        # transport owns the queue; the runner wires this. Default True until wired.
        return True

    # ---- read ------------------------------------------------------------
    def snapshot(self, run_id, after) -> dict | None:
        with self._lock:
            r = self._runs.get(run_id)
            if not r:
                return None
            logs = [l for l in r["_logs"] if l["seq"] > after]
            out = {k: v for k, v in r.items() if k not in ("_logs", "_seq")}
            out["_logs"] = logs
            out["last_seq"] = r["_seq"]
            # deep-ish copy for turns is unnecessary for read-only JSON serialization
            return out

    def list_sessions(self) -> list[dict]:
        with self._lock:
            return [{
                "run_id": r["run_id"], "label": r["label"], "status": r["status"],
                "started_at": r["started_at"], "finished_at": r["finished_at"],
                "turn_count": len(r["turns"]),
            } for r in reversed(self._runs.values())]

    # ---- eviction --------------------------------------------------------
    def _evict_locked(self) -> None:
        while len(self._runs) > _MAX_RUNS:
            victim = None
            for rid, r in self._runs.items():
                if r["status"] in _TERMINAL:
                    victim = rid
                    break
            if victim is None:
                break  # everything is live; do not evict
            self._runs.pop(victim, None)
            task = self._tasks.pop(victim, None)
            if task is not None and not task.done():
                task.cancel()


AGENT_SESSIONS = AgentSessionStore()
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pytest tests/jobs/test_agent_sessions.py -q`
Expected: PASS (7 tests).

- [ ] **Step 6: Commit**

```bash
cd /Users/salescode/Desktop/project/interviewiq-ai-service
git add app/jobs/agent_sessions.py tests/jobs/test_agent_sessions.py
git commit -m "feat(agent-diag): AgentSessionStore with turn/step tree + non-terminal-safe eviction"
```

---

### Task A2: `DiagnosticTransport`

**Files:**
- Create: `app/interview_agent/diagnostic_transport.py`
- Test: `tests/interview_agent/test_diagnostic_transport.py`

**Interfaces:**
- Consumes: `app.interview_agent.transport.Transport` (Protocol — implement it), `app.interview_agent.types.{UtteranceTiming, Artifact}`, `AGENT_SESSIONS`.
- Produces:
  - `class DiagnosticSessionAborted(Exception)`.
  - Sentinels `_SILENCE`, `_END` (module-level singletons).
  - `@dataclass _TurnInput{text: str, artifact: dict | None, advance_seconds: float}`.
  - `class DiagnosticTransport` with `submit_turn(text, artifact, advance_seconds)`, `submit_silence(advance_seconds=60.0)`, `submit_end()` (put onto the inbox), and the Transport methods `say/next_utterance/current_artifact/end_session/seconds_since_activity`.
  - `.inbox_empty() -> bool`.

- [ ] **Step 1: Write the failing test**

```python
# tests/interview_agent/test_diagnostic_transport.py
import asyncio
import pytest
from app.jobs.agent_sessions import AgentSessionStore
from app.interview_agent.diagnostic_transport import (
    DiagnosticTransport, DiagnosticSessionAborted,
)

@pytest.mark.asyncio
async def test_turn_advances_clock_and_returns_timing():
    store = AgentSessionStore(); store.start("r", {}, label="x")
    t = DiagnosticTransport("r", store)
    t.submit_turn("hello", artifact=None, advance_seconds=60.0)
    text, timing = await t.next_utterance()
    assert text == "hello"
    assert timing.t_start == 0.0 and timing.t_end == 60.0
    t.submit_turn("again", artifact=None, advance_seconds=30.0)
    _, timing2 = await t.next_utterance()
    assert timing2.t_start == 60.0 and timing2.t_end == 90.0  # accumulates

@pytest.mark.asyncio
async def test_silence_returns_none_and_raises_activity():
    store = AgentSessionStore(); store.start("r", {}, label="x")
    t = DiagnosticTransport("r", store)
    t.submit_silence(advance_seconds=50.0)
    got = await t.next_utterance()
    assert got is None
    assert t.seconds_since_activity() >= 45.0

@pytest.mark.asyncio
async def test_sticky_artifact_retained_until_replaced():
    store = AgentSessionStore(); store.start("r", {}, label="x")
    t = DiagnosticTransport("r", store)
    t.submit_turn("a", artifact={"kind": "code", "content": "x=1"}, advance_seconds=10)
    await t.next_utterance()
    art = await t.current_artifact()
    assert art is not None and art.content == "x=1"
    t.submit_turn("b", artifact=None, advance_seconds=10)   # no new artifact
    await t.next_utterance()
    art2 = await t.current_artifact()
    assert art2 is not None and art2.content == "x=1"       # retained (sticky)

@pytest.mark.asyncio
async def test_end_sentinel_raises_aborted():
    store = AgentSessionStore(); store.start("r", {}, label="x")
    t = DiagnosticTransport("r", store)
    t.submit_end()
    with pytest.raises(DiagnosticSessionAborted):
        await t.next_utterance()

@pytest.mark.asyncio
async def test_say_appends_transcript_and_status_flip():
    store = AgentSessionStore(); store.start("r", {}, label="x")
    t = DiagnosticTransport("r", store)
    await t.say("welcome")
    assert store.snapshot("r", 0)["transcript"][-1] == {"speaker": "interviewer", "text": "welcome"}
    # next_utterance sets awaiting_input while blocked
    fut = asyncio.ensure_future(t.next_utterance())
    await asyncio.sleep(0.01)
    assert store.status_of("r") == "awaiting_input"
    t.submit_turn("hi", None, 10); await fut
    assert store.status_of("r") == "running"
```

- [ ] **Step 2: Run to verify it fails**

Run: `pytest tests/interview_agent/test_diagnostic_transport.py -q`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `DiagnosticTransport`**

```python
# app/interview_agent/diagnostic_transport.py
"""Queue-backed Transport that lets run_session be driven by typed candidate turns in-process.
Two harness clocks: the elapsed session clock (advanced by advance_seconds, returned as
UtteranceTiming.t_end so the brain sets state.elapsed_s -> drives pacing), and the activity
clock (seconds_since_activity, raised by silence windows -> drives inactivity escalation).
Three inbox message types: _TurnInput (spoken), _SILENCE (silent window -> None), _END
(force abort -> DiagnosticSessionAborted)."""
from __future__ import annotations

import asyncio
from dataclasses import dataclass

from app.interview_agent.types import UtteranceTiming, Artifact, ArtifactKind

_ARTIFACT_KIND_DEFAULT = "code"


class DiagnosticSessionAborted(Exception):
    """Raised out of next_utterance when a force-end (_END) is dequeued; propagates out of
    run_session (the brain does not catch it) so the runner can mark the session aborted."""


class _Sentinel:
    def __init__(self, name): self.name = name


_SILENCE = _Sentinel("SILENCE")
_END = _Sentinel("END")


@dataclass
class _TurnInput:
    text: str
    artifact: dict | None
    advance_seconds: float


class DiagnosticTransport:
    def __init__(self, run_id: str, store) -> None:
        self._run_id = run_id
        self._store = store
        self._inbox: "asyncio.Queue" = asyncio.Queue()
        self._clock = 0.0
        self._activity_seconds = 0.0
        self._artifact: Artifact | None = None

    # ---- producer side (called by the /turn, /end endpoints) -------------
    def submit_turn(self, text, artifact, advance_seconds) -> None:
        self._inbox.put_nowait(_TurnInput(text=text, artifact=artifact,
                                          advance_seconds=float(advance_seconds)))

    def submit_silence(self, advance_seconds=60.0) -> None:
        # carry the advance on the sentinel via a tuple so the clock still moves
        self._inbox.put_nowait((_SILENCE, float(advance_seconds)))

    def submit_end(self) -> None:
        self._inbox.put_nowait(_END)

    def inbox_empty(self) -> bool:
        return self._inbox.empty()

    # ---- Transport protocol ---------------------------------------------
    async def say(self, text: str) -> None:
        self._store.append_transcript(self._run_id, "interviewer", text)
        # tts step is recorded by the emitter tap around _say; here we just carry text.

    async def next_utterance(self):
        self._store.set_status(self._run_id, "awaiting_input")
        item = await self._inbox.get()
        self._store.set_status(self._run_id, "running")
        if item is _END:
            raise DiagnosticSessionAborted()
        if isinstance(item, tuple) and item[0] is _SILENCE:
            advance = item[1]
            self._clock += advance
            self._activity_seconds = max(self._activity_seconds, advance, 45.0)
            self._store.open_turn(self._run_id, "silence", None, False,
                                  self._artifact is not None, self._clock)
            return None
        # _TurnInput
        present = item.artifact is not None
        if present:
            self._artifact = Artifact(kind=ArtifactKind(item.artifact.get("kind", _ARTIFACT_KIND_DEFAULT)),
                                      content=item.artifact.get("content", ""))
        elif item.artifact == {}:   # explicit clear
            self._artifact = None
        t_start = self._clock
        self._clock += item.advance_seconds
        self._activity_seconds = 0.0
        self._store.append_transcript(self._run_id, "candidate", item.text)
        self._store.open_turn(self._run_id, "main", item.text, present,
                              self._artifact is not None, self._clock)
        return item.text, UtteranceTiming(t_start=t_start, t_end=self._clock,
                                          time_to_first_word_s=0.0)

    async def current_artifact(self):
        return self._artifact

    async def end_session(self) -> None:
        # brain-initiated end; runner sets terminal status on run_session return.
        return None

    def seconds_since_activity(self) -> float:
        return self._activity_seconds
```

> Verified: `Artifact(kind: ArtifactKind, content: str, language: str | None = None)` (types.py:100-107); `ArtifactKind` is a `(str, Enum)` with `CODE="code"`/`DIAGRAM="diagram"` (types.py:80-82). `kind` MUST be the enum — the brain calls `artifact.kind.value` on the PROBE_ARTIFACT path (session.py:384), so a raw string would `AttributeError`. That is why the construction wraps with `ArtifactKind(...)`.

- [ ] **Step 4: Run to verify it passes**

Run: `pytest tests/interview_agent/test_diagnostic_transport.py -q`
Expected: PASS (5 tests). If `Artifact(...)` fails, read `types.py` and fix field names, then re-run.

- [ ] **Step 5: Commit**

```bash
git add app/interview_agent/diagnostic_transport.py tests/interview_agent/test_diagnostic_transport.py
git commit -m "feat(agent-diag): DiagnosticTransport with dual clocks + 3 inbox message types"
```

---

### Task A3: Emitter + pure `decide_with_reason` wrapper + additive session.py taps

**Files:**
- Create: `app/interview_agent/diagnostics_emit.py`
- Test: `tests/interview_agent/test_diagnostics_emit.py`
- Modify: `app/interview_agent/session.py` (insert `emit.*` calls at tap points; swap `decide` → `decide_with_reason`)

**Interfaces:**
- Consumes: `AGENT_SESSIONS`, `app.interview_agent.graph.decide`, `types.Action`, `types.DecisionInputs`.
- Produces:
  - `bind_emitter(run_id) -> token`, `unbind_emitter(token)` (contextvar, mirrors `bind_run`).
  - Emit helpers that no-op when the contextvar is unbound: `step_begin(name, llm_label=None)`, `step_end(status, detail)`, `step_skipped(name)`. Each resolves the bound `run_id` and forwards to `AGENT_SESSIONS`.
  - `decide_with_reason(inputs: DecisionInputs) -> tuple[Action, str]` — calls `graph.decide(inputs)` and returns `(action, branch_reason)` where `branch_reason` is a stable human label of the matched precedence branch. **Pure**: for any inputs, `decide_with_reason(i)[0] == graph.decide(i)`.

- [ ] **Step 1: Write the failing test (no-op safety + purity + emit routing)**

```python
# tests/interview_agent/test_diagnostics_emit.py
import pytest
from app.interview_agent import diagnostics_emit as emit
from app.interview_agent.graph import decide
from app.jobs.agent_sessions import AgentSessionStore

def test_emit_is_noop_when_unbound():
    # Must not raise when no session is bound (production path safety).
    emit.step_begin("classify"); emit.step_end("ok", {"x": 1}); emit.step_skipped("scope")

def test_emit_routes_to_bound_session(monkeypatch):
    store = AgentSessionStore(); store.start("r", {}, label="x")
    monkeypatch.setattr(emit, "AGENT_SESSIONS", store)
    tok = emit.bind_emitter("r")
    try:
        emit.step_begin("classify", llm_label="iv-classify")
        emit.step_end("ok", {"decision": "answer"})
    finally:
        emit.unbind_emitter(tok)
    step = store.snapshot("r", 0)["turns"][0]["steps"][-1]
    assert step["name"] == "classify" and step["detail"]["decision"] == "answer"

def test_decide_with_reason_matches_bare_decide_and_labels():
    from app.interview_agent.state import DecisionInputs   # TypedDict lives in state.py
    from app.interview_agent.types import PacingDirective
    # sample a range of inputs; the action must equal bare decide, and reason is non-empty
    samples = [
        dict(turn_class="answer", requested_topic=None, topic_scope="in",
             pacing_directive=PacingDirective.CONTINUE.value, followups_left=2, hints_left=1,
             has_next_question=True, reserve_available=True, pivot_count=0, pivot_cap=2,
             answer_adequate=True),
        dict(turn_class="pivot_request", requested_topic="ml", topic_scope="out",
             pacing_directive=PacingDirective.CONTINUE.value, followups_left=0, hints_left=0,
             has_next_question=False, reserve_available=False, pivot_count=3, pivot_cap=2,
             answer_adequate=False),
    ]
    for s in samples:
        di = DecisionInputs(**s)
        action, reason = emit.decide_with_reason(di)
        assert action == decide(di)
        assert isinstance(reason, str) and reason
```

- [ ] **Step 2: Run to verify it fails**

Run: `pytest tests/interview_agent/test_diagnostics_emit.py -q`
Expected: FAIL — module not found. (If `DecisionInputs` construction fails, read `graph.py`/`types.py` for the exact `DecisionInputs` shape and adjust the sample dicts — it is a `TypedDict` per graph.py:38.)

- [ ] **Step 3: Implement the emitter + wrapper**

```python
# app/interview_agent/diagnostics_emit.py
"""Contextvar-bound diagnostics emitter. No-op unless a diagnostic session binds it (mirrors
pipeline_runs.bind_run). Lets session.py carry additive emit.* taps that are inert on the
production run_session path, keeping the brain's behaviour (and its 148 tests) unchanged."""
from __future__ import annotations

import contextvars

from app.interview_agent.graph import decide
from app.interview_agent.types import Action
from app.interview_agent.state import DecisionInputs  # DecisionInputs is a TypedDict in state.py, NOT types.py
from app.jobs.agent_sessions import AGENT_SESSIONS

_current: "contextvars.ContextVar[str | None]" = contextvars.ContextVar(
    "diag_emitter_run_id", default=None)


def bind_emitter(run_id: str):
    return _current.set(run_id)


def unbind_emitter(token) -> None:
    _current.reset(token)


def _rid() -> str | None:
    return _current.get()


def step_begin(name, llm_label=None) -> None:
    rid = _rid()
    if rid is not None:
        AGENT_SESSIONS.begin_step(rid, name, llm_label=llm_label)


def step_end(status, detail) -> None:
    rid = _rid()
    if rid is not None:
        AGENT_SESSIONS.end_step(rid, status, detail)


def step_skipped(name) -> None:
    rid = _rid()
    if rid is not None:
        AGENT_SESSIONS.emit_skipped(rid, name)


def decide_with_reason(inputs: DecisionInputs) -> tuple[Action, str]:
    """Pure. Returns bare decide(inputs) plus a stable branch label mirroring the precedence
    ladder in graph.decide. MUST return the same Action as graph.decide."""
    action = decide(inputs)
    reason = _branch_reason(inputs, action)
    return action, reason


def _branch_reason(inputs: DecisionInputs, action: Action) -> str:
    # Human-readable label of why this action was chosen. Derived from the same precedence
    # order as graph.decide; kept in sync by the regression test that asserts action equality.
    d = inputs["pacing_directive"]
    if d == "wind_down":
        return "pacing directive: wind_down"
    if d == "extend":
        return "pacing directive: extend"
    tc = inputs["turn_class"]
    scope = inputs["topic_scope"]
    if tc == "pivot_request" and scope == "out":
        return "pivot_request out of round scope"
    if tc == "pivot_request" and inputs["pivot_count"] >= inputs["pivot_cap"]:
        return "pivot_request past pivot cap -> hold ground"
    if tc == "pivot_request":
        return "pivot_request within scope+cap -> derive"
    if tc == "clarify":
        return "turn_class clarify -> answer clarification"
    if tc == "distress":
        return "turn_class distress -> reassure"
    if tc == "challenge":
        return "turn_class challenge -> de-escalate"
    if tc == "off_topic":
        return "turn_class off_topic -> redirect"
    if tc == "idk_silence":
        return "idk/silence -> hint" if inputs["hints_left"] > 0 else "idk/silence, no hints -> move on"
    if inputs["answer_adequate"]:
        return "answer adequate -> move on / wrap"
    return "answer not yet adequate -> escalate follow-up"
```

> The executor MUST verify `_branch_reason`'s branches mirror the real precedence order in `graph.decide` (graph.py:53-88). The purity test only checks the returned *action* equals bare `decide`; keep the reason labels aligned with the actual branches while implementing.

- [ ] **Step 4: Insert additive taps into `session.py`**

Read `session.py` around the confirmed tap points and wrap each with `emit`. Example shape (adapt to the real local variable names):

```python
# app/interview_agent/session.py  (top)
from app.interview_agent import diagnostics_emit as emit

# --- classify (around session.py:419) ---
emit.step_begin("classify", llm_label="iv-classify")
turn_class, requested_topic, topic_scope = await classify_utterance(...)   # existing call
emit.step_end("ok", {"decision": turn_class.value, "requested_topic": requested_topic,
                     "topic_scope": topic_scope.value})

# --- scope: emit skipped when not a pivot ---
if turn_class == TurnClass.PIVOT_REQUEST:
    ...  # existing scope handling already inside classify_utterance/graph
else:
    emit.step_skipped("scope")

# --- grade (around session.py:422-428) ---
# REQUIRED refactor (verified): `_score_last_answer` currently returns None with competency/
# coherence as locals (session.py:124). Change it to RETURN (competency, coherence, artifact_used)
# — pure return-value add, existing callers ignore it. Adapt the arg names to the real call site.
if turn_class == TurnClass.ANSWER:
    emit.step_begin("grade", llm_label="iv-grade")
    competency, coherence, artifact_used = await _score_last_answer(scorer, settings, state, text, timing, artifact)
    emit.step_end("ok", {"decision": {"competency": competency, "coherence": coherence},
                         "artifact_present_this_turn": artifact is not None,
                         "artifact_used_in_grade": artifact_used,
                         "state_delta": {"rolling": state.rolling,
                                         "last_competency": state.per_answer[-1].competency}})
else:
    emit.step_skipped("grade")

# --- pacing (around session.py:436) ---
# REQUIRED refactor (verified): `_update_pacing` currently returns None with gate/directive as
# locals (session.py:148,157). Change it to RETURN (gate, directive) — the PacingGate from
# evaluate_gate and the resolved PacingDirective. Pure return-value add; it still sets
# state.pacing_directive / state.ended_reason exactly as before.
emit.step_begin("pacing")
gate, directive = await _update_pacing(scorer, settings, state)
emit.step_end("ok", {"decision": {"gate": gate.value, "directive": directive.value},
                     "inputs": {"elapsed_s": state.elapsed_s, "rolling": state.rolling}})

# --- route: swap decide -> decide_with_reason (around session.py:438-440) ---
emit.step_begin("route")
inputs = build_inputs(state, turn_class, requested_topic, topic_scope, settings)
action, branch_reason = emit.decide_with_reason(inputs)
emit.step_end("ok", {"inputs": dict(inputs), "decision": action.value,
                     "branch_reason": branch_reason})

# --- action ---
emit.step_begin("action")
await _apply_action(action, ...)   # existing
emit.step_end("ok", {"decision": action.value})
```

Keep each tap a thin wrapper around the **existing** call — do not change control flow or the values passed to the brain. Where `_apply_action` internally runs converse/derive, leave those for Slice 2's per-op capture; Slice 1 records the action step only.

- [ ] **Step 5: Run emitter tests + FULL regression suite**

Run: `pytest tests/interview_agent/test_diagnostics_emit.py -q && pytest -q`
Expected: emitter tests PASS; full suite still at the Task A0 baseline count (e.g. `148 passed`). If any brain test fails, a tap changed behavior — revert to a pure observation.

- [ ] **Step 6: Commit**

```bash
git add app/interview_agent/diagnostics_emit.py app/interview_agent/session.py tests/interview_agent/test_diagnostics_emit.py
git commit -m "feat(agent-diag): contextvar emitter + pure decide_with_reason + additive session taps"
```

---

### Task A4: `diagnostic_runner` (orchestration)

**Files:**
- Create: `app/interview_agent/diagnostic_runner.py`
- Test: `tests/interview_agent/test_diagnostic_runner.py`

**Interfaces:**
- Consumes: `run_session` (`session.py` — it builds & closes its own LLM clients internally; the runner passes only `plan`+`settings`, no clients), `DiagnosticTransport`, `AGENT_SESSIONS`, `bind_run`/`unbind_run` (pipeline_runs), `bind_emitter`/`unbind_emitter`, `new_run_id`, `Settings`.
- Produces:
  - `class TooManyActiveSessions(Exception)`.
  - `MAX_ACTIVE_SESSIONS` (from settings, default 3).
  - `start_agent_session(plan: dict, settings, label: str | None = None) -> tuple[str, DiagnosticTransport]` — capacity check, seed store, create the `_run` task, `attach_task`, return `(run_id, transport)`.
  - `terminal_status(ended_reason: str | None) -> str` — `"abandoned"` if `abandoned` else `"completed"`.
  - `_run(run_id, transport, plan, settings)` — binds run+emitter, awaits `run_session` (which ALWAYS returns a `SessionOutcome`; it catches its own errors), stores result + `finish(terminal_status(ended_reason))`. Force-end and fatal LLM errors both arrive as `ended_reason=="aborted_technical"` → status `"aborted"`. Only `asyncio.CancelledError` (eviction) and a defensive `Exception` (asdict/store failure) are caught.
- The endpoints (Task A5) keep a registry `run_id -> DiagnosticTransport` so `/turn` and `/end` can reach the transport.

- [ ] **Step 1: Write the failing integration test (drive a full scripted session)**

```python
# tests/interview_agent/test_diagnostic_runner.py
import asyncio
import pytest
from app.jobs.agent_sessions import AGENT_SESSIONS
from app.interview_agent import diagnostic_runner as dr

@pytest.mark.asyncio
async def test_terminal_status_mapping():
    assert dr.terminal_status("abandoned") == "abandoned"
    assert dr.terminal_status("natural_complete") == "completed"
    assert dr.terminal_status("time_ceiling") == "completed"
    assert dr.terminal_status(None) == "completed"

@pytest.mark.asyncio
async def test_capacity_enforced(monkeypatch, minimal_plan, test_settings):
    monkeypatch.setattr(dr, "MAX_ACTIVE_SESSIONS", 1)
    rid, t = dr.start_agent_session(minimal_plan, test_settings, label="x")
    with pytest.raises(dr.TooManyActiveSessions):
        dr.start_agent_session(minimal_plan, test_settings, label="y")
    t.submit_end()  # let the first one wind down so we don't leak the task

@pytest.mark.asyncio
async def test_force_end_yields_aborted(minimal_plan, test_settings):
    rid, t = dr.start_agent_session(minimal_plan, test_settings, label="x")
    await asyncio.sleep(0.05)                     # let opening run to first next_utterance
    t.submit_end()
    for _ in range(50):
        if AGENT_SESSIONS.status_of(rid) == "aborted":
            break
        await asyncio.sleep(0.02)
    assert AGENT_SESSIONS.status_of(rid) == "aborted"
```

> Verified: there is NO `tests/interview_agent/conftest.py` and no fixture. `test_session.py:14-23` defines a module-level `PLAN` dict (2 ladders + 1 reserve) that drains to `NATURAL_COMPLETE`/`WRAP`, and `test_session.py:40-61` has `_install_stubs(monkeypatch, classify=, competency=, directive=, opening_intent=)` which monkeypatches `app.interview_agent.llm_ops` fns AND stubs `sess.build_llm_client -> None` so `run_session` never hits the network, plus builds `Settings` via `app.config.get_settings()`. Create `tests/interview_agent/conftest.py` exposing `minimal_plan` (copy `PLAN`) and `test_settings` (`get_settings()`), and reuse/replicate `_install_stubs` in the runner test so no real LLM is called.

- [ ] **Step 2: Run to verify it fails**

Run: `pytest tests/interview_agent/test_diagnostic_runner.py -q`
Expected: FAIL — module not found / fixture missing.

- [ ] **Step 3: Implement the runner**

```python
# app/interview_agent/diagnostic_runner.py
"""Starts and supervises an in-process diagnostic interview session. Binds the run-store log
capture AND the diagnostics emitter for the session's asyncio task, drives run_session behind a
DiagnosticTransport, and records the terminal outcome. Does NOT post to the outcome sink."""
from __future__ import annotations

import asyncio
import dataclasses
import logging

from app.config import Settings
from app.interview_agent.diagnostic_transport import DiagnosticTransport
from app.interview_agent.session import run_session
from app.interview_agent import diagnostics_emit as emit
from app.jobs.agent_sessions import AGENT_SESSIONS
from app.jobs.pipeline_runs import bind_run, unbind_run, new_run_id
# (no LLMError import — run_session never raises it to the runner; it returns aborted_technical)

logger = logging.getLogger(__name__)


class TooManyActiveSessions(Exception):
    pass


def _max_active(settings: Settings) -> int:
    return getattr(settings, "max_active_diagnostic_sessions", 3) or 3


# module-level so the endpoints can look up the live transport by run_id
TRANSPORTS: dict[str, DiagnosticTransport] = {}


def terminal_status(ended_reason: str | None) -> str:
    # run_session catches ALL exceptions (session.py ~448) and returns an outcome; a force-end
    # (_END -> DiagnosticSessionAborted) OR a fatal LLM error both come back as "aborted_technical".
    if ended_reason == "abandoned":
        return "abandoned"
    if ended_reason == "aborted_technical":
        return "aborted"
    return "completed"


def start_agent_session(plan: dict, settings: Settings, label: str | None = None):
    if AGENT_SESSIONS.active_count() >= _max_active(settings):
        raise TooManyActiveSessions()
    run_id = new_run_id()
    label = label or f"{plan.get('round','?')}·{(plan.get('persona') or {}).get('name','?')}"
    AGENT_SESSIONS.start(run_id, plan, label=label)
    transport = DiagnosticTransport(run_id, AGENT_SESSIONS)
    TRANSPORTS[run_id] = transport
    task = asyncio.create_task(_run(run_id, transport, plan, settings))
    AGENT_SESSIONS.attach_task(run_id, task)
    return run_id, transport


async def _run(run_id, transport, plan, settings) -> None:
    run_tok = bind_run(run_id)
    emit_tok = emit.bind_emitter(run_id)
    try:
        outcome = await run_session(transport, plan, settings)
        # SessionOutcome is a frozen dataclass (types.py:135) -> asdict recurses nested dataclasses.
        # ended_reason is an EndedReason (str, Enum), so JSON + == "abandoned" both work.
        doc = dataclasses.asdict(outcome)
        ended_reason = doc.get("ended_reason")
        AGENT_SESSIONS.set_result(run_id, doc, ended_reason)
        AGENT_SESSIONS.finish(run_id, terminal_status(ended_reason))
    except asyncio.CancelledError:
        AGENT_SESSIONS.finish(run_id, "aborted")   # store evicted this session and cancelled us
        raise
    except Exception as e:
        # defensive only: run_session catches its OWN errors and always returns an outcome, so this
        # guards asdict/store failures — NOT interview content. A force-end (_END) or fatal LLM
        # error arrives above as ended_reason == "aborted_technical" and is mapped by terminal_status.
        logger.warning("[agent-diag] runner error: %s", e)
        AGENT_SESSIONS.fail(run_id, step=AGENT_SESSIONS.current_step(run_id), error=e)
    finally:
        emit.unbind_emitter(emit_tok)
        unbind_run(run_tok)
        TRANSPORTS.pop(run_id, None)
```

> Verified: `SessionOutcome` is a frozen `@dataclass` (types.py:135-145) with an `ended_reason: EndedReason` field; no `to_dict`/`model_dump`. Use `dataclasses.asdict(outcome)` (recurses into nested `PerAnswerScore`/`NegativeEvent`). `EndedReason` is a `(str, Enum)` so it serializes and `== "abandoned"` compares as a string.

- [ ] **Step 4: Run to verify it passes**

Run: `pytest tests/interview_agent/test_diagnostic_runner.py -q`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add app/interview_agent/diagnostic_runner.py tests/interview_agent/test_diagnostic_runner.py tests/interview_agent/conftest.py
git commit -m "feat(agent-diag): diagnostic_runner supervises run_session (capacity, force-end, terminal mapping)"
```

---

### Task A5: Admin endpoints

**Files:**
- Modify: `app/api/admin.py` (append a new block; reuse the existing `router`, `require_internal_key`, `get_settings`)
- Test: `tests/api/test_admin_interview_agent.py`

**Interfaces:**
- Consumes: `start_agent_session`, `TooManyActiveSessions`, `TRANSPORTS`, `AGENT_SESSIONS`, `get_settings`.
- Produces routes (all under `/admin`, internal-key):
  - `POST /interview-agent/run` body=InterviewPlan dict → `{run_id, status:"running"}` | `429`.
  - `POST /interview-agent/runs/{run_id}/turn` body=`{text?, artifact?, advance_seconds?, silence?}` → `{status:"accepted"}` | `404` | `409`.
  - `GET /interview-agent/runs/{run_id}?after=<int>` → snapshot | `404`.
  - `GET /interview-agent/runs` → `{runs: [...]}`.
  - `POST /interview-agent/runs/{run_id}/end` → `{status:"accepted"}` | `404`.

- [ ] **Step 1: Write the failing endpoint tests**

```python
# tests/api/test_admin_interview_agent.py
import pytest
from httpx import AsyncClient, ASGITransport
from app.main import app

HEADERS = {"X-Internal-Api-Key": "x"}  # root tests/conftest.py:11 sets INTERNAL_API_KEY="x"; get_settings is @lru_cache

@pytest.mark.asyncio
async def test_run_then_poll_then_atomic_turn(minimal_plan_json):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        r = await c.post("/admin/interview-agent/run", json=minimal_plan_json, headers=HEADERS)
        assert r.status_code == 200
        rid = r.json()["run_id"]
        # poll until awaiting_input (opening finished)
        import asyncio
        for _ in range(50):
            snap = (await c.get(f"/admin/interview-agent/runs/{rid}?after=0", headers=HEADERS)).json()
            if snap["status"] == "awaiting_input":
                break
            await asyncio.sleep(0.02)
        assert snap["status"] == "awaiting_input"
        # a valid turn is accepted
        r2 = await c.post(f"/admin/interview-agent/runs/{rid}/turn",
                          json={"text": "my answer", "advance_seconds": 60}, headers=HEADERS)
        assert r2.status_code == 200 and r2.json()["status"] == "accepted"

@pytest.mark.asyncio
async def test_turn_on_unknown_is_404():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        r = await c.post("/admin/interview-agent/runs/nope/turn", json={"text": "x"}, headers=HEADERS)
        assert r.status_code == 404

@pytest.mark.asyncio
async def test_missing_internal_key_is_401(minimal_plan_json):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        r = await c.post("/admin/interview-agent/run", json=minimal_plan_json)
        assert r.status_code == 401
```

> Verified: there is NO `tests/api/` dir and NO conftest setting `"test-internal-key"`. Root `tests/conftest.py:11` does `os.environ.setdefault("INTERNAL_API_KEY", "x")` and `get_settings` is `@lru_cache`, so the effective key is `"x"` — send that header (the 401 test still holds: omitting the header ≠ `"x"`). Reuse `_install_stubs` (test_session.py) so `/run` starts a stubbed, no-network session. `minimal_plan_json` = the `PLAN` dict from `test_session.py:14-23` (already JSON-serializable). Put both in `tests/interview_agent/conftest.py` (auto-discovered under `tests/`), or an `app.dependency_overrides[require_internal_key]=lambda:True` bypass per `tests/test_questions_endpoints.py:7-8` for the non-401 cases.

- [ ] **Step 2: Run to verify it fails**

Run: `pytest tests/api/test_admin_interview_agent.py -q`
Expected: FAIL — 404 on `/admin/interview-agent/run` (route not defined).

- [ ] **Step 3: Implement the endpoints** (append to `app/api/admin.py`). FIRST add `Body` to the existing fastapi import — admin.py:14 currently imports `APIRouter, Depends, HTTPException, Query, Request, status` and **`Body` is missing** (the `plan: dict = Body(...)` param NameErrors without it). `Query`/`HTTPException`/`Depends`/`status` and the module-level `get_settings()` are already available; `router` is the existing `APIRouter(prefix="/admin", ...)`.

```python
# --- Agent diagnostics (interactive brain harness) --------------------------------
from app.interview_agent.diagnostic_runner import start_agent_session, TooManyActiveSessions, TRANSPORTS
from app.jobs.agent_sessions import AGENT_SESSIONS

@router.post("/interview-agent/run")
async def start_agent_run(plan: dict = Body(...), settings=Depends(get_settings)):
    try:
        run_id, _ = start_agent_session(plan, settings)
    except TooManyActiveSessions:
        raise HTTPException(status_code=429, detail="sessions_at_capacity")
    return {"run_id": run_id, "status": "running"}

@router.post("/interview-agent/runs/{run_id}/turn")
async def submit_agent_turn(run_id: str, body: dict = Body(...)):
    transport = TRANSPORTS.get(run_id)
    if transport is None or AGENT_SESSIONS.snapshot(run_id, 0) is None:
        raise HTTPException(status_code=404, detail="run_not_found")
    # atomic accept: only when awaiting_input AND inbox empty
    if AGENT_SESSIONS.status_of(run_id) != "awaiting_input" or not transport.inbox_empty():
        raise HTTPException(status_code=409, detail="not_awaiting_input")
    AGENT_SESSIONS.set_status(run_id, "running")   # flip before returning (anti double-submit)
    if body.get("silence"):
        transport.submit_silence(advance_seconds=float(body.get("advance_seconds", 60.0)))
    else:
        transport.submit_turn(text=body.get("text", ""), artifact=body.get("artifact"),
                              advance_seconds=float(body.get("advance_seconds", 60.0)))
    return {"status": "accepted"}

@router.get("/interview-agent/runs/{run_id}")
async def get_agent_run(run_id: str, after: int = Query(0)):
    snap = AGENT_SESSIONS.snapshot(run_id, after)
    if snap is None:
        raise HTTPException(status_code=404, detail="run_not_found")
    return snap

@router.get("/interview-agent/runs")
async def list_agent_runs():
    return {"runs": AGENT_SESSIONS.list_sessions()}

@router.post("/interview-agent/runs/{run_id}/end")
async def end_agent_run(run_id: str):
    transport = TRANSPORTS.get(run_id)
    if transport is None:
        raise HTTPException(status_code=404, detail="run_not_found")
    transport.submit_end()
    return {"status": "accepted"}
```

> Ensure `Body`, `Query`, `HTTPException`, `Depends` are imported in `admin.py` (the prep endpoints already import most). The `set_status(run_id, "running")` flip makes the double-submit guard atomic (the next poll observes `running`, and a second submit hits the 409 branch).

- [ ] **Step 4: Run endpoint tests + full suite**

Run: `pytest tests/api/test_admin_interview_agent.py -q && pytest -q`
Expected: endpoint tests PASS; full suite still green at baseline.

- [ ] **Step 5: Commit**

```bash
git add app/api/admin.py tests/api/test_admin_interview_agent.py
git commit -m "feat(agent-diag): /admin/interview-agent endpoints (run/turn/runs/end) with atomic accept + capacity"
```

---

## Phase B — backend (Spring BFF proxy)

### Task B1: `AiServiceClient` interview-agent methods

**Files:**
- Modify: `src/main/java/com/interviewiq/interviewiq_backend/integrations/aiservice/AiServiceClient.java`

**Interfaces:**
- Consumes: existing `restClient`, `baseUrl`, `internalApiKey`, `X-Internal-Api-Key` pattern (mirror the interview-prep methods at AiServiceClient.java:307-345).
- Produces (return `JsonNode`/`Map<String,Object>` — opaque passthrough):
  - `JsonNode startAgentRun(JsonNode plan)` → POST `/admin/interview-agent/run`.
  - `JsonNode submitAgentTurn(String runId, JsonNode body)` → POST `/admin/interview-agent/runs/{runId}/turn`.
  - `JsonNode getAgentRun(String runId, long after)` → GET `/admin/interview-agent/runs/{runId}?after={after}`.
  - `JsonNode listAgentRuns()` → GET `/admin/interview-agent/runs`.
  - `JsonNode endAgentRun(String runId)` → POST `/admin/interview-agent/runs/{runId}/end`.

- [ ] **Step 1: Add the client methods** (mirror the prep block, AiServiceClient.java:307-345, exact same header + error surface)

```java
// --- Agent diagnostics (interactive brain harness) -------------------------------------
// Mirror the prep methods (AiServiceClient.java:314-346): .retrieve().body(String.class) then
// objectMapper.readTree(...). objectMapper is the existing `private final ObjectMapper objectMapper`
// field (tools.jackson.databind — Jackson 3, readTree throws only unchecked JacksonException).
/** Start an interactive diagnostic interview session on the ai-service. */
public JsonNode startAgentRun(JsonNode plan) {
    String body = restClient.post()
            .uri(baseUrl + "/admin/interview-agent/run")
            .header("X-Internal-Api-Key", internalApiKey)
            .contentType(MediaType.APPLICATION_JSON)
            .body(plan)
            .retrieve()
            .body(String.class);
    if (body == null || body.isBlank())
        throw new RestClientException("ai-service /admin/interview-agent/run returned an empty body");
    return objectMapper.readTree(body);
}

/** Submit a candidate turn (or silence/end) to a diagnostic session. */
public JsonNode submitAgentTurn(String runId, JsonNode turn) {
    String body = restClient.post()
            .uri(baseUrl + "/admin/interview-agent/runs/{runId}/turn", runId)
            .header("X-Internal-Api-Key", internalApiKey)
            .contentType(MediaType.APPLICATION_JSON)
            .body(turn)
            .retrieve()
            .body(String.class);
    return objectMapper.readTree(body);
}

/** Snapshot of a diagnostic session + incremental logs (entries with seq > after). */
public JsonNode getAgentRun(String runId, long after) {
    String body = restClient.get()
            .uri(baseUrl + "/admin/interview-agent/runs/{runId}?after={after}", runId, after)
            .header("X-Internal-Api-Key", internalApiKey)
            .retrieve()
            .body(String.class);
    return objectMapper.readTree(body);
}

/** Recent diagnostic sessions (newest first). */
public JsonNode listAgentRuns() {
    String body = restClient.get()
            .uri(baseUrl + "/admin/interview-agent/runs")
            .header("X-Internal-Api-Key", internalApiKey)
            .retrieve()
            .body(String.class);
    return objectMapper.readTree(body);
}

/** Force-end a diagnostic session. */
public JsonNode endAgentRun(String runId) {
    String body = restClient.post()
            .uri(baseUrl + "/admin/interview-agent/runs/{runId}/end", runId)
            .header("X-Internal-Api-Key", internalApiKey)
            .retrieve()
            .body(String.class);
    return objectMapper.readTree(body);
}
```

> Verified: fields are `restClient`, `objectMapper`, `baseUrl`, `internalApiKey`. Imports: `JsonNode`/`ObjectMapper` = `tools.jackson.databind.*` (Jackson 3, NOT `com.fasterxml`), `MediaType` = `org.springframework.http.MediaType`, `RestClientException` = `org.springframework.web.client.RestClientException`. Jackson-3 `readTree` throws unchecked, so no `try/catch` is needed.

- [ ] **Step 2: Compile**

Run: `cd /Users/salescode/Desktop/project/interviewiq-backend && JAVA_HOME=/opt/homebrew/opt/openjdk@25/libexec/openjdk.jdk/Contents/Home ./mvnw -q compile` — JDK 25 required; the machine default is JDK 17 with `JAVA_HOME` unset, so a bare `mvnw` FAILS to produce release-25 bytecode.
Expected: BUILD SUCCESS.

- [ ] **Step 3: Commit**

```bash
git add src/main/java/com/interviewiq/interviewiq_backend/integrations/aiservice/AiServiceClient.java
git commit -m "feat(agent-diag): AiServiceClient methods for /admin/interview-agent proxy"
```

---

### Task B2: `AdminInterviewAgentController`

**Files:**
- Create: `.../controllers/AdminInterviewAgentController.java`
- Test: `.../controllers/AdminInterviewAgentControllerTest.java`

**Interfaces:**
- Consumes: `AiServiceClient` (B1). Mirror `AdminInterviewPrepController` mapping + **3-way error mapping** (AdminInterviewPrepController.java:167-183).
- Produces: `@RequestMapping(value = "/api/{version}/intelligence/interview-agent", version = "1")` with `POST /run`, `POST /runs/{id}/turn`, `GET /runs/{id}?after=`, `GET /runs`, `POST /runs/{id}/end`. `429 sessions_at_capacity` surfaced from ai-service.

- [ ] **Step 1: Write the failing MockMvc test**

```java
// AdminInterviewAgentControllerTest.java — mirror AdminInterviewPrepControllerTest EXACTLY.
@WebMvcTest(controllers = AdminInterviewAgentController.class,
            properties = "spring.mvc.apiversion.use.path-segment=1")     // else /api/v1 version won't resolve
@Import(AdminInterviewAgentControllerTest.TestSecurityConfig.class)
class AdminInterviewAgentControllerTest {
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper objectMapper;                 // tools.jackson.databind.ObjectMapper (autowired, not `new`)
    @MockitoBean AiServiceClient aiService;               // org.springframework.test.context.bean.override.mockito.MockitoBean

    @Test
    void start_run_proxies_and_returns_body() throws Exception {
        when(aiService.startAgentRun(any()))
            .thenReturn(objectMapper.readTree("{\"run_id\":\"r1\",\"status\":\"running\"}"));
        mvc.perform(post("/api/v1/intelligence/interview-agent/run")
                .with(jwt()).contentType(APPLICATION_JSON).content("{}"))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.run_id").value("r1"));
    }

    @Test
    void unknown_run_maps_to_404_run_not_found() throws Exception {
        when(aiService.getAgentRun(eq("nope"), anyLong()))
            .thenThrow(HttpClientErrorException.create(HttpStatus.NOT_FOUND, "nf", null, null, null));
        mvc.perform(get("/api/v1/intelligence/interview-agent/runs/nope").with(jwt()))
           .andExpect(status().isNotFound())
           .andExpect(jsonPath("$.code").value("run_not_found"));
    }

    @Test
    void aiservice_down_maps_to_502() throws Exception {
        when(aiService.listAgentRuns()).thenThrow(new RestClientException("down"));
        mvc.perform(get("/api/v1/intelligence/interview-agent/runs").with(jwt()))
           .andExpect(status().isBadGateway())
           .andExpect(jsonPath("$.code").value("ai_service_unreachable"));
    }

    // Copy VERBATIM from AdminInterviewPrepControllerTest: a mock(JwtDecoder.class) bean + a
    // permissive SecurityFilterChain (csrf disabled, anyRequest().authenticated(), oauth2 jwt()).
    @TestConfiguration @EnableWebSecurity
    static class TestSecurityConfig { /* mock JwtDecoder bean + SecurityFilterChain bean */ }
}
```

> Verified: `AdminInterviewPrepControllerTest.java` exists and uses `@MockitoBean` (`org.springframework.test.context.bean.override.mockito.MockitoBean`), `@WebMvcTest(..., properties="spring.mvc.apiversion.use.path-segment=1")`, `@Import(...TestSecurityConfig.class)`, `.with(jwt())` on every request (static import `SecurityMockMvcRequestPostProcessors.jwt`), an autowired `tools.jackson.databind.ObjectMapper`, and `when(...).thenReturn(...)`. Do NOT use `@WithMockUser`. `ApiError` = `record ApiError(String code, String message)` in `...dtos`. `HttpClientErrorException.TooManyRequests` exists in spring-web 7.0.7 (429 branch is valid).

- [ ] **Step 2: Run to verify it fails**

Run: `JAVA_HOME=/opt/homebrew/opt/openjdk@25/libexec/openjdk.jdk/Contents/Home ./mvnw -q -Dtest=AdminInterviewAgentControllerTest test`
Expected: FAIL — controller class missing.

- [ ] **Step 3: Implement the controller** (mirror `AdminInterviewPrepController` incl. the 3-way catch)

```java
@RestController
@RequestMapping(value = "/api/{version}/intelligence/interview-agent", version = "1")
public class AdminInterviewAgentController {
    private static final Logger log = LoggerFactory.getLogger(AdminInterviewAgentController.class);
    private final AiServiceClient aiService;

    public AdminInterviewAgentController(AiServiceClient aiService) { this.aiService = aiService; }

    @PostMapping("/run")
    public ResponseEntity<?> start(@RequestBody JsonNode plan) {
        return proxy(() -> aiService.startAgentRun(plan));
    }
    @PostMapping("/runs/{runId}/turn")
    public ResponseEntity<?> turn(@PathVariable String runId, @RequestBody JsonNode body) {
        return proxy(() -> aiService.submitAgentTurn(runId, body));
    }
    @GetMapping("/runs/{runId}")
    public ResponseEntity<?> get(@PathVariable String runId, @RequestParam(defaultValue = "0") long after) {
        return proxy(() -> aiService.getAgentRun(runId, after));
    }
    @GetMapping("/runs")
    public ResponseEntity<?> list() { return proxy(aiService::listAgentRuns); }
    @PostMapping("/runs/{runId}/end")
    public ResponseEntity<?> end(@PathVariable String runId) {
        return proxy(() -> aiService.endAgentRun(runId));
    }

    private ResponseEntity<?> proxy(java.util.function.Supplier<JsonNode> call) {
        try {
            return ResponseEntity.ok(call.get());
        } catch (HttpClientErrorException.NotFound ex) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(new ApiError("run_not_found", "no such diagnostic session"));
        } catch (HttpClientErrorException.TooManyRequests ex) {
            return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                    .body(new ApiError("sessions_at_capacity", "too many active diagnostic sessions"));
        } catch (RestClientException ex) {
            log.warn("AI service interview-agent call failed: {}", ex.getMessage());
            return ResponseEntity.status(HttpStatus.BAD_GATEWAY)
                    .body(new ApiError("ai_service_unreachable", "ai-service unavailable"));
        }
    }
}
```

> `ApiError` is the same record the prep controller uses. Confirm the `version = "1"` attribute name on `@RequestMapping` matches the prep controller exactly (Spring Framework 7 API versioning). Import `JsonNode`, `HttpClientErrorException`, `HttpStatus`, `RestClientException`, `ResponseEntity`.

- [ ] **Step 4: Run to verify it passes**

Run: `JAVA_HOME=/opt/homebrew/opt/openjdk@25/libexec/openjdk.jdk/Contents/Home ./mvnw -q -Dtest=AdminInterviewAgentControllerTest test`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/java/com/interviewiq/interviewiq_backend/controllers/AdminInterviewAgentController*.java
git commit -m "feat(agent-diag): AdminInterviewAgentController BFF proxy with 3-way error mapping"
```

---

## Phase C — frontend

### Task C0: Branch + `@xyflow/react` NOT yet (Slice 2). Add endpoint constants + types.

**Files:**
- Modify: `lib/constants/observability/index.ts`
- Create: `features/agent-diagnostics/types.ts`, `features/agent-diagnostics/index.ts`

**Interfaces:**
- Produces:
  - `INTERVIEW_AGENT_ENDPOINTS = { run, runs, runOf(id), turnOf(id), endOf(id) }` under base `/api/v1/intelligence/interview-agent`.
  - Types `AgentSession`, `AgentTurn`, `AgentStep`, `AgentStepStatus`, `AgentSessionSummary`, `SubmitTurnBody`; reuse `RunLogEntry` from `@/features/observability` and `TranscriptEntry` from `@/features/interview-live`.

- [ ] **Step 1: Create the branch**

Run: `cd /Users/salescode/Desktop/project/interviewIQ-frontend && git checkout -b feat/agent-diagnostics && git branch --show-current`
Expected: `feat/agent-diagnostics`.

- [ ] **Step 2: Add endpoint constants** (mirror `INTERVIEW_PREP_BENCH_ENDPOINTS`, observability/index.ts:12-17)

```ts
// lib/constants/observability/index.ts  (append)
const INTERVIEW_AGENT_BASE = "/api/v1/intelligence/interview-agent";
export const INTERVIEW_AGENT_ENDPOINTS = {
  run: `${INTERVIEW_AGENT_BASE}/run`,
  runs: `${INTERVIEW_AGENT_BASE}/runs`,
  runOf: (id: string) => `${INTERVIEW_AGENT_BASE}/runs/${id}`,
  turnOf: (id: string) => `${INTERVIEW_AGENT_BASE}/runs/${id}/turn`,
  endOf: (id: string) => `${INTERVIEW_AGENT_BASE}/runs/${id}/end`,
} as const;
```

- [ ] **Step 3: Add types**

```ts
// features/agent-diagnostics/types.ts
import type { RunLogEntry, RunStepStatus } from "@/features/observability";
import type { TranscriptEntry } from "@/features/interview-live/session/types";

export type AgentSessionStatus =
  | "running" | "awaiting_input" | "completed" | "failed" | "abandoned" | "aborted";

export interface AgentStep {
  name: string;
  status: RunStepStatus;               // pending|running|ok|failed|skipped
  llm_label: string | null;
  started_at: number | null;
  finished_at: number | null;
  duration_ms: number | null;
  detail: Record<string, unknown>;
}
export interface AgentTurn {
  index: number;
  kind: "opening" | "main" | "silence";
  candidate_text: string | null;
  artifact_present_this_turn: boolean;
  artifact_available: boolean;
  steps: AgentStep[];
  started_at: number | null;
  finished_at: number | null;
  duration_ms: number | null;
  elapsed_s_at_turn: number;
}
export interface AgentSession {
  run_id: string;
  pipeline: "interview_agent";
  label: string;
  status: AgentSessionStatus;
  plan_summary: Record<string, unknown>;
  current_turn: number;
  current_step: string | null;
  turns: AgentTurn[];
  transcript: TranscriptEntry[];
  result: unknown | null;
  ended_reason: string | null;
  error: { step?: string; type?: string; message?: string } | null;
  started_at: number;
  finished_at: number | null;
  _logs: RunLogEntry[];
  last_seq: number;
}
export interface AgentSessionSummary {
  run_id: string; label: string; status: AgentSessionStatus;
  started_at: number; finished_at: number | null; turn_count: number;
}
export interface SubmitTurnBody {
  text?: string;
  artifact?: { kind: string; content: string } | null;
  advance_seconds?: number;
  silence?: boolean;
}
```

```ts
// features/agent-diagnostics/index.ts
export * from "./types";
export * from "./api";
export * from "./hooks";
```

> Verify the `TranscriptEntry` import path against the real file (`features/interview-live/session/types.ts` per spec §4.3). Confirm `RunStepStatus`/`RunLogEntry` are exported from `@/features/observability`.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit` (there is NO `npm run typecheck` script; `tsconfig` sets `noEmit`).
Expected: no new errors. (`api.ts`/`hooks.ts` don't exist yet — `index.ts` will error until C1/C2; either add C1/C2 in the same commit or comment the barrel exports until then. Prefer committing C0+C1+C2 together — see below.)

- [ ] **Step 5: (defer commit to after C2 so the barrel resolves)**

---

### Task C1: API client fns

**Files:**
- Create: `features/agent-diagnostics/api.ts`

**Interfaces:**
- Consumes: `apiFetch` (`@/lib/api-client/client`), `INTERVIEW_AGENT_ENDPOINTS`, types (C0).
- Produces: `startAgentSession(plan)`, `submitTurn(runId, body)`, `getAgentSession(runId, after=0)`, `listAgentSessions()`, `endAgentSession(runId)`.

- [ ] **Step 1: Implement** (mirror `features/interview-prep-bench/api.ts`)

```ts
// features/agent-diagnostics/api.ts
import { apiFetch } from "@/lib/api-client/client";
import { INTERVIEW_AGENT_ENDPOINTS as E } from "@/lib/constants/observability";
import type { AgentSession, AgentSessionSummary, SubmitTurnBody } from "./types";

export function startAgentSession(plan: unknown) {
  return apiFetch<{ run_id: string; status: string }>(E.run, { method: "POST", json: plan });
}
export function submitTurn(runId: string, body: SubmitTurnBody) {
  return apiFetch<{ status: string }>(E.turnOf(runId), { method: "POST", json: body });
}
export function getAgentSession(runId: string, after = 0) {
  return apiFetch<AgentSession>(`${E.runOf(runId)}?after=${after}`);
}
export function listAgentSessions() {
  return apiFetch<{ runs: AgentSessionSummary[] }>(E.runs);
}
export function endAgentSession(runId: string) {
  return apiFetch<{ status: string }>(E.endOf(runId), { method: "POST" });
}
```

> Confirm `apiFetch`'s option shape (`{ method, json }`) against `lib/api-client/client.ts:32-47`.

---

### Task C2: Hooks + generalized poller

**Files:**
- (No modification to `features/observability/hooks.ts` — `useRunPolling` is typed to `RunSnapshot` (`snap.logs`/`snap.last_seq`, terminal = `completed|failed`) and cannot serve the 6-status `AgentSession` with `_logs`. Ship a standalone poller.)
- Create: `features/agent-diagnostics/hooks.ts` (contains `useAgentSession`, the standalone poll-until-terminal hook)
- Test: `features/agent-diagnostics/__tests__/hooks.test.ts` (or the repo's test location)

**Interfaces:**
- Produces: `useStartAgentSession()`, `useSubmitTurn()`, `useEndAgentSession()`, `useAgentSessions()`, `useAgentSession(runId)`.
- Session poller keeps polling while `running|awaiting_input`; stops on `completed|failed|abandoned|aborted`.

- [ ] **Step 1: Write the failing poller test**

```ts
// features/agent-diagnostics/__tests__/hooks.test.ts
import { isSessionTerminal } from "../hooks";

test("awaiting_input is NOT terminal (keeps polling)", () => {
  expect(isSessionTerminal("awaiting_input")).toBe(false);
  expect(isSessionTerminal("running")).toBe(false);
});
test("terminal statuses stop polling", () => {
  for (const s of ["completed", "failed", "abandoned", "aborted"] as const) {
    expect(isSessionTerminal(s)).toBe(true);
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run features/agent-diagnostics/__tests__/hooks.test.ts`
Expected: FAIL — `isSessionTerminal` not exported.

- [ ] **Step 3: Implement hooks**

```ts
// features/agent-diagnostics/hooks.ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import * as api from "./api";
import type { AgentSession, AgentSessionStatus } from "./types";

const POLL_MS = 1000;
export function isSessionTerminal(s: AgentSessionStatus | undefined): boolean {
  return s === "completed" || s === "failed" || s === "abandoned" || s === "aborted";
}

export function useStartAgentSession() {
  return useMutation({ mutationFn: (plan: unknown) => api.startAgentSession(plan) });
}
export function useSubmitTurn() {
  return useMutation({
    mutationFn: (v: { runId: string; body: Parameters<typeof api.submitTurn>[1] }) =>
      api.submitTurn(v.runId, v.body),
  });
}
export function useEndAgentSession() {
  return useMutation({ mutationFn: (runId: string) => api.endAgentSession(runId) });
}
export function useAgentSessions() {
  return useQuery({ queryKey: ["agent-diag", "list"], queryFn: () => api.listAgentSessions() });
}

// incremental-log accumulator + poll-until-terminal, mirroring useRunPolling
export function useAgentSession(runId: string | null) {
  const acc = useRef<{ runId: string | null; lastSeq: number; logs: AgentSession["_logs"] }>({
    runId: null, lastSeq: 0, logs: [],
  });
  return useQuery({
    queryKey: ["agent-diag", "run", runId],
    enabled: !!runId,
    refetchInterval: (q) => (isSessionTerminal(q.state.data?.status) ? false : POLL_MS),
    queryFn: async () => {
      const id = runId as string;
      if (acc.current.runId !== id) acc.current = { runId: id, lastSeq: 0, logs: [] };
      const snap = await api.getAgentSession(id, acc.current.lastSeq);
      acc.current.lastSeq = snap.last_seq;
      acc.current.logs = [...acc.current.logs, ...snap._logs];
      return { ...snap, _logs: acc.current.logs };
    },
  });
}
```

> Match the exact TanStack v5 idioms already used in `features/observability/hooks.ts` (query key style, `refetchInterval` signature). If the repo centralizes `POLL_MS`, import it instead of redeclaring.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run features/agent-diagnostics/__tests__/hooks.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit C0+C1+C2 together (barrel now resolves)**

```bash
cd /Users/salescode/Desktop/project/interviewIQ-frontend
git add lib/constants/observability/index.ts features/agent-diagnostics
git commit -m "feat(agent-diag): agent-diagnostics feature slice (endpoints, types, api, poll-until-terminal hooks)"
```

---

### Task C3: Markdown export util

**Files:**
- Create: `app/(app)/intelligence/_components/agent/markdownExport.ts`
- Test: `app/(app)/intelligence/_components/agent/__tests__/markdownExport.test.ts`

**Interfaces:**
- Produces: `sessionToMarkdown(session: AgentSession, notes: Record<number,string>): string`, `turnToMarkdown(turn: AgentTurn, notes?: string): string`.

- [ ] **Step 1: Write the failing test**

```ts
import { turnToMarkdown } from "../markdownExport";
import type { AgentTurn } from "@/features/agent-diagnostics";

test("turnToMarkdown includes decisions, prompts and branch reason", () => {
  const turn: AgentTurn = {
    index: 1, kind: "main", candidate_text: "my answer",
    artifact_present_this_turn: false, artifact_available: false,
    started_at: 0, finished_at: 1, duration_ms: 1000, elapsed_s_at_turn: 60,
    steps: [
      { name: "classify", status: "ok", llm_label: "iv-classify", started_at: 0, finished_at: 1,
        duration_ms: 100, detail: { decision: "answer" } },
      { name: "route", status: "ok", llm_label: null, started_at: 0, finished_at: 1,
        duration_ms: 10, detail: { decision: "MOVE_ON", branch_reason: "answer adequate -> move on / wrap" } },
    ],
  };
  const md = turnToMarkdown(turn);
  expect(md).toContain("Turn 1");
  expect(md).toContain("classify");
  expect(md).toContain("answer");
  expect(md).toContain("MOVE_ON");
  expect(md).toContain("answer adequate");
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run .../markdownExport.test.ts` → FAIL.

- [ ] **Step 3: Implement**

```ts
// markdownExport.ts
import type { AgentSession, AgentTurn } from "@/features/agent-diagnostics";

export function turnToMarkdown(turn: AgentTurn, notes?: string): string {
  const lines: string[] = [`### Turn ${turn.index} (${turn.kind}) — elapsed ${turn.elapsed_s_at_turn}s`];
  if (turn.candidate_text) lines.push(`**Candidate:** ${turn.candidate_text}`);
  for (const s of turn.steps) {
    lines.push(`\n#### ${s.name} — \`${s.status}\`${s.llm_label ? ` (${s.llm_label})` : ""}`);
    const d = s.detail || {};
    if (d.branch_reason) lines.push(`- why: ${String(d.branch_reason)}`);
    if (d.decision !== undefined) lines.push(`- decision: \`${JSON.stringify(d.decision)}\``);
    if (d.inputs !== undefined) lines.push(`- inputs: \`${JSON.stringify(d.inputs)}\``);
    if (d.prompt_user) lines.push(`- prompt:\n\`\`\`\n${String(d.prompt_user)}\n\`\`\``);
    if (d.raw_response) lines.push(`- response:\n\`\`\`\n${String(d.raw_response)}\n\`\`\``);
  }
  if (notes) lines.push(`\n> Notes: ${notes}`);
  return lines.join("\n");
}

export function sessionToMarkdown(session: AgentSession, notes: Record<number, string> = {}): string {
  const head = [`# Agent Diagnostic — ${session.label}`,
    `status: ${session.status}${session.ended_reason ? ` (${session.ended_reason})` : ""}`, ""];
  const turns = session.turns.map((t) => turnToMarkdown(t, notes[t.index]));
  const logs = ["\n## Logs", "```", ...session._logs.map((l) => `[${l.level}] ${l.message}`), "```"];
  return [...head, ...turns, ...logs].join("\n\n");
}
```

- [ ] **Step 4: Run to verify it passes** — PASS.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/intelligence/_components/agent/markdownExport.ts" "app/(app)/intelligence/_components/agent/__tests__/markdownExport.test.ts"
git commit -m "feat(agent-diag): Copy-as-Markdown serializer for sessions/turns"
```

---

### Task C4: `AgentDiagnosticsPanel` + composer + timeline + tab wiring

**Files:**
- Create: `app/(app)/intelligence/_components/AgentDiagnosticsPanel.tsx`
- Create: `app/(app)/intelligence/_components/agent/TurnComposer.tsx`
- Create: `app/(app)/intelligence/_components/agent/DecisionTimeline.tsx`
- Modify: `app/(app)/intelligence/page.tsx` (add 7th tab)

**Interfaces:**
- Consumes: prep hooks (`useStartPrepRun`, `usePrepRun`) + `RunConsole` for Phase 1; `useStartAgentSession`, `useAgentSession`, `useSubmitTurn`, `useEndAgentSession`, `useAgentSessions`; `RunLogStream`, `TranscriptPanel`; `sessionToMarkdown`.
- Produces: the panel; a `TurnComposer` (text + artifact + advance_seconds + silence, disabled unless `awaiting_input`); a `DecisionTimeline` (renders `turns[].steps` grouped, skipped rows muted).

- [ ] **Step 1: Write a component test for the phase machine + disabled composer**

```tsx
// AgentDiagnosticsPanel.test.tsx  (Testing Library + mocked hooks)
// Mock the hooks module so useAgentSession returns a session in awaiting_input, assert the
// composer submit button is enabled; return running, assert it's disabled.
import { render, screen } from "@testing-library/react";
import { TurnComposer } from "./agent/TurnComposer";

test("composer is disabled unless awaiting_input", () => {
  const { rerender } = render(<TurnComposer status="running" onSubmit={() => {}} onSilence={() => {}} onEnd={() => {}} />);
  expect(screen.getByRole("button", { name: /send/i })).toBeDisabled();
  rerender(<TurnComposer status="awaiting_input" onSubmit={() => {}} onSilence={() => {}} onEnd={() => {}} />);
  expect(screen.getByRole("button", { name: /send/i })).toBeEnabled();
});
```

- [ ] **Step 2: Run to verify it fails** — component missing → FAIL.

- [ ] **Step 3: Implement `TurnComposer`**

```tsx
// app/(app)/intelligence/_components/agent/TurnComposer.tsx
"use client";
import { useState } from "react";
import type { AgentSessionStatus, SubmitTurnBody } from "@/features/agent-diagnostics";

export function TurnComposer({ status, onSubmit, onSilence, onEnd }: {
  status: AgentSessionStatus;
  onSubmit: (b: SubmitTurnBody) => void;
  onSilence: (advanceSeconds: number) => void;
  onEnd: () => void;
}) {
  const [text, setText] = useState("");
  const [artifact, setArtifact] = useState("");
  const [advance, setAdvance] = useState(60);
  const enabled = status === "awaiting_input";
  return (
    <div className="space-y-2">
      <textarea value={text} onChange={(e) => setText(e.target.value)} disabled={!enabled}
                placeholder="Candidate turn…" className="w-full border rounded p-2" />
      <details><summary>Artifact (code/diagram)</summary>
        <textarea value={artifact} onChange={(e) => setArtifact(e.target.value)} disabled={!enabled}
                  className="w-full border rounded p-2 font-mono text-sm" /></details>
      <div className="flex items-center gap-2">
        <label className="text-sm">advance&nbsp;
          <input type="number" value={advance} min={0} onChange={(e) => setAdvance(+e.target.value)}
                 disabled={!enabled} className="w-20 border rounded px-1" />s</label>
        <button disabled={!enabled} onClick={() => {
          onSubmit({ text, advance_seconds: advance,
                     artifact: artifact ? { kind: "code", content: artifact } : undefined });
          setText("");
        }}>Send</button>
        <button disabled={!enabled} onClick={() => onSilence(advance)}>Simulate silence</button>
        <button onClick={onEnd}>End</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Implement `DecisionTimeline`** (reuse `RunTimeline` idiom over `turn.steps`)

```tsx
// app/(app)/intelligence/_components/agent/DecisionTimeline.tsx
"use client";
import type { AgentTurn } from "@/features/agent-diagnostics";

export function DecisionTimeline({ turns, onSelectStep }: {
  turns: AgentTurn[];
  onSelectStep?: (turnIndex: number, stepIndex: number) => void;
}) {
  return (
    <div className="space-y-4">
      {turns.map((t) => (
        <div key={t.index}>
          <div className="text-sm font-medium">Turn {t.index} · {t.kind} · {t.elapsed_s_at_turn}s</div>
          <ol className="ml-4">
            {t.steps.map((s, i) => (
              <li key={i} className={s.status === "skipped" ? "opacity-40" : ""}
                  onClick={() => onSelectStep?.(t.index, i)} style={{ cursor: "pointer" }}>
                <span>{s.name}</span> — <span>{s.status}</span>
                {s.detail?.branch_reason ? <em> · {String(s.detail.branch_reason)}</em> : null}
              </li>
            ))}
          </ol>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Implement `AgentDiagnosticsPanel`** (phase machine: idle → prep → session)

```tsx
// app/(app)/intelligence/_components/AgentDiagnosticsPanel.tsx
"use client";
import { useState } from "react";
import { useJds } from "@/features/jobs";
import { usePrepCandidates, useStartPrepRun, usePrepRun } from "@/features/interview-prep-bench";
import { RunConsole } from "@/components/observability/RunConsole";
import { RunLogStream } from "@/components/observability/RunLogStream";
import { TranscriptPanel } from "@/features/interview-live/work/TranscriptPanel";
import {
  useStartAgentSession, useAgentSession, useSubmitTurn, useEndAgentSession,
} from "@/features/agent-diagnostics";
import { sessionToMarkdown } from "./agent/markdownExport";
import { TurnComposer } from "./agent/TurnComposer";
import { DecisionTimeline } from "./agent/DecisionTimeline";

// copied verbatim from InterviewPrepBenchPanel.tsx:10-11
const SELECT_CLASS = "rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

export function AgentDiagnosticsPanel() {
  const jds = useJds();
  const candidates = usePrepCandidates();
  const [jdId, setJdId] = useState<string>();
  const [candidateId, setCandidateId] = useState<string>();
  const startPrep = useStartPrepRun();
  const [prepRunId, setPrepRunId] = useState<string>();
  const prep = usePrepRun(prepRunId ?? null);
  const startSession = useStartAgentSession();
  const [sessionId, setSessionId] = useState<string>();
  const session = useAgentSession(sessionId ?? null);
  const submit = useSubmitTurn();
  const end = useEndAgentSession();

  const plan = prep.data?.status === "completed" ? prep.data.result : null;

  return (
    <div className="space-y-4">
      {!sessionId && (
        <div className="flex gap-2 items-end">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">Job description</span>
            <select className={SELECT_CLASS} value={jdId ?? ""} onChange={(e) => setJdId(e.target.value)}>
              <option value="">{jds.isLoading ? "Loading roles…" : "Select a role"}</option>
              {(jds.data ?? []).map((jd) => (
                <option key={jd.id} value={jd.id}>{jd.companyName} — {jd.title} ({jd.level})</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">Candidate (optional)</span>
            <select className={SELECT_CLASS} value={candidateId ?? ""} onChange={(e) => setCandidateId(e.target.value)}>
              <option value="">{candidates.isLoading ? "Loading candidates…" : "No candidate (JD-only grounding)"}</option>
              {(candidates.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>{c.name}{c.email ? ` — ${c.email}` : ""}</option>
              ))}
            </select>
          </label>
          <button disabled={!jdId} onClick={() =>
            startPrep.mutate({ jobDescriptionId: jdId!, candidateId },
              { onSuccess: (r) => setPrepRunId(r.run_id) })}>Run prep</button>
          {plan ? (
            <button onClick={() =>
              startSession.mutate(plan, { onSuccess: (r) => setSessionId(r.run_id) })}>
              Start session</button>
          ) : null}
        </div>
      )}

      {prepRunId && !sessionId && prep.data && (
        <RunConsole snapshot={prep.data} resultTitle="Generated InterviewPlan" />
      )}

      {sessionId && session.data && (
        <div className="grid grid-cols-[1fr_2fr] gap-4">
          <div className="space-y-3">
            <TranscriptPanel entries={session.data.transcript}
                             interviewerName={String(session.data.plan_summary.persona_name ?? "Interviewer")} />
            <TurnComposer status={session.data.status}
              onSubmit={(b) => submit.mutate({ runId: sessionId, body: b })}
              onSilence={(adv) => submit.mutate({ runId: sessionId, body: { silence: true, advance_seconds: adv } })}
              onEnd={() => end.mutate(sessionId)} />
            <button onClick={() =>
              navigator.clipboard.writeText(sessionToMarkdown(session.data!, {}))}>Copy as Markdown</button>
            {session.data.status === "completed" || session.data.ended_reason ? (
              <div className="text-sm">Ended: <strong>{session.data.ended_reason ?? session.data.status}</strong></div>
            ) : null}
          </div>
          <div className="space-y-3">
            <DecisionTimeline turns={session.data.turns} />
            <RunLogStream logs={session.data._logs} />
          </div>
        </div>
      )}
    </div>
  );
}
```

> Adapt prop names to the real `RunConsole`/`RunLogStream`/`TranscriptPanel`/`useStartPrepRun` signatures (spec §4.3 lists them). The JD/candidate `<select>`s should be copied from `InterviewPrepBenchPanel.tsx` verbatim.

- [ ] **Step 6: Wire the 7th tab** in `app/(app)/intelligence/page.tsx`

```tsx
// add to the TabsList:
<TabsTrigger value="agent">Agent diagnostics</TabsTrigger>
// add alongside the other TabsContent:
<TabsContent value="agent"><AgentDiagnosticsPanel /></TabsContent>
// and import AgentDiagnosticsPanel at the top.
```

- [ ] **Step 7: Run component tests + typecheck + build**

Run: `npx vitest run app/\(app\)/intelligence/_components && npx tsc --noEmit && npm run build`
Expected: tests PASS, typecheck clean, build succeeds.

- [ ] **Step 8: Commit**

```bash
git add "app/(app)/intelligence"
git commit -m "feat(agent-diag): Agent Diagnostics panel (prep->session, composer, timeline, logs, export) + tab"
```

---

## Phase D — end-to-end verification (Slice 1 acceptance)

### Task D1: Manual E2E against a running stack
- [ ] Start ai-service (with a real `LLM_API_KEY`/model) + backend + frontend.
- [ ] In Intelligence ▸ Agent diagnostics: pick a JD+candidate → **Run prep** → confirm steps/prompts render (reused prep console).
- [ ] **Start session** → confirm opening line(s) appear; status `awaiting_input`.
- [ ] Submit several answers → each `main` turn shows classify/grade/pacing/route/action; `scope` shows `skipped` on non-pivots.
- [ ] Drive `advance_seconds` high across turns → reach `ended_reason ∈ {natural_complete, time_ceiling}`.
- [ ] Fresh session → submit the silence sequence (§6.7) → reach `status:"abandoned"`.
- [ ] On a DSA round, paste code in a turn → grade step detail shows `artifact_used_in_grade:true`.
- [ ] Double-click Send / submit while `running` → `409` (composer stays disabled; no extra turn appears).
- [ ] **End** mid-session → `status:"aborted"` + partial outcome shown.
- [ ] **Copy as Markdown** → paste into an editor; confirm transcript + decisions + prompts + logs are present and readable.
- [ ] Poll a stale/evicted id (restart ai-service, re-poll) → "session expired".

### Task D2: Full regression gate
- [ ] `cd interviewiq-ai-service && pytest -q` → green at the Task A0 baseline count.
- [ ] `cd interviewiq-backend && JAVA_HOME=/opt/homebrew/opt/openjdk@25/libexec/openjdk.jdk/Contents/Home ./mvnw -q test` → green.
- [ ] `cd interviewIQ-frontend && npx tsc --noEmit && npm run build` → clean.
- [ ] Request code review (superpowers:requesting-code-review) on the three branches' diffs before merge.

---

## Deferred to Slice 2 (separate plan)
- `<thought>` capture seam at `llm/client.py::complete` (contextvar keyed by `llm_label`), surfaced per LLM step incl. distinct converse/derive thoughts on PIVOT_DERIVE turns.
- `@xyflow/react` `PipelineCanvas` with live node highlighting, click-detail drawer, per-turn notes; recent-sessions selector UI.
- Per-op capture inside `_apply_action` (converse/derive prompt-in/out).
