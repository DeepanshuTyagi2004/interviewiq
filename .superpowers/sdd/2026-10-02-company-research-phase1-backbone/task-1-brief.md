## Task 1: Research settings and shared vocabulary

**Files:**
- Modify: `apps/ai-service/app/config.py`
- Create: `apps/ai-service/app/research/__init__.py`, `apps/ai-service/app/research/models.py`
- Test: `apps/ai-service/tests/research/__init__.py`, `apps/ai-service/tests/research/test_research_config.py`, `apps/ai-service/tests/research/test_models.py`

**Interfaces:**
- Produces:
  - `Settings.research_*` fields.
  - `RunStatus`, `ItemStatus`, `Control`, `Mode` (`StrEnum`).
  - `ACTIVE_RUN_STATUSES`, `NODE_ORDER`, `PIPELINE_VERSION`.
  - `field(value, *, confidence, provenance, source_urls=(), note=None) -> dict` and `unavailable(note=None) -> dict`.
  - `InvalidTransition` and `check_transition(status: str, action: Literal["pause","resume","stop"]) -> None`.

- [ ] **Step 1: Write the failing tests**

`apps/ai-service/tests/research/__init__.py`: an empty file.

`apps/ai-service/tests/research/test_research_config.py`:

```python
import pytest
from pydantic import ValidationError

from app.config import Settings


def test_research_defaults():
    s = Settings(_env_file=None)
    assert s.research_enabled is True
    assert s.research_cron == "0 2 * * mon"
    assert s.research_mode == "live"
    assert s.research_fixtures_dir == ".research-fixtures"
    assert (s.research_concurrency, s.research_results_per_query, s.research_max_roles) == (2, 5, 8)
    assert (s.research_max_exa_calls, s.research_max_llm_calls) == (400, 2000)
    assert (s.research_stale_after_days, s.research_max_attempts, s.research_trace_ttl_days) == (7, 2, 14)


def test_research_mode_must_be_known(monkeypatch):
    monkeypatch.setenv("RESEARCH_MODE", "dry-run")
    with pytest.raises(ValidationError):
        Settings(_env_file=None)
```

`apps/ai-service/tests/research/test_models.py`:

```python
import pytest

from app.research.models import (
    ACTIVE_RUN_STATUSES,
    NODE_ORDER,
    InvalidTransition,
    RunStatus,
    check_transition,
    field,
    unavailable,
)


def test_field_shape():
    f = field("Meesho", confidence="high", provenance="evidence", source_urls=("https://meesho.com",))
    assert f == {
        "value": "Meesho", "confidence": "high", "provenance": "evidence",
        "source_urls": ["https://meesho.com"], "note": None,
    }


def test_unavailable_is_an_empty_low_confidence_field():
    assert unavailable("no data") == {
        "value": None, "confidence": "low", "provenance": "unavailable", "source_urls": [], "note": "no data",
    }


def test_paused_run_still_holds_the_active_slot():
    assert RunStatus.PAUSED in ACTIVE_RUN_STATUSES
    assert RunStatus.COMPLETED not in ACTIVE_RUN_STATUSES
    assert RunStatus.STOPPED not in ACTIVE_RUN_STATUSES


def test_phase_one_node_order():
    assert NODE_ORDER == ("resolve", "write_draft")


@pytest.mark.parametrize("status,action", [
    ("running", "pause"), ("queued", "pause"), ("paused", "resume"),
    ("pausing", "stop"), ("paused", "stop"), ("running", "stop"),
])
def test_allowed_transitions(status, action):
    check_transition(status, action)


@pytest.mark.parametrize("status,action", [
    ("paused", "pause"), ("running", "resume"), ("pausing", "resume"),
    ("completed", "stop"), ("stopped", "resume"), ("failed", "pause"),
])
def test_rejected_transitions(status, action):
    with pytest.raises(InvalidTransition):
        check_transition(status, action)
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/ai-service && .venv/bin/python -m pytest tests/research -q`
Expected: FAIL. The config test fails with an `AttributeError` for `research_enabled`, and `test_models` fails with `ModuleNotFoundError: No module named 'app.research'`.

