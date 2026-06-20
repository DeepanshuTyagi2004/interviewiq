"""In-memory state for the current/last pipeline run + a verbose log buffer.

This is deliberately ephemeral and single-process: it powers the live ingestion
view (trigger + watch). It is NOT a run history — only the most recent run is kept,
and it is lost on restart. That's fine for monitoring; persist to Mongo later if a
durable audit trail is ever needed.

A logging.Handler (RunLogHandler) pipes every log record emitted while a run is
active into the buffer, so the UI sees the same verbose logs the server logs.
"""
from __future__ import annotations

import logging
import uuid
from collections import deque
from datetime import datetime, timezone
from threading import Lock
from typing import Any

_MAX_LOGS = 2000  # ponytail: ring buffer; oldest lines drop. Raise if a run is chattier.


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_run_id() -> str:
    return uuid.uuid4().hex


class RunStore:
    def __init__(self) -> None:
        self._lock = Lock()
        self._seq = 0
        self._logs: deque[dict] = deque(maxlen=_MAX_LOGS)
        self.run_id: str | None = None
        self.status: str = "idle"          # idle | running | completed | failed
        self.trigger: str | None = None    # "manual" | "scheduler"
        self.started_at: str | None = None
        self.finished_at: str | None = None
        self.stage: str | None = None
        self.stages: dict[str, Any] = {}   # stage -> result dict
        self.error: str | None = None
        self._cancel = False               # cooperative stop flag
        # Per-combination detail for the verbose UI: prompt, raw response, citations,
        # parsed brief, the doc stored in Mongo, status. Keyed by combo label.
        self._combos: dict[str, dict] = {}

    def is_running(self) -> bool:
        return self.status == "running"

    def request_cancel(self) -> bool:
        """Ask the active run to stop after the current item. Returns True if a run was running."""
        with self._lock:
            if self.status != "running":
                return False
            self._cancel = True
            return True

    def is_cancelled(self) -> bool:
        with self._lock:
            return self._cancel

    def start(self, run_id: str, trigger: str) -> bool:
        """Claim the single run slot. Returns False if a run is already active."""
        with self._lock:
            if self.status == "running":
                return False
            self.run_id = run_id
            self.status = "running"
            self.trigger = trigger
            self.started_at = _now_iso()
            self.finished_at = None
            self.stage = None
            self.stages = {}
            self.error = None
            self._cancel = False
            self._combos = {}
            self._logs.clear()
            self._seq = 0
            return True

    def record_combo(self, label: str, **fields) -> None:
        """Merge verbose detail (status/brief/stored_doc/...) for one combination into
        the current run. No-op when not running (e.g. a synchronous /refresh)."""
        with self._lock:
            if self.status != "running":
                return
            rec = self._combos.setdefault(label, {"combo": label})
            rec.update(fields)

    def add_combo_request(self, label: str, *, prompt: str, raw_response: str, citations: list) -> None:
        """Append ONE Perplexity request (prompt + raw response + citations) to a
        combination. Every request is kept — a retry adds a second entry, not overwrite."""
        with self._lock:
            if self.status != "running":
                return
            rec = self._combos.setdefault(label, {"combo": label})
            rec.setdefault("requests", []).append({
                "prompt": prompt,
                "raw_response": raw_response,
                "citations": citations,
                "ts": _now_iso(),
            })

    def set_stage(self, stage: str) -> None:
        with self._lock:
            self.stage = stage

    def record_stage_result(self, stage: str, result: dict) -> None:
        with self._lock:
            self.stages[stage] = result

    def finish(self, status: str, error: str | None = None) -> None:
        with self._lock:
            self.status = status
            self.finished_at = _now_iso()
            self.stage = None
            self.error = error

    def append_log(self, level: str, logger_name: str, message: str) -> None:
        with self._lock:
            self._seq += 1
            self._logs.append(
                {"seq": self._seq, "ts": _now_iso(), "level": level, "logger": logger_name, "message": message}
            )

    def snapshot(self, after: int = 0) -> dict:
        """Current run state + log lines with seq > `after` (incremental polling)."""
        with self._lock:
            logs = [entry for entry in self._logs if entry["seq"] > after]
            return {
                "run_id": self.run_id,
                "status": self.status,
                "trigger": self.trigger,
                "stage": self.stage,
                "started_at": self.started_at,
                "finished_at": self.finished_at,
                "stages": dict(self.stages),
                "error": self.error,
                "combos": list(self._combos.values()),
                "logs": logs,
                "last_seq": self._seq,
            }


RUN_STORE = RunStore()


class RunLogHandler(logging.Handler):
    """Routes log records into RUN_STORE while a run is active. Never raises."""

    def emit(self, record: logging.LogRecord) -> None:
        if not RUN_STORE.is_running():
            return
        try:
            RUN_STORE.append_log(record.levelname, record.name, record.getMessage())
        except Exception:  # noqa: BLE001 — logging must never break the pipeline
            pass
