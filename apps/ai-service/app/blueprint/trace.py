"""The diagnostic trace of one blueprint run (spec §6, §10): per-stage status, timings, summaries,
details and every LLM call (prompts, raw reply, validation, repairs, provider, tokens, latency).
Kept in memory during the run and flushed to `blueprint_runs` at each stage transition."""
from __future__ import annotations

import time
from typing import Any

from app.blueprint import store
from app.blueprint.vocabulary import STAGE_LABELS, STAGES

_MAX_TEXT = 30_000


class StageError(Exception):
    """A run failure with a stable code (spec §12)."""

    def __init__(self, code: str, message: str, partial=None):
        super().__init__(f"{code}: {message}")
        self.code = code
        self.message = message
        self.partial = partial  # the last schema-valid output that failed only the extra check, if any


def _clip(text: Any) -> Any:
    if isinstance(text, str) and len(text) > _MAX_TEXT:
        return text[:_MAX_TEXT] + f"\n… [{len(text) - _MAX_TEXT} more characters]"
    return text


class RunTrace:
    def __init__(self, run_id: str):
        self.run_id = run_id
        self.stages: list[dict] = [
            {"id": s, "label": STAGE_LABELS[s], "status": "pending", "started_at": None, "ended_at": None,
             "duration_ms": None, "summary": {}, "detail": {}, "llm_calls": [], "error": None}
            for s in STAGES
        ]
        self._t0: dict[str, float] = {}
        self.current: str | None = None

    def _stage(self, stage_id: str) -> dict:
        return next(s for s in self.stages if s["id"] == stage_id)

    async def flush(self) -> None:
        await store.update_run(self.run_id, {"stages": self.stages, "stage": self.current})

    async def start(self, stage_id: str) -> None:
        st = self._stage(stage_id)
        st.update(status="running", started_at=store.iso())
        self._t0[stage_id] = time.monotonic()
        self.current = stage_id
        await self.flush()

    def _close(self, st: dict, status: str) -> None:
        st["status"] = status
        st["ended_at"] = store.iso()
        if st["id"] in self._t0:
            st["duration_ms"] = int((time.monotonic() - self._t0[st["id"]]) * 1000)

    async def done(self, stage_id: str, summary: dict | None = None, detail: dict | None = None) -> None:
        st = self._stage(stage_id)
        if summary:
            st["summary"].update(summary)
        if detail:
            st["detail"].update(detail)
        self._close(st, "done")
        await self.flush()

    async def skip(self, stage_id: str, reason: str) -> None:
        st = self._stage(stage_id)
        st["summary"]["skipped"] = reason
        self._close(st, "skipped")
        await self.flush()

    async def fail(self, stage_id: str | None, code: str, message: str) -> None:
        if stage_id is None:
            return
        st = self._stage(stage_id)
        st["error"] = {"code": code, "message": message[:2000]}
        self._close(st, "failed")
        await self.flush()

    def note(self, stage_id: str, **detail: Any) -> None:
        self._stage(stage_id)["detail"].update(detail)

    def llm(self, stage_id: str, record: dict) -> None:
        clipped = {k: _clip(v) for k, v in record.items()}
        self._stage(stage_id)["llm_calls"].append(clipped)

    def steps(self) -> list[dict]:
        """Compact progress for the API's live stepper."""
        out = []
        for s in self.stages:
            state = {"done": "done", "skipped": "done", "running": "active", "failed": "failed"}.get(s["status"], "pending")
            out.append({"id": s["id"], "state": state, "elapsed_ms": s["duration_ms"]})
        return out


def steps_of(stages: list[dict] | None) -> list[dict]:
    """The same compact progress, read from a stored run."""
    out = []
    for s in stages or []:
        state = {"done": "done", "skipped": "done", "running": "active", "failed": "failed"}.get(s.get("status"), "pending")
        elapsed = s.get("duration_ms")
        out.append({"id": s.get("id"), "state": state, "elapsed_ms": elapsed})
    return out