- [ ] **Step 3: Add the settings**

In `apps/ai-service/app/config.py`, change the typing import to:

```python
from typing import Annotated, Literal
```

Then insert this block directly after the `brief_inter_call_delay_seconds` field:

```python
    # --- Company research pipeline (app/research; spec 2026-10-02) ---
    research_enabled: bool = Field(True, alias="RESEARCH_ENABLED")
    # Weekly run, APScheduler crontab syntax, Asia/Kolkata. Use day NAMES ("mon"): APScheduler numbers
    # weekdays from Monday=0, unlike cron, so digits are a trap.
    research_cron: str = Field("0 2 * * mon", alias="RESEARCH_CRON")
    # live = real Exa/LLM; record = live + save every response to RESEARCH_FIXTURES_DIR;
    # replay = serve ONLY from saved fixtures (free, deterministic, offline).
    research_mode: Literal["live", "record", "replay"] = Field("live", alias="RESEARCH_MODE")
    research_fixtures_dir: str = Field(".research-fixtures", alias="RESEARCH_FIXTURES_DIR")
    research_concurrency: int = Field(2, alias="RESEARCH_CONCURRENCY", ge=1)
    research_results_per_query: int = Field(5, alias="RESEARCH_RESULTS_PER_QUERY", ge=1)
    research_stale_after_days: int = Field(7, alias="RESEARCH_STALE_AFTER_DAYS", ge=0)
    research_max_roles: int = Field(8, alias="RESEARCH_MAX_ROLES", ge=1)
    # Per-run caps; reaching one auto-pauses the run (raise the cap in the UI, then resume).
    research_max_exa_calls: int = Field(400, alias="RESEARCH_MAX_EXA_CALLS", ge=0)
    research_max_llm_calls: int = Field(2000, alias="RESEARCH_MAX_LLM_CALLS", ge=0)
    # Crash-loop guard: a company found mid-run after this many restarts is failed, not retried.
    research_max_attempts: int = Field(2, alias="RESEARCH_MAX_ATTEMPTS", ge=1)
    research_trace_ttl_days: int = Field(14, alias="RESEARCH_TRACE_TTL_DAYS", ge=1)
```

- [ ] **Step 4: Write the vocabulary module**

`apps/ai-service/app/research/__init__.py`:

```python
"""Company research pipeline (spec: docs/superpowers/specs/2026-10-02-company-research-pipeline-design.md)."""
```

`apps/ai-service/app/research/models.py`:

```python
"""Shared vocabulary for the company research pipeline (spec §5): run and item states, admin
controls, research modes, the node order, and the `Field` shape every draft-snapshot leaf uses.
Pure: no I/O, safe to import anywhere."""
from __future__ import annotations

from enum import StrEnum
from typing import Any, Literal

PIPELINE_VERSION = "research-v1"


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


# Phase 1 graph. Later phases insert profile / compensation / roles / interview_process / reconcile /
# tier between these two. Mirrored in apps/web/lib/constants/research/index.ts: keep in sync.
NODE_ORDER: tuple[str, ...] = ("resolve", "write_draft")

Confidence = Literal["high", "medium", "low"]
Provenance = Literal["evidence", "derived", "inferred_from_similar", "template", "unavailable", "admin_override"]


def field(value: Any, *, confidence: Confidence, provenance: Provenance,
          source_urls: list[str] | tuple[str, ...] = (), note: str | None = None) -> dict:
    """One snapshot leaf (spec §4.2): the value, how far to trust it, and where it came from."""
    return {
        "value": value,
        "confidence": confidence,
        "provenance": provenance,
        "source_urls": list(source_urls),
        "note": note,
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
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd apps/ai-service && .venv/bin/python -m pytest tests/research tests/test_config.py -q`
Expected: PASS.

- [ ] **Step 6: Checkpoint**

Run `git status`. The changes stay in the working tree; the user commits.

---

