"""Keyed, in-memory run store for the admin observability consoles (résumé parse, interview-prep).

Generalizes ``run_store.py``'s single-slot model to many concurrent runs keyed by ``run_id``, each
with a pre-declared, ordered step list (status + timing + per-step detail) and a per-run log ring
buffer. Ephemeral, single-process, LRU-capped, lost on restart — it powers "trigger a pipeline and
watch every step + log" admin consoles via snapshot polling. It is NOT a durable history; persist
to Mongo later if an audit trail is ever needed.

A context-scoped ``PipelineRunLogHandler`` lets a background task's incidental logs (e.g. the LLM
client's ``[llm]`` rotation warnings) land in the right run's buffer without threading ``run_id``
through every call — bind the run at the top of the task, and any ``logger.*`` emitted within that
task's context is captured.
"""
from __future__ import annotations

import contextvars
import logging
import uuid
from collections import OrderedDict, deque
from datetime import datetime, timezone
from threading import Lock
from typing import Any

_MAX_RUNS = 25      # keep the last N runs; oldest non-running run evicted past this
_MAX_LOGS = 2000    # per-run log ring buffer; oldest lines drop

# Set at the top of a run's background task so the log handler can route records to it.
_current_run_id: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "pipeline_run_id", default=None
)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _duration_ms(start_iso: str | None, end_iso: str | None) -> int | None:
    if not start_iso or not end_iso:
        return None
    start = datetime.fromisoformat(start_iso)
    end = datetime.fromisoformat(end_iso)
    return int((end - start).total_seconds() * 1000)


def new_run_id() -> str:
    return uuid.uuid4().hex


class PipelineRunStore:
    """Thread-safe, keyed store of pipeline runs. Steps are pre-declared at ``start_run`` so the
    UI can render the full timeline (pending → running → ok/failed/skipped) from the first poll."""

    def __init__(self, max_runs: int = _MAX_RUNS) -> None:
        self._lock = Lock()
        self._runs: "OrderedDict[str, dict]" = OrderedDict()
        self._max_runs = max_runs

    def start_run(
        self, pipeline: str, source: str, label: str, step_names: list[str], run_id: str | None = None
    ) -> str:
        run_id = run_id or new_run_id()
        with self._lock:
            self._runs[run_id] = {
                "run_id": run_id,
                "pipeline": pipeline,
                "source": source,
                "label": label,
                "status": "running",
                "current_step": None,
                "steps": [self._pending_step(name) for name in step_names],
                "result": None,
                "error": None,
                "started_at": _now_iso(),
                "finished_at": None,
                "_logs": deque(maxlen=_MAX_LOGS),
                "_seq": 0,
            }
            self._runs.move_to_end(run_id)
            self._evict_locked()
            return run_id

    @staticmethod
    def _pending_step(name: str) -> dict:
        return {
            "name": name,
            "status": "pending",
            "started_at": None,
            "finished_at": None,
            "duration_ms": None,
            "detail": {},
        }

    def _evict_locked(self) -> None:
        while len(self._runs) > self._max_runs:
            for rid, rec in list(self._runs.items()):
                if rec["status"] != "running":
                    del self._runs[rid]
                    break
            else:  # every run still active (pathological) — drop the oldest regardless
                self._runs.popitem(last=False)

    @staticmethod
    def _find_step(rec: dict, name: str) -> dict | None:
        for step in rec["steps"]:
            if step["name"] == name:
                return step
        return None

    def begin_step(self, run_id: str, name: str, detail: dict | None = None) -> None:
        with self._lock:
            rec = self._runs.get(run_id)
            if not rec:
                return
            step = self._find_step(rec, name)
            if not step:
                return
            step["status"] = "running"
            step["started_at"] = _now_iso()
            if detail:
                step["detail"].update(detail)
            rec["current_step"] = name

    def end_step(self, run_id: str, name: str, status: str = "ok", detail: dict | None = None) -> None:
        with self._lock:
            rec = self._runs.get(run_id)
            if not rec:
                return
            step = self._find_step(rec, name)
            if not step:
                return
            step["status"] = status
            step["finished_at"] = _now_iso()
            step["duration_ms"] = _duration_ms(step["started_at"], step["finished_at"])
            if detail:
                step["detail"].update(detail)
            if rec["current_step"] == name:
                rec["current_step"] = None

    def log(self, run_id: str, level: str, message: str) -> None:
        with self._lock:
            rec = self._runs.get(run_id)
            if not rec:
                return
            rec["_seq"] += 1
            rec["_logs"].append(
                {"seq": rec["_seq"], "ts": _now_iso(), "level": level, "message": message}
            )

    def set_result(self, run_id: str, result: Any) -> None:
        with self._lock:
            rec = self._runs.get(run_id)
            if rec:
                rec["result"] = result

    def finish(self, run_id: str, status: str, error: dict | None = None) -> None:
        """Terminal transition. On failure, any step still pending becomes ``skipped`` and any
        still running becomes ``failed`` so the timeline reads correctly."""
        with self._lock:
            rec = self._runs.get(run_id)
            if not rec:
                return
            rec["status"] = status
            rec["finished_at"] = _now_iso()
            rec["current_step"] = None
            if error:
                rec["error"] = error
            if status == "failed":
                for step in rec["steps"]:
                    if step["status"] == "pending":
                        step["status"] = "skipped"
                    elif step["status"] == "running":
                        step["status"] = "failed"
                        step["finished_at"] = _now_iso()

    def snapshot(self, run_id: str, after: int = 0) -> dict | None:
        with self._lock:
            rec = self._runs.get(run_id)
            if not rec:
                return None
            logs = [entry for entry in rec["_logs"] if entry["seq"] > after]
            return {
                "run_id": rec["run_id"],
                "pipeline": rec["pipeline"],
                "source": rec["source"],
                "label": rec["label"],
                "status": rec["status"],
                "current_step": rec["current_step"],
                "steps": [dict(step) for step in rec["steps"]],
                "result": rec["result"],
                "error": rec["error"],
                "started_at": rec["started_at"],
                "finished_at": rec["finished_at"],
                "logs": logs,
                "last_seq": rec["_seq"],
            }

    def list_runs(self, pipeline: str | None = None) -> list[dict]:
        with self._lock:
            out: list[dict] = []
            for rec in reversed(self._runs.values()):  # newest first
                if pipeline and rec["pipeline"] != pipeline:
                    continue
                out.append(
                    {
                        "run_id": rec["run_id"],
                        "pipeline": rec["pipeline"],
                        "source": rec["source"],
                        "label": rec["label"],
                        "status": rec["status"],
                        "started_at": rec["started_at"],
                        "finished_at": rec["finished_at"],
                        "step_count": len(rec["steps"]),
                    }
                )
            return out


RUNS = PipelineRunStore()


def bind_run(run_id: str) -> contextvars.Token:
    """Bind ``run_id`` to the current context so PipelineRunLogHandler routes logs to it. Call at
    the top of the run's task; pass the returned token to :func:`unbind_run` in a finally."""
    return _current_run_id.set(run_id)


def unbind_run(token: contextvars.Token) -> None:
    _current_run_id.reset(token)


class PipelineRunLogHandler(logging.Handler):
    """Routes a log record into the run bound to the current context. No-op when no run is bound
    (so it never interferes with the briefs' single-slot RUN_STORE). Never raises."""

    def emit(self, record: logging.LogRecord) -> None:
        run_id = _current_run_id.get()
        if not run_id:
            return
        try:
            RUNS.log(run_id, record.levelname, record.getMessage())
        except Exception:  # noqa: BLE001 — logging must never break the pipeline
            pass
