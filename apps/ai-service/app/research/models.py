"""Shared vocabulary for the company research pipeline (spec §5): run and item states, admin
controls, research modes, the node order, and the `Field` shape every draft-snapshot leaf uses.
Pure: no I/O, safe to import anywhere."""
from __future__ import annotations

from enum import StrEnum
from typing import Any, Literal

PIPELINE_VERSION = "research-v5-overview"


class RunStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    PAUSING = "pausing"
    PAUSED = "paused"
    STOPPING = "stopping"
    STOPPED = "stopped"
    COMPLETED = "completed"
    FAILED = "failed"


# A run in any of these statuses holds the single "active run" slot (spec §5.2). A paused run counts:
# it must be resumed or stopped before another run can start.
ACTIVE_RUN_STATUSES: frozenset[str] = frozenset({
    RunStatus.QUEUED, RunStatus.RUNNING, RunStatus.PAUSING, RunStatus.PAUSED, RunStatus.STOPPING,
})


class ItemStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    PAUSED = "paused"
    DONE = "done"
    FAILED = "failed"
    SKIPPED = "skipped"
    CANCELLED = "cancelled"


class Control(StrEnum):
    NONE = "none"
    PAUSE = "pause"
    STOP = "stop"


class Mode(StrEnum):
    LIVE = "live"
    RECORD = "record"
    REPLAY = "replay"


# Overview suggestions only; detailed enrichment is human-authored in the admin API.
# Mirrored in apps/web/lib/constants/research/index.ts: keep in sync.
NODE_ORDER: tuple[str, ...] = ("resolve", "profile", "write_draft")

Confidence = Literal["high", "medium", "low"]
Provenance = Literal["evidence", "derived", "inferred_from_similar", "template", "unavailable", "admin_override"]


def field(value: Any, *, confidence: Confidence, provenance: Provenance,
          source_urls: list[str] | tuple[str, ...] = (), note: str | None = None,
          alternatives: list[dict] | tuple[dict, ...] | None = None, as_of: str | None = None) -> dict:
    """One snapshot leaf (spec §4.2): the value, how far to trust it, and where it came from.
    `alternatives` lists the values other sources reported ({value, source_urls, as_of}); `as_of` is
    the newest supporting source's date (evidence-hardening spec §9)."""
    return {
        "value": value,
        "confidence": confidence,
        "provenance": provenance,
        "source_urls": list(source_urls),
        "note": note,
        "alternatives": list(alternatives or []),
        "as_of": as_of,
    }


def unavailable(note: str | None = None) -> dict:
    """No data. The field stays empty; it is never guessed (spec §6.3)."""
    return field(None, confidence="low", provenance="unavailable", note=note)


class InvalidTransition(ValueError):
    """An admin control that does not apply to the run's current status (HTTP 409)."""


_ALLOWED_FROM: dict[str, frozenset[str]] = {
    "pause": frozenset({RunStatus.QUEUED, RunStatus.RUNNING}),
    "resume": frozenset({RunStatus.PAUSED}),
    "stop": frozenset({RunStatus.QUEUED, RunStatus.RUNNING, RunStatus.PAUSING, RunStatus.PAUSED}),
}


def check_transition(status: str, action: str) -> None:
    allowed = _ALLOWED_FROM[action]
    if status not in allowed:
        raise InvalidTransition(
            f"cannot {action} a run that is {status} (allowed from: {', '.join(sorted(allowed))})"
        )
