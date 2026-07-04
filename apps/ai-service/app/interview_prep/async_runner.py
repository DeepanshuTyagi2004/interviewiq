"""Fire-and-poll wrapper around the PRODUCTION interview-plan pipeline.

The backend's prep trigger can't hold one HTTP call open for a whole plan generation: Stage 2 fires
three concurrent LLM reasoning calls, and on a slower model the tail can run past the client read
timeout, surfacing as a transport error that wrongly marks the session PREP_FAILED. So the backend
POSTs to *start* a run — which executes :func:`generate_interview_plan` (the real path: cache-gated
and persisted) in the background — gets a ``run_id`` back immediately, then polls a fast status
endpoint until the run reaches a terminal state. Every HTTP call is then short.

The run store here is a tiny in-memory, LRU-capped, single-process map of ``run_id -> {status, plan,
error}``. It is deliberately NOT the admin observability ``RUNS`` store: keeping them separate means
a burst of scheduled prep runs can't evict an admin's bench run from that 25-slot cap, and the
backend poll only needs terminal status + the finished plan (or a structured error), not per-stage
timing. Runs are poll-then-forget; nothing is persisted *here* (the plan itself IS persisted to
Mongo by the pipeline). Lost on restart — an in-flight run started before a restart simply 404s on
the next poll and the scheduler re-triggers it next tick.

Single-process assumption: like the admin console's ``RUNS`` store, start and poll must land on the
same worker. The ai-service runs a single uvicorn worker today; revisit if it is ever scaled out.
"""
from __future__ import annotations

import logging
import uuid
from collections import OrderedDict
from threading import Lock
from typing import Any

from app.config import Settings
from app.interview_prep.pipeline import PrepDataError, generate_interview_plan
from app.interview_prep.schema import GenerateInterviewPlanRequest
from app.llm.client import LLMError

logger = logging.getLogger(__name__)

_MAX_RUNS = 100  # poll-then-forget; keep the last N, oldest dropped


class _PlanRunStore:
    """Thread-safe map of production plan-gen runs. A run is ``running`` until the background task
    calls :meth:`complete` (with the plan doc) or :meth:`fail` (with a code + message)."""

    def __init__(self, max_runs: int = _MAX_RUNS) -> None:
        self._lock = Lock()
        self._runs: "OrderedDict[str, dict]" = OrderedDict()
        self._max_runs = max_runs

    def create(self) -> str:
        run_id = uuid.uuid4().hex
        with self._lock:
            self._runs[run_id] = {"run_id": run_id, "status": "running", "plan": None, "error": None}
            self._runs.move_to_end(run_id)
            while len(self._runs) > self._max_runs:
                self._runs.popitem(last=False)
        return run_id

    def complete(self, run_id: str, plan: dict) -> None:
        with self._lock:
            rec = self._runs.get(run_id)
            if rec:
                rec["status"] = "completed"
                rec["plan"] = plan

    def fail(self, run_id: str, code: str, message: str) -> None:
        with self._lock:
            rec = self._runs.get(run_id)
            if rec:
                rec["status"] = "failed"
                rec["error"] = {"code": code, "message": message}

    def get(self, run_id: str) -> dict[str, Any] | None:
        with self._lock:
            rec = self._runs.get(run_id)
            return dict(rec) if rec else None


PLAN_RUNS = _PlanRunStore()


async def run_plan_async(req: GenerateInterviewPlanRequest, run_id: str, settings: Settings) -> None:
    """Run the production plan pipeline and record its terminal state in :data:`PLAN_RUNS`.

    Maps the same failure modes the synchronous route maps to HTTP: ``PrepDataError`` -> ``no_data``
    (the 422 case), ``LLMError`` -> ``llm_error`` (the 502 case), anything else -> ``unexpected``.
    Never raises — a background task must not die silently mid-flight without recording a status."""
    session_id = req.session.session_id
    try:
        plan = await generate_interview_plan(req, settings)
        PLAN_RUNS.complete(run_id, plan)
        logger.info("[prep-async] plan ready for session %s (run %s)", session_id, run_id)
    except PrepDataError as exc:
        PLAN_RUNS.fail(run_id, "no_data", str(exc))
        logger.info("[prep-async] no data for session %s (run %s): %s", session_id, run_id, exc)
    except LLMError as exc:
        PLAN_RUNS.fail(run_id, "llm_error", str(exc))
        logger.warning("[prep-async] LLM failure for session %s (run %s): %s", session_id, run_id, exc)
    except Exception as exc:  # noqa: BLE001 — record, don't crash the background task
        logger.exception("[prep-async] unexpected failure for run %s", run_id)
        PLAN_RUNS.fail(run_id, "unexpected", str(exc))
