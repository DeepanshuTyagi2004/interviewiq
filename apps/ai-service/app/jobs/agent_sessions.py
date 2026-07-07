"""In-memory keyed store for interactive agent-diagnostic sessions. Sibling to
pipeline_runs.PipelineRunStore, sharing its seq-cursor / ring-buffer / LRU conventions
(and its ISO-8601 timestamp format, so the frontend's RunLogStream / RunLogEntry types
render identically) but modelling an interactive turn->step tree. Ephemeral: lost on
restart. A session in a non-terminal status (running / awaiting_input) is NEVER evicted;
evicting a terminal session cancels any attached, not-yet-done task defensively.

Mutators fetch with ``self._runs.get(run_id)`` and no-op silently on an unknown/evicted
run_id (mirroring pipeline_runs), so the runner driving these across ``await`` points can
never crash on a session that was evicted between calls."""
from __future__ import annotations

import threading
from collections import OrderedDict, deque
from datetime import datetime, timezone
from typing import Any

_MAX_RUNS = 25
_MAX_LOGS = 2000
_TERMINAL = {"completed", "failed", "abandoned", "aborted"}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _duration_ms(start_iso: str | None, end_iso: str | None) -> int | None:
    if not start_iso or not end_iso:
        return None
    start = datetime.fromisoformat(start_iso)
    end = datetime.fromisoformat(end_iso)
    return int((end - start).total_seconds() * 1000)


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
                "started_at": _now_iso(),
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
            "steps": [], "started_at": _now_iso(), "finished_at": None,
            "duration_ms": None, "elapsed_s_at_turn": elapsed,
        }

    def open_turn(self, run_id, kind, candidate_text, artifact_present_this_turn,
                  artifact_available, elapsed_s_at_turn) -> int:
        with self._lock:
            r = self._runs.get(run_id)
            if not r:
                return -1
            # close the previous turn's timing
            if r["turns"]:
                prev = r["turns"][-1]
                if prev["finished_at"] is None:
                    prev["finished_at"] = _now_iso()
                    prev["duration_ms"] = _duration_ms(prev["started_at"], prev["finished_at"])
            idx = len(r["turns"])
            r["turns"].append(self._new_turn(idx, kind, candidate_text,
                                             artifact_present_this_turn, artifact_available,
                                             elapsed_s_at_turn))
            r["current_turn"] = idx
            return idx

    # ---- steps -----------------------------------------------------------
    def begin_step(self, run_id, name, llm_label=None) -> None:
        with self._lock:
            r = self._runs.get(run_id)
            if not r:
                return
            r["current_step"] = name
            r["turns"][-1]["steps"].append({
                "name": name, "status": "running", "llm_label": llm_label,
                "started_at": _now_iso(), "finished_at": None, "duration_ms": None, "detail": {},
            })

    def end_step(self, run_id, status, detail) -> None:
        with self._lock:
            r = self._runs.get(run_id)
            if not r:
                return
            step = r["turns"][-1]["steps"][-1]
            step["status"] = status
            step["finished_at"] = _now_iso()
            step["duration_ms"] = _duration_ms(step["started_at"], step["finished_at"])
            step["detail"] = {**step.get("detail", {}), **(detail or {})}
            r["current_step"] = None

    def emit_skipped(self, run_id, name) -> None:
        with self._lock:
            r = self._runs.get(run_id)
            if not r:
                return
            r["turns"][-1]["steps"].append({
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
            r["_logs"].append({"seq": r["_seq"], "ts": _now_iso(),
                               "level": level, "message": message})

    def append_transcript(self, run_id, speaker, text) -> None:
        with self._lock:
            r = self._runs.get(run_id)
            if not r:
                return
            r["transcript"].append({"speaker": speaker, "text": text})

    # ---- terminal --------------------------------------------------------
    def set_result(self, run_id, outcome, ended_reason) -> None:
        with self._lock:
            r = self._runs.get(run_id)
            if not r:
                return
            r["result"] = outcome
            r["ended_reason"] = ended_reason

    def fail(self, run_id, step, error) -> None:
        with self._lock:
            r = self._runs.get(run_id)
            if not r:
                return
            r["status"] = "failed"
            r["error"] = {"step": step, "type": type(error).__name__, "message": str(error)}
            r["finished_at"] = _now_iso()

    def finish(self, run_id, status) -> None:
        with self._lock:
            r = self._runs.get(run_id)
            if not r:
                return
            r["status"] = status
            r["finished_at"] = _now_iso()

    # ---- status / tasks --------------------------------------------------
    def set_status(self, run_id, status) -> None:
        with self._lock:
            r = self._runs.get(run_id)
            if not r:
                return
            r["status"] = status

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
