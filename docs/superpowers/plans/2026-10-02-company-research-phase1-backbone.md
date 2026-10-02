# Company Research — Phase 1 (Backbone) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the research pipeline's backbone end to end:
- admins add companies;
- a LangGraph run per company (`resolve` → `write_draft`) can be started, paused, resumed and stopped from the UI, survives restarts, and respects budget caps;
- every step is traced at full verbosity into an admin-only debugger with copy-for-Claude.

**Architecture:**
- `apps/ai-service/app/research/` holds the runner, the per-company LangGraph, the tracer and the `ResearchIO` gateway (Exa + LLM with record/replay, budget and extract cache). State lives in Mongo collections behind a `ResearchStore` protocol.
- `apps/api` owns the company catalogue (Postgres), admin CRUD and the authenticated proxies.
- `apps/web` adds Companies and Runs tabs to `/intelligence`.

**Tech Stack:** Python 3.12, FastAPI, Motor, LangGraph 1.2.12 (already installed; `InMemorySaver` plus state saved on the item), APScheduler 3. Node 22, Express 5, Drizzle 0.45, Vitest + PGlite. Next.js 16, React 19, TanStack Query 5, Tailwind 3, `@monaco-editor/react`, `@xyflow/react`, sonner.

**Spec:** `docs/superpowers/specs/2026-10-02-company-research-pipeline-design.md` (Phase 1 row of §13). Read §3, §4.2, §5, §9.1 and §10 before starting.

## Global Constraints

- **No commits.** The user commits their own work (standing rule). Every task ends with a "Checkpoint" step (`git status` plus tests green), never `git commit`.
- **No Docker.** Run everything on the host against Supabase and the Atlas dev database.
- **No new runtime dependencies** in any app. LangGraph is already in `apps/ai-service/requirements.txt`. Do **not** add `langgraph-checkpoint-mongodb`.
- **ai-service tests are synchronous.** They use `asyncio.run(...)`. The repo has no `asyncio_mode`, so never use `@pytest.mark.asyncio`.
- **Run ai-service tests** from `apps/ai-service` with `.venv/bin/python -m pytest -q`.
- **Run API tests** with `pnpm --filter @interviewiq/api test`; **web tests** with `pnpm --filter @interviewiq/web test`.
- **Error envelope** everywhere: `{ "code": string, "message": string }`.
- **JSON casing:**
  - Research proxy payloads stay **snake_case**: the API passes ai-service JSON through, the same as the existing `/intelligence/*` proxies.
  - Admin company payloads are **camelCase**: API-owned, like the rest of the catalogue.
- **Contract first:** `packages/contracts/openapi.yaml` is the source of truth. Web types come from `pnpm contracts:types`, never hand-written DTO types.
- **Copy rules:**
  - Write "resume", never "résumé".
  - No "badge" or "certified" wording.
  - Orange (`brand`) is the only accent colour.
  - Use the existing HUD primitives (`@/components/hud`) and observability pieces (`@/components/observability/*`).
- **`LEVELS` is unchanged in Phase 1.** The 7-level ladder is Phase 3.
- **Slugs must be identical in Python and TypeScript:** NFKD-fold, drop non-ASCII, lowercase, `&` → ` and `, non-alphanumerics → `-`, trim `-`.
- **`NODE_ORDER = ("resolve", "write_draft")`** in `app/research/models.py` is mirrored in `apps/web/lib/constants/research/index.ts`. Keep the two in sync.

## Review Focus

These are the inputs most likely to bite real users that no task's happy-path tests would catch. Each one has a test in the task that owns the code.

1. **Pause while a company is in its last node** (`write_draft`): the company finishes as `done` rather than being parked and re-run later. Task 8 covers this: `test_pause_during_last_node_lets_the_company_finish`.
2. **A company archived or deleted after the run was queued:** the item ends `skipped` with a clear message, and the run doesn't crash. Task 8: `test_company_archived_after_queueing_is_skipped`.
3. **Two quick clicks on Start:** exactly one run starts, and the other click gets `RunActive` (409). Task 8: `test_concurrent_starts_create_exactly_one_run`.
4. **Opening the console for a run with more than 2,000 events:** it shows the **newest** rows, and "Load older" fetches the previous page. Task 14: `initialAfterSeq`, `olderPageQuery` tests.
5. **A secret echoed back in an upstream error message** (e.g. Exa's 401 text containing the key): redacted in span errors, events and item errors. Task 8: `test_secrets_in_upstream_errors_are_redacted_everywhere`.

---

## File Structure

### apps/ai-service

| File | Responsibility |
|---|---|
| `app/config.py` (modify) | `RESEARCH_*` settings |
| `app/llm/client.py` (modify) | `LLMResult` and `complete_full()` (raw content, usage, key index, attempts); `complete()` unchanged |
| `app/research/__init__.py` | Package marker |
| `app/research/models.py` | Run/item/control/mode enums, `NODE_ORDER`, `field()`/`unavailable()`, transition rules |
| `app/research/store.py` | `ResearchStore` protocol, `EventFilter`, `event_matches`, `MongoResearchStore`, `ensure_research_indexes` |
| `app/research/memory_store.py` | `InMemoryResearchStore` (tests and `cli --memory`) |
| `app/research/trace/__init__.py` | Package marker |
| `app/research/trace/context.py` | Context variables: tracer, span, company, node |
| `app/research/trace/redact.py` | `redact()`, `secrets_from_settings()` |
| `app/research/trace/errors.py` | `error_info()`, `code_ref()` |
| `app/research/trace/tracer.py` | `Tracer` (spans, buffered events, payload offload), `hydrate_span()` |
| `app/research/trace/log_handler.py` | `ResearchLogHandler`: Python logs → trace events |
| `app/research/fixtures.py` | `FixtureStore` for record/replay; `FixtureMissing` |
| `app/research/budget.py` | `Budget`, `BudgetExhausted` |
| `app/research/gateway.py` | `ResearchIO.search()` / `.extract_json()` |
| `app/research/normalize/__init__.py` | Package marker |
| `app/research/normalize/identity.py` | `slugify`, `name_key`, `domain_of`, `find_possible_duplicates` |
| `app/research/drafts.py` | `snapshot_diff()` |
| `app/prompts/research/__init__.py` | Package marker |
| `app/prompts/research/resolve_company.py` | Resolve prompt (DRAFT v1, for human review) |
| `app/research/nodes/__init__.py` | Package marker |
| `app/research/nodes/resolve.py` | `resolve` node |
| `app/research/nodes/write_draft.py` | `write_draft` node |
| `app/research/graph.py` | `CompanyState`, `NodeDeps`, `build_company_graph()` |
| `app/research/targets.py` | `ResearchTarget`, `fetch_research_targets()`, `TargetsUnavailable` |
| `app/research/runner.py` | `ResearchRunner` (start, pause, resume, stop, budget, recovery, drive loop) |
| `app/research/api.py` | FastAPI `/research/*` router |
| `app/research/wiring.py` | `build_research_runner()` |
| `app/research/cli.py` | `python -m app.research.cli run …` |
| `app/jobs/scheduler.py` (modify) | Weekly research cron job |
| `app/main.py` (modify) | Wire runner, indexes, recovery, log handler, router |
| `tests/research/*` | Tests per module plus `fakes.py` and `helpers.py` |

### apps/api

| File | Responsibility |
|---|---|
| `src/db/pg/schema.ts` (modify) | New `companies` and `job_descriptions` columns |
| `drizzle/0002_company_research.sql` (generated, then edited) | Migration plus backfill |
| `src/domain/slug.ts` | `slugify()` (Python parity) |
| `src/repositories/pg.ts` (modify) | Company repo CRUD and filters; role-config `deleteByCompany`; remove `deleteAllExcept*` |
| `src/services/catalogueSeeder.ts` (modify) | Upsert-only seed; `origin: "seed"`; published |
| `src/routes/catalogue.ts` (modify) | Student `/companies` shows published, active companies only |
| `src/routes/admin.ts` (modify) | New `adminCompaniesRouter` (CRUD plus research state) |
| `src/routes/internal.ts` (modify) | `GET /research-targets` |
| `src/routes/research.ts` | `adminResearchRouter` (runs, control, events, spans) |
| `src/integrations/aiService/client.ts` (modify) | Research client methods; `sendJson` |
| `src/app.ts` (modify) | Mount `/admin/research` |
| `test/**` | Route, repo and migration tests |

### packages/contracts

| File | Responsibility |
|---|---|
| `openapi.yaml` (modify) | Admin company and research paths and schemas, plus internal research targets |

### apps/web

| File | Responsibility |
|---|---|
| `lib/constants/research/index.ts` | Endpoints, query keys, polling, limits, `NODE_ORDER` |
| `features/research/types.ts` | Aliases of generated schemas |
| `features/research/api.ts` | `apiFetch` wrappers |
| `features/research/hooks.ts` | TanStack Query hooks, including `useRunEvents` |
| `features/research/status.ts` | Company research status, dots, run controls |
| `features/research/trace-tree.ts` | `buildSpanTree()` |
| `features/research/event-filters.ts` | Level ranks, `filterEvents`, `appendCapped`, `initialAfterSeq`, `olderPageQuery` |
| `features/research/copy-bundle.ts` | `trimMiddle`, `fence`, `formatSpanForClaude`, `formatFailureReport`, `formatRunSummary` |
| `features/research/deep-link.ts` | `?tab=&run=&company=&span=` parse/serialize |
| `features/research/clipboard.ts` | `copyText()` (clipboard plus toast), `downloadJson()` |
| `features/research/index.ts` | Barrel |
| `app/(app)/intelligence/_components/research/*.tsx` | Companies tab, Runs debugger and its parts |
| `app/(app)/intelligence/page.tsx` (modify) | URL-driven tabs; Companies + Runs; legacy briefs tab kept |
| `app/(app)/intelligence/_components/CompaniesPanel.tsx`, `RemoveCompanyButton.tsx` (delete) | Superseded by the Companies tab |

---

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

## Task 2: Redaction and error capture

**Files:**
- Create: `apps/ai-service/app/research/trace/__init__.py`, `apps/ai-service/app/research/trace/redact.py`, `apps/ai-service/app/research/trace/errors.py`
- Test: `apps/ai-service/tests/research/test_redact.py`, `apps/ai-service/tests/research/test_errors.py`

**Interfaces:**
- Consumes: `check_transition` and `InvalidTransition` (Task 1), used to raise from an `app/research` frame in tests.
- Produces:
  - `redact(value: Any, secrets: Mapping[str, str]) -> Any`.
  - `secrets_from_settings(settings) -> dict[str, str]`.
  - `code_ref(exc) -> str | None`.
  - `error_info(exc) -> {"type", "message", "traceback", "code_ref"}`.

- [ ] **Step 1: Write the failing tests**

`apps/ai-service/tests/research/test_redact.py`:

```python
from app.config import Settings
from app.research.trace.redact import redact, secrets_from_settings

SECRETS = {"EXA_API_KEY": "exa-secret-123"}


def test_redacts_secret_values_wherever_they_appear():
    out = redact({"msg": "401 for key exa-secret-123!", "nested": [{"k": "exa-secret-123"}]}, SECRETS)
    assert out == {"msg": "401 for key «redacted:EXA_API_KEY»!", "nested": [{"k": "«redacted:EXA_API_KEY»"}]}


def test_redacts_auth_headers_by_name_case_insensitively():
    out = redact({"Authorization": "Bearer abc", "X-Internal-Api-Key": "k", "x-api-key": "e", "Accept": "json"}, {})
    assert out == {
        "Authorization": "«redacted:header»", "X-Internal-Api-Key": "«redacted:header»",
        "x-api-key": "«redacted:header»", "Accept": "json",
    }


def test_leaves_non_string_scalars_alone():
    assert redact({"n": 42, "b": True, "none": None, "f": 1.5}, SECRETS) == {"n": 42, "b": True, "none": None, "f": 1.5}


def test_tuples_become_lists_and_input_is_not_mutated():
    original = {"t": ("exa-secret-123", 1)}
    assert redact(original, SECRETS) == {"t": ["«redacted:EXA_API_KEY»", 1]}
    assert original == {"t": ("exa-secret-123", 1)}


def test_secrets_from_settings_names_each_llm_key_and_skips_short_values(monkeypatch):
    monkeypatch.setenv("EXA_API_KEY", "exa-long-key")
    monkeypatch.setenv("LLM_API_KEY", "key-one-long,key-two-long")
    monkeypatch.setenv("INTERNAL_API_KEY", "x")  # too short to redact safely: matching "x" would shred text
    names = secrets_from_settings(Settings(_env_file=None))
    assert names == {"EXA_API_KEY": "exa-long-key", "LLM_API_KEY#0": "key-one-long", "LLM_API_KEY#1": "key-two-long"}
```

`apps/ai-service/tests/research/test_errors.py`:

```python
import pytest

from app.research.models import InvalidTransition, check_transition
from app.research.trace.errors import code_ref, error_info


def test_error_info_points_code_ref_at_the_innermost_research_frame():
    with pytest.raises(InvalidTransition) as caught:
        check_transition("completed", "stop")
    info = error_info(caught.value)
    assert info["type"] == "InvalidTransition"
    assert "cannot stop a run that is completed" in info["message"]
    assert info["code_ref"] == "app/research/models.py:check_transition"
    assert "Traceback" in info["traceback"]


def test_code_ref_is_none_outside_the_research_package():
    try:
        raise ValueError("boom")
    except ValueError as exc:
        assert code_ref(exc) is None
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `.venv/bin/python -m pytest tests/research/test_redact.py tests/research/test_errors.py -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.research.trace'`.

- [ ] **Step 3: Implement**

`apps/ai-service/app/research/trace/__init__.py`:

```python
"""Full-verbosity tracing for research runs (spec §10)."""
```

`apps/ai-service/app/research/trace/redact.py`:

```python
"""Scrub secrets before anything reaches Mongo or the admin UI (spec §10.3).

Two passes: (1) any mapping key that is an auth header is replaced wholesale; (2) any string
containing a configured secret value has that value replaced with «redacted:<NAME>». Values
shorter than _MIN_SECRET_LEN are never treated as secrets: replacing "x" everywhere would shred
every payload (test env keys are 1 character)."""
from __future__ import annotations

from collections.abc import Mapping
from typing import Any

_SECRET_HEADERS = frozenset({"authorization", "x-api-key", "x-internal-api-key"})
_MIN_SECRET_LEN = 6


def secrets_from_settings(settings: Any) -> dict[str, str]:
    named: dict[str, str] = {
        "EXA_API_KEY": settings.exa_api_key,
        "INTERNAL_API_KEY": settings.internal_api_key,
    }
    for i, key in enumerate(settings.llm_api_keys):
        named[f"LLM_API_KEY#{i}"] = key
    return {name: value for name, value in named.items() if value and len(value) >= _MIN_SECRET_LEN}


def redact(value: Any, secrets: Mapping[str, str]) -> Any:
    if isinstance(value, str):
        for name, secret in secrets.items():
            if secret in value:
                value = value.replace(secret, f"«redacted:{name}»")
        return value
    if isinstance(value, Mapping):
        return {
            k: "«redacted:header»" if isinstance(k, str) and k.lower() in _SECRET_HEADERS else redact(v, secrets)
            for k, v in value.items()
        }
    if isinstance(value, (list, tuple)):
        return [redact(v, secrets) for v in value]
    return value
```

`apps/ai-service/app/research/trace/errors.py`:

```python
"""Turn an exception into what the debugger shows: type, message, full traceback, and a code_ref
("app/research/nodes/resolve.py:resolve") naming the innermost pipeline frame so Claude Code can
jump straight to the code (spec §10.4)."""
from __future__ import annotations

import traceback

_MAX_MESSAGE = 2000
_MAX_TRACEBACK = 20_000
_MARKER = "/app/research/"


def code_ref(exc: BaseException) -> str | None:
    for frame in reversed(traceback.extract_tb(exc.__traceback__)):
        path = frame.filename.replace("\\", "/")
        i = path.rfind(_MARKER)
        if i != -1:
            return f"{path[i + 1:]}:{frame.name}"
    return None


def error_info(exc: BaseException) -> dict:
    return {
        "type": type(exc).__name__,
        "message": str(exc)[:_MAX_MESSAGE],
        "traceback": "".join(traceback.format_exception(exc))[-_MAX_TRACEBACK:],
        "code_ref": code_ref(exc),
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/research -q`
Expected: PASS.

- [ ] **Step 5: Checkpoint**

Run `git status`; leave the changes uncommitted.

---

## Task 3: Research store (protocol, Mongo, in-memory)

**Files:**
- Create: `apps/ai-service/app/research/store.py`, `apps/ai-service/app/research/memory_store.py`
- Test: `apps/ai-service/tests/research/test_store_contract.py`

**Interfaces:**
- Consumes: `ACTIVE_RUN_STATUSES` (Task 1).
- Produces:
  - The collection name constants.
  - `LEVEL_RANK: dict[str, int]` (`trace` 0, `debug` 10, `info` 20, `warn` 30, `error` 40).
  - The frozen dataclass `EventFilter(after_seq=0, before_seq=None, limit=500, min_level=None, company_id=None, node=None, type_prefix=None, span_id=None, q=None)`.
  - `event_matches(event, flt) -> bool`.
  - The `ResearchStore` protocol, implemented by `MongoResearchStore(db)` and `InMemoryResearchStore()` with identical semantics.
  - `ensure_research_indexes(db, *, ttl_days)`.

  All update methods take **`fields=`** (dotted-path `$set`) and **`inc=`** (dotted-path `$inc`). The `ResearchStore` methods (all `async`):

  | Group | Methods |
  |---|---|
  | Runs | `insert_run(run)`, `get_run(run_id)`, `update_run(run_id, *, fields=None, inc=None) -> dict \| None` (returns the updated doc), `find_active_run()`, `find_runs_by_status(statuses)` (oldest first), `list_runs(limit)` (newest first, without `targets`) |
  | Items | `insert_items(items)`, `list_items(run_id)` (by `position`), `update_item(run_id, company_id, *, fields=None, inc=None)` |
  | Spans | `put_span(span)` (upsert by `span_id`), `get_span(span_id)`, `list_spans(run_id, company_id=None)` (by `started_at`, without `input`/`output`) |
  | Events | `insert_events(events)`, `list_events(run_id, flt) -> list` (always ascending by seq; with `before_seq` it returns the **newest** `limit` rows before it) |
  | Payloads | `put_payload(payload)`, `get_payload(payload_id)` |
  | Sources | `upsert_source(source)` (merges `kinds`) |
  | Extracts | `get_extract(key)`, `put_extract(extract)` |
  | Company state | `upsert_company_state(company_id, *, fields)`, `list_company_states(company_ids=None)` |
  | Drafts | `latest_draft(company_id, *, status=None)` (highest version), `insert_draft(draft)`, `supersede_pending_drafts(company_id) -> int` |

  No returned document ever contains `_id`.

- [ ] **Step 1: Write the failing contract tests**

`apps/ai-service/tests/research/test_store_contract.py`:

```python
"""One behavioural contract, two stores. The Mongo half runs only when RESEARCH_TEST_MONGO_URL points
at a server you can create throwaway databases on (e.g. the Atlas dev cluster):

    RESEARCH_TEST_MONGO_URL='mongodb+srv://…' .venv/bin/python -m pytest tests/research/test_store_contract.py -q
"""
import asyncio
import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.research.memory_store import InMemoryResearchStore
from app.research.store import LEVEL_RANK, EventFilter, MongoResearchStore, ensure_research_indexes

T0 = datetime(2026, 10, 2, 10, 0, tzinfo=timezone.utc)


async def _noop() -> None:
    return None


@pytest.fixture(params=["memory", "mongo"])
def make_store(request):
    if request.param == "memory":
        async def make_memory():
            return InMemoryResearchStore(), _noop
        return make_memory
    url = os.environ.get("RESEARCH_TEST_MONGO_URL")
    if not url:
        pytest.skip("RESEARCH_TEST_MONGO_URL not set")

    async def make_mongo():
        from motor.motor_asyncio import AsyncIOMotorClient
        client = AsyncIOMotorClient(url, tz_aware=True)
        db = client[f"research_contract_{uuid.uuid4().hex[:10]}"]
        await ensure_research_indexes(db, ttl_days=1)

        async def cleanup():
            await client.drop_database(db.name)
            client.close()
        return MongoResearchStore(db), cleanup
    return make_mongo


def _run(make_store, scenario):
    async def go():
        store, cleanup = await make_store()
        try:
            await scenario(store)
        finally:
            await cleanup()
    asyncio.run(go())


def _run_doc(run_id, status="running", created_at=T0):
    return {"run_id": run_id, "status": status, "control": "none", "created_at": created_at,
            "counters": {"done": 0}, "budget": {"exa_used": 0}, "last_seq": 0, "targets": [{"id": "c1"}]}


def _event(seq, *, level="info", type_="log", message="hello", span_id=None, company_id=None, node=None):
    return {"run_id": "r1", "seq": seq, "ts": T0, "level": level, "level_rank": LEVEL_RANK[level],
            "type": type_, "message": message, "span_id": span_id, "company_id": company_id, "node": node}


def test_runs_support_dotted_updates_and_never_leak_mongo_ids(make_store):
    async def scenario(store):
        await store.insert_run(_run_doc("r1"))
        updated = await store.update_run("r1", fields={"status": "paused", "budget.exa_cap": 9}, inc={"counters.done": 2})
        assert updated["status"] == "paused"
        assert updated["budget"] == {"exa_used": 0, "exa_cap": 9}
        assert updated["counters"]["done"] == 2
        assert "_id" not in (await store.get_run("r1"))
        assert await store.get_run("nope") is None
        assert await store.update_run("nope", fields={"status": "x"}) is None
    _run(make_store, scenario)


def test_active_run_and_listing_orders(make_store):
    async def scenario(store):
        await store.insert_run(_run_doc("old", status="completed", created_at=T0))
        await store.insert_run(_run_doc("new", status="paused", created_at=T0 + timedelta(minutes=1)))
        assert (await store.find_active_run())["run_id"] == "new"
        listed = await store.list_runs(10)
        assert [r["run_id"] for r in listed] == ["new", "old"]
        assert all("targets" not in r for r in listed)
        assert [r["run_id"] for r in await store.find_runs_by_status(["completed", "paused"])] == ["old", "new"]
    _run(make_store, scenario)


def test_items_keep_queue_order_and_take_dotted_updates(make_store):
    async def scenario(store):
        await store.insert_items([
            {"run_id": "r1", "company_id": "b", "position": 1, "status": "queued", "nodes": {}},
            {"run_id": "r1", "company_id": "a", "position": 0, "status": "queued", "nodes": {}},
            {"run_id": "r2", "company_id": "a", "position": 0, "status": "queued", "nodes": {}},
        ])
        await store.update_item("r1", "a", fields={"nodes.resolve.status": "ok"}, inc={"nodes.resolve.llm_calls": 1})
        items = await store.list_items("r1")
        assert [i["company_id"] for i in items] == ["a", "b"]
        assert items[0]["nodes"] == {"resolve": {"status": "ok", "llm_calls": 1}}
        assert all("_id" not in i for i in items)
    _run(make_store, scenario)


def test_spans_upsert_and_list_without_payloads(make_store):
    async def scenario(store):
        base = {"span_id": "s1", "run_id": "r1", "company_id": "c1", "parent_id": None, "kind": "node",
                "name": "resolve", "status": "running", "started_at": T0, "input": {"q": 1}, "output": None}
        await store.put_span(base)
        await store.put_span({**base, "status": "ok", "output": {"ok": True}})
        full = await store.get_span("s1")
        assert full["status"] == "ok" and full["input"] == {"q": 1} and full["output"] == {"ok": True}
        listed = await store.list_spans("r1")
        assert len(listed) == 1 and "input" not in listed[0] and "output" not in listed[0]
        assert await store.list_spans("r1", company_id="other") == []
    _run(make_store, scenario)


def test_event_filters_and_pages(make_store):
    async def scenario(store):
        await store.insert_events([
            _event(1, type_="run.started", message="starting run"),
            _event(2, level="debug", type_="span.start", span_id="s1", company_id="c1", node="resolve"),
            _event(3, level="warn", message="Meesho is slow", company_id="c1", node="resolve"),
            _event(4, level="error", type_="span.end", span_id="s1", company_id="c1", node="resolve"),
            _event(5, message="other company", company_id="c2"),
        ])
        seqs = lambda rows: [e["seq"] for e in rows]  # noqa: E731
        assert seqs(await store.list_events("r1", EventFilter(after_seq=2))) == [3, 4, 5]
        assert seqs(await store.list_events("r1", EventFilter(before_seq=5, limit=2))) == [3, 4]
        assert seqs(await store.list_events("r1", EventFilter(min_level="warn"))) == [3, 4]
        assert seqs(await store.list_events("r1", EventFilter(type_prefix="span."))) == [2, 4]
        assert seqs(await store.list_events("r1", EventFilter(q="MEESHO"))) == [3]
        assert seqs(await store.list_events("r1", EventFilter(span_id="s1"))) == [2, 4]
        assert seqs(await store.list_events("r1", EventFilter(company_id="c1", node="resolve"))) == [2, 3, 4]
        assert seqs(await store.list_events("r1", EventFilter(limit=2))) == [1, 2]
    _run(make_store, scenario)


def test_drafts_latest_by_version_and_supersede(make_store):
    async def scenario(store):
        await store.insert_draft({"draft_id": "d1", "company_id": "c1", "version": 1, "status": "approved"})
        await store.insert_draft({"draft_id": "d2", "company_id": "c1", "version": 2, "status": "pending_review"})
        assert (await store.latest_draft("c1"))["draft_id"] == "d2"
        assert (await store.latest_draft("c1", status="approved"))["draft_id"] == "d1"
        assert await store.supersede_pending_drafts("c1") == 1
        assert (await store.latest_draft("c1"))["status"] == "superseded"
        assert await store.latest_draft("nope") is None
    _run(make_store, scenario)


def test_company_state_upsert_and_filter(make_store):
    async def scenario(store):
        await store.upsert_company_state("c1", fields={"last_status": "queued"})
        await store.upsert_company_state("c1", fields={"last_status": "done", "last_researched_at": T0})
        await store.upsert_company_state("c2", fields={"last_status": "failed"})
        one = await store.list_company_states(["c1"])
        assert one == [{"company_id": "c1", "last_status": "done", "last_researched_at": T0}]
        assert len(await store.list_company_states()) == 2
    _run(make_store, scenario)


def test_sources_merge_kinds_and_extract_cache_roundtrip(make_store):
    async def scenario(store):
        await store.upsert_source({"url": "https://a.com", "text": "v1", "kinds": ["resolve"]})
        await store.upsert_source({"url": "https://a.com", "text": "v2", "kinds": ["resolve", "profile"]})
        await store.put_payload({"payload_id": "p1", "run_id": "r1", "body": {"big": True}, "created_at": T0})
        assert (await store.get_payload("p1"))["body"] == {"big": True}
        await store.put_extract({"key": "k1", "output": {"a": 1}, "created_at": T0})
        await store.put_extract({"key": "k1", "output": {"a": 2}, "created_at": T0})
        assert (await store.get_extract("k1"))["output"] == {"a": 2}
        assert await store.get_extract("missing") is None
    _run(make_store, scenario)
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `.venv/bin/python -m pytest tests/research/test_store_contract.py -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.research.memory_store'`. The Mongo-parameterized tests are skipped.

- [ ] **Step 3: Implement the protocol and the Mongo store**

`apps/ai-service/app/research/store.py`:

```python
"""Persistence for the research pipeline (spec §4.2).

`ResearchStore` is the seam: the runner, tracer, gateway and nodes only talk to it.
`MongoResearchStore` is production; `InMemoryResearchStore` (memory_store.py) backs tests and
`cli --memory`. Both must pass tests/research/test_store_contract.py.

Docs are plain dicts and no `_id` ever leaks out. Updates take Mongo-style dotted paths
(`fields={"nodes.resolve.status": "ok"}` → $set, `inc={...}` → $inc); the in-memory store applies
them the same way."""
from __future__ import annotations

import re
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Protocol

from motor.motor_asyncio import AsyncIOMotorDatabase
from pymongo import ASCENDING, DESCENDING, ReturnDocument
from pymongo.errors import OperationFailure

from app.research.models import ACTIVE_RUN_STATUSES

RUNS = "research_runs"
ITEMS = "research_items"
SPANS = "research_spans"
EVENTS = "research_events"
PAYLOADS = "research_payloads"
SOURCES = "research_sources"
EXTRACTS = "research_extracts"
COMPANY_STATE = "company_research_state"
DRAFTS = "company_drafts"

LEVEL_RANK: dict[str, int] = {"trace": 0, "debug": 10, "info": 20, "warn": 30, "error": 40}
SPAN_LIST_EXCLUDE: tuple[str, ...] = ("input", "output")


@dataclass(frozen=True)
class EventFilter:
    after_seq: int = 0
    before_seq: int | None = None   # set → newest `limit` events with seq < before_seq (still ascending)
    limit: int = 500
    min_level: str | None = None
    company_id: str | None = None
    node: str | None = None
    type_prefix: str | None = None
    span_id: str | None = None
    q: str | None = None            # case-insensitive substring of `message`


def event_matches(e: dict, flt: EventFilter) -> bool:
    if e["seq"] <= flt.after_seq:
        return False
    if flt.before_seq is not None and e["seq"] >= flt.before_seq:
        return False
    if flt.min_level and e["level_rank"] < LEVEL_RANK[flt.min_level]:
        return False
    if flt.company_id and e.get("company_id") != flt.company_id:
        return False
    if flt.node and e.get("node") != flt.node:
        return False
    if flt.span_id and e.get("span_id") != flt.span_id:
        return False
    if flt.type_prefix and not e["type"].startswith(flt.type_prefix):
        return False
    if flt.q and flt.q.lower() not in e["message"].lower():
        return False
    return True


class ResearchStore(Protocol):
    async def insert_run(self, run: dict) -> None: ...
    async def get_run(self, run_id: str) -> dict | None: ...
    async def update_run(self, run_id: str, *, fields: dict | None = None, inc: dict | None = None) -> dict | None: ...
    async def find_active_run(self) -> dict | None: ...
    async def find_runs_by_status(self, statuses: Iterable[str]) -> list[dict]: ...
    async def list_runs(self, limit: int) -> list[dict]: ...
    async def insert_items(self, items: list[dict]) -> None: ...
    async def list_items(self, run_id: str) -> list[dict]: ...
    async def update_item(self, run_id: str, company_id: str, *, fields: dict | None = None, inc: dict | None = None) -> None: ...
    async def put_span(self, span: dict) -> None: ...
    async def get_span(self, span_id: str) -> dict | None: ...
    async def list_spans(self, run_id: str, company_id: str | None = None) -> list[dict]: ...
    async def insert_events(self, events: list[dict]) -> None: ...
    async def list_events(self, run_id: str, flt: EventFilter) -> list[dict]: ...
    async def put_payload(self, payload: dict) -> None: ...
    async def get_payload(self, payload_id: str) -> dict | None: ...
    async def upsert_source(self, source: dict) -> None: ...
    async def get_extract(self, key: str) -> dict | None: ...
    async def put_extract(self, extract: dict) -> None: ...
    async def upsert_company_state(self, company_id: str, *, fields: dict) -> None: ...
    async def list_company_states(self, company_ids: list[str] | None = None) -> list[dict]: ...
    async def latest_draft(self, company_id: str, *, status: str | None = None) -> dict | None: ...
    async def insert_draft(self, draft: dict) -> None: ...
    async def supersede_pending_drafts(self, company_id: str) -> int: ...


def _update_doc(fields: dict | None, inc: dict | None) -> dict:
    doc: dict = {}
    if fields:
        doc["$set"] = fields
    if inc:
        doc["$inc"] = inc
    return doc


class MongoResearchStore:
    def __init__(self, db: AsyncIOMotorDatabase):
        self._db = db

    # --- runs ---
    async def insert_run(self, run: dict) -> None:
        await self._db[RUNS].insert_one(dict(run))   # copy: insert_one adds _id to the dict it is given

    async def get_run(self, run_id: str) -> dict | None:
        return await self._db[RUNS].find_one({"run_id": run_id}, {"_id": 0})

    async def update_run(self, run_id: str, *, fields: dict | None = None, inc: dict | None = None) -> dict | None:
        upd = _update_doc(fields, inc)
        if not upd:
            return await self.get_run(run_id)
        return await self._db[RUNS].find_one_and_update(
            {"run_id": run_id}, upd, projection={"_id": 0}, return_document=ReturnDocument.AFTER,
        )

    async def find_active_run(self) -> dict | None:
        return await self._db[RUNS].find_one(
            {"status": {"$in": sorted(ACTIVE_RUN_STATUSES)}}, {"_id": 0}, sort=[("created_at", DESCENDING)],
        )

    async def find_runs_by_status(self, statuses: Iterable[str]) -> list[dict]:
        cur = self._db[RUNS].find({"status": {"$in": list(statuses)}}, {"_id": 0}).sort("created_at", ASCENDING)
        return await cur.to_list(None)

    async def list_runs(self, limit: int) -> list[dict]:
        cur = self._db[RUNS].find({}, {"_id": 0, "targets": 0}).sort("created_at", DESCENDING).limit(limit)
        return await cur.to_list(None)

    # --- items ---
    async def insert_items(self, items: list[dict]) -> None:
        if items:
            await self._db[ITEMS].insert_many([dict(i) for i in items])

    async def list_items(self, run_id: str) -> list[dict]:
        return await self._db[ITEMS].find({"run_id": run_id}, {"_id": 0}).sort("position", ASCENDING).to_list(None)

    async def update_item(self, run_id: str, company_id: str, *, fields: dict | None = None, inc: dict | None = None) -> None:
        upd = _update_doc(fields, inc)
        if upd:
            await self._db[ITEMS].update_one({"run_id": run_id, "company_id": company_id}, upd)

    # --- spans ---
    async def put_span(self, span: dict) -> None:
        await self._db[SPANS].replace_one({"span_id": span["span_id"]}, dict(span), upsert=True)

    async def get_span(self, span_id: str) -> dict | None:
        return await self._db[SPANS].find_one({"span_id": span_id}, {"_id": 0})

    async def list_spans(self, run_id: str, company_id: str | None = None) -> list[dict]:
        q: dict = {"run_id": run_id}
        if company_id:
            q["company_id"] = company_id
        projection = {"_id": 0, **{k: 0 for k in SPAN_LIST_EXCLUDE}}
        return await self._db[SPANS].find(q, projection).sort("started_at", ASCENDING).to_list(None)

    # --- events ---
    async def insert_events(self, events: list[dict]) -> None:
        if events:
            await self._db[EVENTS].insert_many([dict(e) for e in events], ordered=False)

    async def list_events(self, run_id: str, flt: EventFilter) -> list[dict]:
        seq: dict = {"$gt": flt.after_seq}
        if flt.before_seq is not None:
            seq["$lt"] = flt.before_seq
        q: dict = {"run_id": run_id, "seq": seq}
        if flt.min_level:
            q["level_rank"] = {"$gte": LEVEL_RANK[flt.min_level]}
        if flt.company_id:
            q["company_id"] = flt.company_id
        if flt.node:
            q["node"] = flt.node
        if flt.span_id:
            q["span_id"] = flt.span_id
        if flt.type_prefix:
            q["type"] = {"$regex": "^" + re.escape(flt.type_prefix)}
        if flt.q:
            q["message"] = {"$regex": re.escape(flt.q), "$options": "i"}
        newest_first = flt.before_seq is not None
        cur = self._db[EVENTS].find(q, {"_id": 0}).sort("seq", DESCENDING if newest_first else ASCENDING).limit(flt.limit)
        rows = await cur.to_list(None)
        return list(reversed(rows)) if newest_first else rows

    # --- payloads / sources / extracts ---
    async def put_payload(self, payload: dict) -> None:
        await self._db[PAYLOADS].insert_one(dict(payload))

    async def get_payload(self, payload_id: str) -> dict | None:
        return await self._db[PAYLOADS].find_one({"payload_id": payload_id}, {"_id": 0})

    async def upsert_source(self, source: dict) -> None:
        doc = dict(source)
        kinds = doc.pop("kinds", [])
        await self._db[SOURCES].update_one(
            {"url": doc["url"]}, {"$set": doc, "$addToSet": {"kinds": {"$each": kinds}}}, upsert=True,
        )

    async def get_extract(self, key: str) -> dict | None:
        return await self._db[EXTRACTS].find_one({"key": key}, {"_id": 0})

    async def put_extract(self, extract: dict) -> None:
        await self._db[EXTRACTS].replace_one({"key": extract["key"]}, dict(extract), upsert=True)

    # --- company research state / drafts ---
    async def upsert_company_state(self, company_id: str, *, fields: dict) -> None:
        await self._db[COMPANY_STATE].update_one(
            {"company_id": company_id}, {"$set": {**fields, "company_id": company_id}}, upsert=True,
        )

    async def list_company_states(self, company_ids: list[str] | None = None) -> list[dict]:
        q = {} if company_ids is None else {"company_id": {"$in": company_ids}}
        return await self._db[COMPANY_STATE].find(q, {"_id": 0}).to_list(None)

    async def latest_draft(self, company_id: str, *, status: str | None = None) -> dict | None:
        q: dict = {"company_id": company_id}
        if status:
            q["status"] = status
        return await self._db[DRAFTS].find_one(q, {"_id": 0}, sort=[("version", DESCENDING)])

    async def insert_draft(self, draft: dict) -> None:
        await self._db[DRAFTS].insert_one(dict(draft))

    async def supersede_pending_drafts(self, company_id: str) -> int:
        res = await self._db[DRAFTS].update_many(
            {"company_id": company_id, "status": "pending_review"}, {"$set": {"status": "superseded"}},
        )
        return res.modified_count


async def ensure_research_indexes(db: AsyncIOMotorDatabase, *, ttl_days: int) -> None:
    await db[RUNS].create_index([("run_id", ASCENDING)], name="run_id", unique=True)
    await db[RUNS].create_index([("status", ASCENDING), ("created_at", DESCENDING)], name="status_created")
    await db[ITEMS].create_index([("run_id", ASCENDING), ("company_id", ASCENDING)], name="run_company", unique=True)
    await db[SPANS].create_index([("span_id", ASCENDING)], name="span_id", unique=True)
    await db[SPANS].create_index(
        [("run_id", ASCENDING), ("company_id", ASCENDING), ("started_at", ASCENDING)], name="run_company_started",
    )
    await db[EVENTS].create_index([("run_id", ASCENDING), ("seq", ASCENDING)], name="run_seq", unique=True)
    await db[PAYLOADS].create_index([("payload_id", ASCENDING)], name="payload_id", unique=True)
    await db[SOURCES].create_index([("url", ASCENDING)], name="url", unique=True)
    await db[EXTRACTS].create_index([("key", ASCENDING)], name="key", unique=True)
    await db[COMPANY_STATE].create_index([("company_id", ASCENDING)], name="company_id", unique=True)
    await db[DRAFTS].create_index([("draft_id", ASCENDING)], name="draft_id", unique=True)
    await db[DRAFTS].create_index([("company_id", ASCENDING), ("version", DESCENDING)], name="company_version", unique=True)
    seconds = ttl_days * 86_400
    await _ttl_index(db, EVENTS, "ts", seconds)
    await _ttl_index(db, PAYLOADS, "created_at", seconds)


async def _ttl_index(db: AsyncIOMotorDatabase, coll: str, field_name: str, seconds: int) -> None:
    name = f"{field_name}_ttl"
    try:
        await db[coll].create_index([(field_name, ASCENDING)], name=name, expireAfterSeconds=seconds)
    except OperationFailure:
        # RESEARCH_TRACE_TTL_DAYS changed since the index was built: createIndex refuses, collMod updates in place.
        await db.command("collMod", coll, index={"name": name, "expireAfterSeconds": seconds})
```

- [ ] **Step 4: Implement the in-memory store**

`apps/ai-service/app/research/memory_store.py`:

```python
"""In-memory ResearchStore for tests and `python -m app.research.cli --memory`. Mirrors
MongoResearchStore exactly: dotted-path $set/$inc, sort orders, projections, deep copies in and
out (so callers can never mutate stored state by accident)."""
from __future__ import annotations

import copy
from collections.abc import Iterable

from app.research.models import ACTIVE_RUN_STATUSES
from app.research.store import SPAN_LIST_EXCLUDE, EventFilter, event_matches


def _copy(doc: dict | None) -> dict | None:
    return copy.deepcopy(doc) if doc is not None else None


def _parent(doc: dict, path: str) -> tuple[dict, str]:
    *parents, last = path.split(".")
    cur = doc
    for part in parents:
        nxt = cur.get(part)
        if not isinstance(nxt, dict):
            nxt = {}
            cur[part] = nxt
        cur = nxt
    return cur, last


def _apply(doc: dict, fields: dict | None, inc: dict | None) -> None:
    for path, value in (fields or {}).items():
        parent, key = _parent(doc, path)
        parent[key] = copy.deepcopy(value)
    for path, delta in (inc or {}).items():
        parent, key = _parent(doc, path)
        parent[key] = (parent.get(key) or 0) + delta


class InMemoryResearchStore:
    def __init__(self) -> None:
        self.runs: dict[str, dict] = {}
        self.items: dict[tuple[str, str], dict] = {}
        self.spans: dict[str, dict] = {}
        self.events: list[dict] = []
        self.payloads: dict[str, dict] = {}
        self.sources: dict[str, dict] = {}
        self.extracts: dict[str, dict] = {}
        self.company_states: dict[str, dict] = {}
        self.drafts: list[dict] = []

    # --- runs ---
    async def insert_run(self, run: dict) -> None:
        if run["run_id"] in self.runs:
            raise ValueError(f"duplicate run_id {run['run_id']}")
        self.runs[run["run_id"]] = copy.deepcopy(run)

    async def get_run(self, run_id: str) -> dict | None:
        return _copy(self.runs.get(run_id))

    async def update_run(self, run_id: str, *, fields: dict | None = None, inc: dict | None = None) -> dict | None:
        doc = self.runs.get(run_id)
        if doc is None:
            return None
        _apply(doc, fields, inc)
        return copy.deepcopy(doc)

    async def find_active_run(self) -> dict | None:
        active = [r for r in self.runs.values() if r["status"] in ACTIVE_RUN_STATUSES]
        return _copy(max(active, key=lambda r: r["created_at"])) if active else None

    async def find_runs_by_status(self, statuses: Iterable[str]) -> list[dict]:
        wanted = frozenset(statuses)
        rows = sorted((r for r in self.runs.values() if r["status"] in wanted), key=lambda r: r["created_at"])
        return copy.deepcopy(rows)

    async def list_runs(self, limit: int) -> list[dict]:
        rows = sorted(self.runs.values(), key=lambda r: r["created_at"], reverse=True)[:limit]
        return [{k: copy.deepcopy(v) for k, v in r.items() if k != "targets"} for r in rows]

    # --- items ---
    async def insert_items(self, items: list[dict]) -> None:
        for item in items:
            self.items[(item["run_id"], item["company_id"])] = copy.deepcopy(item)

    async def list_items(self, run_id: str) -> list[dict]:
        rows = sorted((i for (rid, _), i in self.items.items() if rid == run_id), key=lambda i: i["position"])
        return copy.deepcopy(rows)

    async def update_item(self, run_id: str, company_id: str, *, fields: dict | None = None, inc: dict | None = None) -> None:
        doc = self.items.get((run_id, company_id))
        if doc is not None:
            _apply(doc, fields, inc)

    # --- spans ---
    async def put_span(self, span: dict) -> None:
        self.spans[span["span_id"]] = copy.deepcopy(span)

    async def get_span(self, span_id: str) -> dict | None:
        return _copy(self.spans.get(span_id))

    async def list_spans(self, run_id: str, company_id: str | None = None) -> list[dict]:
        rows = [s for s in self.spans.values()
                if s["run_id"] == run_id and (company_id is None or s.get("company_id") == company_id)]
        rows.sort(key=lambda s: s["started_at"])
        return [{k: copy.deepcopy(v) for k, v in s.items() if k not in SPAN_LIST_EXCLUDE} for s in rows]

    # --- events ---
    async def insert_events(self, events: list[dict]) -> None:
        self.events.extend(copy.deepcopy(e) for e in events)

    async def list_events(self, run_id: str, flt: EventFilter) -> list[dict]:
        rows = sorted((e for e in self.events if e["run_id"] == run_id and event_matches(e, flt)), key=lambda e: e["seq"])
        rows = rows[-flt.limit:] if flt.before_seq is not None else rows[: flt.limit]
        return copy.deepcopy(rows)

    # --- payloads / sources / extracts ---
    async def put_payload(self, payload: dict) -> None:
        self.payloads[payload["payload_id"]] = copy.deepcopy(payload)

    async def get_payload(self, payload_id: str) -> dict | None:
        return _copy(self.payloads.get(payload_id))

    async def upsert_source(self, source: dict) -> None:
        doc = copy.deepcopy(source)
        kinds = doc.pop("kinds", [])
        current = self.sources.setdefault(doc["url"], {"kinds": []})
        current.update(doc)
        current["kinds"] = current["kinds"] + [k for k in kinds if k not in current["kinds"]]

    async def get_extract(self, key: str) -> dict | None:
        return _copy(self.extracts.get(key))

    async def put_extract(self, extract: dict) -> None:
        self.extracts[extract["key"]] = copy.deepcopy(extract)

    # --- company research state / drafts ---
    async def upsert_company_state(self, company_id: str, *, fields: dict) -> None:
        current = self.company_states.setdefault(company_id, {"company_id": company_id})
        _apply(current, fields, None)

    async def list_company_states(self, company_ids: list[str] | None = None) -> list[dict]:
        rows = [s for cid, s in self.company_states.items() if company_ids is None or cid in company_ids]
        return copy.deepcopy(rows)

    async def latest_draft(self, company_id: str, *, status: str | None = None) -> dict | None:
        rows = [d for d in self.drafts if d["company_id"] == company_id and (status is None or d["status"] == status)]
        return _copy(max(rows, key=lambda d: d["version"])) if rows else None

    async def insert_draft(self, draft: dict) -> None:
        self.drafts.append(copy.deepcopy(draft))

    async def supersede_pending_drafts(self, company_id: str) -> int:
        n = 0
        for d in self.drafts:
            if d["company_id"] == company_id and d["status"] == "pending_review":
                d["status"] = "superseded"
                n += 1
        return n
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/research/test_store_contract.py -q`
Expected: PASS for the memory store, SKIPPED for Mongo.

If `RESEARCH_TEST_MONGO_URL` is set to the Atlas dev cluster, the Mongo half must also pass. Run it once if you can.

- [ ] **Step 6: Checkpoint**

Run `git status`; leave the changes uncommitted.

---

## Task 4: Tracer, context and log handler

**Files:**
- Create: `apps/ai-service/app/research/trace/context.py`, `apps/ai-service/app/research/trace/tracer.py`, `apps/ai-service/app/research/trace/log_handler.py`
- Test: `apps/ai-service/tests/research/test_tracer.py`

**Interfaces:**
- Consumes: `ResearchStore`, `EventFilter`, `LEVEL_RANK` (Task 3); `redact` and `error_info` (Task 2); `InMemoryResearchStore` in tests.
- Produces:
  - `CURRENT_TRACER`, `CURRENT_SPAN`, `CURRENT_COMPANY`, `CURRENT_NODE` (`ContextVar`s).
  - `utcnow()` and `new_id()` (32-character hex).
  - `INLINE_LIMIT_BYTES = 32768`.
  - `Tracer(store, run_id, *, secrets, start_seq=0, flush_interval=0.25, flush_max=200, echo=None)`, with:
    - `.start()` and `.close()` (async);
    - `.emit(type_, message, *, level="info", data=None, span_id=None, company_id=None, node=None) -> dict` (sync);
    - `.flush()` (async);
    - `.span(kind, name, *, input=None, attrs=None, company_id=None, node=None)`, an async context manager yielding a `SpanHandle` with `.span_id`, `.set_output(value)` and `.set_attrs(**kw)`;
    - `.last_seq`.
  - `hydrate_span(store, span) -> dict` (resolves `input_ref`/`output_ref`).
  - `ResearchLogHandler`.
- **Span document:** `{span_id, parent_id, run_id, company_id, node, kind, name, status: running|ok|error|cancelled, started_at, ended_at, duration_ms, attrs, input, input_ref, output, output_ref, error}`.
- **Event document:** `{run_id, seq, ts, level, level_rank, type, message, span_id, company_id, node, data? | data_ref?}`.

- [ ] **Step 1: Write the failing tests**

`apps/ai-service/tests/research/test_tracer.py`:

```python
import asyncio
import json
import logging

import pytest

from app.research.memory_store import InMemoryResearchStore
from app.research.store import EventFilter
from app.research.trace.context import CURRENT_TRACER
from app.research.trace.log_handler import ResearchLogHandler
from app.research.trace.tracer import INLINE_LIMIT_BYTES, Tracer, hydrate_span, utcnow

SECRET = "exa-secret-123"


async def _setup(start_seq=0):
    store = InMemoryResearchStore()
    await store.insert_run({"run_id": "run1", "status": "running", "last_seq": start_seq, "created_at": utcnow()})
    tracer = Tracer(store, "run1", secrets={"EXA_API_KEY": SECRET}, start_seq=start_seq, flush_interval=0.01)
    await tracer.start()
    return store, tracer


def test_spans_nest_inherit_company_and_record_output():
    async def go():
        store, t = await _setup()
        async with t.span("company", "Meesho", company_id="c1"):
            async with t.span("node", "resolve", node="resolve", input={"q": 1}) as inner:
                inner.set_output({"ok": True})
                inner.set_attrs(model="gemma")
        await t.close()
        spans = {s["name"]: s for s in await store.list_spans("run1")}
        assert spans["resolve"]["parent_id"] == spans["Meesho"]["span_id"]
        assert spans["resolve"]["company_id"] == "c1"
        full = await store.get_span(spans["resolve"]["span_id"])
        assert full["input"] == {"q": 1} and full["output"] == {"ok": True}
        assert full["status"] == "ok" and full["attrs"]["model"] == "gemma" and full["duration_ms"] >= 0
        types = [e["type"] for e in await store.list_events("run1", EventFilter())]
        assert types == ["span.start", "span.start", "span.end", "span.end"]
    asyncio.run(go())


def test_errors_are_recorded_redacted_and_reraised():
    async def go():
        store, t = await _setup()
        with pytest.raises(RuntimeError):
            async with t.span("exa", "search"):
                raise RuntimeError(f"401 for key {SECRET}")
        await t.close()
        (span,) = await store.list_spans("run1")
        full = await store.get_span(span["span_id"])
        assert full["status"] == "error"
        assert full["error"]["type"] == "RuntimeError"
        assert "«redacted:EXA_API_KEY»" in full["error"]["message"]
        events = await store.list_events("run1", EventFilter())
        end = next(e for e in events if e["type"] == "span.end")
        assert end["level"] == "error"
        dumped = json.dumps([full, events], default=str)
        assert SECRET not in dumped
    asyncio.run(go())


def test_emit_assigns_monotonic_seq_and_flush_records_last_seq():
    async def go():
        store, t = await _setup(start_seq=41)
        t.emit("log", "a")
        t.emit("log", "b", level="warn", data={"k": SECRET})
        await t.flush()
        events = await store.list_events("run1", EventFilter())
        assert [e["seq"] for e in events] == [42, 43]
        assert events[1]["level_rank"] == 30 and events[1]["data"] == {"k": "«redacted:EXA_API_KEY»"}
        assert (await store.get_run("run1"))["last_seq"] == 43
        assert t.last_seq == 43
        await t.close()
    asyncio.run(go())


def test_large_values_are_offloaded_and_hydrated_back():
    async def go():
        store, t = await _setup()
        big = {"text": "x" * (INLINE_LIMIT_BYTES + 10)}
        async with t.span("llm", "prompt", input=big) as sp:
            sp.set_output(big)
        t.emit("log", "big data", data=big)
        await t.close()
        (span,) = await store.list_spans("run1")
        full = await store.get_span(span["span_id"])
        assert full["input"] is None and full["input_ref"] and full["output_ref"]
        assert (await store.get_payload(full["input_ref"]))["body"] == big
        hydrated = await hydrate_span(store, full)
        assert hydrated["input"] == big and hydrated["output"] == big
        log = next(e for e in await store.list_events("run1", EventFilter()) if e["type"] == "log")
        assert "data" not in log and (await store.get_payload(log["data_ref"]))["body"] == big
    asyncio.run(go())


def test_cancelled_span_is_marked_cancelled():
    async def go():
        store, t = await _setup()

        async def body():
            async with t.span("node", "slow"):
                await asyncio.sleep(10)
        task = asyncio.create_task(body())
        await asyncio.sleep(0.02)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        await t.close()
        (span,) = await store.list_spans("run1")
        assert span["status"] == "cancelled"
    asyncio.run(go())


def test_log_handler_forwards_only_inside_a_bound_run():
    async def go():
        store, t = await _setup()
        handler = ResearchLogHandler()
        log = logging.getLogger("app.research.test_logger")
        log.setLevel(logging.DEBUG)
        log.addHandler(handler)
        log.propagate = False
        try:
            log.info("outside any run")
            token = CURRENT_TRACER.set(t)
            try:
                async with t.span("node", "resolve", node="resolve"):
                    log.debug("inside %s", "node")
                    try:
                        raise ValueError("bad")
                    except ValueError:
                        log.exception("it failed")
            finally:
                CURRENT_TRACER.reset(token)
            await t.flush()
        finally:
            log.removeHandler(handler)
        logs = [e for e in await store.list_events("run1", EventFilter()) if e["type"] == "log"]
        assert [e["message"] for e in logs] == ["inside node", "it failed"]
        assert logs[0]["level"] == "debug" and logs[0]["node"] == "resolve"
        assert logs[0]["data"]["logger"] == "app.research.test_logger"
        assert logs[1]["level"] == "error" and "ValueError: bad" in logs[1]["data"]["exc"]
        await t.close()
    asyncio.run(go())
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `.venv/bin/python -m pytest tests/research/test_tracer.py -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.research.trace.context'`.

- [ ] **Step 3: Implement the context variables**

`apps/ai-service/app/research/trace/context.py`:

```python
"""Context for the research tracer. The runner binds the tracer for a run and the company for each
item; Tracer.span() binds span/company/node for its body. Read by the tracer (parent links), the log
handler (attribution) and Budget (per-node call counters). asyncio tasks copy the context when
created, so LangGraph's node tasks inherit whatever was bound around graph.astream()."""
from __future__ import annotations

from contextvars import ContextVar
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.research.trace.tracer import Tracer

CURRENT_TRACER: ContextVar["Tracer | None"] = ContextVar("research_tracer", default=None)
CURRENT_SPAN: ContextVar[str | None] = ContextVar("research_span", default=None)
CURRENT_COMPANY: ContextVar[str | None] = ContextVar("research_company", default=None)
CURRENT_NODE: ContextVar[str | None] = ContextVar("research_node", default=None)
```

- [ ] **Step 4: Implement the tracer**

`apps/ai-service/app/research/trace/tracer.py`:

```python
"""Full-verbosity trace for research runs (spec §10): spans carrying their complete input and
output, an append-only event log with a per-run monotonic `seq`, large values offloaded to
research_payloads, and redaction applied before anything is persisted.

Spans are written immediately (at start and at end) so the debugger shows work in flight. Events
are buffered and flushed every `flush_interval` seconds or every `flush_max` events, so a chatty
node never costs one Mongo write per log line."""
from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any

from app.research.store import LEVEL_RANK, ResearchStore
from app.research.trace.context import CURRENT_COMPANY, CURRENT_NODE, CURRENT_SPAN
from app.research.trace.errors import error_info
from app.research.trace.redact import redact

# app.research.trace.* records are NOT forwarded by ResearchLogHandler: a failing flush that logged
# into the trace would just retry forever.
logger = logging.getLogger(__name__)

INLINE_LIMIT_BYTES = 32 * 1024
_MAX_MESSAGE_CHARS = 4000


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def new_id() -> str:
    return uuid.uuid4().hex


def _size(value: Any) -> int:
    return len(json.dumps(value, default=str, ensure_ascii=False).encode())


class SpanHandle:
    """Yielded by Tracer.span(): the body attaches its output and any extra attributes."""

    def __init__(self, span_id: str):
        self.span_id = span_id
        self.output: Any = None
        self.has_output = False
        self.attrs: dict[str, Any] = {}

    def set_output(self, value: Any) -> None:
        self.output = value
        self.has_output = True

    def set_attrs(self, **attrs: Any) -> None:
        self.attrs.update(attrs)


class Tracer:
    def __init__(self, store: ResearchStore, run_id: str, *, secrets: dict[str, str], start_seq: int = 0,
                 flush_interval: float = 0.25, flush_max: int = 200,
                 echo: Callable[[dict], None] | None = None):
        self._store = store
        self.run_id = run_id
        self._secrets = secrets
        self._seq = start_seq
        self._flush_interval = flush_interval
        self._flush_max = flush_max
        self._echo = echo
        self._buffer: list[dict] = []
        self._pending_payloads: list[dict] = []
        self._lock = asyncio.Lock()
        self._task: asyncio.Task | None = None
        self._kick_pending = False

    @property
    def last_seq(self) -> int:
        return self._seq

    def _redact(self, value: Any) -> Any:
        return redact(value, self._secrets)

    # --- lifecycle -------------------------------------------------------------------------------
    async def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self._flush_loop(), name=f"research-trace-flush-{self.run_id}")

    async def close(self) -> None:
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        await self.flush()

    async def _flush_loop(self) -> None:
        while True:
            await asyncio.sleep(self._flush_interval)
            try:
                await self.flush()
            except Exception:  # noqa: BLE001 — a failed flush is retried on the next tick
                logger.exception("research trace flush failed (run %s)", self.run_id)

    async def flush(self) -> None:
        async with self._lock:
            payloads, self._pending_payloads = self._pending_payloads, []
            for p in payloads:
                await self._store.put_payload(p)
            batch, self._buffer = self._buffer, []
            if not batch:
                return
            try:
                await self._store.insert_events(batch)
                await self._store.update_run(self.run_id, fields={"last_seq": batch[-1]["seq"]})
            except Exception:
                self._buffer = batch + self._buffer   # keep them for the next tick
                raise

    # --- events ----------------------------------------------------------------------------------
    def emit(self, type_: str, message: str, *, level: str = "info", data: Any = None,
             span_id: str | None = None, company_id: str | None = None, node: str | None = None) -> dict:
        self._seq += 1
        event: dict[str, Any] = {
            "run_id": self.run_id,
            "seq": self._seq,
            "ts": utcnow(),
            "level": level,
            "level_rank": LEVEL_RANK[level],
            "type": type_,
            "message": self._redact(str(message))[:_MAX_MESSAGE_CHARS],
            "span_id": span_id or CURRENT_SPAN.get(),
            "company_id": company_id or CURRENT_COMPANY.get(),
            "node": node or CURRENT_NODE.get(),
        }
        if data is not None:
            clean = self._redact(data)
            if _size(clean) <= INLINE_LIMIT_BYTES:
                event["data"] = clean
            else:
                payload_id = new_id()
                event["data_ref"] = payload_id
                self._pending_payloads.append(self._payload_doc(payload_id, event["span_id"], clean))
        self._buffer.append(event)
        if self._echo is not None:
            self._echo(event)
        if len(self._buffer) >= self._flush_max and not self._kick_pending:
            try:
                loop = asyncio.get_running_loop()
            except RuntimeError:
                return event   # emitted from a thread with no loop: the timer flush picks it up
            self._kick_pending = True
            loop.create_task(self._kicked_flush())
        return event

    async def _kicked_flush(self) -> None:
        try:
            await self.flush()
        except Exception:  # noqa: BLE001
            logger.exception("research trace flush failed (run %s)", self.run_id)
        finally:
            self._kick_pending = False

    # --- spans -----------------------------------------------------------------------------------
    @asynccontextmanager
    async def span(self, kind: str, name: str, *, input: Any = None,  # noqa: A002 — mirrors the UI's Input tab
                   attrs: dict | None = None, company_id: str | None = None,
                   node: str | None = None) -> AsyncIterator[SpanHandle]:
        span_id = new_id()
        company = company_id or CURRENT_COMPANY.get()
        node_name = node or CURRENT_NODE.get()
        doc: dict[str, Any] = {
            "span_id": span_id,
            "parent_id": CURRENT_SPAN.get(),
            "run_id": self.run_id,
            "company_id": company,
            "node": node_name,
            "kind": kind,
            "name": name,
            "status": "running",
            "started_at": utcnow(),
            "ended_at": None,
            "duration_ms": None,
            "attrs": self._redact(attrs or {}),
            "error": None,
            "output": None,
            "output_ref": None,
        }
        doc["input"], doc["input_ref"] = await self._inline_or_payload(span_id, input)
        await self._store.put_span(doc)
        self.emit("span.start", f"{kind} · {name}", level="debug", span_id=span_id, company_id=company, node=node_name)

        handle = SpanHandle(span_id)
        span_token = CURRENT_SPAN.set(span_id)
        company_token = CURRENT_COMPANY.set(company)
        node_token = CURRENT_NODE.set(node_name)
        started = time.monotonic()
        try:
            yield handle
            doc["status"] = "ok"
        except asyncio.CancelledError:
            doc["status"] = "cancelled"
            raise
        except Exception as exc:
            doc["status"] = "error"
            doc["error"] = self._redact(error_info(exc))
            raise
        finally:
            CURRENT_NODE.reset(node_token)
            CURRENT_COMPANY.reset(company_token)
            CURRENT_SPAN.reset(span_token)
            await self._finish_span(doc, handle, started)

    async def _finish_span(self, doc: dict, handle: SpanHandle, started: float) -> None:
        doc["ended_at"] = utcnow()
        doc["duration_ms"] = int((time.monotonic() - started) * 1000)
        if handle.attrs:
            doc["attrs"] = {**doc["attrs"], **self._redact(handle.attrs)}
        try:
            if handle.has_output:
                doc["output"], doc["output_ref"] = await self._inline_or_payload(doc["span_id"], handle.output)
            await self._store.put_span(doc)
        except Exception:  # noqa: BLE001 — never mask the body's own outcome
            logger.exception("could not persist span %s", doc["span_id"])
        message = f"{doc['kind']} · {doc['name']} · {doc['status']} · {doc['duration_ms']}ms"
        if doc["error"]:
            message += f" · {doc['error']['type']}: {doc['error']['message'][:300]}"
        self.emit(
            "span.end", message, level="error" if doc["status"] == "error" else "debug",
            span_id=doc["span_id"], company_id=doc["company_id"], node=doc["node"],
            data={"status": doc["status"], "duration_ms": doc["duration_ms"]},
        )

    # --- payload offload -------------------------------------------------------------------------
    def _payload_doc(self, payload_id: str, span_id: str | None, body: Any) -> dict:
        return {"payload_id": payload_id, "run_id": self.run_id, "span_id": span_id,
                "content_type": "application/json", "size_bytes": _size(body), "body": body,
                "created_at": utcnow()}

    async def _inline_or_payload(self, span_id: str, value: Any) -> tuple[Any, str | None]:
        if value is None:
            return None, None
        clean = self._redact(value)
        if _size(clean) <= INLINE_LIMIT_BYTES:
            return clean, None
        payload_id = new_id()
        await self._store.put_payload(self._payload_doc(payload_id, span_id, clean))
        return None, payload_id


async def hydrate_span(store: ResearchStore, span: dict) -> dict:
    """Return the span with offloaded input/output read back from research_payloads."""
    out = dict(span)
    for key in ("input", "output"):
        ref = out.get(f"{key}_ref")
        if ref:
            payload = await store.get_payload(ref)
            out[key] = payload["body"] if payload else {"missing_payload": ref}
    return out
```

- [ ] **Step 5: Implement the log handler**

`apps/ai-service/app/research/trace/log_handler.py`:

```python
"""Forward Python log records into the bound research run as `log` events (spec §10.2), so every
logger.debug/info/warning inside the pipeline (including app.llm.client's 429 cooldown lines) shows
in the debugger console under the right company, node and span. A no-op unless a run is bound."""
from __future__ import annotations

import logging
import traceback

from app.research.trace.context import CURRENT_TRACER

_IGNORED_PREFIX = "app.research.trace"   # the tracer's own logs must not feed back into it


def _level(levelno: int) -> str:
    if levelno >= logging.ERROR:
        return "error"
    if levelno >= logging.WARNING:
        return "warn"
    if levelno >= logging.INFO:
        return "info"
    return "debug"


class ResearchLogHandler(logging.Handler):
    def emit(self, record: logging.LogRecord) -> None:
        tracer = CURRENT_TRACER.get()
        if tracer is None or record.name.startswith(_IGNORED_PREFIX):
            return
        try:
            data: dict = {"logger": record.name, "where": f"{record.pathname}:{record.lineno}"}
            if record.exc_info:
                data["exc"] = "".join(traceback.format_exception(*record.exc_info))
            tracer.emit("log", record.getMessage(), level=_level(record.levelno), data=data)
        except Exception:  # noqa: BLE001 — logging must never break the caller
            pass
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/research -q`
Expected: PASS.

- [ ] **Step 7: Checkpoint**

Run `git status`; leave the changes uncommitted.

---

## Task 5: LLM raw result, fixtures, budget and the ResearchIO gateway

**Files:**
- Modify: `apps/ai-service/app/llm/client.py`
- Create: `apps/ai-service/app/research/fixtures.py`, `apps/ai-service/app/research/budget.py`, `apps/ai-service/app/research/gateway.py`
- Test: `apps/ai-service/tests/llm/test_complete_full.py`, `apps/ai-service/tests/research/fakes.py`, `apps/ai-service/tests/research/test_gateway.py`

**Interfaces:**
- Consumes: Tracer (Task 4), store (Task 3), `Mode` (Task 1).
- Produces:
  - `LLMResult(data, thought, content, usage, latency_ms, key_index, attempts)` and `LLMClient.complete_full(system, user, *, label) -> LLMResult`.
  - `FixtureStore(root)` with:
    - `.read(company_slug, kind, request)`;
    - `.write(company_slug, kind, request, response) -> Path`;
    - `.path_for(...)`;
    - `FixtureStore.request_hash(request) -> str`.
  - `FixtureMissing`.
  - `Budget(store, run_id, *, exa_cap, llm_cap, exa_used=0, llm_used=0)` with:
    - `Budget.from_run(store, run)`;
    - `await .charge(kind)` (raises `BudgetExhausted(kind, used, cap)`);
    - `await .add_tokens(tokens_in, tokens_out)`;
    - `.set_caps(exa_cap=None, llm_cap=None)`.
  - `content_hash(text) -> "sha256:…"` and `extract_key(prompt_name, prompt_version, system, user) -> str`.
  - `ResearchIO(*, mode, exa, llm, fixtures, tracer, budget, store, settings)` with:
    - `await .search(query, *, company_slug, kind) -> list[{title, url, content, date}]`;
    - `await .extract_json(*, prompt_name, prompt_version, system, user, company_slug, label) -> dict`.

  Fakes for tests:
  - `FakeExa(respond: Callable[[str], list[dict]] | None = None, fail=None)` with `.calls`.
  - `FakeLLM(respond: Callable[[system, user, label], dict | Exception], on_call=None)` with `.calls`.
  - `result(url, title=..., content=..., date=None)` and `resolve_answer(name, website)`.

- [ ] **Step 1: Write the failing LLM test**

`apps/ai-service/tests/llm/test_complete_full.py`:

```python
"""complete_full() exposes what the research trace needs (raw content, token usage, which key,
how many attempts) without changing complete()'s (data, thought) contract."""
import asyncio
import json

import httpx

from app.llm.client import LLMClient


def _client(handler) -> LLMClient:
    llm = LLMClient(base_url="https://llm.test/v1", api_keys=["k0-long-key", "k1-long-key"], model="m", timeout_seconds=5)
    llm._client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return llm


def test_complete_full_returns_raw_content_usage_and_key_index():
    body = {"choices": [{"message": {"content": "<thought>hmm</thought>{\"a\": 1}"}}],
            "usage": {"prompt_tokens": 11, "completion_tokens": 3}}

    async def go():
        llm = _client(lambda req: httpx.Response(200, json=body))
        r = await llm.complete_full("sys", "user", label="t")
        data, thought = await llm.complete("sys", "user", label="t")
        await llm.aclose()
        return r, data, thought

    r, data, thought = asyncio.run(go())
    assert r.data == {"a": 1} and r.thought == "hmm"
    assert r.content == body["choices"][0]["message"]["content"]
    assert r.usage == {"prompt_tokens": 11, "completion_tokens": 3}
    assert r.key_index == 0 and r.attempts == 1 and r.latency_ms >= 0
    assert (data, thought) == ({"a": 1}, "hmm")


def test_complete_full_counts_attempts_across_key_rotation():
    calls = {"n": 0}

    def handler(req):
        calls["n"] += 1
        if calls["n"] == 1:
            return httpx.Response(500, text="boom")
        return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps({"ok": True})}}]})

    async def go():
        llm = _client(handler)
        r = await llm.complete_full("s", "u", label="t")
        await llm.aclose()
        return r

    r = asyncio.run(go())
    assert r.data == {"ok": True} and r.attempts == 2 and r.key_index == 1 and r.usage == {}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `.venv/bin/python -m pytest tests/llm/test_complete_full.py -q`
Expected: FAIL with `AttributeError: 'LLMClient' object has no attribute 'complete_full'`.

- [ ] **Step 3: Refactor the LLM client**

In `apps/ai-service/app/llm/client.py`:

1. Add `from dataclasses import dataclass` to the imports.
2. Add this class above `class LLMClient`:

```python
@dataclass(frozen=True)
class LLMResult:
    """Everything one successful call produced. complete() keeps returning just (data, thought); the
    research trace uses complete_full() to also show the raw reply, token usage, key and attempts."""
    data: dict
    thought: str
    content: str
    usage: dict
    latency_ms: int
    key_index: int
    attempts: int
```

3. Rename `async def complete(self, system: str, user: str, *, label: str = "llm") -> tuple[dict, str]:` to `async def complete_full(self, system: str, user: str, *, label: str = "llm") -> LLMResult:`. Keep its docstring, and add one sentence: "Returns LLMResult; complete() is the (data, thought) shorthand."
4. Inside the success branch, replace `return data, thought` with:

```python
                            return LLMResult(
                                data=data, thought=thought, content=content, usage=_usage,
                                latency_ms=_llm_ms, key_index=key_i, attempts=attempt,
                            )
```

5. Add this method directly above `complete_full`:

```python
    async def complete(self, system: str, user: str, *, label: str = "llm") -> tuple[dict, str]:
        """One chat call returning (parsed JSON object, reasoning text). See complete_full()."""
        result = await self.complete_full(system, user, label=label)
        return result.data, result.thought
```

`complete_json` keeps calling `self.complete(...)`, so it is unchanged.

- [ ] **Step 4: Run the LLM tests**

Run: `.venv/bin/python -m pytest tests/llm tests/test_llm_helpers.py -q`
Expected: PASS.

- [ ] **Step 5: Write the fakes and the failing gateway tests**

`apps/ai-service/tests/research/fakes.py`:

```python
"""Test doubles for the two external clients ResearchIO wraps. Same method names and return shapes
as ExaClient.collect_sources and LLMClient.complete_full."""
from __future__ import annotations

import copy
import json
from collections.abc import Awaitable, Callable

from app.llm.client import LLMResult


def result(url: str, title: str = "Official site", content: str = "Company homepage text.", date: str | None = None) -> dict:
    return {"title": title, "url": url, "content": content, "date": date}


def resolve_answer(name: str, website: str | None) -> dict:
    return {"is_company": True, "canonical_name": name, "website": website, "aliases": [],
            "confidence": "high", "evidence_urls": [website] if website else [], "reasoning": "official site in results"}


class FakeExa:
    def __init__(self, respond: Callable[[str], list[dict]] | None = None, fail: Exception | None = None):
        self._respond = respond or (lambda q: [])
        self._fail = fail
        self.calls: list[str] = []

    async def collect_sources(self, queries, *, include_domains, exclude_domains):
        query = queries[0]
        self.calls.append(query)
        if self._fail is not None:
            raise self._fail
        return copy.deepcopy(self._respond(query))


class FakeLLM:
    def __init__(self, respond: Callable[[str, str, str], dict | Exception],
                 on_call: Callable[[str], Awaitable[None]] | None = None):
        self._respond = respond
        self._on_call = on_call
        self.calls: list[str] = []

    async def complete_full(self, system: str, user: str, *, label: str = "llm") -> LLMResult:
        self.calls.append(label)
        if self._on_call is not None:
            await self._on_call(label)
        data = self._respond(system, user, label)
        if isinstance(data, Exception):
            raise data
        return LLMResult(data=data, thought="", content=json.dumps(data),
                         usage={"prompt_tokens": 100, "completion_tokens": 20},
                         latency_ms=5, key_index=0, attempts=1)

    async def aclose(self) -> None:
        return None


class Exploding:
    """Stands in for a client that must never be called (replay mode)."""

    async def collect_sources(self, *a, **kw):
        raise AssertionError("Exa must not be called in replay mode")

    async def complete_full(self, *a, **kw):
        raise AssertionError("the LLM must not be called in replay mode")

    async def aclose(self) -> None:
        return None
```

`apps/ai-service/tests/research/test_gateway.py`:

```python
import asyncio

import pytest

from app.config import Settings
from app.research.budget import Budget, BudgetExhausted
from app.research.fixtures import FixtureMissing, FixtureStore
from app.research.gateway import ResearchIO
from app.research.memory_store import InMemoryResearchStore
from app.research.models import Mode
from app.research.store import EventFilter
from app.research.trace.context import CURRENT_COMPANY, CURRENT_NODE
from app.research.trace.tracer import Tracer, utcnow
from tests.research.fakes import Exploding, FakeExa, FakeLLM, result


def _settings(**kw) -> Settings:
    return Settings(_env_file=None).model_copy(update={"research_results_per_query": 2, **kw})


async def _io(tmp_path, *, mode=Mode.LIVE, exa=None, llm=None, exa_cap=10, llm_cap=10, store=None):
    store = store or InMemoryResearchStore()
    if await store.get_run("run1") is None:
        await store.insert_run({"run_id": "run1", "status": "running", "last_seq": 0, "created_at": utcnow(),
                                "budget": {"exa_used": 0, "llm_used": 0, "tokens_in": 0, "tokens_out": 0}})
        await store.insert_items([{"run_id": "run1", "company_id": "c1", "position": 0, "nodes": {}}])
    tracer = Tracer(store, "run1", secrets={}, flush_interval=0.01)
    budget = Budget(store, "run1", exa_cap=exa_cap, llm_cap=llm_cap)
    io = ResearchIO(mode=mode, exa=exa, llm=llm, fixtures=FixtureStore(tmp_path / "fx"), tracer=tracer,
                    budget=budget, store=store, settings=_settings())
    return io, store, tracer


def _bind():
    return CURRENT_COMPANY.set("c1"), CURRENT_NODE.set("resolve")


def test_live_search_truncates_charges_budget_counts_per_node_and_remembers_sources(tmp_path):
    async def go():
        exa = FakeExa(lambda q: [result("https://a.com"), result("https://b.com"), result("https://c.com")])
        io, store, tracer = await _io(tmp_path, exa=exa)
        c, n = _bind()
        try:
            results = await io.search("Meesho company", company_slug="meesho", kind="resolve")
        finally:
            CURRENT_NODE.reset(n)
            CURRENT_COMPANY.reset(c)
        await tracer.close()
        assert [r["url"] for r in results] == ["https://a.com", "https://b.com"]
        assert exa.calls == ["Meesho company"]
        run = await store.get_run("run1")
        assert run["budget"]["exa_used"] == 1
        (item,) = await store.list_items("run1")
        assert item["nodes"]["resolve"]["exa_calls"] == 1
        assert store.sources["https://a.com"]["kinds"] == ["resolve"]
        assert store.sources["https://a.com"]["content_hash"].startswith("sha256:")
        (span,) = await store.list_spans("run1")
        full = await store.get_span(span["span_id"])
        assert span["kind"] == "exa" and full["output"]["count"] == 2
    asyncio.run(go())


def test_record_then_replay_serves_identical_results_without_calling_exa(tmp_path):
    async def go():
        exa = FakeExa(lambda q: [result("https://a.com")])
        io, _, t1 = await _io(tmp_path, mode=Mode.RECORD, exa=exa)
        recorded = await io.search("Meesho company", company_slug="meesho", kind="resolve")
        await t1.close()
        io2, store2, t2 = await _io(tmp_path, mode=Mode.REPLAY, exa=Exploding())
        replayed = await io2.search("Meesho company", company_slug="meesho", kind="resolve")
        await t2.close()
        assert replayed == recorded
        assert (await store2.get_run("run1"))["budget"]["exa_used"] == 0
        assert list((tmp_path / "fx" / "meesho").glob("exa-*.json"))
    asyncio.run(go())


def test_replay_miss_fails_loudly_with_how_to_fix(tmp_path):
    async def go():
        io, _, t = await _io(tmp_path, mode=Mode.REPLAY, exa=Exploding())
        with pytest.raises(FixtureMissing, match="RESEARCH_MODE=record"):
            await io.search("never recorded", company_slug="meesho", kind="resolve")
        await t.close()
    asyncio.run(go())


def test_extract_cache_reuses_identical_calls_and_emits_cache_hit(tmp_path):
    async def go():
        llm = FakeLLM(lambda s, u, label: {"answer": 42})
        io, store, tracer = await _io(tmp_path, llm=llm)
        kwargs = dict(prompt_name="p", prompt_version="v1", system="sys", user="user", company_slug="meesho", label="t")
        first = await io.extract_json(**kwargs)
        second = await io.extract_json(**kwargs)
        await tracer.close()
        assert first == second == {"answer": 42}
        assert llm.calls == ["t"]
        run = await store.get_run("run1")
        assert run["budget"]["llm_used"] == 1
        assert (run["budget"]["tokens_in"], run["budget"]["tokens_out"]) == (100, 20)
        events = await store.list_events("run1", EventFilter(type_prefix="cache.hit"))
        assert len(events) == 1
        llm_spans = [s for s in await store.list_spans("run1") if s["kind"] == "llm"]
        assert [s["attrs"]["cache"] for s in llm_spans] == ["miss", "hit"]
        assert llm_spans[0]["attrs"]["tokens_in"] == 100
    asyncio.run(go())


def test_record_mode_bypasses_the_extract_cache(tmp_path):
    async def go():
        llm = FakeLLM(lambda s, u, label: {"answer": 1})
        io, _, tracer = await _io(tmp_path, mode=Mode.RECORD, llm=llm)
        kwargs = dict(prompt_name="p", prompt_version="v1", system="s", user="u", company_slug="meesho", label="t")
        await io.extract_json(**kwargs)
        await io.extract_json(**kwargs)
        await tracer.close()
        assert llm.calls == ["t", "t"]
    asyncio.run(go())


def test_exhausted_budget_raises_before_any_call(tmp_path):
    async def go():
        llm = FakeLLM(lambda s, u, label: {"a": 1})
        io, _, tracer = await _io(tmp_path, llm=llm, llm_cap=0)
        with pytest.raises(BudgetExhausted) as caught:
            await io.extract_json(prompt_name="p", prompt_version="v1", system="s", user="u", company_slug="m", label="t")
        await tracer.close()
        assert caught.value.kind == "llm" and llm.calls == []
    asyncio.run(go())
```

- [ ] **Step 6: Run them to verify they fail**

Run: `.venv/bin/python -m pytest tests/research/test_gateway.py -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.research.budget'`.

- [ ] **Step 7: Implement fixtures, budget and the gateway**

`apps/ai-service/app/research/fixtures.py`:

```python
"""Record / replay store for research I/O (spec §12.2). `record` writes every Exa and LLM response
as <root>/<company-slug>/<kind>-<request-hash>.json; `replay` serves only from those files and
fails loudly on a miss. Keyed by a hash of the canonical request, so a changed query, prompt or
model is a different fixture."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

from app.research.trace.tracer import utcnow


class FixtureMissing(RuntimeError):
    """Replay asked for a response that was never recorded."""


class FixtureStore:
    def __init__(self, root: str | Path):
        self._root = Path(root)

    @staticmethod
    def request_hash(request: dict) -> str:
        canonical = json.dumps(request, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
        return hashlib.sha256(canonical.encode()).hexdigest()[:20]

    def path_for(self, company_slug: str, kind: str, request: dict) -> Path:
        return self._root / company_slug / f"{kind}-{self.request_hash(request)}.json"

    def read(self, company_slug: str, kind: str, request: dict) -> Any:
        path = self.path_for(company_slug, kind, request)
        if not path.exists():
            raise FixtureMissing(
                f"no recorded {kind} response for {company_slug} at {path}; "
                f"run this company once with RESEARCH_MODE=record to capture it"
            )
        return json.loads(path.read_text(encoding="utf-8"))["response"]

    def write(self, company_slug: str, kind: str, request: dict, response: Any) -> Path:
        path = self.path_for(company_slug, kind, request)
        path.parent.mkdir(parents=True, exist_ok=True)
        doc = {"recorded_at": utcnow().isoformat(), "request": request, "response": response}
        path.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")
        return path
```

`apps/ai-service/app/research/budget.py`:

```python
"""Per-run call caps (spec §5.3). charge() runs BEFORE each external call: it checks the cap and
counts the call in memory before its first await, so concurrent companies can never overshoot the
cap. The runner turns BudgetExhausted into an auto-pause with pause_reason=budget_exhausted."""
from __future__ import annotations

from typing import Literal

from app.research.store import ResearchStore
from app.research.trace.context import CURRENT_COMPANY, CURRENT_NODE

Kind = Literal["exa", "llm"]


class BudgetExhausted(RuntimeError):
    def __init__(self, kind: str, used: int, cap: int):
        super().__init__(f"{kind} budget exhausted ({used}/{cap} calls)")
        self.kind, self.used, self.cap = kind, used, cap


class Budget:
    def __init__(self, store: ResearchStore, run_id: str, *, exa_cap: int, llm_cap: int,
                 exa_used: int = 0, llm_used: int = 0):
        self._store = store
        self._run_id = run_id
        self._caps: dict[str, int] = {"exa": exa_cap, "llm": llm_cap}
        self._used: dict[str, int] = {"exa": exa_used, "llm": llm_used}

    @classmethod
    def from_run(cls, store: ResearchStore, run: dict) -> "Budget":
        b = run["budget"]
        return cls(store, run["run_id"], exa_cap=b["exa_cap"], llm_cap=b["llm_cap"],
                   exa_used=b.get("exa_used", 0), llm_used=b.get("llm_used", 0))

    def set_caps(self, *, exa_cap: int | None = None, llm_cap: int | None = None) -> None:
        if exa_cap is not None:
            self._caps["exa"] = exa_cap
        if llm_cap is not None:
            self._caps["llm"] = llm_cap

    async def charge(self, kind: Kind) -> None:
        used, cap = self._used[kind], self._caps[kind]
        if used >= cap:
            raise BudgetExhausted(kind, used, cap)
        self._used[kind] = used + 1   # before any await: this is what makes concurrent charges safe
        await self._store.update_run(self._run_id, inc={f"budget.{kind}_used": 1})
        company, node = CURRENT_COMPANY.get(), CURRENT_NODE.get()
        if company and node:
            await self._store.update_item(self._run_id, company, inc={f"nodes.{node}.{kind}_calls": 1})

    async def add_tokens(self, tokens_in: int, tokens_out: int) -> None:
        if tokens_in or tokens_out:
            await self._store.update_run(self._run_id, inc={"budget.tokens_in": tokens_in, "budget.tokens_out": tokens_out})
```

`apps/ai-service/app/research/gateway.py`:

```python
"""ResearchIO: the only way research nodes reach the outside world (spec §3.3, §10.1, §12.2).

Every Exa search and LLM call goes through here, which:
  1. opens a traced span carrying the full request and the full response;
  2. charges the run's budget (live/record only; replay is free);
  3. records to / replays from fixtures according to the run's mode;
  4. caches LLM extracts by a hash of their full input (bypassed in record mode so every call
     gets a fixture), and remembers every search result in research_sources.

Phase 1 stores full prompts on LLM spans (resolve prompts are a few KB). Phase 2's per-source
extracts switch to template + research_sources refs (spec §4.3)."""
from __future__ import annotations

import hashlib
import logging
from typing import Any

from app.config import Settings
from app.research.budget import Budget
from app.research.fixtures import FixtureStore
from app.research.models import Mode
from app.research.normalize.identity import domain_of
from app.research.store import ResearchStore
from app.research.trace.tracer import Tracer, utcnow

logger = logging.getLogger(__name__)


def content_hash(text: str) -> str:
    return "sha256:" + hashlib.sha256(text.encode()).hexdigest()


def extract_key(prompt_name: str, prompt_version: str, system: str, user: str) -> str:
    h = hashlib.sha256()
    for part in (prompt_name, prompt_version, system, user):
        h.update(part.encode())
        h.update(b"\x00")
    return h.hexdigest()


class ResearchIO:
    def __init__(self, *, mode: Mode, exa: Any, llm: Any, fixtures: FixtureStore, tracer: Tracer,
                 budget: Budget, store: ResearchStore, settings: Settings):
        self._mode = Mode(mode)
        self._exa = exa
        self._llm = llm
        self._fixtures = fixtures
        self._tracer = tracer
        self._budget = budget
        self._store = store
        self._settings = settings

    async def search(self, query: str, *, company_slug: str, kind: str) -> list[dict]:
        n = self._settings.research_results_per_query
        request = {"query": query, "num_results": n, "user_location": self._settings.exa_user_location,
                   "exclude_domains": sorted(self._settings.exa_exclude_domains)}
        async with self._tracer.span("exa", query, input=request,
                                     attrs={"query": query, "mode": self._mode.value, "kind": kind}) as sp:
            if self._mode is Mode.REPLAY:
                results = self._fixtures.read(company_slug, "exa", request)
                sp.set_attrs(replay=True)
            else:
                await self._budget.charge("exa")
                raw = await self._exa.collect_sources(
                    [query], include_domains=[], exclude_domains=list(self._settings.exa_exclude_domains),
                )
                results = raw[:n]
                if self._mode is Mode.RECORD:
                    sp.set_attrs(recorded_to=str(self._fixtures.write(company_slug, "exa", request, results)))
            logger.debug("exa %r → %d result(s)", query, len(results))
            sp.set_output({"count": len(results), "results": results})
        for r in results:
            text = r.get("content") or ""
            await self._store.upsert_source({
                "url": r["url"], "domain": domain_of(r["url"]), "title": r.get("title"),
                "published_date": r.get("date"), "text": text, "content_hash": content_hash(text),
                "fetched_at": utcnow(), "kinds": [kind],
            })
        return results

    async def extract_json(self, *, prompt_name: str, prompt_version: str, system: str, user: str,
                           company_slug: str, label: str) -> dict:
        model = self._settings.llm_model
        key = extract_key(prompt_name, prompt_version, system, user)
        request = {"model": model, "prompt_name": prompt_name, "prompt_version": prompt_version,
                   "system": system, "user": user}
        async with self._tracer.span("llm", f"{prompt_name}@{prompt_version}", input=request,
                                     attrs={"model": model, "prompt_name": prompt_name,
                                            "prompt_version": prompt_version, "mode": self._mode.value,
                                            "label": label}) as sp:
            if self._mode is not Mode.RECORD:
                hit = await self._store.get_extract(key)
                if hit is not None:
                    sp.set_attrs(cache="hit")
                    self._tracer.emit("cache.hit", f"{prompt_name}@{prompt_version}: reused cached extract", level="debug")
                    sp.set_output({"data": hit["output"], "cache": "hit"})
                    return hit["output"]
            if self._mode is Mode.REPLAY:
                response = self._fixtures.read(company_slug, "llm", request)
                sp.set_attrs(replay=True)
            else:
                await self._budget.charge("llm")
                r = await self._llm.complete_full(system, user, label=label)
                response = {"data": r.data, "thought": r.thought, "content": r.content, "usage": r.usage,
                            "latency_ms": r.latency_ms, "key_index": r.key_index, "attempts": r.attempts}
                await self._budget.add_tokens(int(r.usage.get("prompt_tokens") or 0),
                                              int(r.usage.get("completion_tokens") or 0))
                if self._mode is Mode.RECORD:
                    sp.set_attrs(recorded_to=str(self._fixtures.write(company_slug, "llm", request, response)))
            usage = response.get("usage") or {}
            sp.set_attrs(cache="miss", tokens_in=usage.get("prompt_tokens"), tokens_out=usage.get("completion_tokens"),
                         latency_ms=response.get("latency_ms"), key_index=response.get("key_index"),
                         retries=max(0, int(response.get("attempts") or 1) - 1))
            sp.set_output(response)
        await self._store.put_extract({"key": key, "prompt_name": prompt_name, "prompt_version": prompt_version,
                                       "output": response["data"], "created_at": utcnow()})
        return response["data"]
```

The gateway imports `domain_of` from `app/research/normalize/identity.py`, which is created in Task 6. Create it now with only `domain_of`; Task 6 adds the rest of the file:

```python
"""Company identity helpers (spec §3.2 resolve): slugs, name keys, domains, duplicate detection."""
from __future__ import annotations

from urllib.parse import urlparse


def domain_of(url: str | None) -> str | None:
    if not url:
        return None
    s = url.strip()
    if "://" not in s:
        s = "https://" + s
    host = urlparse(s).hostname
    if not host:
        return None
    host = host.lower()
    return host[4:] if host.startswith("www.") else host
```

Also create `apps/ai-service/app/research/normalize/__init__.py`:

```python
"""Pure normalization helpers for research data (spec §6)."""
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/research tests/llm -q`
Expected: PASS.

- [ ] **Step 9: Checkpoint**

Run `git status`; leave the changes uncommitted.

---

## Task 6: Identity helpers and snapshot diff (pure)

**Files:**
- Modify: `apps/ai-service/app/research/normalize/identity.py` (created in Task 5 with `domain_of`)
- Create: `apps/ai-service/app/research/drafts.py`
- Test: `apps/ai-service/tests/research/test_identity.py`, `apps/ai-service/tests/research/test_drafts.py`

**Interfaces:**
- Produces:
  - `slugify(name) -> str`, with the same output as the API's TypeScript `slugify`.
  - `name_key(name) -> str`.
  - `domain_of(url) -> str | None`.
  - `find_possible_duplicates(identity: {"name","website","aliases"}, others: list[{"id","name","website","aliases"}]) -> list[{"type": "possible_duplicate", "company_id", "company_name", "reasons": ["name"|"website"]}]`.
  - `flatten_snapshot(snapshot) -> dict[path, value]`.
  - `snapshot_diff(before: dict | None, after: dict) -> list[{"path", "change": "added"|"changed"|"removed", "before", "after"}]`, sorted by path.

- [ ] **Step 1: Write the failing tests**

`apps/ai-service/tests/research/test_identity.py`:

```python
import pytest

from app.research.normalize.identity import domain_of, find_possible_duplicates, name_key, slugify

# Mirrored verbatim in apps/api/test/domain/slug.test.ts. A slug is the join key between Postgres
# rows, briefs and fixture folders, so both languages must agree exactly.
SLUG_CASES = [
    ("Meesho", "meesho"),
    ("  Big   Co ", "big-co"),
    ("Tata Consultancy Services (TCS)", "tata-consultancy-services-tcs"),
    ("AT&T", "at-and-t"),
    ("Café Coffee Day", "cafe-coffee-day"),
    ("Straße Labs", "strae-labs"),
]


@pytest.mark.parametrize("name,expected", SLUG_CASES)
def test_slugify_matches_the_api(name, expected):
    assert slugify(name) == expected


@pytest.mark.parametrize("a,b", [
    ("Amazon India", "Amazon"),
    ("Infosys Limited", "Infosys"),
    ("Zoho Corporation Pvt. Ltd.", "Zoho"),
    ("Meesho", "MEESHO"),
])
def test_name_key_ignores_case_punctuation_and_corporate_suffixes(a, b):
    assert name_key(a) == name_key(b)


def test_name_key_keeps_at_least_one_word():
    assert name_key("Services") == "services"


@pytest.mark.parametrize("url,expected", [
    ("https://www.meesho.com/about", "meesho.com"),
    ("meesho.com", "meesho.com"),
    ("HTTP://Careers.Razorpay.com", "careers.razorpay.com"),
    ("", None),
    (None, None),
])
def test_domain_of(url, expected):
    assert domain_of(url) == expected


def test_duplicates_by_name_alias_or_website():
    others = [
        {"id": "a", "name": "Amazon", "website": None, "aliases": []},
        {"id": "b", "name": "Fashnear", "website": "https://www.meesho.com", "aliases": []},
        {"id": "c", "name": "Unrelated", "website": "https://other.com", "aliases": ["Other Co"]},
    ]
    found = find_possible_duplicates({"name": "Amazon India", "website": "https://meesho.com", "aliases": []}, others)
    assert found == [
        {"type": "possible_duplicate", "company_id": "a", "company_name": "Amazon", "reasons": ["name"]},
        {"type": "possible_duplicate", "company_id": "b", "company_name": "Fashnear", "reasons": ["website"]},
    ]


def test_no_duplicates_when_nothing_matches():
    assert find_possible_duplicates({"name": "Meesho", "website": None, "aliases": []},
                                    [{"id": "x", "name": "Razorpay", "website": None, "aliases": []}]) == []
```

`apps/ai-service/tests/research/test_drafts.py`:

```python
from app.research.drafts import flatten_snapshot, snapshot_diff
from app.research.models import field, unavailable

V1 = {"identity": {
    "name": field("Meesho", confidence="high", provenance="evidence"),
    "website": unavailable(),
    "aliases": field(["Fashnear"], confidence="medium", provenance="evidence"),
}}


def test_flatten_reads_field_values_by_dotted_path():
    assert flatten_snapshot(V1) == {
        "identity.aliases": ["Fashnear"], "identity.name": "Meesho", "identity.website": None,
    }


def test_flatten_keys_role_lists_by_role_key():
    snap = {"roles": [{"role_key": "sde1-backend", "title": field("SDE I", confidence="high", provenance="evidence")}]}
    assert flatten_snapshot(snap) == {"roles[sde1-backend].title": "SDE I"}


def test_first_draft_is_all_additions():
    assert snapshot_diff(None, V1) == [
        {"path": "identity.aliases", "change": "added", "before": None, "after": ["Fashnear"]},
        {"path": "identity.name", "change": "added", "before": None, "after": "Meesho"},
        {"path": "identity.website", "change": "added", "before": None, "after": None},
    ]


def test_changes_and_removals_compare_values_not_metadata():
    v2 = {"identity": {
        "name": field("Meesho", confidence="low", provenance="derived"),     # same value: no change
        "website": field("https://meesho.com", confidence="high", provenance="evidence"),
    }}
    assert snapshot_diff(V1, v2) == [
        {"path": "identity.aliases", "change": "removed", "before": ["Fashnear"], "after": None},
        {"path": "identity.website", "change": "changed", "before": None, "after": "https://meesho.com"},
    ]


def test_identical_snapshots_have_no_diff():
    assert snapshot_diff(V1, V1) == []
```

- [ ] **Step 2: Run them to verify they fail**

Run: `.venv/bin/python -m pytest tests/research/test_identity.py tests/research/test_drafts.py -q`
Expected: FAIL with an `ImportError` for `slugify` and `ModuleNotFoundError: app.research.drafts`.

- [ ] **Step 3: Implement**

Replace `apps/ai-service/app/research/normalize/identity.py` with:

```python
"""Company identity helpers (spec §3.2 resolve): slugs, name keys, domains, duplicate detection.
Pure functions. slugify() MUST stay byte-identical to apps/api/src/domain/slug.ts."""
from __future__ import annotations

import re
import unicodedata
from urllib.parse import urlparse

_SUFFIX_WORDS = frozenset({
    "private", "pvt", "limited", "ltd", "inc", "llc", "llp", "plc", "technologies", "technology", "tech",
    "india", "corp", "corporation", "co", "company", "labs", "software", "solutions", "services", "group",
})


def _ascii_fold(text: str) -> str:
    return unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()


def slugify(name: str) -> str:
    s = _ascii_fold(name).lower().replace("&", " and ")
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


def name_key(name: str) -> str:
    """Compact comparison key: "Zoho Corporation Pvt. Ltd." → "zoho". Strips trailing corporate
    words but always keeps the first word, so "Services" alone stays "services"."""
    words = re.findall(r"[a-z0-9]+", _ascii_fold(name).lower())
    while len(words) > 1 and words[-1] in _SUFFIX_WORDS:
        words.pop()
    return "".join(words)


def domain_of(url: str | None) -> str | None:
    if not url:
        return None
    s = url.strip()
    if "://" not in s:
        s = "https://" + s
    host = urlparse(s).hostname
    if not host:
        return None
    host = host.lower()
    return host[4:] if host.startswith("www.") else host


def _keys(name: str | None, aliases: list[str] | None) -> set[str]:
    return {k for k in (name_key(n) for n in [name or "", *(aliases or [])]) if k}


def find_possible_duplicates(identity: dict, others: list[dict]) -> list[dict]:
    keys = _keys(identity.get("name"), identity.get("aliases"))
    domain = domain_of(identity.get("website"))
    found: list[dict] = []
    for other in others:
        reasons: list[str] = []
        if keys & _keys(other.get("name"), other.get("aliases")):
            reasons.append("name")
        if domain and domain == domain_of(other.get("website")):
            reasons.append("website")
        if reasons:
            found.append({"type": "possible_duplicate", "company_id": other["id"],
                          "company_name": other.get("name"), "reasons": reasons})
    return found
```

`apps/ai-service/app/research/drafts.py`:

```python
"""Draft diffing (spec §4.2 `diff`): compare two snapshots by the VALUES of their Field leaves.
Confidence/provenance changes alone are not a change the admin needs to review."""
from __future__ import annotations

from typing import Any


def _is_field(value: Any) -> bool:
    return isinstance(value, dict) and "value" in value and "provenance" in value


def flatten_snapshot(snapshot: dict, prefix: str = "") -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key in sorted(snapshot):
        value = snapshot[key]
        path = f"{prefix}{key}"
        if _is_field(value):
            out[path] = value["value"]
        elif isinstance(value, dict):
            out.update(flatten_snapshot(value, path + "."))
        elif isinstance(value, list) and value and all(isinstance(x, dict) and "role_key" in x for x in value):
            for entry in value:
                rest = {k: v for k, v in entry.items() if k != "role_key"}
                out.update(flatten_snapshot(rest, f"{path}[{entry['role_key']}]."))
        else:
            out[path] = value
    return out


def snapshot_diff(before: dict | None, after: dict) -> list[dict]:
    b = flatten_snapshot(before or {})
    a = flatten_snapshot(after)
    changes: list[dict] = []
    for path in sorted(b.keys() | a.keys()):
        if path not in b:
            changes.append({"path": path, "change": "added", "before": None, "after": a[path]})
        elif path not in a:
            changes.append({"path": path, "change": "removed", "before": b[path], "after": None})
        elif b[path] != a[path]:
            changes.append({"path": path, "change": "changed", "before": b[path], "after": a[path]})
    return changes
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/research -q`
Expected: PASS.

- [ ] **Step 5: Checkpoint**

Run `git status`; leave the changes uncommitted.

---

## Task 7: Resolve prompt, nodes and the company graph

**Files:**
- Create: `apps/ai-service/app/prompts/research/__init__.py`, `apps/ai-service/app/prompts/research/resolve_company.py`, `apps/ai-service/app/research/nodes/__init__.py`, `apps/ai-service/app/research/nodes/resolve.py`, `apps/ai-service/app/research/nodes/write_draft.py`, `apps/ai-service/app/research/graph.py`
- Test: `apps/ai-service/tests/research/helpers.py`, `apps/ai-service/tests/research/test_nodes.py`, `apps/ai-service/tests/research/test_graph.py`

**Interfaces:**
- Consumes: `ResearchIO` (Task 5), identity and drafts helpers (Task 6), `field`/`unavailable`/`NODE_ORDER`/`PIPELINE_VERSION` (Task 1), `Tracer`/`utcnow`/`new_id` (Task 4).
- Produces:
  - `CompanyState` (TypedDict, `total=False`): `company`, `others`, `identity`, `conflicts`, `draft`.
  - `NodeDeps(io, store, tracer, settings, run_id)` (dataclass).
  - `NODES: dict[str, Callable]`.
  - `is_transient(exc) -> bool`.
  - `build_company_graph(deps, *, retry_initial_interval=2.0)`, a compiled LangGraph with `InMemorySaver`.
  - `resolve(state, deps) -> {"identity", "conflicts"}`.
  - `write_draft(state, deps) -> {"draft": {"status": "created"|"unchanged", "draft_id", "version"}}`.
- **Draft document:** `{draft_id, company_id, version, run_id, status: "pending_review", created_at, snapshot: {"identity": {...}}, conflicts, diff, excluded_role_keys: [], pipeline_version}`.

- [ ] **Step 1: Write the shared test helpers**

`apps/ai-service/tests/research/helpers.py`:

```python
"""Shared scaffolding for research tests: settings, fake clients, wired NodeDeps, and a runner over
the in-memory store. Not a test module (no test_ prefix), so pytest does not collect it."""
from __future__ import annotations

import re
from contextlib import asynccontextmanager

from app.config import Settings
from app.research.budget import Budget
from app.research.fixtures import FixtureStore
from app.research.gateway import ResearchIO
from app.research.graph import NodeDeps
from app.research.models import Mode
from app.research.runner import ResearchRunner
from app.research.targets import ResearchTarget
from app.research.trace.tracer import Tracer, utcnow
from tests.research.fakes import FakeExa, FakeLLM, resolve_answer, result

SECRET = "exa-secret-123"
MEESHO = ResearchTarget(id="c-meesho", name="Meesho", slug="meesho")
RAZORPAY = ResearchTarget(id="c-razorpay", name="Razorpay", slug="razorpay", website="https://razorpay.com")


def research_settings(**overrides) -> Settings:
    return Settings(_env_file=None).model_copy(update={"research_concurrency": 1, **overrides})


def company_exa(**kw) -> FakeExa:
    """Answers "<Name> company official website India" with https://<name>.com."""
    def respond(query: str) -> list[dict]:
        name = query.split()[0]
        return [result(f"https://{name.lower()}.com", title=f"{name} — official site")]
    return FakeExa(respond, **kw)


def company_llm(**kw) -> FakeLLM:
    def respond(system: str, user: str, label: str):
        name = re.search(r"Company name as entered: (.+)", user).group(1).strip()
        return resolve_answer(name, f"https://{name.lower()}.com")
    return FakeLLM(respond, **kw)


async def wired_deps(store, tmp_path, *, exa=None, llm=None, mode=Mode.LIVE, run_id="run1",
                     company=MEESHO, others=(), exa_cap=100, llm_cap=100):
    settings = research_settings()
    await store.insert_run({"run_id": run_id, "status": "running", "control": "none", "created_at": utcnow(),
                            "last_seq": 0, "counters": {},
                            "budget": {"exa_used": 0, "exa_cap": exa_cap, "llm_used": 0, "llm_cap": llm_cap,
                                       "tokens_in": 0, "tokens_out": 0}})
    await store.insert_items([{"run_id": run_id, "company_id": company.id, "company_name": company.name,
                               "company_slug": company.slug, "position": 0, "status": "running", "nodes": {}}])
    tracer = Tracer(store, run_id, secrets={"EXA_API_KEY": SECRET}, flush_interval=0.01)
    await tracer.start()
    budget = Budget(store, run_id, exa_cap=exa_cap, llm_cap=llm_cap)
    io = ResearchIO(mode=mode, exa=exa or company_exa(), llm=llm or company_llm(),
                    fixtures=FixtureStore(tmp_path / "fixtures"), tracer=tracer, budget=budget,
                    store=store, settings=settings)
    deps = NodeDeps(io=io, store=store, tracer=tracer, settings=settings, run_id=run_id)
    state = {"company": company.as_dict(), "others": [o.as_dict() for o in others]}
    return deps, tracer, state


def make_runner(store, tmp_path, *, targets=None, exa=None, llm=None, **overrides):
    """A runner over `store` with fake clients. Returns (runner, live_targets); mutate
    live_targets to simulate an admin archiving a company mid-run."""
    settings = research_settings(research_fixtures_dir=str(tmp_path / "fixtures"), **overrides)
    live_targets = list(targets if targets is not None else [MEESHO, RAZORPAY])
    exa = exa or company_exa()
    llm = llm or company_llm()

    @asynccontextmanager
    async def clients():
        yield exa, llm

    async def fetch():
        return list(live_targets)

    runner = ResearchRunner(store=store, settings=settings, targets=fetch, clients=clients,
                            secrets={"EXA_API_KEY": SECRET}, retry_initial_interval=0.01)
    return runner, live_targets
```

`helpers.py` imports `app.research.runner` and `app.research.targets`, which Task 8 creates. Task 7's tests import only `wired_deps`, `MEESHO` and `RAZORPAY`. To keep Task 7 green on its own, create **minimal** versions of both modules now (Task 8 replaces them in full).

`apps/ai-service/app/research/targets.py` (minimal; Task 8 adds fetching):

```python
"""Research targets: the active companies interviewiq-api says to research (spec §3.1)."""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ResearchTarget:
    id: str
    name: str
    slug: str
    website: str | None = None
    aliases: tuple[str, ...] = ()

    def as_dict(self) -> dict:
        return {"id": self.id, "name": self.name, "slug": self.slug, "website": self.website,
                "aliases": list(self.aliases)}
```

`apps/ai-service/app/research/runner.py` (placeholder, replaced in full by Task 8):

```python
"""Replaced in full by Task 8 (the run driver)."""


class ResearchRunner:  # pragma: no cover — Task 8 replaces this module
    def __init__(self, **kwargs):
        raise NotImplementedError("ResearchRunner is implemented in Task 8")
```

- [ ] **Step 2: Write the failing node and graph tests**

`apps/ai-service/tests/research/test_nodes.py`:

```python
import asyncio

import pytest
from pydantic import ValidationError

from app.research.memory_store import InMemoryResearchStore
from app.research.nodes.resolve import resolve
from app.research.nodes.write_draft import write_draft
from app.research.store import EventFilter
from app.research.targets import ResearchTarget
from tests.research.fakes import FakeExa, FakeLLM, resolve_answer, result
from tests.research.helpers import MEESHO, RAZORPAY, wired_deps


def test_resolve_takes_identity_from_evidence_backed_llm_output(tmp_path):
    async def go():
        store = InMemoryResearchStore()
        deps, tracer, state = await wired_deps(store, tmp_path)
        out = await resolve(state, deps)
        await tracer.close()
        ident = out["identity"]
        assert ident["name"] == {"value": "Meesho", "confidence": "high", "provenance": "evidence",
                                 "source_urls": ["https://meesho.com"], "note": None}
        assert ident["website"]["value"] == "https://meesho.com" and ident["website"]["provenance"] == "evidence"
        assert out["conflicts"] == []
    asyncio.run(go())


def test_admin_website_wins_and_disagreement_is_noted(tmp_path):
    async def go():
        store = InMemoryResearchStore()
        llm = FakeLLM(lambda s, u, label: resolve_answer("Razorpay", "https://razorpay-mirror.com") | {
            "evidence_urls": ["https://razorpay.com"]})
        exa = FakeExa(lambda q: [result("https://razorpay.com")])
        deps, tracer, state = await wired_deps(store, tmp_path, company=RAZORPAY, llm=llm, exa=exa)
        out = await resolve(state, deps)
        await tracer.close()
        site = out["identity"]["website"]
        assert site["value"] == "https://razorpay.com" and site["provenance"] == "admin_override"
        assert site["note"] == "research found https://razorpay-mirror.com"
    asyncio.run(go())


def test_evidence_not_in_results_downgrades_confidence(tmp_path):
    async def go():
        store = InMemoryResearchStore()
        llm = FakeLLM(lambda s, u, label: resolve_answer("Meesho", "https://meesho.com") | {
            "evidence_urls": ["https://invented.example"]})
        deps, tracer, state = await wired_deps(store, tmp_path, llm=llm)
        out = await resolve(state, deps)
        await tracer.close()
        assert out["identity"]["name"]["confidence"] == "low"
        assert out["identity"]["name"]["provenance"] == "derived"
        assert out["identity"]["name"]["source_urls"] == []
    asyncio.run(go())


def test_not_a_company_and_duplicates_become_conflicts(tmp_path):
    async def go():
        store = InMemoryResearchStore()
        llm = FakeLLM(lambda s, u, label: resolve_answer("Meesho", "https://meesho.com") | {
            "is_company": False, "reasoning": "a shopping term"})
        twin = ResearchTarget(id="c-twin", name="Meesho India", slug="meesho-india")
        deps, tracer, state = await wired_deps(store, tmp_path, llm=llm, others=[twin])
        out = await resolve(state, deps)
        await tracer.close()
        types = [c["type"] for c in out["conflicts"]]
        assert types == ["not_a_company", "possible_duplicate"]
        assert out["conflicts"][1]["company_id"] == "c-twin"
    asyncio.run(go())


def test_resolve_rejects_output_without_a_name(tmp_path):
    async def go():
        store = InMemoryResearchStore()
        llm = FakeLLM(lambda s, u, label: {"is_company": True})
        deps, tracer, state = await wired_deps(store, tmp_path, llm=llm)
        with pytest.raises(ValidationError):
            await resolve(state, deps)
        await tracer.close()
    asyncio.run(go())


def test_write_draft_creates_then_skips_unchanged_then_versions_changes(tmp_path):
    async def go():
        store = InMemoryResearchStore()
        deps, tracer, state = await wired_deps(store, tmp_path)
        state = {**state, **(await resolve(state, deps))}
        first = await write_draft(state, deps)
        again = await write_draft(state, deps)
        changed = {**state, "identity": {**state["identity"], "aliases": {**state["identity"]["aliases"], "value": ["Fashnear"]}}}
        third = await write_draft(changed, deps)
        await tracer.close()
        assert first["draft"]["status"] == "created" and first["draft"]["version"] == 1
        assert again["draft"] == {"status": "unchanged", "draft_id": first["draft"]["draft_id"], "version": 1}
        assert third["draft"]["status"] == "created" and third["draft"]["version"] == 2
        v1, v2 = sorted(store.drafts, key=lambda d: d["version"])
        assert v1["status"] == "superseded" and v2["status"] == "pending_review"
        assert {c["path"] for c in v1["diff"]} == {"identity.aliases", "identity.name", "identity.website"}
        assert v2["snapshot"] == {"identity": changed["identity"]}
        created = await store.list_events("run1", EventFilter(type_prefix="draft.created"))
        assert len(created) == 2
    asyncio.run(go())
```

`apps/ai-service/tests/research/test_graph.py`:

```python
import asyncio

from app.research.graph import build_company_graph, is_transient
from app.research.memory_store import InMemoryResearchStore
from app.exa.client import ExaConfigError, ExaError
from app.llm.client import LLMError
from app.research.budget import BudgetExhausted
from app.research.fixtures import FixtureMissing
from tests.research.helpers import wired_deps


def test_graph_runs_both_nodes_in_order_and_tracks_node_progress(tmp_path):
    async def go():
        store = InMemoryResearchStore()
        deps, tracer, state = await wired_deps(store, tmp_path)
        graph = build_company_graph(deps, retry_initial_interval=0.01)
        updates = [u async for u in graph.astream(state, {"configurable": {"thread_id": "t"}}, stream_mode="updates")]
        await tracer.close()
        assert [next(iter(u)) for u in updates] == ["resolve", "write_draft"]
        (item,) = await store.list_items("run1")
        assert item["nodes"]["resolve"]["status"] == "ok" and item["nodes"]["write_draft"]["status"] == "ok"
        assert item["nodes"]["resolve"]["llm_calls"] == 1 and item["nodes"]["resolve"]["exa_calls"] == 1
        node_spans = [s for s in await store.list_spans("run1") if s["kind"] == "node"]
        assert [s["name"] for s in node_spans] == ["resolve", "write_draft"]
        resolve_span = await store.get_span(node_spans[0]["span_id"])
        assert "others" not in resolve_span["input"] and resolve_span["input"]["others_count"] == 0
    asyncio.run(go())


def test_transient_errors_are_exactly_the_retryable_ones():
    assert is_transient(ExaError("503"))
    assert is_transient(LLMError("429"))
    assert not is_transient(ExaConfigError("bad key"))
    assert not is_transient(BudgetExhausted("llm", 1, 1))
    assert not is_transient(FixtureMissing("x"))
    assert not is_transient(ValueError("bad output"))
```

- [ ] **Step 3: Run them to verify they fail**

Run: `.venv/bin/python -m pytest tests/research/test_nodes.py tests/research/test_graph.py -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.research.graph'`.

- [ ] **Step 4: Implement the prompt**

`apps/ai-service/app/prompts/research/__init__.py`:

```python
"""Prompts for the company research pipeline. Every prompt here is a DRAFT for human review before
production use (prompts are product IP; spec §14)."""
```

`apps/ai-service/app/prompts/research/resolve_company.py`:

```python
"""Company identity resolution: DRAFT v1, for human review before production use.

Input: the admin-entered name / website / aliases plus the top Exa results.
Output: the company's canonical identity, with evidence URLs drawn ONLY from those results."""
from __future__ import annotations

import json

PROMPT_NAME = "resolve_company"
PROMPT_VERSION = "v1"
_SNIPPET_CHARS = 1500

SYSTEM = """You identify companies for an Indian interview-preparation platform.
You get the name an admin typed, optional hints, and web search results.
Answer ONLY with one JSON object, no prose:
{
  "is_company": true or false,
  "canonical_name": "the name the company uses for itself, e.g. Meesho",
  "website": "the official homepage URL, or null",
  "aliases": ["other names people use: legal entity, former names, Indian subsidiary"],
  "confidence": "high" or "medium" or "low",
  "evidence_urls": ["URLs from the results that support this"],
  "reasoning": "one or two sentences"
}
Rules:
- Use ONLY the search results. Never invent a website or alias they do not support.
- website is the company's own homepage: never a job board, news site, Wikipedia or LinkedIn.
- At most 6 aliases, and do not repeat canonical_name.
- Copy evidence_urls exactly from the results.
- If the results describe something that is not a company (a person, a product category, nothing relevant), set is_company to false.
- confidence: high = the official site is in the results; medium = consistent third-party evidence only; low = thin or conflicting evidence."""


def build_user(*, name: str, website_hint: str | None, aliases_hint: list[str], results: list[dict]) -> str:
    lines = [
        f"Company name as entered: {name}",
        f"Website hint from admin: {website_hint or 'none'}",
        f"Known aliases: {', '.join(aliases_hint) if aliases_hint else 'none'}",
        "",
        "Search results:",
    ]
    for i, r in enumerate(results, 1):
        lines.append(json.dumps({"n": i, "url": r.get("url"), "title": r.get("title"), "date": r.get("date"),
                                 "text": (r.get("content") or "")[:_SNIPPET_CHARS]}, ensure_ascii=False))
    if not results:
        lines.append("(no results)")
    return "\n".join(lines)
```

- [ ] **Step 5: Implement the nodes**

`apps/ai-service/app/research/nodes/__init__.py`:

```python
"""LangGraph nodes for the per-company research graph (spec §3.2)."""
```

`apps/ai-service/app/research/nodes/resolve.py`:

```python
"""resolve (spec §3.2 node 1): canonical name, official website and aliases, plus a duplicate check
against the other companies in the catalogue. A likely duplicate never blocks the run: it lands
on the draft as a `possible_duplicate` conflict for the admin to decide."""
from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Literal

from pydantic import BaseModel, Field as PField

from app.prompts.research import resolve_company as prompt
from app.research.models import field, unavailable
from app.research.normalize.identity import domain_of, find_possible_duplicates, name_key

if TYPE_CHECKING:
    from app.research.graph import CompanyState, NodeDeps

logger = logging.getLogger(__name__)

QUERY_TEMPLATE = "{name} company official website India"
_MAX_ALIASES = 6


class ResolveOutput(BaseModel):
    is_company: bool = True
    canonical_name: str = PField(min_length=1)
    website: str | None = None
    aliases: list[str] = []
    confidence: Literal["high", "medium", "low"] = "low"
    evidence_urls: list[str] = []
    reasoning: str = ""


async def resolve(state: "CompanyState", deps: "NodeDeps") -> dict:
    company = state["company"]
    query = QUERY_TEMPLATE.format(name=company["name"])
    results = await deps.io.search(query, company_slug=company["slug"], kind="resolve")
    logger.info("resolve %s: %d search result(s)", company["name"], len(results))

    raw = await deps.io.extract_json(
        prompt_name=prompt.PROMPT_NAME, prompt_version=prompt.PROMPT_VERSION, system=prompt.SYSTEM,
        user=prompt.build_user(name=company["name"], website_hint=company.get("website"),
                               aliases_hint=list(company.get("aliases") or []), results=results),
        company_slug=company["slug"], label=f"resolve:{company['slug']}",
    )
    out = ResolveOutput.model_validate(raw)

    result_urls = {r["url"] for r in results}
    evidence = [u for u in out.evidence_urls if u in result_urls]
    dropped = [u for u in out.evidence_urls if u not in result_urls]
    if dropped:
        logger.warning("resolve %s: ignoring %d evidence URL(s) not in the search results: %s",
                       company["name"], len(dropped), dropped)
    confidence = out.confidence if evidence else "low"
    provenance = "evidence" if evidence else "derived"

    name = field(out.canonical_name.strip(), confidence=confidence, provenance=provenance, source_urls=evidence)
    website = _website_field(company.get("website"), out.website, confidence, provenance, evidence)
    aliases = _aliases(company, out)
    identity = {
        "name": name,
        "website": website,
        "aliases": field(aliases, confidence=confidence, provenance=provenance, source_urls=evidence),
    }

    conflicts: list[dict] = []
    if not out.is_company:
        conflicts.append({"type": "not_a_company", "message": out.reasoning or "the search results do not describe a company"})
    conflicts += find_possible_duplicates(
        {"name": name["value"], "website": website["value"], "aliases": aliases}, state.get("others") or [],
    )
    for c in conflicts:
        logger.warning("resolve %s: conflict %s", company["name"], c)
    return {"identity": identity, "conflicts": conflicts}


def _website_field(admin_site: str | None, found: str | None, confidence: str, provenance: str,
                   evidence: list[str]) -> dict:
    if admin_site:
        note = f"research found {found}" if found and domain_of(found) != domain_of(admin_site) else None
        return field(admin_site, confidence="high", provenance="admin_override", note=note)
    if found:
        return field(found, confidence=confidence, provenance=provenance, source_urls=evidence)
    return unavailable("no official website in the search results")


def _aliases(company: dict, out: ResolveOutput) -> list[str]:
    canonical = name_key(out.canonical_name)
    seen: set[str] = set()
    aliases: list[str] = []
    for alias in [*(company.get("aliases") or []), *out.aliases, company["name"]]:
        alias = alias.strip()
        key = name_key(alias)
        if not alias or not key or key == canonical or key in seen:
            continue
        seen.add(key)
        aliases.append(alias)
    return aliases[:_MAX_ALIASES]
```

`apps/ai-service/app/research/nodes/write_draft.py`:

```python
"""write_draft (spec §3.2 node 8): persist the end-result snapshot as a pending_review draft with a
diff against the last APPROVED snapshot. If nothing changed since the latest draft, write nothing
and report "unchanged"; the runner then marks the company `skipped` (no no-op review items)."""
from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from app.research.drafts import snapshot_diff
from app.research.models import PIPELINE_VERSION
from app.research.trace.tracer import new_id, utcnow

if TYPE_CHECKING:
    from app.research.graph import CompanyState, NodeDeps

logger = logging.getLogger(__name__)


async def write_draft(state: "CompanyState", deps: "NodeDeps") -> dict:
    company = state["company"]
    snapshot = {"identity": state["identity"]}
    conflicts = state.get("conflicts") or []

    latest = await deps.store.latest_draft(company["id"])
    if latest and latest["snapshot"] == snapshot and (latest.get("conflicts") or []) == conflicts:
        logger.info("write_draft %s: unchanged since draft v%d", company["name"], latest["version"])
        return {"draft": {"status": "unchanged", "draft_id": latest["draft_id"], "version": latest["version"]}}

    published = await deps.store.latest_draft(company["id"], status="approved")
    version = (latest["version"] if latest else 0) + 1
    diff = snapshot_diff(published["snapshot"] if published else None, snapshot)
    superseded = await deps.store.supersede_pending_drafts(company["id"])
    draft = {
        "draft_id": new_id(), "company_id": company["id"], "version": version, "run_id": deps.run_id,
        "status": "pending_review", "created_at": utcnow(), "snapshot": snapshot, "conflicts": conflicts,
        "diff": diff, "excluded_role_keys": [], "pipeline_version": PIPELINE_VERSION,
    }
    await deps.store.insert_draft(draft)
    deps.tracer.emit(
        "draft.created", f"{company['name']}: draft v{version} · {len(diff)} change(s) · {len(conflicts)} conflict(s)",
        level="info", data={"draft_id": draft["draft_id"], "version": version, "superseded": superseded},
    )
    return {"draft": {"status": "created", "draft_id": draft["draft_id"], "version": version}}
```

- [ ] **Step 6: Implement the graph**

`apps/ai-service/app/research/graph.py`:

```python
"""The per-company research graph (spec §3.2): a LangGraph StateGraph over CompanyState, one node per
NODE_ORDER entry, each wrapped in a traced span plus item progress updates, with a RetryPolicy for
transient Exa/LLM failures.

Durability does NOT come from a LangGraph checkpointer (spec §3.2): the runner saves the merged state
and last completed node on the research item after every node, and on resume seeds a fresh
InMemorySaver thread with aupdate_state(state, as_node=last_node)."""
from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from itertools import pairwise
from typing import Any, TypedDict

import httpx
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import END, START, StateGraph
from langgraph.types import RetryPolicy

from app.config import Settings
from app.exa.client import ExaConfigError, ExaError
from app.llm.client import LLMError
from app.research.gateway import ResearchIO
from app.research.models import NODE_ORDER
from app.research.nodes.resolve import resolve
from app.research.nodes.write_draft import write_draft
from app.research.store import ResearchStore
from app.research.trace.tracer import Tracer, utcnow


class CompanyState(TypedDict, total=False):
    company: dict          # the target {id, name, slug, website, aliases}
    others: list[dict]     # every other target, for duplicate detection
    identity: dict         # resolve → {name, website, aliases} Fields
    conflicts: list[dict]
    draft: dict            # write_draft → {status, draft_id, version}


@dataclass
class NodeDeps:
    io: ResearchIO
    store: ResearchStore
    tracer: Tracer
    settings: Settings
    run_id: str


NodeFn = Callable[[CompanyState, NodeDeps], Awaitable[dict]]
NODES: dict[str, NodeFn] = {"resolve": resolve, "write_draft": write_draft}


def is_transient(exc: BaseException) -> bool:
    """Retry only what a retry can fix: network blips, 429s, 5xx. Bad keys, exhausted budgets,
    missing fixtures and invalid model output fail immediately."""
    if isinstance(exc, ExaConfigError):
        return False
    return isinstance(exc, (ExaError, LLMError, httpx.TransportError))


def _node_input(state: CompanyState) -> dict[str, Any]:
    shown: dict[str, Any] = {k: v for k, v in state.items() if k != "others"}
    shown["others_count"] = len(state.get("others") or [])
    return shown


def _traced(name: str, fn: NodeFn, deps: NodeDeps):
    async def run(state: CompanyState) -> dict:
        company_id = state["company"]["id"]
        await deps.store.update_item(deps.run_id, company_id, fields={
            "current_node": name, f"nodes.{name}.status": "running", f"nodes.{name}.started_at": utcnow(),
        })
        try:
            async with deps.tracer.span("node", name, input=_node_input(state), node=name,
                                        company_id=company_id) as sp:
                out = await fn(state, deps)
                sp.set_output(out)
        except Exception as exc:
            await deps.store.update_item(deps.run_id, company_id, fields={
                f"nodes.{name}.status": "error", f"nodes.{name}.error": f"{type(exc).__name__}: {exc}"[:500],
                f"nodes.{name}.finished_at": utcnow(),
            })
            raise
        await deps.store.update_item(deps.run_id, company_id, fields={
            f"nodes.{name}.status": "ok", f"nodes.{name}.finished_at": utcnow(),
        })
        return out
    run.__name__ = name
    return run


def build_company_graph(deps: NodeDeps, *, retry_initial_interval: float = 2.0):
    retry = RetryPolicy(max_attempts=3, initial_interval=retry_initial_interval, backoff_factor=2.0,
                        retry_on=is_transient)
    g = StateGraph(CompanyState)
    for name in NODE_ORDER:
        g.add_node(name, _traced(name, NODES[name], deps), retry_policy=retry)
    g.add_edge(START, NODE_ORDER[0])
    for a, b in pairwise(NODE_ORDER):
        g.add_edge(a, b)
    g.add_edge(NODE_ORDER[-1], END)
    return g.compile(checkpointer=InMemorySaver())
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/research -q`
Expected: PASS.

- [ ] **Step 8: Checkpoint**

Run `git status`; leave the changes uncommitted.

---

## Task 8: Targets and the run driver (start, pause, resume, stop, budget, recovery)

**Files:**
- Modify (replace the Task 7 minimal versions): `apps/ai-service/app/research/targets.py`, `apps/ai-service/app/research/runner.py`
- Test: `apps/ai-service/tests/research/test_targets.py`, `apps/ai-service/tests/research/test_runner.py`

**Interfaces:**
- Consumes: everything above.
- Produces:
  - `ResearchTarget.from_row(row)`, `fetch_research_targets(settings) -> list[ResearchTarget]` and `TargetsUnavailable`.
  - `RunActive(run_id)`, `RunNotFound` and `NoCompaniesSelected`.
  - `ResearchRunner(*, store, settings, targets, clients, secrets, echo=None, retry_initial_interval=2.0)` with:
    - `.store` and `.busy`;
    - `await .start_run(*, trigger, scope="all", company_ids=None, mode=None, requested_by=None) -> run`;
    - `await .pause(run_id)`, `await .resume(run_id)` and `await .stop(run_id)`, each returning the run;
    - `await .raise_budget(run_id, *, exa_cap=None, llm_cap=None) -> run`;
    - `await .recover_on_startup()`;
    - `await .wait_idle()`.
- **Run document:** `{run_id, trigger, mode, scope, company_ids, targets, status, control, pause_reason, requested_by, counters{total, queued, running, paused, done, failed, skipped, cancelled}, budget{exa_used, exa_cap, llm_used, llm_cap, tokens_in, tokens_out}, last_seq, created_at, started_at, finished_at, error, pipeline_version}`.
- **Item document:** `{run_id, company_id, company_name, company_slug, position, target, status, attempts, current_node, last_node, state, nodes{<node>: {status, started_at, finished_at, exa_calls, llm_calls, error}}, draft_id, error, started_at, finished_at}`.
- **Company state:** `{company_id, last_run_id, last_status, last_researched_at, latest_draft_id, latest_draft_status}`.

- [ ] **Step 1: Write the failing targets tests**

`apps/ai-service/tests/research/test_targets.py`:

```python
import asyncio

import httpx
import pytest

import app.research.targets as targets_mod
from app.config import Settings
from app.research.targets import ResearchTarget, TargetsUnavailable, fetch_research_targets

REAL_CLIENT = httpx.AsyncClient


def _patch(monkeypatch, handler):
    monkeypatch.setattr(targets_mod.httpx, "AsyncClient",
                        lambda **kw: REAL_CLIENT(transport=httpx.MockTransport(handler), **kw))


def test_fetch_parses_rows_sends_the_internal_key_and_skips_malformed(monkeypatch):
    seen = {}

    def handler(req):
        seen["url"], seen["key"] = str(req.url), req.headers.get("x-internal-api-key")
        return httpx.Response(200, json=[
            {"id": "c1", "name": "Meesho", "slug": "meesho", "website": None, "aliases": ["Fashnear"]},
            {"name": "no id"},
        ])
    _patch(monkeypatch, handler)
    settings = Settings(_env_file=None).model_copy(update={"api_base_url": "http://api.test", "internal_api_key": "k"})
    got = asyncio.run(fetch_research_targets(settings))
    assert got == [ResearchTarget(id="c1", name="Meesho", slug="meesho", website=None, aliases=("Fashnear",))]
    assert seen == {"url": "http://api.test/api/v1/internal/research-targets", "key": "k"}


def test_fetch_failure_raises_targets_unavailable(monkeypatch):
    _patch(monkeypatch, lambda req: httpx.Response(503, text="down"))
    with pytest.raises(TargetsUnavailable, match="research-targets"):
        asyncio.run(fetch_research_targets(Settings(_env_file=None)))
```

- [ ] **Step 2: Write the failing runner tests**

`apps/ai-service/tests/research/test_runner.py`:

```python
import asyncio
import json
from datetime import timedelta

import pytest

from app.exa.client import ExaError
from app.research.memory_store import InMemoryResearchStore
from app.research.models import InvalidTransition
from app.research.runner import RunActive
from app.research.store import EventFilter
from app.research.trace.tracer import utcnow
from tests.research.fakes import Exploding, FakeLLM, resolve_answer
from tests.research.helpers import MEESHO, RAZORPAY, SECRET, company_exa, company_llm, make_runner


def _statuses(items):
    return {i["company_id"]: i["status"] for i in items}


class HookStore(InMemoryResearchStore):
    """Lets a test act at the moment write_draft persists (i.e. inside the LAST node)."""
    on_draft = None

    async def insert_draft(self, draft):
        await super().insert_draft(draft)
        if self.on_draft:
            await self.on_draft()


def test_run_completes_writes_drafts_and_traces_everything(tmp_path):
    async def go():
        store = InMemoryResearchStore()
        runner, _ = make_runner(store, tmp_path)
        run = await runner.start_run(trigger="admin", scope="all")
        assert run["status"] == "queued" and run["counters"]["total"] == 2
        await runner.wait_idle()
        run = await store.get_run(run["run_id"])
        items = await store.list_items(run["run_id"])
        assert run["status"] == "completed" and run["finished_at"] is not None
        assert _statuses(items) == {"c-meesho": "done", "c-razorpay": "done"}
        c = run["counters"]
        assert (c["done"], c["queued"], c["running"]) == (2, 0, 0)
        assert {d["company_id"]: d["status"] for d in store.drafts} == {"c-meesho": "pending_review", "c-razorpay": "pending_review"}
        state = {s["company_id"]: s for s in await store.list_company_states()}
        assert state["c-meesho"]["last_status"] == "done" and state["c-meesho"]["latest_draft_status"] == "pending_review"
        kinds = {s["kind"] for s in await store.list_spans(run["run_id"])}
        assert kinds == {"run", "company", "node", "exa", "llm"}
        types = [e["type"] for e in await store.list_events(run["run_id"], EventFilter(min_level="info"))]
        assert types[0] == "run.started" and types[-1] == "run.completed"
        assert run["last_seq"] == len(await store.list_events(run["run_id"], EventFilter(limit=10_000)))
    asyncio.run(go())


def test_second_run_with_no_changes_skips_every_company(tmp_path):
    async def go():
        store = InMemoryResearchStore()
        runner, _ = make_runner(store, tmp_path)
        await runner.start_run(trigger="admin", scope="selected", company_ids=["c-meesho"])
        await runner.wait_idle()
        run = await runner.start_run(trigger="admin", scope="selected", company_ids=["c-meesho"])
        await runner.wait_idle()
        assert _statuses(await store.list_items(run["run_id"])) == {"c-meesho": "skipped"}
        assert len(store.drafts) == 1
    asyncio.run(go())


def test_pause_after_first_node_then_resume_runs_each_node_exactly_once(tmp_path):
    async def go():
        store = InMemoryResearchStore()
        holder = {}

        async def pause_on_first(label):
            if label == "resolve:meesho" and "paused" not in holder:
                holder["paused"] = True
                await runner.pause(holder["run_id"])
        llm = company_llm(on_call=pause_on_first)
        runner, _ = make_runner(store, tmp_path, llm=llm)
        run = await runner.start_run(trigger="admin", scope="all")
        holder["run_id"] = run["run_id"]
        await runner.wait_idle()
        run = await store.get_run(run["run_id"])
        items = {i["company_id"]: i for i in await store.list_items(run["run_id"])}
        assert run["status"] == "paused" and run["pause_reason"] == "admin"
        assert items["c-meesho"]["status"] == "paused" and items["c-meesho"]["last_node"] == "resolve"
        assert items["c-razorpay"]["status"] == "queued"
        assert store.drafts == []

        await runner.resume(run["run_id"])
        await runner.wait_idle()
        run = await store.get_run(run["run_id"])
        assert run["status"] == "completed"
        assert _statuses(await store.list_items(run["run_id"])) == {"c-meesho": "done", "c-razorpay": "done"}
        assert llm.calls == ["resolve:meesho", "resolve:razorpay"]           # resolve never re-ran
        meesho_nodes = [s for s in await store.list_spans(run["run_id"], "c-meesho") if s["kind"] == "node"]
        assert [s["name"] for s in meesho_nodes] == ["resolve", "write_draft"]
        resumed = [s for s in await store.list_spans(run["run_id"], "c-meesho") if s["kind"] == "company"]
        assert [s["attrs"]["resumed_after"] for s in resumed] == [None, "resolve"]
        assert len(store.drafts) == 2
    asyncio.run(go())


def test_pause_during_last_node_lets_the_company_finish(tmp_path):
    async def go():
        store = HookStore()
        holder = {}

        async def pause_once():
            if "paused" not in holder:
                holder["paused"] = True
                await runner.pause(holder["run_id"])
        store.on_draft = pause_once
        runner, _ = make_runner(store, tmp_path)
        run = await runner.start_run(trigger="admin", scope="all")
        holder["run_id"] = run["run_id"]
        await runner.wait_idle()
        assert (await store.get_run(run["run_id"]))["status"] == "paused"
        assert _statuses(await store.list_items(run["run_id"])) == {"c-meesho": "done", "c-razorpay": "queued"}
    asyncio.run(go())


def test_stop_cancels_clears_state_and_writes_no_draft(tmp_path):
    async def go():
        store = InMemoryResearchStore()
        holder = {}

        async def stop_on_first(label):
            if "stopped" not in holder:
                holder["stopped"] = True
                await runner.stop(holder["run_id"])
        runner, _ = make_runner(store, tmp_path, llm=company_llm(on_call=stop_on_first))
        run = await runner.start_run(trigger="admin", scope="all")
        holder["run_id"] = run["run_id"]
        await runner.wait_idle()
        run = await store.get_run(run["run_id"])
        items = await store.list_items(run["run_id"])
        assert run["status"] == "stopped" and run["control"] == "none"
        assert _statuses(items) == {"c-meesho": "cancelled", "c-razorpay": "cancelled"}
        assert all(i["state"] is None and i["last_node"] is None for i in items)
        assert store.drafts == []
        assert run["counters"]["cancelled"] == 2
    asyncio.run(go())


def test_stopping_a_paused_run_finishes_without_a_drive(tmp_path):
    async def go():
        store = InMemoryResearchStore()
        holder = {}

        async def pause_once(label):
            if "p" not in holder:
                holder["p"] = True
                await runner.pause(holder["run_id"])
        runner, _ = make_runner(store, tmp_path, llm=company_llm(on_call=pause_once))
        run = await runner.start_run(trigger="admin", scope="all")
        holder["run_id"] = run["run_id"]
        await runner.wait_idle()
        stopped = await runner.stop(run["run_id"])
        assert stopped["status"] == "stopped" and not runner.busy
        assert _statuses(await store.list_items(run["run_id"])) == {"c-meesho": "cancelled", "c-razorpay": "cancelled"}
        stopped_events = await store.list_events(run["run_id"], EventFilter(type_prefix="run.stopped"))
        assert len(stopped_events) == 1
    asyncio.run(go())


def test_budget_exhaustion_auto_pauses_and_resume_after_raise_finishes(tmp_path):
    async def go():
        store = InMemoryResearchStore()
        exa, llm = company_exa(), company_llm()
        runner, _ = make_runner(store, tmp_path, exa=exa, llm=llm, research_max_llm_calls=1)
        run = await runner.start_run(trigger="admin", scope="all")
        await runner.wait_idle()
        run = await store.get_run(run["run_id"])
        assert run["status"] == "paused" and run["pause_reason"] == "budget_exhausted"
        assert _statuses(await store.list_items(run["run_id"])) == {"c-meesho": "done", "c-razorpay": "paused"}
        assert len(await store.list_events(run["run_id"], EventFilter(type_prefix="budget.exhausted"))) == 1

        with pytest.raises(ValueError, match="below calls already made"):
            await runner.raise_budget(run["run_id"], llm_cap=0)
        await runner.raise_budget(run["run_id"], llm_cap=5)
        await runner.resume(run["run_id"])
        await runner.wait_idle()
        run = await store.get_run(run["run_id"])
        assert run["status"] == "completed" and run["budget"]["llm_used"] == 2 and run["budget"]["llm_cap"] == 5
        assert len(exa.calls) == 3     # razorpay's resolve search ran again after the pause
        assert llm.calls == ["resolve:meesho", "resolve:razorpay"]
    asyncio.run(go())


def test_crash_recovery_resumes_from_the_saved_node_then_fails_a_crash_loop(tmp_path):
    async def go():
        store = InMemoryResearchStore()
        holder = {}

        async def pause_once(label):
            if "p" not in holder:
                holder["p"] = True
                await runner.pause(holder["run_id"])
        runner, _ = make_runner(store, tmp_path, llm=company_llm(on_call=pause_once))
        run = await runner.start_run(trigger="admin", scope="all")
        holder["run_id"] = run["run_id"]
        await runner.wait_idle()
        run_id = run["run_id"]
        # Simulate the process dying mid-node: the run and Meesho look "running" in the store.
        await store.update_run(run_id, fields={"status": "running", "control": "none"})
        await store.update_item(run_id, "c-meesho", fields={"status": "running"})

        llm2 = company_llm()
        fresh, _ = make_runner(store, tmp_path, llm=llm2)       # a new process
        await fresh.recover_on_startup()
        await fresh.wait_idle()
        items = {i["company_id"]: i for i in await store.list_items(run_id)}
        assert (await store.get_run(run_id))["status"] == "completed"
        assert items["c-meesho"]["status"] == "done" and items["c-meesho"]["attempts"] == 2
        assert llm2.calls == ["resolve:razorpay"]                  # Meesho resumed at write_draft
        recovered = await store.list_events(run_id, EventFilter(type_prefix="run.recovered"))
        assert len(recovered) == 1

        # Second crash on the same company → crash loop → failed, not retried again.
        await store.update_run(run_id, fields={"status": "running"})
        await store.update_item(run_id, "c-meesho", fields={"status": "running", "attempts": 2})
        again, _ = make_runner(store, tmp_path, llm=Exploding())
        await again.recover_on_startup()
        await again.wait_idle()
        meesho = next(i for i in await store.list_items(run_id) if i["company_id"] == "c-meesho")
        assert meesho["status"] == "failed" and meesho["error"]["type"] == "CrashLoop"
    asyncio.run(go())


def test_paused_runs_are_left_alone_on_restart(tmp_path):
    async def go():
        store = InMemoryResearchStore()
        holder = {}

        async def pause_once(label):
            if "p" not in holder:
                holder["p"] = True
                await runner.pause(holder["run_id"])
        runner, _ = make_runner(store, tmp_path, llm=company_llm(on_call=pause_once))
        run = await runner.start_run(trigger="admin", scope="all")
        holder["run_id"] = run["run_id"]
        await runner.wait_idle()
        fresh, _ = make_runner(store, tmp_path, llm=Exploding())
        await fresh.recover_on_startup()
        assert not fresh.busy and (await store.get_run(run["run_id"]))["status"] == "paused"
    asyncio.run(go())


def test_concurrent_starts_create_exactly_one_run(tmp_path):
    async def go():
        store = InMemoryResearchStore()
        runner, _ = make_runner(store, tmp_path)
        results = await asyncio.gather(
            runner.start_run(trigger="admin", scope="all"), runner.start_run(trigger="admin", scope="all"),
            return_exceptions=True,
        )
        await runner.wait_idle()
        assert sum(isinstance(r, dict) for r in results) == 1
        assert sum(isinstance(r, RunActive) for r in results) == 1
        assert len(store.runs) == 1
    asyncio.run(go())


def test_resume_is_only_allowed_from_paused(tmp_path):
    async def go():
        store = InMemoryResearchStore()
        runner, _ = make_runner(store, tmp_path)
        run = await runner.start_run(trigger="admin", scope="all")
        await runner.wait_idle()
        with pytest.raises(InvalidTransition):
            await runner.resume(run["run_id"])
    asyncio.run(go())


def test_one_company_failing_does_not_stop_the_others(tmp_path):
    async def go():
        store = InMemoryResearchStore()

        def respond(system, user, label):
            return {"is_company": True} if label == "resolve:meesho" else resolve_answer("Razorpay", "https://razorpay.com")
        runner, _ = make_runner(store, tmp_path, llm=FakeLLM(respond))
        run = await runner.start_run(trigger="admin", scope="all")
        await runner.wait_idle()
        run = await store.get_run(run["run_id"])
        items = {i["company_id"]: i for i in await store.list_items(run["run_id"])}
        assert run["status"] == "completed" and run["counters"]["failed"] == 1 and run["counters"]["done"] == 1
        assert items["c-meesho"]["status"] == "failed"
        assert items["c-meesho"]["error"]["code_ref"] == "app/research/nodes/resolve.py:resolve"
        assert items["c-razorpay"]["status"] == "done"
        state = {s["company_id"]: s for s in await store.list_company_states()}
        assert state["c-meesho"]["last_status"] == "failed" and "last_researched_at" not in state["c-meesho"]
    asyncio.run(go())


def test_secrets_in_upstream_errors_are_redacted_everywhere(tmp_path):
    async def go():
        store = InMemoryResearchStore()
        exa = company_exa(fail=ExaError(f"Exa returned 401 for key {SECRET}"))
        runner, _ = make_runner(store, tmp_path, exa=exa, targets=[MEESHO])
        run = await runner.start_run(trigger="admin", scope="all")
        await runner.wait_idle()
        (item,) = await store.list_items(run["run_id"])
        assert item["status"] == "failed" and "«redacted:EXA_API_KEY»" in item["error"]["message"]
        assert len(exa.calls) == 3          # transient → retried 3× by the node RetryPolicy
        everything = json.dumps([store.runs, list(store.items.values()), store.spans, store.events], default=str)
        assert SECRET not in everything
    asyncio.run(go())


def test_replay_reproduces_a_recorded_run_for_free(tmp_path):
    async def go():
        recorded = InMemoryResearchStore()
        rec_runner, _ = make_runner(recorded, tmp_path)
        await rec_runner.start_run(trigger="admin", scope="all", mode="record")
        await rec_runner.wait_idle()

        replayed = InMemoryResearchStore()
        rep_runner, _ = make_runner(replayed, tmp_path, exa=Exploding(), llm=Exploding())
        run = await rep_runner.start_run(trigger="admin", scope="all", mode="replay")
        await rep_runner.wait_idle()
        run = await replayed.get_run(run["run_id"])
        assert run["status"] == "completed"
        assert (run["budget"]["exa_used"], run["budget"]["llm_used"]) == (0, 0)
        snap = lambda store: {d["company_id"]: d["snapshot"] for d in store.drafts}  # noqa: E731
        assert snap(replayed) == snap(recorded)
    asyncio.run(go())


def test_all_scope_skips_recently_researched_companies(tmp_path):
    async def go():
        store = InMemoryResearchStore()
        await store.upsert_company_state("c-meesho", fields={"last_researched_at": utcnow() - timedelta(days=1)})
        await store.upsert_company_state("c-razorpay", fields={"last_researched_at": utcnow() - timedelta(days=30)})
        runner, _ = make_runner(store, tmp_path)
        run = await runner.start_run(trigger="cron", scope="all")
        await runner.wait_idle()
        assert run["company_ids"] == ["c-razorpay"]
    asyncio.run(go())


def test_company_archived_after_queueing_is_skipped(tmp_path):
    async def go():
        store = InMemoryResearchStore()
        runner, live_targets = make_runner(store, tmp_path)
        run = await runner.start_run(trigger="admin", scope="all")
        live_targets.remove(MEESHO)            # archived before the drive refreshes targets
        await runner.wait_idle()
        items = {i["company_id"]: i for i in await store.list_items(run["run_id"])}
        assert items["c-meesho"]["status"] == "skipped"
        assert "no longer an active research target" in items["c-meesho"]["error"]["message"]
        assert items["c-razorpay"]["status"] == "done"
    asyncio.run(go())


def test_nothing_to_research_completes_immediately(tmp_path):
    async def go():
        store = InMemoryResearchStore()
        runner, _ = make_runner(store, tmp_path, targets=[])
        run = await runner.start_run(trigger="cron", scope="all")
        assert run["status"] == "completed" and not runner.busy
    asyncio.run(go())
```

- [ ] **Step 3: Run them to verify they fail**

Run: `.venv/bin/python -m pytest tests/research/test_targets.py tests/research/test_runner.py -q`
Expected: FAIL. `TargetsUnavailable` and `RunActive` can't be imported, and the runner raises `NotImplementedError`.

- [ ] **Step 4: Implement the targets module**

Replace `apps/ai-service/app/research/targets.py` with:

```python
"""Research targets: the active companies interviewiq-api says to research (spec §3.1), read from its
internal endpoint with the shared key. Unlike the brief pipeline's targets, failure is an error:
an admin pressing Start must hear why nothing ran."""
from __future__ import annotations

import logging
from dataclasses import dataclass

import httpx

from app.config import Settings

logger = logging.getLogger(__name__)


class TargetsUnavailable(RuntimeError):
    """interviewiq-api could not be reached or returned an error."""


@dataclass(frozen=True)
class ResearchTarget:
    id: str
    name: str
    slug: str
    website: str | None = None
    aliases: tuple[str, ...] = ()

    def as_dict(self) -> dict:
        return {"id": self.id, "name": self.name, "slug": self.slug, "website": self.website,
                "aliases": list(self.aliases)}

    @classmethod
    def from_row(cls, row: dict) -> "ResearchTarget":
        return cls(id=row["id"], name=row["name"], slug=row["slug"], website=row.get("website"),
                   aliases=tuple(row.get("aliases") or ()))


async def fetch_research_targets(settings: Settings) -> list[ResearchTarget]:
    url = settings.api_base_url.rstrip("/") + "/api/v1/internal/research-targets"
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(url, headers={"X-Internal-Api-Key": settings.internal_api_key})
            resp.raise_for_status()
            rows = resp.json()
    except Exception as exc:  # noqa: BLE001
        raise TargetsUnavailable(f"could not load research targets from {url}: {exc}") from exc
    targets: list[ResearchTarget] = []
    for row in rows:
        try:
            targets.append(ResearchTarget.from_row(row))
        except (KeyError, TypeError) as exc:
            logger.warning("ignoring malformed research target %r: %s", row, exc)
    return targets
```

- [ ] **Step 5: Implement the runner**

Replace `apps/ai-service/app/research/runner.py` with:

```python
"""Drives research runs (spec §3.1, §5).

start_run() builds the queue and launches the drive loop as a background task. The loop runs each
company's LangGraph (a few companies at a time), saves the merged state + last node on the item
after EVERY node, and checks the run's `control` flag between nodes:
  pause → the company parks as `paused` and later resumes at the next node;
  stop  → the company is `cancelled`, its saved state cleared, no draft written.
A company in its LAST node always finishes (no wasted re-run). BudgetExhausted auto-pauses the run.

recover_on_startup() picks up runs a crash left behind, resuming from saved state; a company
caught mid-run more than RESEARCH_MAX_ATTEMPTS-1 times is failed as a crash loop.

One process, one active run (asyncio.Lock around start)."""
from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from contextlib import AbstractAsyncContextManager
from datetime import timedelta
from typing import Any

from app.config import Settings
from app.research.budget import Budget, BudgetExhausted
from app.research.fixtures import FixtureStore
from app.research.gateway import ResearchIO
from app.research.graph import NodeDeps, build_company_graph
from app.research.models import (
    NODE_ORDER,
    PIPELINE_VERSION,
    Control,
    InvalidTransition,
    ItemStatus,
    Mode,
    RunStatus,
    check_transition,
)
from app.research.store import ResearchStore
from app.research.targets import ResearchTarget
from app.research.trace.context import CURRENT_COMPANY, CURRENT_TRACER
from app.research.trace.errors import error_info
from app.research.trace.redact import redact
from app.research.trace.tracer import Tracer, new_id, utcnow

logger = logging.getLogger(__name__)

TargetsFetcher = Callable[[], Awaitable[list[ResearchTarget]]]
ClientsFactory = Callable[[], AbstractAsyncContextManager[tuple[Any, Any]]]

_TERMINAL_ITEM = (ItemStatus.DONE, ItemStatus.SKIPPED, ItemStatus.FAILED, ItemStatus.CANCELLED)


class RunActive(Exception):
    def __init__(self, run_id: str):
        super().__init__(f"run {run_id} is still active; resume or stop it first")
        self.run_id = run_id


class RunNotFound(LookupError):
    pass


class NoCompaniesSelected(ValueError):
    pass


def _counters(n: int) -> dict[str, int]:
    return {"total": n, **{s.value: 0 for s in ItemStatus}, "queued": n}


class ResearchRunner:
    def __init__(self, *, store: ResearchStore, settings: Settings, targets: TargetsFetcher,
                 clients: ClientsFactory, secrets: dict[str, str],
                 echo: Callable[[dict], None] | None = None, retry_initial_interval: float = 2.0):
        self._store = store
        self._settings = settings
        self._targets = targets
        self._clients = clients
        self._secrets = secrets
        self._echo = echo
        self._retry_interval = retry_initial_interval
        self._task: asyncio.Task | None = None
        self._start_lock = asyncio.Lock()
        self._tracer: Tracer | None = None
        self._budget: Budget | None = None
        self._active_run_id: str | None = None

    @property
    def store(self) -> ResearchStore:
        return self._store

    @property
    def busy(self) -> bool:
        return self._task is not None and not self._task.done()

    async def wait_idle(self) -> None:
        while self.busy:
            await asyncio.wait({self._task})

    # --- admin API ---------------------------------------------------------------------------------
    async def start_run(self, *, trigger: str, scope: str = "all", company_ids: list[str] | None = None,
                        mode: str | None = None, requested_by: str | None = None) -> dict:
        async with self._start_lock:
            active = await self._store.find_active_run()
            if active is not None:
                raise RunActive(active["run_id"])
            targets = await self._targets()
            chosen = await self._choose(targets, scope, company_ids or [])
            run_id, now = new_id(), utcnow()
            run = {
                "run_id": run_id, "trigger": trigger, "mode": Mode(mode or self._settings.research_mode).value,
                "scope": scope, "company_ids": [t.id for t in chosen], "targets": [t.as_dict() for t in targets],
                "status": RunStatus.QUEUED.value, "control": Control.NONE.value, "pause_reason": None,
                "requested_by": requested_by, "counters": _counters(len(chosen)),
                "budget": {"exa_used": 0, "exa_cap": self._settings.research_max_exa_calls,
                           "llm_used": 0, "llm_cap": self._settings.research_max_llm_calls,
                           "tokens_in": 0, "tokens_out": 0},
                "last_seq": 0, "created_at": now, "started_at": None, "finished_at": None, "error": None,
                "pipeline_version": PIPELINE_VERSION,
            }
            await self._store.insert_run(run)
            await self._store.insert_items([self._new_item(run_id, i, t) for i, t in enumerate(chosen)])
            for t in chosen:
                await self._store.upsert_company_state(t.id, fields={"last_run_id": run_id, "last_status": ItemStatus.QUEUED.value})
            if chosen:
                self._launch(run_id)
            else:
                await self._store.update_run(run_id, fields={"status": RunStatus.COMPLETED.value, "started_at": now, "finished_at": now})
            return await self._store.get_run(run_id)

    async def pause(self, run_id: str) -> dict:
        run = await self._require(run_id)
        check_transition(run["status"], "pause")
        await self._store.update_run(run_id, fields={"control": Control.PAUSE.value, "status": RunStatus.PAUSING.value,
                                                     "pause_reason": "admin"})
        await self._note(run_id, "control.pause", "pause requested: companies finish their current step, then park")
        if not self.busy:
            await self._finalize(run_id)
        return await self._store.get_run(run_id)

    async def resume(self, run_id: str) -> dict:
        run = await self._require(run_id)
        check_transition(run["status"], "resume")
        if self.busy:
            raise InvalidTransition("the previous drive is still winding down; try again in a moment")
        await self._store.update_run(run_id, fields={"control": Control.NONE.value, "status": RunStatus.QUEUED.value,
                                                     "pause_reason": None})
        await self._note(run_id, "control.resume", "resume requested")
        self._launch(run_id)
        return await self._store.get_run(run_id)

    async def stop(self, run_id: str) -> dict:
        run = await self._require(run_id)
        check_transition(run["status"], "stop")
        await self._store.update_run(run_id, fields={"control": Control.STOP.value, "status": RunStatus.STOPPING.value})
        await self._note(run_id, "control.stop", "stop requested: companies finish their current step, then cancel")
        if not self.busy:   # paused (or orphaned): nothing is driving it, so complete the stop here
            await self._finalize(run_id)
        return await self._store.get_run(run_id)

    async def raise_budget(self, run_id: str, *, exa_cap: int | None = None, llm_cap: int | None = None) -> dict:
        run = await self._require(run_id)
        budget = run["budget"]
        fields: dict[str, int] = {}
        for kind, cap in (("exa", exa_cap), ("llm", llm_cap)):
            if cap is None:
                continue
            if cap < budget[f"{kind}_used"]:
                raise ValueError(f"{kind}_cap {cap} is below calls already made ({budget[f'{kind}_used']})")
            fields[f"budget.{kind}_cap"] = cap
        if fields:
            await self._store.update_run(run_id, fields=fields)
            if self._budget is not None and self._active_run_id == run_id:
                self._budget.set_caps(exa_cap=exa_cap, llm_cap=llm_cap)
            await self._note(run_id, "budget.raised", f"budget caps raised: {fields}")
        return await self._store.get_run(run_id)

    async def recover_on_startup(self) -> None:
        runs = await self._store.find_runs_by_status(
            [RunStatus.QUEUED, RunStatus.RUNNING, RunStatus.PAUSING, RunStatus.STOPPING])
        for run in runs:
            run_id = run["run_id"]
            for item in await self._store.list_items(run_id):
                if item["status"] != ItemStatus.RUNNING:
                    continue
                attempts = item.get("attempts", 1) + 1
                if attempts > self._settings.research_max_attempts:
                    await self._set_item_status(run_id, item["company_id"], ItemStatus.RUNNING, ItemStatus.FAILED, extra={
                        "attempts": attempts, "current_node": None, "finished_at": utcnow(),
                        "error": {"type": "CrashLoop", "code_ref": None, "traceback": "",
                                  "message": f"the service restarted mid-run {attempts - 1} times while researching this company"},
                    })
                    await self._store.upsert_company_state(item["company_id"], fields={"last_status": ItemStatus.FAILED.value})
                else:
                    await self._store.update_item(run_id, item["company_id"], fields={"attempts": attempts})
            if run["status"] == RunStatus.STOPPING:
                await self._finalize(run_id)
            elif run["status"] == RunStatus.PAUSING:
                for item in await self._store.list_items(run_id):
                    if item["status"] == ItemStatus.RUNNING:
                        await self._set_item_status(run_id, item["company_id"], ItemStatus.RUNNING, ItemStatus.PAUSED)
                await self._store.update_run(run_id, fields={"status": RunStatus.PAUSED.value})
                await self._note(run_id, "run.recovered", "service restarted while pausing: run is paused", level="warn")
            elif self.busy:
                await self._store.update_run(run_id, fields={"status": RunStatus.FAILED.value, "finished_at": utcnow(),
                                                             "error": "orphaned: another run was already being resumed"})
            else:
                await self._note(run_id, "run.recovered", "service restarted mid-run: resuming from saved state", level="warn")
                self._launch(run_id)

    # --- drive loop --------------------------------------------------------------------------------
    def _launch(self, run_id: str) -> None:
        self._task = asyncio.create_task(self._drive(run_id), name=f"research-run-{run_id}")

    async def _drive(self, run_id: str) -> None:
        run = await self._store.get_run(run_id)
        tracer = Tracer(self._store, run_id, secrets=self._secrets, start_seq=run.get("last_seq", 0), echo=self._echo)
        await tracer.start()
        self._tracer, self._active_run_id = tracer, run_id
        token = CURRENT_TRACER.set(tracer)
        resumed = run.get("started_at") is not None
        try:
            fields: dict[str, Any] = {"status": RunStatus.RUNNING.value}
            if not resumed:
                fields["started_at"] = utcnow()
            await self._store.update_run(run_id, fields=fields)
            tracer.emit("run.resumed" if resumed else "run.started",
                        f"{'resuming' if resumed else 'starting'} run · mode={run['mode']} · {run['counters']['total']} company(ies)",
                        data={"mode": run["mode"], "trigger": run["trigger"], "scope": run["scope"], "budget": run["budget"]})
            budget = Budget.from_run(self._store, run)
            self._budget = budget
            active_ids = await self._active_target_ids()
            async with tracer.span("run", "resume" if resumed else "run", attrs={"mode": run["mode"], "trigger": run["trigger"]}):
                async with self._clients() as (exa, llm):
                    io = ResearchIO(mode=Mode(run["mode"]), exa=exa, llm=llm,
                                    fixtures=FixtureStore(self._settings.research_fixtures_dir), tracer=tracer,
                                    budget=budget, store=self._store, settings=self._settings)
                    await self._process_items(run, io, tracer, active_ids)
            await self._finalize(run_id, tracer)
        except Exception as exc:  # noqa: BLE001 — a failed run is recorded, never raised into the event loop
            logger.exception("research run %s failed", run_id)
            info = redact(error_info(exc), self._secrets)
            await self._store.update_run(run_id, fields={"status": RunStatus.FAILED.value, "control": Control.NONE.value,
                                                         "error": info["message"], "finished_at": utcnow()})
            tracer.emit("run.failed", f"run failed: {info['type']}: {info['message']}", level="error", data=info)
        finally:
            CURRENT_TRACER.reset(token)
            await tracer.close()
            self._tracer = None
            self._budget = None
            self._active_run_id = None

    async def _active_target_ids(self) -> set[str] | None:
        try:
            return {t.id for t in await self._targets()}
        except Exception as exc:  # noqa: BLE001
            logger.warning("could not refresh research targets (%s); researching the queued companies as-is", exc)
            return None

    async def _process_items(self, run: dict, io: ResearchIO, tracer: Tracer, active_ids: set[str] | None) -> None:
        run_id = run["run_id"]
        items = await self._store.list_items(run_id)
        order = [i for i in items if i["status"] in (ItemStatus.RUNNING, ItemStatus.PAUSED)]
        order += [i for i in items if i["status"] == ItemStatus.QUEUED]
        sem = asyncio.Semaphore(self._settings.research_concurrency)
        tasks: list[asyncio.Task] = []
        for item in order:
            await sem.acquire()
            if await self._control(run_id) is not Control.NONE:
                sem.release()
                break
            if active_ids is not None and item["company_id"] not in active_ids:
                await self._skip_inactive(run_id, item, tracer)
                sem.release()
                continue
            tasks.append(asyncio.create_task(self._run_item_slot(run, item, io, tracer, sem)))
        await asyncio.gather(*tasks)

    async def _run_item_slot(self, run: dict, item: dict, io: ResearchIO, tracer: Tracer, sem: asyncio.Semaphore) -> None:
        try:
            await self._run_item(run, item, io, tracer)
        finally:
            sem.release()

    async def _run_item(self, run: dict, item: dict, io: ResearchIO, tracer: Tracer) -> None:
        run_id, cid = run["run_id"], item["company_id"]
        company = item["target"]
        others = [t for t in run["targets"] if t["id"] != cid]
        state: dict = item.get("state") or {"company": company, "others": others}
        last_node: str | None = item.get("last_node")
        outcome, err = ItemStatus.DONE, None
        token = CURRENT_COMPANY.set(cid)
        try:
            await self._set_item_status(run_id, cid, ItemStatus(item["status"]), ItemStatus.RUNNING,
                                        extra={"started_at": utcnow(), "error": None})
            await self._store.upsert_company_state(cid, fields={"last_run_id": run_id, "last_status": ItemStatus.RUNNING.value})
            deps = NodeDeps(io=io, store=self._store, tracer=tracer, settings=self._settings, run_id=run_id)
            graph = build_company_graph(deps, retry_initial_interval=self._retry_interval)
            config = {"configurable": {"thread_id": f"{run_id}:{cid}:{new_id()[:8]}"}}
            interrupted: Control | None = None
            async with tracer.span("company", company["name"], company_id=cid,
                                   attrs={"slug": company["slug"], "resumed_after": last_node}):
                if last_node:
                    await graph.aupdate_state(config, state, as_node=last_node)
                    tracer.emit("item.resumed", f"{company['name']}: resuming after {last_node}")
                    graph_input = None
                else:
                    tracer.emit("item.started", f"{company['name']}: starting")
                    graph_input = state
                stream = graph.astream(graph_input, config, stream_mode="updates")
                try:
                    async for update in stream:
                        for node_name, delta in update.items():
                            state = {**state, **(delta or {})}
                            last_node = node_name
                        await self._store.update_item(run_id, cid, fields={"state": state, "last_node": last_node})
                        control = await self._control(run_id)
                        if control is not Control.NONE and last_node != NODE_ORDER[-1]:
                            interrupted = control
                            break
                finally:
                    await stream.aclose()
            if interrupted is Control.PAUSE:
                outcome = ItemStatus.PAUSED
            elif interrupted is Control.STOP:
                outcome = ItemStatus.CANCELLED
            elif (state.get("draft") or {}).get("status") == "unchanged":
                outcome = ItemStatus.SKIPPED
        except BudgetExhausted as exc:
            outcome = ItemStatus.PAUSED
            await self._store.update_run(run_id, fields={"control": Control.PAUSE.value, "status": RunStatus.PAUSING.value,
                                                         "pause_reason": "budget_exhausted"})
            tracer.emit("budget.exhausted", f"{exc}: pausing the run; raise the cap, then resume", level="warn",
                        data={"kind": exc.kind, "used": exc.used, "cap": exc.cap})
        except Exception as exc:  # noqa: BLE001 — one company's failure never stops the run
            outcome, err = ItemStatus.FAILED, redact(error_info(exc), self._secrets)
        finally:
            CURRENT_COMPANY.reset(token)
        await self._finish_item(run_id, item, outcome, state, err, tracer)

    async def _finish_item(self, run_id: str, item: dict, outcome: ItemStatus, state: dict,
                           err: dict | None, tracer: Tracer) -> None:
        cid, name = item["company_id"], item["company_name"]
        draft = state.get("draft") or {}
        extra: dict[str, Any] = {"current_node": None}
        if outcome in _TERMINAL_ITEM:
            extra["finished_at"] = utcnow()
        if outcome is ItemStatus.CANCELLED:
            extra.update(state=None, last_node=None)
        if outcome is ItemStatus.FAILED:
            extra["error"] = err
        if outcome in (ItemStatus.DONE, ItemStatus.SKIPPED):
            extra["draft_id"] = draft.get("draft_id")
        await self._set_item_status(run_id, cid, ItemStatus.RUNNING, outcome, extra=extra)

        company_state: dict[str, Any] = {"last_status": outcome.value}
        if outcome in (ItemStatus.DONE, ItemStatus.SKIPPED):
            company_state["last_researched_at"] = utcnow()
            if draft.get("status") == "created":
                company_state["latest_draft_id"] = draft["draft_id"]
                company_state["latest_draft_status"] = "pending_review"
        await self._store.upsert_company_state(cid, fields=company_state)

        message = {
            ItemStatus.DONE: f"done · draft v{draft.get('version')}",
            ItemStatus.SKIPPED: "no changes since the last draft: skipped",
            ItemStatus.PAUSED: "paused",
            ItemStatus.CANCELLED: "cancelled",
            ItemStatus.FAILED: f"failed · {err['type']}: {err['message']}" if err else "failed",
        }[outcome]
        tracer.emit(f"item.{outcome.value}", f"{name}: {message}", level="error" if outcome is ItemStatus.FAILED else "info",
                    company_id=cid, data=err if outcome is ItemStatus.FAILED else {"draft": draft or None})

    async def _skip_inactive(self, run_id: str, item: dict, tracer: Tracer) -> None:
        reason = "company is no longer an active research target (archived or deleted after the run was queued)"
        await self._set_item_status(run_id, item["company_id"], ItemStatus(item["status"]), ItemStatus.SKIPPED, extra={
            "finished_at": utcnow(), "error": {"type": "NotATarget", "message": reason, "traceback": "", "code_ref": None}})
        await self._store.upsert_company_state(item["company_id"], fields={"last_status": ItemStatus.SKIPPED.value})
        tracer.emit("item.skipped", f"{item['company_name']}: {reason}", level="warn", company_id=item["company_id"])

    async def _finalize(self, run_id: str, tracer: Tracer | None = None) -> None:
        run = await self._store.get_run(run_id)
        control = run["control"]
        if control == Control.STOP:
            for item in await self._store.list_items(run_id):
                if item["status"] in (ItemStatus.QUEUED, ItemStatus.PAUSED, ItemStatus.RUNNING):
                    await self._set_item_status(run_id, item["company_id"], ItemStatus(item["status"]), ItemStatus.CANCELLED,
                                                extra={"state": None, "last_node": None, "current_node": None,
                                                       "finished_at": utcnow()})
                    await self._store.upsert_company_state(item["company_id"], fields={"last_status": ItemStatus.CANCELLED.value})
            fields = {"status": RunStatus.STOPPED.value, "control": Control.NONE.value, "finished_at": utcnow()}
        elif control == Control.PAUSE:
            fields = {"status": RunStatus.PAUSED.value}
        else:
            fields = {"status": RunStatus.COMPLETED.value, "finished_at": utcnow()}
        run = await self._store.update_run(run_id, fields=fields)
        c = run["counters"]
        summary = f"run {fields['status']} · done {c['done']} · skipped {c['skipped']} · failed {c['failed']} · cancelled {c['cancelled']}"
        data = {"counters": c, "budget": run["budget"], "pause_reason": run.get("pause_reason")}
        if tracer is not None:
            tracer.emit(f"run.{fields['status']}", summary, data=data)
        else:
            await self._note(run_id, f"run.{fields['status']}", summary, data=data)

    # --- helpers -----------------------------------------------------------------------------------
    async def _require(self, run_id: str) -> dict:
        run = await self._store.get_run(run_id)
        if run is None:
            raise RunNotFound(f"no research run {run_id}")
        return run

    async def _control(self, run_id: str) -> Control:
        run = await self._store.get_run(run_id)
        return Control(run["control"])

    async def _set_item_status(self, run_id: str, company_id: str, old: ItemStatus, new: ItemStatus,
                               extra: dict | None = None) -> None:
        await self._store.update_item(run_id, company_id, fields={"status": new.value, **(extra or {})})
        if old is not new:
            await self._store.update_run(run_id, inc={f"counters.{old.value}": -1, f"counters.{new.value}": 1})

    async def _note(self, run_id: str, type_: str, message: str, *, level: str = "info", data: Any = None) -> None:
        """Emit into the live trace when this run is being driven; otherwise write it directly."""
        if self._tracer is not None and self._active_run_id == run_id:
            self._tracer.emit(type_, message, level=level, data=data)
            return
        run = await self._store.get_run(run_id)
        detached = Tracer(self._store, run_id, secrets=self._secrets, start_seq=run.get("last_seq", 0), echo=self._echo)
        detached.emit(type_, message, level=level, data=data)
        await detached.flush()

    @staticmethod
    def _new_item(run_id: str, position: int, target: ResearchTarget) -> dict:
        return {"run_id": run_id, "company_id": target.id, "company_name": target.name, "company_slug": target.slug,
                "position": position, "target": target.as_dict(), "status": ItemStatus.QUEUED.value, "attempts": 1,
                "current_node": None, "last_node": None, "state": None, "nodes": {}, "draft_id": None,
                "error": None, "started_at": None, "finished_at": None}

    async def _choose(self, targets: list[ResearchTarget], scope: str, company_ids: list[str]) -> list[ResearchTarget]:
        if scope == "selected":
            wanted = set(company_ids)
            chosen = [t for t in targets if t.id in wanted]
            if not chosen:
                raise NoCompaniesSelected("none of the selected companies are active research targets")
            return chosen
        states = {s["company_id"]: s for s in await self._store.list_company_states([t.id for t in targets])}
        cutoff = utcnow() - timedelta(days=self._settings.research_stale_after_days)

        def stale(t: ResearchTarget) -> bool:
            last = states.get(t.id, {}).get("last_researched_at")
            return last is None or last < cutoff
        return [t for t in targets if stale(t)]
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/research -q`
Expected: PASS, including all 17 runner tests.

If `test_crash_recovery…` fails on `attempts == 2`, check that `recover_on_startup` increments attempts only for items whose status is `running`.

- [ ] **Step 7: Run the full ai-service suite**

Run: `.venv/bin/python -m pytest -q`
Expected: PASS, with no regressions in the brief, question or interview tests.

- [ ] **Step 8: Checkpoint**

Run `git status`; leave the changes uncommitted.

---

## Task 9: Research HTTP router, service wiring, weekly cron and CLI

**Files:**
- Create: `apps/ai-service/app/research/api.py`, `apps/ai-service/app/research/wiring.py`, `apps/ai-service/app/research/cli.py`
- Modify: `apps/ai-service/app/main.py`, `apps/ai-service/app/jobs/scheduler.py`
- Test: `apps/ai-service/tests/research/test_research_api.py`, `apps/ai-service/tests/research/test_scheduler_research.py`

**Interfaces:**
- Consumes: `ResearchRunner` and its exceptions (Task 8), `hydrate_span` (Task 4), `EventFilter` (Task 3).
- Produces these HTTP routes (all behind the internal key):

  | Method | Path | Response |
  |---|---|---|
  | `POST` | `/research/runs` `{scope, company_ids, mode, requested_by}` | 201 run; 409 `run_active` (+`run_id`), 400 `no_companies`, 503 `targets_unavailable` |
  | `GET` | `/research/runs?limit` | `{runs}` |
  | `GET` | `/research/runs/{run_id}` | `{run, items}` (items without `state`/`target`) |
  | `POST` | `/research/runs/{run_id}/pause\|resume\|stop` | run; 404 `run_not_found`, 409 `invalid_transition` |
  | `PATCH` | `/research/runs/{run_id}/budget` `{exa_cap?, llm_cap?}` | run; 400 `invalid_budget` |
  | `GET` | `/research/runs/{run_id}/events?after_seq&before_seq&limit&level&company_id&node&type&span_id&q` | `{events, last_seq}` |
  | `GET` | `/research/runs/{run_id}/spans?company_id` | `{spans}` |
  | `GET` | `/research/spans/{span_id}` | `{span, logs}` |
  | `GET` | `/research/companies/state?ids=a,b` | `{states}` |

  When research is disabled, every route returns 503 `research_disabled`.

  Also produces:
  - `build_research_runner(settings, *, store, targets=None, echo=None) -> ResearchRunner`;
  - `create_scheduler(exa, settings, research=None)` (adds the `company-research` cron job);
  - the CLI `python -m app.research.cli run (--name NAME [--website URL] | --company SLUG …) [--mode …] [--memory] [--verbose]`.

- [ ] **Step 1: Write the failing tests**

`apps/ai-service/tests/research/test_research_api.py`:

```python
"""Route functions are called directly (the repo's pattern: no TestClient, so no lifespan / Mongo).
Annotated[...] parameters keep plain-Python defaults, so a direct call needs only what it sets."""
import asyncio
import json

from fastapi.responses import JSONResponse

import app.research.api as api
from app.research.memory_store import InMemoryResearchStore
from tests.research.helpers import make_runner


def _body(resp):
    assert isinstance(resp, JSONResponse)
    return resp.status_code, json.loads(resp.body)


def test_start_then_conflict_then_detail(tmp_path):
    async def go():
        runner, _ = make_runner(InMemoryResearchStore(), tmp_path)
        run = await api.start_run(api.StartRunBody(scope="all"), runner=runner)
        assert run["status"] == "queued" and "targets" not in run
        status, body = _body(await api.start_run(api.StartRunBody(scope="all"), runner=runner))
        assert status == 409 and body["code"] == "run_active" and body["run_id"] == run["run_id"]
        await runner.wait_idle()
        detail = await api.get_run(run["run_id"], runner=runner)
        assert detail["run"]["status"] == "completed"
        assert all("state" not in i and "target" not in i for i in detail["items"])
        listed = await api.list_runs(runner=runner)
        assert [r["run_id"] for r in listed["runs"]] == [run["run_id"]]
    asyncio.run(go())


def test_selected_scope_with_unknown_ids_is_400(tmp_path):
    async def go():
        runner, _ = make_runner(InMemoryResearchStore(), tmp_path)
        status, body = _body(await api.start_run(api.StartRunBody(scope="selected", company_ids=["nope"]), runner=runner))
        assert status == 400 and body["code"] == "no_companies"
    asyncio.run(go())


def test_controls_map_errors_to_404_and_409(tmp_path):
    async def go():
        runner, _ = make_runner(InMemoryResearchStore(), tmp_path)
        status, body = _body(await api.pause_run("0" * 32, runner=runner))
        assert status == 404 and body["code"] == "run_not_found"
        run = await api.start_run(api.StartRunBody(), runner=runner)
        await runner.wait_idle()
        status, body = _body(await api.resume_run(run["run_id"], runner=runner))
        assert status == 409 and body["code"] == "invalid_transition"
        status, body = _body(await api.patch_budget(run["run_id"], api.BudgetBody(llm_cap=0), runner=runner))
        assert status == 400 and body["code"] == "invalid_budget"
    asyncio.run(go())


def test_events_spans_and_span_detail(tmp_path):
    async def go():
        runner, _ = make_runner(InMemoryResearchStore(), tmp_path)
        run = await api.start_run(api.StartRunBody(), runner=runner)
        await runner.wait_idle()
        page = await api.run_events(run["run_id"], runner=runner, level="info")
        assert page["last_seq"] >= len(page["events"]) > 0
        assert all(e["level_rank"] >= 20 for e in page["events"])
        older = await api.run_events(run["run_id"], runner=runner, before_seq=page["last_seq"], limit=3)
        assert len(older["events"]) == 3 and older["events"][-1]["seq"] == page["last_seq"] - 1
        spans = (await api.run_spans(run["run_id"], runner=runner, company_id="c-meesho"))["spans"]
        llm = next(s for s in spans if s["kind"] == "llm")
        detail = await api.get_span(llm["span_id"], runner=runner)
        assert detail["span"]["input"]["prompt_name"] == "resolve_company"
        assert [e["type"] for e in detail["logs"]][0] == "span.start"
        status, body = _body(await api.get_span("f" * 32, runner=runner))
        assert status == 404 and body["code"] == "span_not_found"
    asyncio.run(go())


def test_company_states_endpoint(tmp_path):
    async def go():
        runner, _ = make_runner(InMemoryResearchStore(), tmp_path)
        await api.start_run(api.StartRunBody(), runner=runner)
        await runner.wait_idle()
        got = await api.companies_state(runner=runner, ids="c-meesho")
        assert [s["company_id"] for s in got["states"]] == ["c-meesho"]
        assert got["states"][0]["latest_draft_status"] == "pending_review"
    asyncio.run(go())


def test_disabled_research_is_503():
    async def go():
        status, body = _body(await api.list_runs(runner=None))
        assert status == 503 and body["code"] == "research_disabled"
    asyncio.run(go())
```

`apps/ai-service/tests/research/test_scheduler_research.py`:

```python
import asyncio

from apscheduler.triggers.cron import CronTrigger

from app.config import Settings
from app.jobs.scheduler import _research_job, create_scheduler
from app.research.runner import RunActive


class _Runner:
    def __init__(self, exc=None):
        self.calls, self.exc = [], exc

    async def start_run(self, **kw):
        self.calls.append(kw)
        if self.exc:
            raise self.exc
        return {"run_id": "r"}


def test_research_job_is_scheduled_weekly_on_the_configured_cron():
    sched = create_scheduler(exa=object(), settings=Settings(_env_file=None), research=_Runner())
    job = sched.get_job("company-research")
    assert isinstance(job.trigger, CronTrigger)
    assert str(job.trigger.timezone) == "Asia/Kolkata"
    assert sched.get_job("brief-generation") is not None


def test_no_research_job_without_a_runner():
    sched = create_scheduler(exa=object(), settings=Settings(_env_file=None))
    assert sched.get_job("company-research") is None


def test_research_job_starts_an_all_scope_cron_run_and_swallows_run_active():
    runner = _Runner()
    asyncio.run(_research_job(runner))
    assert runner.calls == [{"trigger": "cron", "scope": "all"}]
    asyncio.run(_research_job(_Runner(exc=RunActive("busy"))))   # must not raise
```

- [ ] **Step 2: Run them to verify they fail**

Run: `.venv/bin/python -m pytest tests/research/test_research_api.py tests/research/test_scheduler_research.py -q`
Expected: FAIL with `ModuleNotFoundError: app.research.api` and an `ImportError` for `_research_job`.

- [ ] **Step 3: Implement the router**

`apps/ai-service/app/research/api.py`:

```python
"""Internal HTTP surface of the research pipeline (spec §8.2). Called only by interviewiq-api with
the internal key, on behalf of an authenticated ADMIN. Errors use the {code, message} envelope,
which the API forwards as-is."""
from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from app.api.deps import require_internal_key
from app.research.models import InvalidTransition
from app.research.runner import NoCompaniesSelected, ResearchRunner, RunActive, RunNotFound
from app.research.store import EventFilter
from app.research.targets import TargetsUnavailable
from app.research.trace.tracer import hydrate_span

router = APIRouter(prefix="/research", dependencies=[Depends(require_internal_key)])

Level = Literal["trace", "debug", "info", "warn", "error"]
_ITEM_HIDDEN = ("state", "target")


def get_runner(request: Request) -> ResearchRunner | None:
    return getattr(request.app.state, "research", None)


RunnerDep = Annotated[ResearchRunner | None, Depends(get_runner)]


def error(status: int, code: str, message: str, **extra) -> JSONResponse:
    return JSONResponse(status_code=status, content={"code": code, "message": message, **extra})


def _disabled() -> JSONResponse:
    return error(503, "research_disabled", "the research pipeline is disabled (RESEARCH_ENABLED=false)")


def _public_run(run: dict) -> dict:
    return {k: v for k, v in run.items() if k != "targets"}


def _public_item(item: dict) -> dict:
    return {k: v for k, v in item.items() if k not in _ITEM_HIDDEN}


class StartRunBody(BaseModel):
    scope: Literal["all", "selected"] = "all"
    company_ids: list[str] = []
    mode: Literal["live", "record", "replay"] | None = None
    requested_by: str | None = None


class BudgetBody(BaseModel):
    exa_cap: int | None = Field(None, ge=0)
    llm_cap: int | None = Field(None, ge=0)


@router.post("/runs", status_code=201)
async def start_run(body: StartRunBody, runner: RunnerDep):
    if runner is None:
        return _disabled()
    try:
        run = await runner.start_run(trigger="admin", scope=body.scope, company_ids=body.company_ids,
                                     mode=body.mode, requested_by=body.requested_by)
    except RunActive as exc:
        return error(409, "run_active", str(exc), run_id=exc.run_id)
    except NoCompaniesSelected as exc:
        return error(400, "no_companies", str(exc))
    except TargetsUnavailable as exc:
        return error(503, "targets_unavailable", str(exc))
    return _public_run(run)


@router.get("/runs")
async def list_runs(runner: RunnerDep, limit: Annotated[int, Query(ge=1, le=100)] = 20):
    if runner is None:
        return _disabled()
    return {"runs": await runner.store.list_runs(limit)}


@router.get("/runs/{run_id}")
async def get_run(run_id: str, runner: RunnerDep):
    if runner is None:
        return _disabled()
    run = await runner.store.get_run(run_id)
    if run is None:
        return error(404, "run_not_found", f"no research run {run_id}")
    items = await runner.store.list_items(run_id)
    return {"run": _public_run(run), "items": [_public_item(i) for i in items]}


async def _control(runner: ResearchRunner | None, run_id: str, action: str):
    if runner is None:
        return _disabled()
    try:
        run = await getattr(runner, action)(run_id)
    except RunNotFound as exc:
        return error(404, "run_not_found", str(exc))
    except InvalidTransition as exc:
        return error(409, "invalid_transition", str(exc))
    return _public_run(run)


@router.post("/runs/{run_id}/pause")
async def pause_run(run_id: str, runner: RunnerDep):
    return await _control(runner, run_id, "pause")


@router.post("/runs/{run_id}/resume")
async def resume_run(run_id: str, runner: RunnerDep):
    return await _control(runner, run_id, "resume")


@router.post("/runs/{run_id}/stop")
async def stop_run(run_id: str, runner: RunnerDep):
    return await _control(runner, run_id, "stop")


@router.patch("/runs/{run_id}/budget")
async def patch_budget(run_id: str, body: BudgetBody, runner: RunnerDep):
    if runner is None:
        return _disabled()
    try:
        run = await runner.raise_budget(run_id, exa_cap=body.exa_cap, llm_cap=body.llm_cap)
    except RunNotFound as exc:
        return error(404, "run_not_found", str(exc))
    except ValueError as exc:
        return error(400, "invalid_budget", str(exc))
    return _public_run(run)


@router.get("/runs/{run_id}/events")
async def run_events(
    run_id: str,
    runner: RunnerDep,
    after_seq: Annotated[int, Query(ge=0)] = 0,
    before_seq: Annotated[int | None, Query(ge=1)] = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 500,
    level: Annotated[Level | None, Query()] = None,
    company_id: Annotated[str | None, Query()] = None,
    node: Annotated[str | None, Query()] = None,
    type_: Annotated[str | None, Query(alias="type")] = None,
    span_id: Annotated[str | None, Query()] = None,
    q: Annotated[str | None, Query(max_length=200)] = None,
):
    if runner is None:
        return _disabled()
    run = await runner.store.get_run(run_id)
    if run is None:
        return error(404, "run_not_found", f"no research run {run_id}")
    events = await runner.store.list_events(run_id, EventFilter(
        after_seq=after_seq, before_seq=before_seq, limit=limit, min_level=level, company_id=company_id,
        node=node, type_prefix=type_, span_id=span_id, q=q,
    ))
    return {"events": events, "last_seq": run.get("last_seq", 0)}


@router.get("/runs/{run_id}/spans")
async def run_spans(run_id: str, runner: RunnerDep, company_id: Annotated[str | None, Query()] = None):
    if runner is None:
        return _disabled()
    if await runner.store.get_run(run_id) is None:
        return error(404, "run_not_found", f"no research run {run_id}")
    return {"spans": await runner.store.list_spans(run_id, company_id)}


@router.get("/spans/{span_id}")
async def get_span(span_id: str, runner: RunnerDep):
    if runner is None:
        return _disabled()
    span = await runner.store.get_span(span_id)
    if span is None:
        return error(404, "span_not_found", f"no span {span_id}")
    span = await hydrate_span(runner.store, span)
    logs = await runner.store.list_events(span["run_id"], EventFilter(span_id=span_id, limit=500))
    return {"span": span, "logs": logs}


@router.get("/companies/state")
async def companies_state(runner: RunnerDep, ids: Annotated[str, Query(max_length=20_000)] = ""):
    if runner is None:
        return _disabled()
    wanted = [i for i in ids.split(",") if i]
    return {"states": await runner.store.list_company_states(wanted or None)}
```

- [ ] **Step 4: Implement wiring and the scheduler job**

`apps/ai-service/app/research/wiring.py`:

```python
"""Build a production ResearchRunner: real Exa + LLM clients per run, targets from interviewiq-api,
secrets from settings. The CLI passes its own store / targets / echo."""
from __future__ import annotations

from collections.abc import Awaitable, Callable
from contextlib import asynccontextmanager

from app.config import Settings
from app.exa.client import build_exa_client
from app.llm.client import build_llm_client
from app.research.runner import ResearchRunner
from app.research.store import ResearchStore
from app.research.targets import ResearchTarget, fetch_research_targets
from app.research.trace.redact import secrets_from_settings


def build_research_runner(settings: Settings, *, store: ResearchStore,
                          targets: Callable[[], Awaitable[list[ResearchTarget]]] | None = None,
                          echo: Callable[[dict], None] | None = None) -> ResearchRunner:
    @asynccontextmanager
    async def clients():
        exa = build_exa_client(settings)
        llm = build_llm_client(settings)
        try:
            yield exa, llm
        finally:
            await llm.aclose()

    async def fetch() -> list[ResearchTarget]:
        return await fetch_research_targets(settings)

    return ResearchRunner(store=store, settings=settings, targets=targets or fetch, clients=clients,
                          secrets=secrets_from_settings(settings), echo=echo)
```

In `apps/ai-service/app/jobs/scheduler.py`:
- Add `from apscheduler.triggers.cron import CronTrigger`.
- Add `from app.research.runner import RunActive`.
- Add the job function and extend `create_scheduler`:

```python
async def _research_job(research) -> None:
    try:
        await research.start_run(trigger="cron", scope="all")
    except RunActive as exc:
        logger.info("Scheduled research run skipped: run %s is still active", exc.run_id)
    except Exception:  # noqa: BLE001 — a scheduled run must never kill the scheduler
        logger.exception("Scheduled research run failed to start")
```

Change the signature to `def create_scheduler(exa: ExaClient, settings: Settings, research=None) -> AsyncIOScheduler:`, and before `return scheduler` add:

```python
    if research is not None:
        scheduler.add_job(
            _research_job,
            CronTrigger.from_crontab(settings.research_cron, timezone="Asia/Kolkata"),
            args=[research],
            id="company-research",
            replace_existing=True,
            max_instances=1,
            coalesce=True,
        )
        logger.info("Scheduler configured: company research on cron %r (Asia/Kolkata)", settings.research_cron)
```

- [ ] **Step 5: Wire the service**

In `apps/ai-service/app/main.py`:

1. Add these imports:

```python
from app.research.api import router as research_router
from app.research.store import MongoResearchStore, ensure_research_indexes
from app.research.trace.log_handler import ResearchLogHandler
from app.research.wiring import build_research_runner
```

2. After the `AgentDiagLogHandler` block in `lifespan`, add:

```python
    # Research traces: forward every log record emitted inside a research run into its trace.
    if not any(isinstance(h, ResearchLogHandler) for h in root.handlers):
        root.addHandler(ResearchLogHandler())
    # The debugger wants DEBUG from the pipeline even when the console runs at LOG_LEVEL. The console
    # StreamHandler keeps LOG_LEVEL, so stdout stays as quiet as before.
    logging.getLogger("app.research").setLevel(logging.DEBUG)
    for h in root.handlers:
        if type(h) is logging.StreamHandler:
            h.setLevel(settings.log_level.upper())
```

3. After `app.state.exa = build_exa_client(settings)`, add:

```python
    research = None
    if settings.research_enabled:
        await ensure_research_indexes(mongo.get_db(), ttl_days=settings.research_trace_ttl_days)
        research = build_research_runner(settings, store=MongoResearchStore(mongo.get_db()))
        await research.recover_on_startup()
    app.state.research = research
```

4. Change `scheduler = create_scheduler(app.state.exa, settings)` to `scheduler = create_scheduler(app.state.exa, settings, research=research)`.
5. Add `app.include_router(research_router)` after `app.include_router(admin_router)`.
6. Update the module docstring's startup list with: "5. research runner: indexes, crash recovery, weekly cron".

- [ ] **Step 6: Implement the CLI**

`apps/ai-service/app/research/cli.py`:

```python
"""Run the research pipeline from a terminal, streaming every trace event (spec §12.2).

    # ad-hoc company, nothing else running: no API, no Mongo, free replay
    python -m app.research.cli run --name "Meesho" --mode replay --memory --verbose

    # record real responses once (costs Exa + LLM calls), then replay them for free
    python -m app.research.cli run --name "Meesho" --mode record --memory

    # catalogue companies by slug (needs interviewiq-api running); writes to MONGODB_DB
    python -m app.research.cli run --company meesho --company razorpay --mode live

Exit code: 0 all companies done/skipped, 1 any failed, 2 bad arguments / nothing to run."""
from __future__ import annotations

import argparse
import asyncio
import logging
import sys

from app.config import get_settings
from app.db import mongo
from app.research.memory_store import InMemoryResearchStore
from app.research.normalize.identity import slugify
from app.research.store import LEVEL_RANK, MongoResearchStore, ensure_research_indexes
from app.research.targets import ResearchTarget, fetch_research_targets
from app.research.trace.log_handler import ResearchLogHandler
from app.research.wiring import build_research_runner


def _echo(min_rank: int):
    def echo(ev: dict) -> None:
        if ev["level_rank"] < min_rank:
            return
        print(f"{ev['seq']:>6} {ev['ts']:%H:%M:%S} {ev['level']:<5} {(ev.get('node') or '-'):<12} "
              f"{ev['type']:<18} {ev['message']}", flush=True)
    return echo


async def _run(args: argparse.Namespace) -> int:
    settings = get_settings()
    if args.mode:
        settings = settings.model_copy(update={"research_mode": args.mode})
    logging.basicConfig(level=logging.WARNING, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    logging.getLogger("app.research").setLevel(logging.DEBUG)
    logging.getLogger().addHandler(ResearchLogHandler())

    if args.memory:
        store = InMemoryResearchStore()
    else:
        db = await mongo.connect(settings)
        await ensure_research_indexes(db, ttl_days=settings.research_trace_ttl_days)
        store = MongoResearchStore(db)

    if args.name:
        slug = slugify(args.name)
        targets = [ResearchTarget(id=f"cli-{slug}", name=args.name, slug=slug, website=args.website)]
    else:
        wanted = set(args.company or [])
        targets = [t for t in await fetch_research_targets(settings) if t.slug in wanted]
        if not targets:
            print(f"no active catalogue company matches {sorted(wanted)}", file=sys.stderr)
            return 2

    async def fixed_targets() -> list[ResearchTarget]:
        return targets

    runner = build_research_runner(settings, store=store, targets=fixed_targets,
                                   echo=_echo(LEVEL_RANK["trace" if args.verbose else "info"]))
    try:
        run = await runner.start_run(trigger="cli", scope="selected", company_ids=[t.id for t in targets],
                                     mode=settings.research_mode)
        await runner.wait_idle()
        run = await store.get_run(run["run_id"])
        items = await store.list_items(run["run_id"])
        print(f"\nrun {run['run_id']} · {run['status']} · mode={run['mode']} · budget {run['budget']}")
        for item in items:
            err = f" · {item['error']['type']}: {item['error']['message']}" if item.get("error") else ""
            print(f"  {item['company_name']:<24} {item['status']}{err}")
        return 1 if any(i["status"] == "failed" for i in items) else 0
    finally:
        if not args.memory:
            await mongo.close()


def main() -> None:
    parser = argparse.ArgumentParser(prog="python -m app.research.cli")
    sub = parser.add_subparsers(dest="cmd", required=True)
    run = sub.add_parser("run", help="research one or more companies and stream the trace")
    who = run.add_mutually_exclusive_group(required=True)
    who.add_argument("--name", help="ad-hoc company name (no API needed)")
    who.add_argument("--company", action="append", help="catalogue slug (repeatable; needs interviewiq-api)")
    run.add_argument("--website", help="website hint for --name")
    run.add_argument("--mode", choices=["live", "record", "replay"])
    run.add_argument("--memory", action="store_true", help="keep all state in memory (no Mongo)")
    run.add_argument("--verbose", action="store_true", help="print trace/debug events too")
    args = parser.parse_args()
    sys.exit(asyncio.run(_run(args)))


if __name__ == "__main__":
    main()
```

- [ ] **Step 7: Run all ai-service tests**

Run: `.venv/bin/python -m pytest -q`
Expected: PASS.

- [ ] **Step 8: Smoke test the CLI offline**

Run:

```bash
cd apps/ai-service && .venv/bin/python -m app.research.cli run --name "Meesho" --mode replay --memory
```

Expected:
- exit code 2 or 1;
- the output names `FixtureMissing` with "run this company once with RESEARCH_MODE=record";
- no traceback crash;
- no Mongo or API connection attempted.

This proves the replay path fails loudly before anything has been recorded.

- [ ] **Step 9: Checkpoint**

Run `git status`; leave the changes uncommitted.

---

## Task 10: Catalogue schema, migration, slug, seeder and the student filter

**Files:**
- Modify: `apps/api/src/db/pg/schema.ts`, `apps/api/src/repositories/pg.ts`, `apps/api/src/services/catalogueSeeder.ts`, `apps/api/src/routes/catalogue.ts`, `apps/api/test/routes/helpers.ts`, `apps/api/test/routes/adminCompanyController.test.ts` (the seed describe block only), `apps/api/test/db/hibernateCompat.test.ts`
- Create: `apps/api/drizzle/0002_company_research.sql` (generated) and its snapshot, `apps/api/src/domain/slug.ts`
- Test: `apps/api/test/domain/slug.test.ts`, `apps/api/test/db/companyResearchMigration.test.ts`, `apps/api/test/routes/companiesController.test.ts`

**Interfaces:**
- Produces:
  - `slugify(name: string): string`, with the same output as Python's `slugify`.
  - `COMPANY_STATUSES = ["active","archived"] as const`, `COMPANY_ORIGINS = ["seed","admin"] as const` and `ReviewQuote`.
  - New `CompanyRow` fields: `website`, `aliases: string[]`, `sector`, `businessModel`, `headcountBand`, `revenueBand`, `fundingStage`, `tierRationale`, `wlbRating`, `wlbReviewCount`, `reviewSummary`, `reviewQuotes`, `status`, `origin`, `publishedVersion`, `publishedAt`.
  - New `JobDescriptionRow` fields: `yoeMin`, `yoeMax`, `ctcMinLpa`, `ctcMaxLpa`, `ctcSourceCount`, `roleKey`.
  - New `CompanyRepository` methods:
    - `findById(id)`
    - `findPublished()`: `published_at` not null and `status = active`, ordered by `createdAt`
    - `findActive()`
    - `create(row): Promise<CompanyRow>`
    - `update(id, patch): Promise<CompanyRow | null>`
    - `deleteById(id)`
  - `CompanyRoleConfigRepository.deleteByCompany(company)`.
  - `SeedResult = {companies, inserted, backfilled, total}`.
- Removes: `deleteAllExceptSlugs` and both `deleteAllExceptCompanies` methods.

- [ ] **Step 1: Write the failing slug test**

`apps/api/test/domain/slug.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { slugify } from "../../src/domain/slug.js";

// Mirrored verbatim in apps/ai-service/tests/research/test_identity.py: a slug joins Postgres rows,
// briefs and research fixture folders, so both languages must agree exactly.
const CASES: Array<[string, string]> = [
  ["Meesho", "meesho"],
  ["  Big   Co ", "big-co"],
  ["Tata Consultancy Services (TCS)", "tata-consultancy-services-tcs"],
  ["AT&T", "at-and-t"],
  ["Café Coffee Day", "cafe-coffee-day"],
  ["Straße Labs", "strae-labs"],
];

describe("slugify", () => {
  it.each(CASES)("%s → %s", (name, expected) => {
    expect(slugify(name)).toBe(expected);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @interviewiq/api exec vitest run test/domain/slug.test.ts`
Expected: FAIL. Cannot find module `src/domain/slug.js`.

- [ ] **Step 3: Implement `slugify`**

`apps/api/src/domain/slug.ts`:

```ts
/**
 * Company slug: the join key between Postgres rows, AI-service briefs and research fixtures.
 * MUST stay byte-identical to apps/ai-service/app/research/normalize/identity.py::slugify:
 * NFKD-fold, drop non-ASCII, lowercase, "&" → " and ", non-alphanumerics → "-", trim "-".
 */
export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[^\x00-\x7f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
```

Run the slug test again. Expected: PASS.

- [ ] **Step 4: Extend the schema**

In `apps/api/src/db/pg/schema.ts`:
- Add `jsonb` and `numeric` to the `drizzle-orm/pg-core` import list.
- Add `import { sql } from "drizzle-orm";`.
- Replace the `companies` table with the version below.

```ts
export const COMPANY_STATUSES = ["active", "archived"] as const;
export type CompanyStatus = (typeof COMPANY_STATUSES)[number];
export const COMPANY_ORIGINS = ["seed", "admin"] as const;
export type CompanyOrigin = (typeof COMPANY_ORIGINS)[number];

/** A short attributed quote from a public review, shown to students with its link (spec §4.1). */
export interface ReviewQuote {
  text: string;
  sourceUrl: string;
  sourceName: string | null;
  date: string | null;
}

/**
 * A company students can target. `slug` joins to JDs, role configs and the AI-service brief keys.
 * Students only ever see rows with `publishedAt` set and `status = active` (spec §4.1); everything
 * below `companySize` is written only when an admin approves a research draft (Phase 2+).
 */
export const companies = pgTable("companies", {
  id: id(),
  name: varchar("name", { length: 255 }).notNull(),
  slug: varchar("slug", { length: 255 }).notNull().unique(),
  /** Placement tier 1-4 (pay band + selectivity, spec §6.4); descriptive metadata only. */
  tier: integer("tier"),
  logoUrl: varchar("logo_url", { length: 255 }),
  headquarterLocation: varchar("headquarter_location", { length: 255 }),
  companySize: varchar("company_size", { length: 255 }),
  createdAt: createdAt(),
  website: varchar("website", { length: 255 }),
  aliases: text("aliases").array().notNull().default(sql`'{}'::text[]`),
  sector: varchar("sector", { length: 64 }),
  businessModel: varchar("business_model", { length: 16 }),
  headcountBand: varchar("headcount_band", { length: 32 }),
  revenueBand: varchar("revenue_band", { length: 32 }),
  fundingStage: varchar("funding_stage", { length: 32 }),
  tierRationale: text("tier_rationale"),
  wlbRating: numeric("wlb_rating", { precision: 2, scale: 1 }),
  wlbReviewCount: integer("wlb_review_count"),
  reviewSummary: text("review_summary"),
  reviewQuotes: jsonb("review_quotes").$type<ReviewQuote[]>().notNull().default([]),
  status: varchar("status", { length: 16, enum: COMPANY_STATUSES }).notNull().default("active"),
  origin: varchar("origin", { length: 16, enum: COMPANY_ORIGINS }).notNull().default("admin"),
  publishedVersion: integer("published_version"),
  publishedAt: instant("published_at"),
});
```

In the `jobDescriptions` table, add these columns after `active`:

```ts
    /** Research-derived role facts (spec §4.1), written on draft approval (Phase 3). */
    yoeMin: numeric("yoe_min", { precision: 3, scale: 1 }),
    yoeMax: numeric("yoe_max", { precision: 3, scale: 1 }),
    ctcMinLpa: numeric("ctc_min_lpa", { precision: 6, scale: 2 }),
    ctcMaxLpa: numeric("ctc_max_lpa", { precision: 6, scale: 2 }),
    ctcSourceCount: integer("ctc_source_count"),
    /** Stable role identity across research runs: slug(level + specialization + title). */
    roleKey: varchar("role_key", { length: 128 }),
```

Then change its table extras to:

```ts
  (t) => [index("idx_jd_company_level").on(t.company, t.level), unique("uq_jd_company_role_key").on(t.company, t.roleKey)],
```

- [ ] **Step 5: Generate the migration, then add the backfill**

Run: `pnpm --filter @interviewiq/api exec drizzle-kit generate --name company_research`
Expected: this creates `apps/api/drizzle/0002_company_research.sql` and `drizzle/meta/0002_snapshot.json`, and updates `_journal.json`.

The SQL must contain only `ALTER TABLE … ADD COLUMN` statements for the 16 company columns and 6 JD columns, plus `ADD CONSTRAINT "uq_jd_company_role_key" UNIQUE("company","role_key")`. If drizzle-kit asks about renames, answer "create column" every time. Nothing is renamed.

Append these lines to the end of `0002_company_research.sql`:

```sql
--> statement-breakpoint
-- Companies created before research existed were seeded and already visible to students: keep
-- them visible (published) and mark where they came from.
UPDATE "companies" SET "published_at" = "created_at", "origin" = 'seed' WHERE "published_at" IS NULL;
```

- [ ] **Step 6: Write the failing migration, student-filter and seeder tests**

`apps/api/test/db/companyResearchMigration.test.ts`:

```ts
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { describe, expect, it } from "vitest";
import { MIGRATIONS_FOLDER } from "../../src/db/pg/client.js";

/** A copy of the migrations folder whose journal stops just BEFORE `tag`. */
function migrationsBefore(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), "iq-migrations-"));
  cpSync(MIGRATIONS_FOLDER, dir, { recursive: true });
  const journalPath = join(dir, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: Array<{ tag: string }> };
  journal.entries = journal.entries.slice(0, journal.entries.findIndex((e) => e.tag === tag));
  writeFileSync(journalPath, JSON.stringify(journal));
  return dir;
}

describe("0002_company_research", () => {
  it("publishes every company that existed before research, so none disappears for students", async () => {
    const client = new PGlite();
    try {
      await migrate(drizzle(client), { migrationsFolder: migrationsBefore("0002_company_research") });
      await client.query(
        `insert into companies (id, name, slug, tier, created_at) values (gen_random_uuid(), 'Meesho', 'meesho', 2, '2026-01-01T00:00:00Z')`,
      );
      await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER });
      const { rows } = await client.query<{ published_at: Date; origin: string; status: string; aliases: string[] }>(
        "select published_at, origin, status, aliases from companies",
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.published_at.toISOString()).toBe("2026-01-01T00:00:00.000Z");
      expect(rows[0]).toMatchObject({ origin: "seed", status: "active", aliases: [] });
    } finally {
      await client.close();
    }
  });
});
```

`apps/api/test/routes/companiesController.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bearer, createUser, createTestEnv, type TestEnv } from "../support/harness.js";
import { seedCompany } from "./helpers.js";

describe("GET /api/v1/companies (student catalogue)", () => {
  let env: TestEnv;
  let user: string;
  beforeAll(async () => {
    env = await createTestEnv();
    user = await bearer(env, await createUser(env));
  });
  afterAll(() => env.close());

  it("lists only published, active companies — never unpublished research targets or archived ones", async () => {
    await seedCompany(env, "meesho", "Meesho");
    await seedCompany(env, "draft-co", "Draft Co", { publishedAt: null });
    await seedCompany(env, "old-co", "Old Co", { status: "archived" });
    const res = await env.http.get("/api/v1/companies").set("Authorization", user);
    expect(res.status).toBe(200);
    expect(res.body.map((c: { slug: string }) => c.slug)).toEqual(["meesho"]);
  });
});
```

In `apps/api/test/routes/helpers.ts`, replace `seedCompany` with:

```ts
export async function seedCompany(
  env: Env,
  slug: string,
  name: string,
  overrides: Partial<typeof companies.$inferInsert> = {},
): Promise<void> {
  // Published by default: most tests model the catalogue students already see.
  await env.c.repos.companies.insert({ name, slug, tier: 2, publishedAt: new Date(), ...overrides });
}
```

Add `companies` to that file's `import type { … } from "../../src/db/pg/schema.js"` list.

In `apps/api/test/routes/adminCompanyController.test.ts`, change the first test of the `POST /admin/companies/seed` describe block to:

```ts
  it("loads the starter catalogue: {companies, inserted, backfilled, total}; never deletes other companies; never triggers ingestion", async () => {
    await seedCompany(env, "acme", "Acme");
    await seedRoleConfig(env, { company: "acme" });
    await seedJd(env, { company: "acme" });

    const res = await env.http.post(`${BASE}/seed`).set("Authorization", admin);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(["backfilled", "companies", "inserted", "total"]);
    expect(res.body).toEqual({ companies: 1, inserted: 1, backfilled: 0, total: 3 });
    expect(aiCalls(env)).toHaveLength(0);

    const companies = await env.http.get("/api/v1/companies").set("Authorization", admin);
    expect(companies.body.map((c: { slug: string }) => c.slug).sort()).toEqual(["acme", "meesho"]);
    expect((await env.c.repos.jds.findAllActiveOrdered()).filter((j) => j.company === "acme")).toHaveLength(1);
  });
```

Change the idempotency test's expected body to `{ companies: 0, inserted: 0, backfilled: 0, total: 3 }`. Delete its two `list` assertions; the list shape changes in Task 11.

- [ ] **Step 7: Run them to verify they fail**

Run: `pnpm --filter @interviewiq/api exec vitest run test/db/companyResearchMigration.test.ts test/routes/companiesController.test.ts test/routes/adminCompanyController.test.ts -t "seed|published|0002"`
Expected: FAIL. `draft-co` and `old-co` are listed, the seed result still has `removed`, and Acme is deleted.

- [ ] **Step 8: Implement the repository, seeder and filter changes**

In `apps/api/src/repositories/pg.ts`, replace `CompanyRepository` with the version below and add `isNotNull` to the `drizzle-orm` import:

```ts
export class CompanyRepository {
  constructor(private readonly db: Database) {}

  findAll(): Promise<CompanyRow[]> {
    return this.db.select().from(companies).orderBy(asc(companies.createdAt));
  }

  findById(id: string): Promise<CompanyRow | null> {
    return this.db.select().from(companies).where(eq(companies.id, id)).then(one);
  }

  findBySlug(slug: string): Promise<CompanyRow | null> {
    return this.db.select().from(companies).where(eq(companies.slug, slug)).then(one);
  }

  findAllBySlug(slugs: string[]): Promise<CompanyRow[]> {
    if (slugs.length === 0) return Promise.resolve([]);
    return this.db.select().from(companies).where(inArray(companies.slug, [...new Set(slugs)]));
  }

  /** What students see: approved (published) and not archived. */
  findPublished(): Promise<CompanyRow[]> {
    return this.db
      .select()
      .from(companies)
      .where(and(isNotNull(companies.publishedAt), eq(companies.status, "active")))
      .orderBy(asc(companies.createdAt));
  }

  /** Research targets: every non-archived company, published or not. */
  findActive(): Promise<CompanyRow[]> {
    return this.db.select().from(companies).where(eq(companies.status, "active")).orderBy(asc(companies.createdAt));
  }

  async insert(row: Insert<typeof companies>): Promise<void> {
    await this.db.insert(companies).values(row);
  }

  create(row: Insert<typeof companies>): Promise<CompanyRow> {
    return this.db
      .insert(companies)
      .values(row)
      .returning()
      .then((r) => r[0]!);
  }

  update(id: string, patch: Partial<Insert<typeof companies>>): Promise<CompanyRow | null> {
    return this.db.update(companies).set(patch).where(eq(companies.id, id)).returning().then(one);
  }

  async deleteById(id: string): Promise<void> {
    await this.db.delete(companies).where(eq(companies.id, id));
  }

  async deleteBySlug(slug: string): Promise<void> {
    await this.db.delete(companies).where(eq(companies.slug, slug));
  }
}
```

Also in `pg.ts`:
- In `CompanyRoleConfigRepository`, replace `deleteAllExceptCompanies` with:

```ts
  async deleteByCompany(company: string): Promise<void> {
    await this.db.delete(companyRoleConfigs).where(eq(companyRoleConfigs.company, company));
  }
```

- Delete `JobDescriptionRepository.deleteAllExceptCompanies`.
- If `notInArray` is now unused, remove it from the import.

In `apps/api/src/services/catalogueSeeder.ts`:
- Delete the `MVP_COMPANIES` constant and the whole "Enforce MVP scope" block (`removed += …` ×3).
- Change the doc comment to: "Loads the starter catalogue ON DEMAND (admin "Load starter companies"), never on startup. Upsert-only: re-running refreshes Meesho's seed JDs and backfills missing role-config fields; it never deletes other companies (admin- and research-added companies live alongside the seed)."
- Change the company insert to:

```ts
        await this.companies.insert({
          name: cs.name, slug: cs.slug, tier: cs.tier, logoUrl: null, headquarterLocation: cs.hq,
          companySize: cs.size, origin: "seed", publishedAt: new Date(),
        });
```

- Change the result interface and return:

```ts
export interface SeedResult {
  companies: number;
  inserted: number;
  backfilled: number;
  total: number;
}
```

```ts
    this.log.info(
      `Catalogue seed: ${companiesSeeded} companies, ${inserted} combos inserted, ${backfilled} backfilled, ` +
        `${JD_SEEDS.length} role-based JDs (across ${SEEDS.length} brief combos)`,
    );
    return { companies: companiesSeeded, inserted, backfilled, total: JD_SEEDS.length };
```

In `apps/api/src/routes/catalogue.ts`, change `companiesRouter`'s `c.repos.companies.findAll()` to `c.repos.companies.findPublished()`.

- [ ] **Step 9: Update the Hibernate compatibility expectations**

`test/db/hibernateCompat.test.ts` pins the exact columns, constraints and indexes the migrations add. Extend its three expected lists:

1. In the `added(after.cols, …)` list, keep the existing entries and add these after `auth_token.user_id uuid null=NO`, in this order:

```ts
      "companies.aliases ARRAY null=NO",
      "companies.business_model character varying null=YES",
      "companies.funding_stage character varying null=YES",
      "companies.headcount_band character varying null=YES",
      "companies.origin character varying null=NO",
      "companies.published_at timestamp with time zone null=YES",
      "companies.published_version integer null=YES",
      "companies.revenue_band character varying null=YES",
      "companies.review_quotes jsonb null=NO",
      "companies.review_summary text null=YES",
      "companies.sector character varying null=YES",
      "companies.status character varying null=NO",
      "companies.tier_rationale text null=YES",
      "companies.website character varying null=YES",
      "companies.wlb_rating numeric null=YES",
      "companies.wlb_review_count integer null=YES",
      "job_descriptions.ctc_max_lpa numeric null=YES",
      "job_descriptions.ctc_min_lpa numeric null=YES",
      "job_descriptions.ctc_source_count integer null=YES",
      "job_descriptions.role_key character varying null=YES",
      "job_descriptions.yoe_max numeric null=YES",
      "job_descriptions.yoe_min numeric null=YES",
```

2. In the constraints list, add `"job_descriptions UNIQUE (company, role_key)"` after the three `auth_token` entries.
3. In the index list, add `"CREATE UNIQUE INDEX uq_jd_company_role_key ON public.job_descriptions USING btree (company, role_key)"` at the end.
4. Update the comment `...and the additions are exactly 0001_password_auth's.` to `...and the additions are exactly 0001_password_auth's and 0002_company_research's.`

If PGlite prints a type differently from the strings above (e.g. `text[]` instead of `ARRAY`), use PGlite's spelling. What matters is that the set of additions is exactly these columns.

- [ ] **Step 10: Run the whole API suite**

Run: `pnpm --filter @interviewiq/api test && pnpm --filter @interviewiq/api typecheck`
Expected: PASS.

Some old catalogue CRUD tests in `adminCompanyController.test.ts` (POST with `jds`, GET grouped by company, DELETE by slug) still fail. Task 11 rewrites them. If you run Task 10 alone, mark that describe block `describe.skip` with the comment `// rewritten in Task 11` until then.

- [ ] **Step 11: Checkpoint**

Run `git status`; leave the changes uncommitted.

---

## Task 11: Admin company CRUD, research targets and the research client

**Files:**
- Modify: `apps/api/src/routes/admin.ts` (`adminCompaniesRouter`), `apps/api/src/routes/internal.ts`, `apps/api/src/integrations/aiService/client.ts`
- Test: `apps/api/test/routes/adminCompanyController.test.ts` (rewrite the "catalogue CRUD" describe block), `apps/api/test/routes/internalResearchTargets.test.ts`

**Interfaces:**
- Consumes: `slugify`, the company repository and `COMPANY_STATUSES` (Task 10).
- Produces these HTTP routes:

  | Method | Path | Body | Response |
  |---|---|---|---|
  | `GET` | `/api/v1/admin/companies` | | `{ companies: AdminCompany[], researchAvailable: boolean }` |
  | `POST` | `/api/v1/admin/companies` | `{ name, website?, aliases? }` | 201 `AdminCompany`; 400 `invalid_company` / `invalid_website` / `invalid_aliases`; 409 `company_exists` |
  | `PATCH` | `/api/v1/admin/companies/:id` | `{ name?, website?, aliases?, status? }` | 200 `AdminCompany`; 400 `invalid_status`; 404 `company_not_found`. The slug never changes. |
  | `DELETE` | `/api/v1/admin/companies/:id` | | 204 (also deletes the company's JDs and role configs); 404 |
  | `POST` | `/api/v1/admin/companies/seed` | | Unchanged route (Task 10 result shape) |
  | `GET` | `/api/v1/internal/research-targets` | | `[{ id, name, slug, website, aliases }]` for active companies |

  - `AdminCompany = { id, name, slug, website, aliases, status, origin, tier, publishedVersion, publishedAt, createdAt, research: { lastRunId, lastResearchedAt, lastStatus, latestDraftId, latestDraftStatus } | null }`.
  - New `AiServiceClient` methods:
    - `companyResearchStates(ids)`: a lookup that resolves to null on failure and never throws;
    - `startResearchRun(body)` and `listResearchRuns(limit)`;
    - `getResearchRun(runId)` and `controlResearchRun(runId, action)`;
    - `patchResearchBudget(runId, body)`;
    - `listResearchEvents(runId, qs: URLSearchParams)`;
    - `listResearchSpans(runId, companyId | null)` and `getResearchSpan(spanId)`.

- [ ] **Step 1: Write the failing tests**

In `apps/api/test/routes/adminCompanyController.test.ts`, replace the whole `describe("catalogue CRUD", …)` block (and remove any `describe.skip` left from Task 10) with:

```ts
describe("company CRUD", () => {
  let env: TestEnv;
  let admin: string;
  beforeAll(async () => {
    env = await createTestEnv();
    admin = await bearer(env, await createUser(env, { role: "ADMIN" }));
  });
  afterAll(() => env.close());
  beforeEach(() => env.fetch.reset());

  it("POST 201: slugs the name, normalises website + aliases, starts unpublished, triggers nothing", async () => {
    const res = await env.http
      .post(BASE)
      .set("Authorization", admin)
      .send({ name: "  Tata   Consultancy Services (TCS) ", website: "tcs.com", aliases: [" TCS ", "tcs", "Tata CS"] });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      name: "Tata Consultancy Services (TCS)",
      slug: "tata-consultancy-services-tcs",
      website: "https://tcs.com",
      aliases: ["TCS", "Tata CS"],
      status: "active",
      origin: "admin",
      publishedAt: null,
      publishedVersion: null,
      research: null,
    });
    expect(res.body.id).toMatch(UUID_RE);
    expect(aiCalls(env)).toHaveLength(0);
    const student = await env.http.get("/api/v1/companies").set("Authorization", admin);
    expect(student.body.map((c: { slug: string }) => c.slug)).not.toContain("tata-consultancy-services-tcs");
  });

  it("POST validation: 400 codes and 409 on a duplicate slug", async () => {
    const post = (body: unknown) => env.http.post(BASE).set("Authorization", admin).send(body as object);
    expect((await post({ name: "  " })).body.code).toBe("invalid_company");
    expect((await post({ name: "!!!" })).body.code).toBe("invalid_company");
    expect((await post({ name: "Acme", website: "not a url" })).body.code).toBe("invalid_website");
    expect((await post({ name: "Acme", website: "ftp://acme.com" })).body.code).toBe("invalid_website");
    expect((await post({ name: "Acme", aliases: "Acme Inc" })).body.code).toBe("invalid_aliases");
    expect((await post({ name: "Acme", aliases: Array.from({ length: 11 }, (_, i) => `a${i}`) })).body.code).toBe("invalid_aliases");
    expect((await post({ name: "Zeta" })).status).toBe(201);
    const dup = await post({ name: "ZETA" });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe("company_exists");
  });

  it("GET merges each company's research state from the AI service", async () => {
    const created = await env.http.post(BASE).set("Authorization", admin).send({ name: "Groww" });
    env.fetch.on("GET", `${AI}/research/companies/state`, {
      states: [{ company_id: created.body.id, last_run_id: "r1", last_researched_at: "2026-10-02T10:00:00Z",
                 last_status: "done", latest_draft_id: "d1", latest_draft_status: "pending_review" }],
    });
    const res = await env.http.get(BASE).set("Authorization", admin);
    expect(res.status).toBe(200);
    expect(res.body.researchAvailable).toBe(true);
    const groww = res.body.companies.find((c: { slug: string }) => c.slug === "groww");
    expect(groww.research).toEqual({ lastRunId: "r1", lastResearchedAt: "2026-10-02T10:00:00Z", lastStatus: "done",
                                     latestDraftId: "d1", latestDraftStatus: "pending_review" });
    expect(aiCalls(env)[0]!.url).toContain(created.body.id);
  });

  it("GET still lists companies when the AI service is down (research null, researchAvailable false)", async () => {
    const res = await env.http.get(BASE).set("Authorization", admin);
    expect(res.status).toBe(200);
    expect(res.body.researchAvailable).toBe(false);
    expect(res.body.companies.every((c: { research: unknown }) => c.research === null)).toBe(true);
  });

  it("PATCH archives, renames without changing the slug, and 404s unknown ids", async () => {
    const created = await env.http.post(BASE).set("Authorization", admin).send({ name: "Swiggy" });
    const res = await env.http.patch(`${BASE}/${created.body.id}`).set("Authorization", admin)
      .send({ name: "Swiggy Ltd", status: "archived", website: null });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: "Swiggy Ltd", slug: "swiggy", status: "archived", website: null });
    expect((await env.http.patch(`${BASE}/${created.body.id}`).set("Authorization", admin).send({ status: "gone" })).body.code)
      .toBe("invalid_status");
    const missing = await env.http.patch(`${BASE}/00000000-0000-4000-8000-000000000000`).set("Authorization", admin).send({ name: "X" });
    expect(missing.status).toBe(404);
    expect(missing.body.code).toBe("company_not_found");
  });

  it("DELETE removes the company with its JDs and role configs", async () => {
    const created = await env.http.post(BASE).set("Authorization", admin).send({ name: "Delete Me" });
    await seedJd(env, { company: "delete-me" });
    await seedRoleConfig(env, { company: "delete-me" });
    const res = await env.http.delete(`${BASE}/${created.body.id}`).set("Authorization", admin);
    expect(res.status).toBe(204);
    expect(await env.c.repos.companies.findById(created.body.id)).toBeNull();
    expect((await env.c.repos.jds.findAllActiveOrdered()).some((j) => j.company === "delete-me")).toBe(false);
    expect(await env.c.repos.roleConfigs.findByCompanyAndRoleAndLevel("delete-me", "software-engineer", "sde1")).toBeNull();
    expect((await env.http.delete(`${BASE}/${created.body.id}`).set("Authorization", admin)).status).toBe(404);
  });

  it("ADMIN-only", async () => {
    const user = await bearer(env, await createUser(env));
    expect((await env.http.get(BASE).set("Authorization", user)).status).toBe(403);
    expect((await env.http.post(BASE).send({ name: "X" })).status).toBe(401);
  });
});
```

`apps/api/test/routes/internalResearchTargets.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestEnv, TEST_INTERNAL_KEY, type TestEnv } from "../support/harness.js";
import { seedCompany } from "./helpers.js";

describe("GET /api/v1/internal/research-targets", () => {
  let env: TestEnv;
  beforeAll(async () => {
    env = await createTestEnv();
    await seedCompany(env, "meesho", "Meesho", { aliases: ["Fashnear"], website: "https://meesho.com" });
    await seedCompany(env, "new-co", "New Co", { publishedAt: null });
    await seedCompany(env, "old-co", "Old Co", { status: "archived" });
  });
  afterAll(() => env.close());

  it("returns every ACTIVE company (published or not) for the research run", async () => {
    const res = await env.http.get("/api/v1/internal/research-targets").set("X-Internal-Api-Key", TEST_INTERNAL_KEY);
    expect(res.status).toBe(200);
    expect(res.body.map((t: { slug: string }) => t.slug)).toEqual(["meesho", "new-co"]);
    expect(res.body[0]).toEqual({ id: expect.any(String), name: "Meesho", slug: "meesho", website: "https://meesho.com", aliases: ["Fashnear"] });
  });

  it("requires the internal key", async () => {
    expect((await env.http.get("/api/v1/internal/research-targets")).status).toBe(401);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @interviewiq/api exec vitest run test/routes/adminCompanyController.test.ts test/routes/internalResearchTargets.test.ts`
Expected: FAIL. POST still demands `jds`, and `/research-targets` returns 404.

- [ ] **Step 3: Add the AI-service client methods**

In `apps/api/src/integrations/aiService/client.ts`, add a section before `// --- transport`:

```ts
  // --- company research (Phase 1) -------------------------------------------------------------

  /** Research state per company `{states: [...]}`; null when the AI service is unreachable (lookup: never throws). */
  async companyResearchStates(ids: string[]): Promise<unknown | null> {
    try {
      return await this.getJson(`/research/companies/state?ids=${ids.map(encodeURIComponent).join(",")}`);
    } catch (err) {
      if (err instanceof UpstreamError) {
        this.log.warn({ err: err.message }, "AI service research-state lookup failed");
        return null;
      }
      throw err;
    }
  }

  startResearchRun(body: unknown): Promise<unknown> {
    return this.postJson("/research/runs", body);
  }

  listResearchRuns(limit: number): Promise<unknown> {
    return this.getJson(`/research/runs?limit=${limit}`);
  }

  getResearchRun(runId: string): Promise<unknown> {
    return this.getJson(`/research/runs/${seg(runId)}`);
  }

  controlResearchRun(runId: string, action: "pause" | "resume" | "stop"): Promise<unknown> {
    return this.postJson(`/research/runs/${seg(runId)}/${action}`);
  }

  async patchResearchBudget(runId: string, body: unknown): Promise<unknown> {
    const path = `/research/runs/${seg(runId)}/budget`;
    return this.nonEmptyJson(
      await this.send({ method: "PATCH", url: this.url(path), body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }),
      path,
    );
  }

  listResearchEvents(runId: string, query: URLSearchParams): Promise<unknown> {
    const qs = query.toString();
    return this.getJson(`/research/runs/${seg(runId)}/events${qs ? `?${qs}` : ""}`);
  }

  listResearchSpans(runId: string, companyId: string | null): Promise<unknown> {
    return this.getJson(`/research/runs/${seg(runId)}/spans${companyId ? `?company_id=${encodeURIComponent(companyId)}` : ""}`);
  }

  getResearchSpan(spanId: string): Promise<unknown> {
    return this.getJson(`/research/spans/${seg(spanId)}`);
  }
```

- [ ] **Step 4: Rewrite the admin company router**

In `apps/api/src/routes/admin.ts`:
- Delete the old `adminCompaniesRouter` and its now-unused helpers (`DEFAULT_ROLE`, `DEFAULT_SPECIALIZATION`, `slug`).
- Remove the now-unused imports (`LEVELS`, `UpstreamError`, `items`, `stringParam`, `isBlank` if unused).
- Add:

```ts
import { COMPANY_STATUSES, type CompanyRow, type CompanyStatus } from "../db/pg/schema.js";
import { slugify } from "../domain/slug.js";
import { ApiError } from "../lib/errors.js";
// (merge into the existing ../lib/json.js import so it reads: import { isObject, items, path } from "../lib/json.js";)

const MAX_ALIASES = 10;
const MAX_ALIAS_LENGTH = 100;

/** The AI service's per-company research state (spec §4.2 company_research_state). */
interface ResearchState {
  company_id: string;
  last_run_id?: string | null;
  last_researched_at?: string | null;
  last_status?: string | null;
  latest_draft_id?: string | null;
  latest_draft_status?: string | null;
}

function toAdminCompany(row: CompanyRow, state: ResearchState | undefined) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    website: row.website,
    aliases: row.aliases,
    status: row.status,
    origin: row.origin,
    tier: row.tier,
    publishedVersion: row.publishedVersion,
    publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    research: state
      ? {
          lastRunId: state.last_run_id ?? null,
          lastResearchedAt: state.last_researched_at ?? null,
          lastStatus: state.last_status ?? null,
          latestDraftId: state.latest_draft_id ?? null,
          latestDraftStatus: state.latest_draft_status ?? null,
        }
      : null,
  };
}

function parseName(raw: unknown): { name: string; slug: string } {
  const name = typeof raw === "string" ? raw.trim().replace(/\s+/g, " ") : "";
  const slug = slugify(name);
  if (!name || name.length > 255 || !slug) {
    throw new ApiError(400, "invalid_company", "name is required (up to 255 characters, with at least one letter or digit)");
  }
  return { name, slug };
}

function parseWebsite(raw: unknown): string | null {
  if (raw === undefined || raw === null || (typeof raw === "string" && raw.trim() === "")) return null;
  const invalid = new ApiError(400, "invalid_website", "website must be an http(s) URL like https://meesho.com");
  if (typeof raw !== "string") throw invalid;
  const trimmed = raw.trim();
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw invalid;
  }
  if (!["http:", "https:"].includes(url.protocol) || !url.hostname.includes(".") || /\s/.test(trimmed) || withScheme.length > 255) {
    throw invalid;
  }
  return withScheme;
}

function parseAliases(raw: unknown): string[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.some((a) => typeof a !== "string")) {
    throw new ApiError(400, "invalid_aliases", "aliases must be a list of strings");
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const alias of raw as string[]) {
    const clean = alias.trim().replace(/\s+/g, " ");
    if (!clean) continue;
    if (clean.length > MAX_ALIAS_LENGTH) throw new ApiError(400, "invalid_aliases", `each alias is at most ${MAX_ALIAS_LENGTH} characters`);
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
  }
  if (out.length > MAX_ALIASES) throw new ApiError(400, "invalid_aliases", `at most ${MAX_ALIASES} aliases`);
  return out;
}

/**
 * Admin company catalogue (Intelligence → Companies): the curated list the research job works
 * through. A new company starts unpublished: students see it only after an admin approves its
 * first research draft (Phase 2). The slug is fixed at creation; it joins JDs, briefs and research.
 */
export function adminCompaniesRouter(c: Container): Router {
  const r = router();

  /** Load the starter catalogue on demand. Idempotent, upsert-only. Does NOT trigger research. */
  r.post("/seed", async (_req, res) => {
    res.json(await c.seeder.seed());
  });

  r.get("/", async (_req, res) => {
    const rows = await c.repos.companies.findAll();
    const states = rows.length > 0 ? await c.aiService.companyResearchStates(rows.map((row) => row.id)) : { states: [] };
    const byId = new Map<string, ResearchState>();
    for (const s of items(path(states, "states"))) {
      if (isObject(s) && typeof s.company_id === "string") byId.set(s.company_id, s as unknown as ResearchState);
    }
    res.json({ companies: rows.map((row) => toAdminCompany(row, byId.get(row.id))), researchAvailable: states !== null });
  });

  r.post("/", async (req, res) => {
    const b = isObject(req.body) ? req.body : {};
    const { name, slug } = parseName(b.name);
    const website = parseWebsite(b.website);
    const aliases = parseAliases(b.aliases);
    if (await c.repos.companies.findBySlug(slug)) {
      sendError(res, 409, "company_exists", `a company with the slug "${slug}" already exists`);
      return;
    }
    const row = await c.repos.companies.create({ name, slug, website, aliases, origin: "admin" });
    res.status(201).json(toAdminCompany(row, undefined));
  });

  r.patch("/:id", async (req, res) => {
    const id = uuidParam(req, "id");
    const b = isObject(req.body) ? req.body : {};
    const patch: Partial<typeof companies.$inferInsert> = {};
    if ("name" in b) patch.name = parseName(b.name).name;
    if ("website" in b) patch.website = parseWebsite(b.website);
    if ("aliases" in b) patch.aliases = parseAliases(b.aliases);
    if ("status" in b) {
      if (typeof b.status !== "string" || !(COMPANY_STATUSES as readonly string[]).includes(b.status)) {
        throw new ApiError(400, "invalid_status", `status must be one of [${COMPANY_STATUSES.join(", ")}]`);
      }
      patch.status = b.status as CompanyStatus;
    }
    const row = Object.keys(patch).length > 0 ? await c.repos.companies.update(id, patch) : await c.repos.companies.findById(id);
    if (!row) {
      sendError(res, 404, "company_not_found", "no company with that id");
      return;
    }
    res.json(toAdminCompany(row, undefined));
  });

  r.delete("/:id", async (req, res) => {
    const id = uuidParam(req, "id");
    const row = await c.repos.companies.findById(id);
    if (!row) {
      sendError(res, 404, "company_not_found", "no company with that id");
      return;
    }
    await c.repos.jds.deleteByCompany(row.slug);
    await c.repos.roleConfigs.deleteByCompany(row.slug);
    await c.repos.companies.deleteById(id);
    res.status(204).end();
  });

  return r;
}
```

Add `companies` to the `../db/pg/schema.js` import (it's used for `$inferInsert`).

- [ ] **Step 5: Add the research-targets endpoint**

In `apps/api/src/routes/internal.ts`, after `/scrape-targets`, add:

```ts
  /** Company research targets: every ACTIVE company, published or not (spec §8.1). */
  r.get("/research-targets", async (_req, res) => {
    const rows = await c.repos.companies.findActive();
    res.json(rows.map((co) => ({ id: co.id, name: co.name, slug: co.slug, website: co.website, aliases: co.aliases })));
  });
```

- [ ] **Step 6: Run the API suite and typecheck**

Run: `pnpm --filter @interviewiq/api test && pnpm --filter @interviewiq/api typecheck`
Expected: PASS.

- [ ] **Step 7: Checkpoint**

Run `git status`; leave the changes uncommitted.

---

## Task 12: Admin research proxy router

**Files:**
- Create: `apps/api/src/routes/research.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/test/routes/adminResearchController.test.ts`

**Interfaces:**
- Consumes: the `AiServiceClient` research methods (Task 11).
- Produces these routes under `/api/v1/admin/research` (admin only, snake_case passthrough):

  | Method | Path | Notes |
  |---|---|---|
  | `POST` | `/runs` | Body `{scope, companyIds?, mode?}`; forwarded as `{scope, company_ids, mode?, requested_by: <admin id>}`. Returns 201. |
  | `GET` | `/runs?limit` | Limit clamped to 1–100 |
  | `GET` | `/runs/:runId` | |
  | `POST` | `/runs/:runId/pause\|resume\|stop` | |
  | `PATCH` | `/runs/:runId/budget` | `{exaCap?, llmCap?}` → `{exa_cap?, llm_cap?}` |
  | `GET` | `/runs/:runId/events?afterSeq&beforeSeq&limit&level&companyId&node&type&spanId&q` | Query mapped to snake_case |
  | `GET` | `/runs/:runId/spans?companyId` | |
  | `GET` | `/spans/:spanId` | |

  Errors:
  - 400 `invalid_run_id` / `invalid_span_id` for anything other than a 32-character hex ID.
  - 400 `no_companies`, `invalid_mode` and `invalid_budget` from local validation.
  - Upstream 400/404/409/503 `{code, message}` forwarded as-is; an upstream 422 becomes 400 `invalid_request`.
  - Anything else upstream becomes 502 `ai_service_unreachable`.

- [ ] **Step 1: Write the failing tests**

`apps/api/test/routes/adminResearchController.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { UserRow } from "../../src/db/pg/schema.js";
import { json } from "../support/fakeFetch.js";
import { bearer, createUser, createTestEnv, TEST_INTERNAL_KEY, type TestEnv } from "../support/harness.js";
import { AI, aiCalls } from "./helpers.js";

const BASE = "/api/v1/admin/research";
const RUN = "a".repeat(32);
const SPAN = "b".repeat(32);

describe("admin research proxies", () => {
  let env: TestEnv;
  let adminUser: UserRow;
  let admin: string;
  beforeAll(async () => {
    env = await createTestEnv();
    adminUser = await createUser(env, { role: "ADMIN" });
    admin = await bearer(env, adminUser);
  });
  afterAll(() => env.close());
  beforeEach(() => env.fetch.reset());

  it("POST /runs forwards scope, ids, mode and the admin as requested_by (201 passthrough)", async () => {
    env.fetch.on("POST", `${AI}/research/runs`, () => json({ run_id: RUN, status: "queued" }, 201));
    const res = await env.http.post(`${BASE}/runs`).set("Authorization", admin)
      .send({ scope: "selected", companyIds: ["c1", 7], mode: "replay" });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ run_id: RUN, status: "queued" });
    const [call] = aiCalls(env);
    expect(call!.json).toEqual({ scope: "selected", company_ids: ["c1"], mode: "replay", requested_by: adminUser.id });
    expect(call!.headers["x-internal-api-key"]).toBe(TEST_INTERNAL_KEY);
  });

  it("POST /runs validates locally: no companies for a selected run, unknown mode", async () => {
    const a = await env.http.post(`${BASE}/runs`).set("Authorization", admin).send({ scope: "selected", companyIds: [] });
    expect([a.status, a.body.code]).toEqual([400, "no_companies"]);
    const b = await env.http.post(`${BASE}/runs`).set("Authorization", admin).send({ mode: "dry" });
    expect([b.status, b.body.code]).toEqual([400, "invalid_mode"]);
    expect(aiCalls(env)).toHaveLength(0);
  });

  it("forwards an upstream 409 run_active with its code and message", async () => {
    env.fetch.on("POST", `${AI}/research/runs`, () =>
      json({ code: "run_active", message: `run ${RUN} is still active; resume or stop it first`, run_id: RUN }, 409));
    const res = await env.http.post(`${BASE}/runs`).set("Authorization", admin).send({});
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ code: "run_active", message: `run ${RUN} is still active; resume or stop it first` });
  });

  it("control actions, run detail and listing pass through", async () => {
    env.fetch.on("POST", `${AI}/research/runs/${RUN}/pause`, { run_id: RUN, status: "pausing" });
    env.fetch.on("GET", `${AI}/research/runs/${RUN}`, { run: { run_id: RUN }, items: [] });
    env.fetch.on("GET", `${AI}/research/runs?limit=100`, { runs: [] });
    expect((await env.http.post(`${BASE}/runs/${RUN}/pause`).set("Authorization", admin)).body.status).toBe("pausing");
    expect((await env.http.get(`${BASE}/runs/${RUN}`).set("Authorization", admin)).body.items).toEqual([]);
    expect((await env.http.get(`${BASE}/runs?limit=500`).set("Authorization", admin)).body).toEqual({ runs: [] });
  });

  it("events: camelCase query → snake_case upstream; blanks dropped", async () => {
    env.fetch.on("GET", `${AI}/research/runs/${RUN}/events`, { events: [], last_seq: 0 });
    await env.http.get(`${BASE}/runs/${RUN}/events?afterSeq=10&level=warn&companyId=c1&spanId=${SPAN}&q=&type=span.`)
      .set("Authorization", admin);
    const url = new URL(aiCalls(env)[0]!.url);
    expect(Object.fromEntries(url.searchParams)).toEqual({ after_seq: "10", level: "warn", company_id: "c1", span_id: SPAN, type: "span." });
  });

  it("PATCH budget maps exaCap/llmCap and rejects negatives", async () => {
    env.fetch.on("PATCH", `${AI}/research/runs/${RUN}/budget`, { run_id: RUN });
    const ok = await env.http.patch(`${BASE}/runs/${RUN}/budget`).set("Authorization", admin).send({ llmCap: 500 });
    expect(ok.status).toBe(200);
    expect(aiCalls(env)[0]!.json).toEqual({ llm_cap: 500 });
    const bad = await env.http.patch(`${BASE}/runs/${RUN}/budget`).set("Authorization", admin).send({ exaCap: -1 });
    expect([bad.status, bad.body.code]).toEqual([400, "invalid_budget"]);
  });

  it("span detail passes through; malformed ids are 400 without an upstream call", async () => {
    env.fetch.on("GET", `${AI}/research/spans/${SPAN}`, { span: { span_id: SPAN }, logs: [] });
    expect((await env.http.get(`${BASE}/spans/${SPAN}`).set("Authorization", admin)).body.span.span_id).toBe(SPAN);
    const badRun = await env.http.get(`${BASE}/runs/not-a-run`).set("Authorization", admin);
    expect([badRun.status, badRun.body.code]).toEqual([400, "invalid_run_id"]);
    const badSpan = await env.http.get(`${BASE}/spans/xyz`).set("Authorization", admin);
    expect([badSpan.status, badSpan.body.code]).toEqual([400, "invalid_span_id"]);
    expect(aiCalls(env)).toHaveLength(1);
  });

  it("AI service unreachable → 502 ai_service_unreachable", async () => {
    const res = await env.http.get(`${BASE}/runs`).set("Authorization", admin);
    expect([res.status, res.body.code]).toEqual([502, "ai_service_unreachable"]);
  });

  it("ADMIN-only", async () => {
    const user = await bearer(env, await createUser(env));
    expect((await env.http.get(`${BASE}/runs`).set("Authorization", user)).status).toBe(403);
    expect((await env.http.get(`${BASE}/runs`)).status).toBe(401);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @interviewiq/api exec vitest run test/routes/adminResearchController.test.ts`
Expected: FAIL with 404 `not_found` on every route.

- [ ] **Step 3: Implement the router**

`apps/api/src/routes/research.ts`:

```ts
import type { Request, Router } from "express";
import type { Container } from "../container.js";
import { queryInt, queryString, routerErrors, router, stringParam, userId } from "../http/support.js";
import { ApiError } from "../lib/errors.js";
import { UpstreamError, UpstreamHttpError } from "../lib/http.js";
import { isObject } from "../lib/json.js";

/*
 * ADMIN-only BFF proxies for the company research pipeline (gated by the security middleware on
 * /api/v1/admin/**). Payloads pass through as the AI service's snake_case JSON, like the
 * /intelligence proxies. Upstream {code, message} errors are forwarded as-is so the debugger can
 * show exactly what the pipeline said.
 */

const HEX_ID = /^[0-9a-f]{32}$/;
const MODES = ["live", "record", "replay"] as const;
const EVENT_QUERY: ReadonlyArray<readonly [string, string]> = [
  ["afterSeq", "after_seq"],
  ["beforeSeq", "before_seq"],
  ["limit", "limit"],
  ["level", "level"],
  ["companyId", "company_id"],
  ["node", "node"],
  ["type", "type"],
  ["spanId", "span_id"],
  ["q", "q"],
];
const FORWARDED_STATUSES = new Set([400, 404, 409, 503]);

function hexParam(req: Request, name: "runId" | "spanId"): string {
  const value = stringParam(req, name);
  if (!HEX_ID.test(value)) {
    throw new ApiError(400, name === "runId" ? "invalid_run_id" : "invalid_span_id", `${name} must be a 32-character hex id`);
  }
  return value;
}

export function adminResearchRouter(c: Container): Router {
  const r = router();

  r.post("/runs", async (req, res) => {
    const b = isObject(req.body) ? req.body : {};
    const scope = b.scope === "selected" ? "selected" : "all";
    const companyIds = Array.isArray(b.companyIds) ? b.companyIds.filter((x): x is string => typeof x === "string") : [];
    if (scope === "selected" && companyIds.length === 0) throw new ApiError(400, "no_companies", "pick at least one company to research");
    let mode: string | undefined;
    if (b.mode !== undefined) {
      if (typeof b.mode !== "string" || !(MODES as readonly string[]).includes(b.mode)) {
        throw new ApiError(400, "invalid_mode", `mode must be one of [${MODES.join(", ")}]`);
      }
      mode = b.mode;
    }
    const run = await c.aiService.startResearchRun({ scope, company_ids: companyIds, ...(mode ? { mode } : {}), requested_by: userId(req) });
    res.status(201).json(run);
  });

  r.get("/runs", async (req, res) => {
    res.json(await c.aiService.listResearchRuns(Math.min(Math.max(queryInt(req, "limit", 20), 1), 100)));
  });

  r.get("/runs/:runId", async (req, res) => {
    res.json(await c.aiService.getResearchRun(hexParam(req, "runId")));
  });

  for (const action of ["pause", "resume", "stop"] as const) {
    r.post(`/runs/:runId/${action}`, async (req, res) => {
      res.json(await c.aiService.controlResearchRun(hexParam(req, "runId"), action));
    });
  }

  r.patch("/runs/:runId/budget", async (req, res) => {
    const runId = hexParam(req, "runId");
    const b = isObject(req.body) ? req.body : {};
    const body: Record<string, number> = {};
    for (const [from, to] of [["exaCap", "exa_cap"], ["llmCap", "llm_cap"]] as const) {
      const value = b[from];
      if (value === undefined) continue;
      if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
        throw new ApiError(400, "invalid_budget", `${from} must be a non-negative integer`);
      }
      body[to] = value;
    }
    res.json(await c.aiService.patchResearchBudget(runId, body));
  });

  r.get("/runs/:runId/events", async (req, res) => {
    const runId = hexParam(req, "runId");
    const qs = new URLSearchParams();
    for (const [from, to] of EVENT_QUERY) {
      const value = queryString(req, from);
      if (value !== null && value !== "") qs.set(to, value);
    }
    res.json(await c.aiService.listResearchEvents(runId, qs));
  });

  r.get("/runs/:runId/spans", async (req, res) => {
    res.json(await c.aiService.listResearchSpans(hexParam(req, "runId"), queryString(req, "companyId")));
  });

  r.get("/spans/:spanId", async (req, res) => {
    res.json(await c.aiService.getResearchSpan(hexParam(req, "spanId")));
  });

  r.use(
    routerErrors((err) => {
      if (err instanceof UpstreamHttpError && (FORWARDED_STATUSES.has(err.status) || err.status === 422)) {
        const body = parseEnvelope(err.responseBody);
        if (err.status === 422) return { status: 400, code: "invalid_request", message: body?.message ?? err.message };
        return { status: err.status, code: body?.code ?? "research_request_failed", message: body?.message ?? err.message };
      }
      if (err instanceof UpstreamError) {
        c.log.warn(`research proxy: ${err.message}`);
        return { status: 502, code: "ai_service_unreachable", message: "the research service is not reachable" };
      }
      return undefined;
    }),
  );
  return r;
}

/** {code, message} from the AI service, or FastAPI's {detail} for its own validation errors. */
function parseEnvelope(text: string): { code?: string; message?: string } | null {
  try {
    const v: unknown = JSON.parse(text);
    if (!isObject(v)) return null;
    if (typeof v.code === "string") return { code: v.code, message: typeof v.message === "string" ? v.message : undefined };
    if (v.detail !== undefined) return { message: typeof v.detail === "string" ? v.detail : JSON.stringify(v.detail).slice(0, 500) };
    return null;
  } catch {
    return null;
  }
}
```

In `apps/api/src/app.ts`, import `adminResearchRouter` from `./routes/research.js`. Mount it right after the admin users router:

```ts
  v1.use("/admin/research", adminResearchRouter(c));
```

- [ ] **Step 4: Run the tests and typecheck**

Run: `pnpm --filter @interviewiq/api test && pnpm --filter @interviewiq/api typecheck`
Expected: PASS.

- [ ] **Step 5: Checkpoint**

Run `git status`; leave the changes uncommitted.

---

## Task 13: Contract and generated web types

**Files:**
- Modify: `packages/contracts/openapi.yaml`
- Regenerate: `apps/web/lib/api-client/generated/schema.d.ts`

**Interfaces:**
- Produces generated `components["schemas"]` for the shapes Tasks 9 and 11 already return:
  - Company: `AdminCompany`, `AdminCompanyList`, `CompanyResearchState`, `CreateCompanyRequest`, `UpdateCompanyRequest`, `SeedResult`.
  - Enums: `ResearchMode`, `ResearchLevel`, `ResearchRunStatus`, `ResearchItemStatus`.
  - Runs: `ResearchRunCounters`, `ResearchBudget`, `ResearchRun`, `ResearchRunList`, `ResearchRunDetail`, `ResearchError`, `ResearchNodeProgress`, `ResearchItem`.
  - Events and spans: `ResearchEvent`, `ResearchEventPage`, `ResearchSpan`, `ResearchSpanList`, `ResearchSpanDetail`, `ResearchSpanDetailResponse`.
  - Requests and targets: `StartResearchRunRequest`, `ResearchBudgetUpdate`, `ResearchTarget`.

- [ ] **Step 1: Bump the version and add tags**

In `packages/contracts/openapi.yaml`:
- Set `info.version` to `0.4.0`.
- Append to the description: "Company research (admin): curated companies, research runs with pause/resume/stop and a full-verbosity trace (spans + events) is the surface added in 0.4.0. Research payloads are the ai-service's snake_case JSON passed through by interviewiq-api; admin company payloads are camelCase."
- Add to `tags`:

```yaml
  - name: admin-companies
    description: Curated company catalogue the research job works through (ADMIN only).
  - name: admin-research
    description: Company research runs, controls and their full trace (ADMIN only; snake_case passthrough).
  - name: internal-research
    description: Service-to-service research targets (ai-service → api).
```

- [ ] **Step 2: Add the paths**

Insert under `paths:`, before `/interview-plans:`:

```yaml
  /api/v1/admin/companies:
    get:
      operationId: listAdminCompanies
      tags: [admin-companies]
      summary: Every company with its research state (research is null when the AI service is unreachable).
      security: [{ bearerAuth: [] }]
      responses:
        "200": { description: Companies., content: { application/json: { schema: { $ref: "#/components/schemas/AdminCompanyList" } } } }
        "401": { $ref: "#/components/responses/Unauthorized" }
    post:
      operationId: createCompany
      tags: [admin-companies]
      summary: Add a company to research. It starts unpublished (students see it after an admin approves its first draft).
      security: [{ bearerAuth: [] }]
      requestBody:
        required: true
        content: { application/json: { schema: { $ref: "#/components/schemas/CreateCompanyRequest" } } }
      responses:
        "201": { description: Created., content: { application/json: { schema: { $ref: "#/components/schemas/AdminCompany" } } } }
        "400": { description: "`invalid_company` | `invalid_website` | `invalid_aliases`.", content: { application/json: { schema: { $ref: "#/components/schemas/ApiError" } } } }
        "409": { description: "`company_exists` — the slug is taken.", content: { application/json: { schema: { $ref: "#/components/schemas/ApiError" } } } }
  /api/v1/admin/companies/seed:
    post:
      operationId: seedCompanies
      tags: [admin-companies]
      summary: Load the starter catalogue (upsert-only; never deletes).
      security: [{ bearerAuth: [] }]
      responses:
        "200": { description: Seed result., content: { application/json: { schema: { $ref: "#/components/schemas/SeedResult" } } } }
  /api/v1/admin/companies/{companyId}:
    parameters:
      - { name: companyId, in: path, required: true, schema: { type: string, format: uuid } }
    patch:
      operationId: updateCompany
      tags: [admin-companies]
      summary: Edit identity fields or archive. The slug never changes.
      security: [{ bearerAuth: [] }]
      requestBody:
        required: true
        content: { application/json: { schema: { $ref: "#/components/schemas/UpdateCompanyRequest" } } }
      responses:
        "200": { description: Updated., content: { application/json: { schema: { $ref: "#/components/schemas/AdminCompany" } } } }
        "400": { description: "`invalid_company` | `invalid_website` | `invalid_aliases` | `invalid_status`.", content: { application/json: { schema: { $ref: "#/components/schemas/ApiError" } } } }
        "404": { $ref: "#/components/responses/NotFound" }
    delete:
      operationId: deleteCompany
      tags: [admin-companies]
      summary: Delete the company with its JDs and role configs.
      security: [{ bearerAuth: [] }]
      responses:
        "204": { description: Deleted. }
        "404": { $ref: "#/components/responses/NotFound" }

  /api/v1/admin/research/runs:
    get:
      operationId: listResearchRuns
      tags: [admin-research]
      security: [{ bearerAuth: [] }]
      parameters:
        - { name: limit, in: query, schema: { type: integer, minimum: 1, maximum: 100, default: 20 } }
      responses:
        "200": { description: Newest first., content: { application/json: { schema: { $ref: "#/components/schemas/ResearchRunList" } } } }
        "502": { description: "`ai_service_unreachable`.", content: { application/json: { schema: { $ref: "#/components/schemas/ApiError" } } } }
    post:
      operationId: startResearchRun
      tags: [admin-research]
      summary: Start a run. Only one run may be active (queued, running, pausing, paused or stopping).
      security: [{ bearerAuth: [] }]
      requestBody:
        required: true
        content: { application/json: { schema: { $ref: "#/components/schemas/StartResearchRunRequest" } } }
      responses:
        "201": { description: The new run., content: { application/json: { schema: { $ref: "#/components/schemas/ResearchRun" } } } }
        "400": { description: "`no_companies` | `invalid_mode`.", content: { application/json: { schema: { $ref: "#/components/schemas/ApiError" } } } }
        "409": { description: "`run_active`.", content: { application/json: { schema: { $ref: "#/components/schemas/ApiError" } } } }
        "503": { description: "`targets_unavailable` | `research_disabled`.", content: { application/json: { schema: { $ref: "#/components/schemas/ApiError" } } } }
  /api/v1/admin/research/runs/{runId}:
    parameters: [{ $ref: "#/components/parameters/ResearchRunId" }]
    get:
      operationId: getResearchRun
      tags: [admin-research]
      security: [{ bearerAuth: [] }]
      responses:
        "200": { description: Run with its items., content: { application/json: { schema: { $ref: "#/components/schemas/ResearchRunDetail" } } } }
        "404": { $ref: "#/components/responses/NotFound" }
  /api/v1/admin/research/runs/{runId}/pause:
    parameters: [{ $ref: "#/components/parameters/ResearchRunId" }]
    post:
      operationId: pauseResearchRun
      tags: [admin-research]
      security: [{ bearerAuth: [] }]
      responses:
        "200": { description: Pausing., content: { application/json: { schema: { $ref: "#/components/schemas/ResearchRun" } } } }
        "409": { description: "`invalid_transition`.", content: { application/json: { schema: { $ref: "#/components/schemas/ApiError" } } } }
  /api/v1/admin/research/runs/{runId}/resume:
    parameters: [{ $ref: "#/components/parameters/ResearchRunId" }]
    post:
      operationId: resumeResearchRun
      tags: [admin-research]
      security: [{ bearerAuth: [] }]
      responses:
        "200": { description: Resumed., content: { application/json: { schema: { $ref: "#/components/schemas/ResearchRun" } } } }
        "409": { description: "`invalid_transition`.", content: { application/json: { schema: { $ref: "#/components/schemas/ApiError" } } } }
  /api/v1/admin/research/runs/{runId}/stop:
    parameters: [{ $ref: "#/components/parameters/ResearchRunId" }]
    post:
      operationId: stopResearchRun
      tags: [admin-research]
      security: [{ bearerAuth: [] }]
      responses:
        "200": { description: Stopping or stopped., content: { application/json: { schema: { $ref: "#/components/schemas/ResearchRun" } } } }
        "409": { description: "`invalid_transition`.", content: { application/json: { schema: { $ref: "#/components/schemas/ApiError" } } } }
  /api/v1/admin/research/runs/{runId}/budget:
    parameters: [{ $ref: "#/components/parameters/ResearchRunId" }]
    patch:
      operationId: updateResearchBudget
      tags: [admin-research]
      security: [{ bearerAuth: [] }]
      requestBody:
        required: true
        content: { application/json: { schema: { $ref: "#/components/schemas/ResearchBudgetUpdate" } } }
      responses:
        "200": { description: Updated run., content: { application/json: { schema: { $ref: "#/components/schemas/ResearchRun" } } } }
        "400": { description: "`invalid_budget` — negative, or below calls already made.", content: { application/json: { schema: { $ref: "#/components/schemas/ApiError" } } } }
  /api/v1/admin/research/runs/{runId}/events:
    parameters: [{ $ref: "#/components/parameters/ResearchRunId" }]
    get:
      operationId: listResearchEvents
      tags: [admin-research]
      summary: Trace events, ascending by seq. With beforeSeq, the newest `limit` events before it (still ascending).
      security: [{ bearerAuth: [] }]
      parameters:
        - { name: afterSeq, in: query, schema: { type: integer, minimum: 0 } }
        - { name: beforeSeq, in: query, schema: { type: integer, minimum: 1 } }
        - { name: limit, in: query, schema: { type: integer, minimum: 1, maximum: 500 } }
        - { name: level, in: query, schema: { $ref: "#/components/schemas/ResearchLevel" } }
        - { name: companyId, in: query, schema: { type: string } }
        - { name: node, in: query, schema: { type: string } }
        - { name: type, in: query, description: Event type prefix, e.g. `span.`, schema: { type: string } }
        - { name: spanId, in: query, schema: { type: string } }
        - { name: q, in: query, description: Case-insensitive substring of the message., schema: { type: string } }
      responses:
        "200": { description: A page of events., content: { application/json: { schema: { $ref: "#/components/schemas/ResearchEventPage" } } } }
  /api/v1/admin/research/runs/{runId}/spans:
    parameters: [{ $ref: "#/components/parameters/ResearchRunId" }]
    get:
      operationId: listResearchSpans
      tags: [admin-research]
      summary: The run's span tree, flat (parent_id links), without inputs/outputs.
      security: [{ bearerAuth: [] }]
      parameters:
        - { name: companyId, in: query, schema: { type: string } }
      responses:
        "200": { description: Spans by start time., content: { application/json: { schema: { $ref: "#/components/schemas/ResearchSpanList" } } } }
  /api/v1/admin/research/spans/{spanId}:
    parameters:
      - { name: spanId, in: path, required: true, schema: { type: string, pattern: "^[0-9a-f]{32}$" } }
    get:
      operationId: getResearchSpan
      tags: [admin-research]
      summary: One span with its full input/output (offloaded payloads resolved) and its log events.
      security: [{ bearerAuth: [] }]
      responses:
        "200": { description: The span., content: { application/json: { schema: { $ref: "#/components/schemas/ResearchSpanDetailResponse" } } } }
        "404": { $ref: "#/components/responses/NotFound" }
  /api/v1/internal/research-targets:
    get:
      operationId: listResearchTargets
      tags: [internal-research]
      summary: Every active company (published or not) for the research run.
      security: [{ internalApiKey: [] }]
      responses:
        "200":
          description: Targets.
          content: { application/json: { schema: { type: array, items: { $ref: "#/components/schemas/ResearchTarget" } } } }
        "401": { $ref: "#/components/responses/Unauthorized" }
```

Under `components.parameters`, add:

```yaml
    ResearchRunId:
      name: runId
      in: path
      required: true
      schema: { type: string, pattern: "^[0-9a-f]{32}$" }
```

- [ ] **Step 3: Add the schemas**

Append under `components.schemas`:

```yaml
    CompanyResearchState:
      type: object
      required: [lastRunId, lastResearchedAt, lastStatus, latestDraftId, latestDraftStatus]
      properties:
        lastRunId: { type: string, nullable: true }
        lastResearchedAt: { type: string, format: date-time, nullable: true }
        lastStatus: { type: string, nullable: true, description: The company's item status in its latest run (ResearchItemStatus). }
        latestDraftId: { type: string, nullable: true }
        latestDraftStatus: { type: string, nullable: true, description: "pending_review | approved | rejected | superseded" }
    AdminCompany:
      type: object
      required: [id, name, slug, website, aliases, status, origin, tier, publishedVersion, publishedAt, createdAt, research]
      properties:
        id: { type: string, format: uuid }
        name: { type: string }
        slug: { type: string }
        website: { type: string, nullable: true }
        aliases: { type: array, items: { type: string } }
        status: { type: string, enum: [active, archived] }
        origin: { type: string, enum: [seed, admin] }
        tier: { type: integer, nullable: true }
        publishedVersion: { type: integer, nullable: true }
        publishedAt: { type: string, format: date-time, nullable: true }
        createdAt: { type: string, format: date-time }
        research:
          allOf: [{ $ref: "#/components/schemas/CompanyResearchState" }]
          nullable: true
    AdminCompanyList:
      type: object
      required: [companies, researchAvailable]
      properties:
        companies: { type: array, items: { $ref: "#/components/schemas/AdminCompany" } }
        researchAvailable: { type: boolean, description: false when the AI service could not be reached (research is null on every row). }
    CreateCompanyRequest:
      type: object
      required: [name]
      properties:
        name: { type: string, maxLength: 255 }
        website: { type: string, nullable: true, description: "http(s) URL; a bare domain gets https://." }
        aliases: { type: array, maxItems: 10, items: { type: string, maxLength: 100 } }
    UpdateCompanyRequest:
      type: object
      properties:
        name: { type: string, maxLength: 255 }
        website: { type: string, nullable: true }
        aliases: { type: array, maxItems: 10, items: { type: string, maxLength: 100 } }
        status: { type: string, enum: [active, archived] }
    SeedResult:
      type: object
      required: [companies, inserted, backfilled, total]
      properties:
        companies: { type: integer }
        inserted: { type: integer }
        backfilled: { type: integer }
        total: { type: integer }
    ResearchTarget:
      type: object
      required: [id, name, slug, website, aliases]
      properties:
        id: { type: string, format: uuid }
        name: { type: string }
        slug: { type: string }
        website: { type: string, nullable: true }
        aliases: { type: array, items: { type: string } }

    ResearchMode: { type: string, enum: [live, record, replay] }
    ResearchLevel: { type: string, enum: [trace, debug, info, warn, error] }
    ResearchRunStatus: { type: string, enum: [queued, running, pausing, paused, stopping, stopped, completed, failed] }
    ResearchItemStatus: { type: string, enum: [queued, running, paused, done, failed, skipped, cancelled] }
    ResearchRunCounters:
      type: object
      required: [total, queued, running, paused, done, failed, skipped, cancelled]
      properties:
        total: { type: integer }
        queued: { type: integer }
        running: { type: integer }
        paused: { type: integer }
        done: { type: integer }
        failed: { type: integer }
        skipped: { type: integer }
        cancelled: { type: integer }
    ResearchBudget:
      type: object
      required: [exa_used, exa_cap, llm_used, llm_cap, tokens_in, tokens_out]
      properties:
        exa_used: { type: integer }
        exa_cap: { type: integer }
        llm_used: { type: integer }
        llm_cap: { type: integer }
        tokens_in: { type: integer }
        tokens_out: { type: integer }
    ResearchRun:
      type: object
      required: [run_id, trigger, mode, scope, company_ids, status, control, pause_reason, counters, budget, last_seq, created_at, started_at, finished_at, error]
      properties:
        run_id: { type: string }
        trigger: { type: string, enum: [admin, cron, cli] }
        mode: { $ref: "#/components/schemas/ResearchMode" }
        scope: { type: string, enum: [all, selected] }
        company_ids: { type: array, items: { type: string } }
        status: { $ref: "#/components/schemas/ResearchRunStatus" }
        control: { type: string, enum: [none, pause, stop] }
        pause_reason: { type: string, nullable: true, description: "admin | budget_exhausted" }
        requested_by: { type: string, nullable: true }
        counters: { $ref: "#/components/schemas/ResearchRunCounters" }
        budget: { $ref: "#/components/schemas/ResearchBudget" }
        last_seq: { type: integer }
        created_at: { type: string, format: date-time }
        started_at: { type: string, format: date-time, nullable: true }
        finished_at: { type: string, format: date-time, nullable: true }
        error: { type: string, nullable: true }
        pipeline_version: { type: string }
    ResearchRunList:
      type: object
      required: [runs]
      properties:
        runs: { type: array, items: { $ref: "#/components/schemas/ResearchRun" } }
    ResearchError:
      type: object
      required: [type, message]
      properties:
        type: { type: string }
        message: { type: string }
        traceback: { type: string }
        code_ref: { type: string, nullable: true, description: "Innermost pipeline frame, e.g. app/research/nodes/resolve.py:resolve." }
    ResearchNodeProgress:
      type: object
      properties:
        status: { type: string, enum: [running, ok, error] }
        started_at: { type: string, format: date-time }
        finished_at: { type: string, format: date-time }
        exa_calls: { type: integer }
        llm_calls: { type: integer }
        error: { type: string }
    ResearchItem:
      type: object
      required: [run_id, company_id, company_name, company_slug, position, status, attempts, current_node, last_node, nodes, draft_id, error]
      properties:
        run_id: { type: string }
        company_id: { type: string }
        company_name: { type: string }
        company_slug: { type: string }
        position: { type: integer }
        status: { $ref: "#/components/schemas/ResearchItemStatus" }
        attempts: { type: integer }
        current_node: { type: string, nullable: true }
        last_node: { type: string, nullable: true }
        nodes:
          type: object
          additionalProperties: { $ref: "#/components/schemas/ResearchNodeProgress" }
        draft_id: { type: string, nullable: true }
        error:
          allOf: [{ $ref: "#/components/schemas/ResearchError" }]
          nullable: true
        started_at: { type: string, format: date-time, nullable: true }
        finished_at: { type: string, format: date-time, nullable: true }
    ResearchRunDetail:
      type: object
      required: [run, items]
      properties:
        run: { $ref: "#/components/schemas/ResearchRun" }
        items: { type: array, items: { $ref: "#/components/schemas/ResearchItem" } }
    StartResearchRunRequest:
      type: object
      properties:
        scope: { type: string, enum: [all, selected], default: all, description: all = every company not researched in RESEARCH_STALE_AFTER_DAYS. }
        companyIds: { type: array, items: { type: string } }
        mode: { $ref: "#/components/schemas/ResearchMode" }
    ResearchBudgetUpdate:
      type: object
      properties:
        exaCap: { type: integer, minimum: 0 }
        llmCap: { type: integer, minimum: 0 }
    ResearchEvent:
      type: object
      required: [run_id, seq, ts, level, level_rank, type, message, span_id, company_id, node]
      properties:
        run_id: { type: string }
        seq: { type: integer }
        ts: { type: string, format: date-time }
        level: { $ref: "#/components/schemas/ResearchLevel" }
        level_rank: { type: integer }
        type: { type: string, description: "run.* | item.* | span.start | span.end | log | cache.hit | conflict.detected | budget.* | draft.created | control.*" }
        message: { type: string }
        span_id: { type: string, nullable: true }
        company_id: { type: string, nullable: true }
        node: { type: string, nullable: true }
        data: { description: Structured detail (any JSON). }
        data_ref: { type: string, nullable: true, description: Payload id when data exceeded 32 KB. }
    ResearchEventPage:
      type: object
      required: [events, last_seq]
      properties:
        events: { type: array, items: { $ref: "#/components/schemas/ResearchEvent" } }
        last_seq: { type: integer }
    ResearchSpan:
      type: object
      required: [span_id, parent_id, run_id, company_id, node, kind, name, status, started_at, ended_at, duration_ms, attrs, error]
      properties:
        span_id: { type: string }
        parent_id: { type: string, nullable: true }
        run_id: { type: string }
        company_id: { type: string, nullable: true }
        node: { type: string, nullable: true }
        kind: { type: string, enum: [run, company, node, exa, llm, cache, merge, normalize, db] }
        name: { type: string }
        status: { type: string, enum: [running, ok, error, cancelled] }
        started_at: { type: string, format: date-time }
        ended_at: { type: string, format: date-time, nullable: true }
        duration_ms: { type: integer, nullable: true }
        attrs: { type: object, additionalProperties: true }
        input_ref: { type: string, nullable: true }
        output_ref: { type: string, nullable: true }
        error:
          allOf: [{ $ref: "#/components/schemas/ResearchError" }]
          nullable: true
    ResearchSpanList:
      type: object
      required: [spans]
      properties:
        spans: { type: array, items: { $ref: "#/components/schemas/ResearchSpan" } }
    ResearchSpanDetail:
      allOf:
        - $ref: "#/components/schemas/ResearchSpan"
        - type: object
          properties:
            input: { description: Full input (any JSON). }
            output: { description: Full output (any JSON). }
    ResearchSpanDetailResponse:
      type: object
      required: [span, logs]
      properties:
        span: { $ref: "#/components/schemas/ResearchSpanDetail" }
        logs: { type: array, items: { $ref: "#/components/schemas/ResearchEvent" } }
```

- [ ] **Step 4: Regenerate and typecheck**

Run: `pnpm contracts:types && pnpm --filter @interviewiq/web typecheck`
Expected:
- `apps/web/lib/api-client/generated/schema.d.ts` gains the new schemas;
- the typecheck passes (nothing consumes them yet).

If the generator rejects the YAML, fix the indentation it names. Don't loosen the schemas.

- [ ] **Step 5: Checkpoint**

Run `git status`; leave the changes uncommitted.

---

## Task 14: Web research feature module (API, hooks, pure helpers)

**Files:**
- Create: `apps/web/lib/constants/research/index.ts`
- Create in `apps/web/features/research/`: `types.ts`, `api.ts`, `hooks.ts`, `status.ts`, `trace-tree.ts`, `event-filters.ts`, `copy-bundle.ts`, `deep-link.ts`, `time.ts`, `clipboard.ts`, `testing.ts`, `index.ts`
- Test, in the same folder: `status.test.ts`, `trace-tree.test.ts`, `event-filters.test.ts`, `copy-bundle.test.ts`, `deep-link.test.ts`, `time.test.ts`

**Interfaces:**
- Consumes: the generated schemas (Task 13) and the `/api/v1/admin/companies` and `/api/v1/admin/research/*` routes (Tasks 11–12).
- Produces:

  | Module | Exports |
  |---|---|
  | constants | `RESEARCH_ENDPOINTS`, `RESEARCH_QUERY_KEYS`, `RESEARCH_POLLING {liveMs:1000, spansMs:2000, listsMs:5000}`, `CONSOLE_MAX_ROWS = 2000`, `EVENTS_PAGE_LIMIT = 500`, `COPY_BUNDLE_MAX_CHARS = 40_000`, `NODE_ORDER`, `NodeName` |
  | api | `listAdminCompanies`, `createCompany`, `updateCompany(id, patch)`, `deleteCompany(id)`, `seedCompanies`, `listRuns(limit)`, `getRun`, `startRun`, `controlRun(runId, action)`, `raiseBudget(runId, body)`, `listRunEvents(runId, {afterSeq?, beforeSeq?, limit?, level?, spanId?})`, `listRunSpans(runId, companyId?)`, `getSpan`, `collectRunExport(runId)` |
  | hooks | `useAdminCompanies`, `useCreateCompany`, `useUpdateCompany`, `useDeleteCompany`, `useSeedCompanies`, `useResearchRuns`, `useResearchRun(runId)`, `useRunSpans(runId, live)`, `useSpanDetail(spanId)`, `useStartRun`, `useRunControl`, `useRaiseBudget`, and `useRunEvents(runId, {live, lastSeq})` → `{events, error, loadOlder, canLoadOlder, loadingOlder}` |
  | status | `CompanyResearchStatus`, `companyResearchStatus(company)`, `COMPANY_STATUS_META`, `RUN_STATUS_DOT`, `ITEM_STATUS_DOT`, `SPAN_STATUS_DOT`, `isRunActive(status)`, `runControls(status, pending)`, `NodeState`, `nodeStates(item)` |
  | trace-tree | `SpanNode`, `buildSpanTree(spans)`, `flattenVisible(roots, collapsed)`, `countSpans(roots)`, `deepestErrorSpan(roots, companyId)`, `nodeSpansFor(roots, companyId)` |
  | event-filters | `LEVEL_ORDER`, `LEVEL_RANK`, `EventFilters`, `DEFAULT_FILTERS`, `filterEvents`, `appendCapped(prev, next, max)`, `initialAfterSeq(lastSeq, max)`, `olderPageQuery(oldestSeq, limit)` |
  | copy-bundle | `trimMiddle`, `fence`, `logLine`, `formatSpanForClaude`, `formatFailureReport`, `formatRunSummary` |
  | deep-link | `INTELLIGENCE_TABS`, `IntelligenceTab`, `DeepLink`, `parseDeepLink(params)`, `deepLinkHref(current, patch)` |
  | time | `timeAgo(iso, now?)` |
  | clipboard | `copyText(text, what?)`, `downloadJson(filename, data)` |
  | testing | `makeCompany`, `makeRun`, `makeItem`, `makeSpan`, `makeEvent` (test builders only) |

- [ ] **Step 1: Write the constants, types, builders and the failing helper tests**

`apps/web/lib/constants/research/index.ts`:

```ts
/**
 * Company research pipeline: admin-only endpoints (interviewiq-api proxies; the browser never
 * reaches the AI service), query keys, polling cadence and console limits.
 */

export const RESEARCH_ENDPOINTS = {
  companies: "/api/v1/admin/companies",
  company: (id: string) => `/api/v1/admin/companies/${encodeURIComponent(id)}`,
  seed: "/api/v1/admin/companies/seed",
  runs: "/api/v1/admin/research/runs",
  run: (runId: string) => `/api/v1/admin/research/runs/${runId}`,
  control: (runId: string, action: "pause" | "resume" | "stop") => `/api/v1/admin/research/runs/${runId}/${action}`,
  budget: (runId: string) => `/api/v1/admin/research/runs/${runId}/budget`,
  events: (runId: string) => `/api/v1/admin/research/runs/${runId}/events`,
  spans: (runId: string) => `/api/v1/admin/research/runs/${runId}/spans`,
  span: (spanId: string) => `/api/v1/admin/research/spans/${spanId}`,
} as const;

export const RESEARCH_QUERY_KEYS = {
  companies: ["research", "companies"] as const,
  runs: ["research", "runs"] as const,
  run: (runId: string) => ["research", "run", runId] as const,
  spans: (runId: string) => ["research", "spans", runId] as const,
  span: (spanId: string) => ["research", "span", spanId] as const,
  events: (runId: string) => ["research", "events", runId] as const,
};

export const RESEARCH_POLLING = {
  /** Run detail + console tail while a run is active, and a span that is still running. */
  liveMs: 1000,
  /** The trace tree while a run is active. */
  spansMs: 2000,
  /** Company list and run history. */
  listsMs: 5000,
} as const;

/** Newest console rows kept in the DOM; older ones load on demand ("Load older"). */
export const CONSOLE_MAX_ROWS = 2000;
export const EVENTS_PAGE_LIMIT = 500;
/** "Copy for Claude" bundles are trimmed to paste cleanly into a chat. */
export const COPY_BUNDLE_MAX_CHARS = 40_000;

/** Mirror of NODE_ORDER in apps/ai-service/app/research/models.py: keep in sync. */
export const NODE_ORDER = ["resolve", "write_draft"] as const;
export type NodeName = (typeof NODE_ORDER)[number];
```

`apps/web/features/research/types.ts`:

```ts
import type { components } from "@/lib/api-client/generated/schema";

type Schemas = components["schemas"];

export type AdminCompany = Schemas["AdminCompany"];
export type AdminCompanyList = Schemas["AdminCompanyList"];
export type CompanyResearchState = Schemas["CompanyResearchState"];
export type CreateCompanyRequest = Schemas["CreateCompanyRequest"];
export type UpdateCompanyRequest = Schemas["UpdateCompanyRequest"];
export type SeedResult = Schemas["SeedResult"];
export type ResearchMode = Schemas["ResearchMode"];
export type ResearchLevel = Schemas["ResearchLevel"];
export type ResearchRunStatus = Schemas["ResearchRunStatus"];
export type ResearchItemStatus = Schemas["ResearchItemStatus"];
export type ResearchRun = Schemas["ResearchRun"];
export type ResearchRunList = Schemas["ResearchRunList"];
export type ResearchRunDetail = Schemas["ResearchRunDetail"];
export type ResearchItem = Schemas["ResearchItem"];
export type ResearchEvent = Schemas["ResearchEvent"];
export type ResearchEventPage = Schemas["ResearchEventPage"];
export type ResearchSpan = Schemas["ResearchSpan"];
export type ResearchSpanList = Schemas["ResearchSpanList"];
export type ResearchSpanDetail = Schemas["ResearchSpanDetail"];
export type ResearchSpanDetailResponse = Schemas["ResearchSpanDetailResponse"];
export type StartResearchRunRequest = Schemas["StartResearchRunRequest"];
export type ResearchBudgetUpdate = Schemas["ResearchBudgetUpdate"];
export type RunAction = "pause" | "resume" | "stop";
```

`apps/web/features/research/testing.ts`:

```ts
/** Builders for research UI tests. Not imported by app code. */
import type { AdminCompany, ResearchEvent, ResearchItem, ResearchRun, ResearchSpan } from "./types";

export const RUN_ID = "a".repeat(32);

export function makeCompany(over: Partial<AdminCompany> = {}): AdminCompany {
  return {
    id: "00000000-0000-4000-8000-000000000001", name: "Meesho", slug: "meesho", website: null, aliases: [],
    status: "active", origin: "admin", tier: null, publishedVersion: null, publishedAt: null,
    createdAt: "2026-10-01T00:00:00Z", research: null, ...over,
  };
}

export function makeRun(over: Partial<ResearchRun> = {}): ResearchRun {
  return {
    run_id: RUN_ID, trigger: "admin", mode: "live", scope: "all", company_ids: ["c-meesho"], status: "running",
    control: "none", pause_reason: null, requested_by: null,
    counters: { total: 2, queued: 1, running: 1, paused: 0, done: 0, failed: 0, skipped: 0, cancelled: 0 },
    budget: { exa_used: 3, exa_cap: 400, llm_used: 2, llm_cap: 2000, tokens_in: 1200, tokens_out: 300 },
    last_seq: 10, created_at: "2026-10-02T10:00:00+00:00", started_at: "2026-10-02T10:00:01+00:00",
    finished_at: null, error: null, pipeline_version: "research-v1", ...over,
  };
}

export function makeItem(over: Partial<ResearchItem> = {}): ResearchItem {
  return {
    run_id: RUN_ID, company_id: "c-meesho", company_name: "Meesho", company_slug: "meesho", position: 0,
    status: "running", attempts: 1, current_node: "resolve", last_node: null, nodes: { resolve: { status: "running" } },
    draft_id: null, error: null, started_at: null, finished_at: null, ...over,
  };
}

export function makeSpan(over: Partial<ResearchSpan> & { span_id: string }): ResearchSpan {
  return {
    parent_id: null, run_id: RUN_ID, company_id: null, node: null, kind: "node", name: "resolve", status: "ok",
    started_at: "2026-10-02T10:00:01+00:00", ended_at: null, duration_ms: 120, attrs: {}, input_ref: null,
    output_ref: null, error: null, ...over,
  };
}

export function makeEvent(over: Partial<ResearchEvent> = {}): ResearchEvent {
  return {
    run_id: RUN_ID, seq: 1, ts: "2026-10-02T10:00:05+00:00", level: "info", level_rank: 20, type: "log",
    message: "hello", span_id: null, company_id: null, node: null, ...over,
  };
}
```

`apps/web/features/research/status.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { companyResearchStatus, nodeStates, runControls } from "./status";
import { makeCompany, makeItem } from "./testing";
import type { CompanyResearchState } from "./types";

const state = (over: Partial<CompanyResearchState>): CompanyResearchState => ({
  lastRunId: "r1", lastResearchedAt: null, lastStatus: null, latestDraftId: null, latestDraftStatus: null, ...over,
});
const PUBLISHED = "2026-01-01T00:00:00Z";

describe("companyResearchStatus", () => {
  it.each([
    [makeCompany(), "never_researched"],
    [makeCompany({ research: state({ lastStatus: "queued" }) }), "queued"],
    [makeCompany({ research: state({ lastStatus: "running" }) }), "researching"],
    [makeCompany({ research: state({ lastStatus: "paused" }) }), "researching"],
    [makeCompany({ research: state({ lastStatus: "failed" }) }), "failed"],
    [makeCompany({ research: state({ lastStatus: "done", latestDraftStatus: "pending_review" }) }), "awaiting_review"],
    [makeCompany({ publishedAt: PUBLISHED, research: state({ lastStatus: "done", latestDraftStatus: "pending_review" }) }), "update_pending"],
    [makeCompany({ publishedAt: PUBLISHED }), "published"],
    [makeCompany({ publishedAt: PUBLISHED, research: state({ lastStatus: "skipped", latestDraftStatus: "approved" }) }), "published"],
  ] as const)("%#: %s", (company, expected) => {
    expect(companyResearchStatus(company)).toBe(expected);
  });
});

describe("runControls", () => {
  it.each([
    ["running", { start: false, pause: true, resume: false, stop: true }],
    ["queued", { start: false, pause: true, resume: false, stop: true }],
    ["pausing", { start: false, pause: false, resume: false, stop: true }],
    ["paused", { start: false, pause: false, resume: true, stop: true }],
    ["stopping", { start: false, pause: false, resume: false, stop: false }],
    ["completed", { start: true, pause: false, resume: false, stop: false }],
    [undefined, { start: true, pause: false, resume: false, stop: false }],
  ] as const)("%s", (status, expected) => {
    expect(runControls(status)).toEqual(expected);
  });

  it("disables everything while a control request is in flight", () => {
    expect(runControls("paused", true)).toEqual({ start: false, pause: false, resume: false, stop: false });
  });
});

describe("nodeStates", () => {
  it("lists every graph node in order, idle until it starts", () => {
    expect(nodeStates(makeItem({ nodes: { resolve: { status: "ok" }, write_draft: { status: "running" } } }))).toEqual([
      { name: "resolve", state: "ok" }, { name: "write_draft", state: "running" },
    ]);
    expect(nodeStates(undefined)).toEqual([{ name: "resolve", state: "idle" }, { name: "write_draft", state: "idle" }]);
  });
});
```

`apps/web/features/research/trace-tree.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildSpanTree, countSpans, deepestErrorSpan, flattenVisible, nodeSpansFor } from "./trace-tree";
import { makeSpan } from "./testing";

const t = (s: number) => `2026-10-02T10:00:${String(s).padStart(2, "0")}+00:00`;
const SPANS = [
  makeSpan({ span_id: "run", kind: "run", name: "run", started_at: t(0) }),
  makeSpan({ span_id: "co", parent_id: "run", kind: "company", name: "Meesho", company_id: "c1", started_at: t(1) }),
  makeSpan({ span_id: "draft", parent_id: "co", kind: "node", name: "write_draft", company_id: "c1", started_at: t(5) }),
  makeSpan({ span_id: "resolve", parent_id: "co", kind: "node", name: "resolve", company_id: "c1", status: "error", started_at: t(2) }),
  makeSpan({ span_id: "llm", parent_id: "resolve", kind: "llm", name: "resolve_company@v1", company_id: "c1", status: "error", started_at: t(3) }),
  makeSpan({ span_id: "orphan", parent_id: "gone", kind: "exa", name: "q", started_at: t(9) }),
];

describe("buildSpanTree", () => {
  it("nests by parent, orders children by start time, and keeps orphans as roots", () => {
    const roots = buildSpanTree(SPANS);
    expect(roots.map((r) => r.span.span_id)).toEqual(["run", "orphan"]);
    const company = roots[0]!.children[0]!;
    expect(company.children.map((c) => c.span.name)).toEqual(["resolve", "write_draft"]);
    expect(company.children[0]!.children[0]!.depth).toBe(3);
  });

  it("bubbles errors up to every ancestor", () => {
    const [run] = buildSpanTree(SPANS);
    expect(run!.hasError).toBe(true);
    expect(run!.children[0]!.hasError).toBe(true);
    expect(run!.children[0]!.children[1]!.hasError).toBe(false);
  });

  it("flattenVisible hides the children of collapsed spans", () => {
    const roots = buildSpanTree(SPANS);
    expect(flattenVisible(roots, new Set()).map((n) => n.span.span_id)).toEqual(["run", "co", "resolve", "llm", "draft", "orphan"]);
    expect(flattenVisible(roots, new Set(["co"])).map((n) => n.span.span_id)).toEqual(["run", "co", "orphan"]);
    expect(countSpans(roots)).toBe(6);
  });

  it("finds the innermost failing step and the company's node spans", () => {
    const roots = buildSpanTree(SPANS);
    expect(deepestErrorSpan(roots, "c1")?.span_id).toBe("llm");
    expect(deepestErrorSpan(roots, "nope")).toBeNull();
    expect(nodeSpansFor(roots, "c1").map((s) => s.name)).toEqual(["resolve", "write_draft"]);
  });
});
```

`apps/web/features/research/event-filters.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_FILTERS, appendCapped, filterEvents, initialAfterSeq, olderPageQuery } from "./event-filters";
import { makeEvent } from "./testing";

const EVENTS = [
  makeEvent({ seq: 1, level: "debug", level_rank: 10, type: "span.start", company_id: "c1", node: "resolve" }),
  makeEvent({ seq: 2, level: "warn", level_rank: 30, message: "Meesho is slow", company_id: "c1", node: "resolve" }),
  makeEvent({ seq: 3, level: "error", level_rank: 40, type: "span.end", company_id: "c2", node: "write_draft" }),
];

describe("filterEvents", () => {
  it("filters by minimum level, company, node, type prefix and case-insensitive text", () => {
    const seqs = (f: Partial<typeof DEFAULT_FILTERS>) => filterEvents(EVENTS, { ...DEFAULT_FILTERS, ...f }).map((e) => e.seq);
    expect(seqs({})).toEqual([1, 2, 3]);
    expect(seqs({ minLevel: "warn" })).toEqual([2, 3]);
    expect(seqs({ companyId: "c1" })).toEqual([1, 2]);
    expect(seqs({ node: "write_draft" })).toEqual([3]);
    expect(seqs({ type: "span." })).toEqual([1, 3]);
    expect(seqs({ q: "MEESHO" })).toEqual([2]);
  });
});

describe("appendCapped", () => {
  it("dedupes by seq, keeps ascending order and drops the OLDEST beyond the cap", () => {
    const merged = appendCapped([makeEvent({ seq: 1 }), makeEvent({ seq: 2 })], [makeEvent({ seq: 2 }), makeEvent({ seq: 3 })], 2);
    expect(merged.map((e) => e.seq)).toEqual([2, 3]);
  });
  it("returns the same array when there is nothing new", () => {
    const prev = [makeEvent({ seq: 1 })];
    expect(appendCapped(prev, [], 10)).toBe(prev);
  });
});

describe("paging (opening a run with more than CONSOLE_MAX_ROWS events)", () => {
  it("starts the tail at the newest rows, not the first", () => {
    expect(initialAfterSeq(5000, 2000)).toBe(3000);
    expect(initialAfterSeq(120, 2000)).toBe(0);
  });
  it("asks for the page just before the oldest loaded row, until the first event is loaded", () => {
    expect(olderPageQuery(3001, 500)).toEqual({ beforeSeq: 3001, limit: 500 });
    expect(olderPageQuery(1, 500)).toBeNull();
    expect(olderPageQuery(null, 500)).toBeNull();
  });
});
```

`apps/web/features/research/copy-bundle.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { COPY_BUNDLE_MAX_CHARS } from "@/lib/constants/research";
import { fence, formatFailureReport, formatRunSummary, formatSpanForClaude, trimMiddle } from "./copy-bundle";
import { makeEvent, makeItem, makeRun, makeSpan } from "./testing";

describe("trimMiddle", () => {
  it("keeps short text and trims the middle of long text, saying how much", () => {
    expect(trimMiddle("short", 100)).toBe("short");
    const out = trimMiddle("a".repeat(500) + "b".repeat(500), 200);
    expect(out.length).toBeLessThanOrEqual(240);
    expect(out.startsWith("a")).toBe(true);
    expect(out.endsWith("b")).toBe(true);
    expect(out).toMatch(/\[\d+ chars trimmed\]/);
  });
});

describe("fence", () => {
  it("uses a fence longer than any backtick run inside the body", () => {
    expect(fence("json", "{}")).toBe("```json\n{}\n```");
    expect(fence("text", "has ``` inside")).toBe("````text\nhas ``` inside\n````");
  });
});

describe("formatSpanForClaude", () => {
  const span = {
    ...makeSpan({
      span_id: "s".repeat(32), kind: "llm", name: "resolve_company@v1", company_id: "c-meesho", node: "resolve", status: "error",
      attrs: { model: "gemma-3-27b-it", prompt_name: "resolve_company", prompt_version: "v1" },
      error: { type: "ValidationError", message: "canonical_name missing", traceback: "Traceback…", code_ref: "app/research/nodes/resolve.py:resolve" },
    }),
    input: { system: "sys", user: "x".repeat(100_000) },
    output: { data: { is_company: true } },
  };

  it("leads with run, company, node, model, prompt and the code location, then fenced sections", () => {
    const out = formatSpanForClaude({ span, logs: [makeEvent({ seq: 7, message: "resolve meesho: 5 results" })], run: makeRun(), companyName: "Meesho" });
    expect(out).toContain("## InterviewIQ research trace — llm · resolve_company@v1 · error");
    expect(out).toContain("- company: Meesho");
    expect(out).toContain("- node: resolve");
    expect(out).toContain("- model: gemma-3-27b-it");
    expect(out).toContain("- prompt: resolve_company@v1");
    expect(out).toContain("- code: apps/ai-service/app/research/nodes/resolve.py:resolve");
    for (const section of ["### Error", "### Input", "### Output", "### Attributes", "### Logs"]) expect(out).toContain(section);
    expect(out).toContain("resolve meesho: 5 results");
    expect(out.length).toBeLessThanOrEqual(COPY_BUNDLE_MAX_CHARS + 100);
    expect(out).toMatch(/chars trimmed/);
  });
});

describe("formatFailureReport", () => {
  it("includes the node timeline, the error, previous node outputs and the failing step", () => {
    const item = makeItem({
      status: "failed", last_node: null, nodes: { resolve: { status: "error", error: "ValidationError: canonical_name" } },
      error: { type: "ValidationError", message: "canonical_name missing", traceback: "tb", code_ref: "app/research/nodes/resolve.py:resolve" },
    });
    const failing = { ...makeSpan({ span_id: "f".repeat(32), kind: "llm", name: "resolve_company@v1" }), input: { user: "u" }, output: null };
    const out = formatFailureReport({ run: makeRun(), item, failing, previousOutputs: [{ node: "resolve", output: { partial: 1 } }], logs: [] });
    expect(out).toContain("## InterviewIQ research failure — Meesho (meesho)");
    expect(out).toContain("- resolve: error — ValidationError: canonical_name");
    expect(out).toContain("- code: apps/ai-service/app/research/nodes/resolve.py:resolve");
    expect(out).toContain("### Output of resolve");
    expect(out).toContain("### Failing step: llm · resolve_company@v1");
  });
});

describe("formatRunSummary", () => {
  it("summarises the run and one line per company", () => {
    const out = formatRunSummary(makeRun({ status: "paused", pause_reason: "budget_exhausted" }), [
      makeItem({ status: "done" }),
      makeItem({ company_id: "c2", company_name: "TCS", status: "failed", error: { type: "X", message: "boom", traceback: "", code_ref: null } }),
    ]);
    expect(out).toContain("paused (budget_exhausted)");
    expect(out).toContain("- Meesho: done");
    expect(out).toContain("- TCS: failed — X: boom");
  });
});
```

`apps/web/features/research/deep-link.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { deepLinkHref, parseDeepLink } from "./deep-link";

describe("parseDeepLink", () => {
  it("defaults to companies, and a run id alone opens the runs tab", () => {
    expect(parseDeepLink(new URLSearchParams(""))).toEqual({ tab: "companies", run: null, company: null, span: null });
    expect(parseDeepLink(new URLSearchParams("run=abc&span=s1")).tab).toBe("runs");
    expect(parseDeepLink(new URLSearchParams("tab=bogus")).tab).toBe("companies");
    expect(parseDeepLink(new URLSearchParams("tab=access&run=abc")).tab).toBe("access");
  });
});

describe("deepLinkHref", () => {
  it("sets and clears keys while keeping the rest", () => {
    const current = new URLSearchParams("tab=runs&run=r1&span=s1");
    expect(deepLinkHref(current, { run: "r2", span: null, company: null })).toBe("?tab=runs&run=r2");
    expect(deepLinkHref(new URLSearchParams(""), { tab: "runs", run: "r1" })).toBe("?tab=runs&run=r1");
  });
});
```

`apps/web/features/research/time.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { timeAgo } from "./time";

const NOW = Date.parse("2026-10-02T12:00:00Z");

describe("timeAgo", () => {
  it.each([
    ["2026-10-02T11:59:40Z", "just now"],
    ["2026-10-02T11:55:00Z", "5m ago"],
    ["2026-10-02T09:00:00Z", "3h ago"],
    ["2026-09-30T12:00:00Z", "2d ago"],
    ["2026-08-01T12:00:00Z", "1 Aug 2026"],
  ])("%s → %s", (iso, expected) => {
    expect(timeAgo(iso, NOW)).toBe(expected);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @interviewiq/web exec vitest run features/research`
Expected: FAIL with "Failed to resolve import ./status" (and the same for each helper).

- [ ] **Step 3: Implement the pure helpers**

`apps/web/features/research/status.ts`:

```ts
import type { DotState } from "@/components/hud";
import { NODE_ORDER, type NodeName } from "@/lib/constants/research";
import type { AdminCompany, ResearchItem, ResearchItemStatus, ResearchRunStatus, ResearchSpan } from "./types";

export type CompanyResearchStatus =
  | "never_researched" | "queued" | "researching" | "awaiting_review" | "published" | "update_pending" | "failed";

export const COMPANY_STATUS_META: Record<CompanyResearchStatus, { label: string; dot: DotState }> = {
  never_researched: { label: "Never researched", dot: "idle" },
  queued: { label: "Queued", dot: "idle" },
  researching: { label: "Researching", dot: "live" },
  awaiting_review: { label: "Awaiting review", dot: "warn" },
  update_pending: { label: "Published · update pending review", dot: "warn" },
  published: { label: "Published", dot: "active" },
  failed: { label: "Failed", dot: "error" },
};

/** Where a company is in research, from its latest run and its latest draft (spec §9.1 Companies). */
export function companyResearchStatus(company: AdminCompany): CompanyResearchStatus {
  const research = company.research;
  const last = research?.lastStatus;
  if (last === "queued") return "queued";
  if (last === "running" || last === "paused") return "researching";
  if (last === "failed") return "failed";
  if (research?.latestDraftStatus === "pending_review") return company.publishedAt ? "update_pending" : "awaiting_review";
  if (company.publishedAt) return "published";
  return "never_researched";
}

export const RUN_STATUS_DOT: Record<ResearchRunStatus, DotState> = {
  queued: "idle", running: "live", pausing: "live", paused: "warn", stopping: "live",
  stopped: "idle", completed: "active", failed: "error",
};

export const ITEM_STATUS_DOT: Record<ResearchItemStatus, DotState> = {
  queued: "idle", running: "live", paused: "warn", done: "active", failed: "error", skipped: "idle", cancelled: "idle",
};

export const SPAN_STATUS_DOT: Record<ResearchSpan["status"], DotState> = {
  running: "live", ok: "active", error: "error", cancelled: "idle",
};

const ACTIVE: ReadonlySet<ResearchRunStatus> = new Set(["queued", "running", "pausing", "paused", "stopping"]);

export function isRunActive(status: ResearchRunStatus): boolean {
  return ACTIVE.has(status);
}

/** Which run controls apply (mirrors the ai-service's transition rules). */
export function runControls(status: ResearchRunStatus | undefined, pending = false) {
  if (pending) return { start: false, pause: false, resume: false, stop: false };
  return {
    start: !status || !isRunActive(status),
    pause: status === "queued" || status === "running",
    resume: status === "paused",
    stop: status === "queued" || status === "running" || status === "pausing" || status === "paused",
  };
}

export type NodeState = "idle" | "running" | "ok" | "error";

export function nodeStates(item: Pick<ResearchItem, "nodes"> | undefined): Array<{ name: NodeName; state: NodeState }> {
  return NODE_ORDER.map((name) => {
    const s = item?.nodes?.[name]?.status;
    return { name, state: s === "running" || s === "ok" || s === "error" ? s : "idle" };
  });
}
```

`apps/web/features/research/trace-tree.ts`:

```ts
import type { ResearchSpan } from "./types";

export interface SpanNode {
  span: ResearchSpan;
  children: SpanNode[];
  /** This span or any descendant failed: drives the error marker on collapsed parents. */
  hasError: boolean;
  depth: number;
}

const byStart = (a: SpanNode, b: SpanNode) => a.span.started_at.localeCompare(b.span.started_at);

/** Flat spans (parent_id links) → a start-ordered tree. Spans whose parent isn't loaded become roots. */
export function buildSpanTree(spans: ResearchSpan[]): SpanNode[] {
  const nodes = new Map<string, SpanNode>(spans.map((s) => [s.span_id, { span: s, children: [], hasError: false, depth: 0 }]));
  const roots: SpanNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.span.parent_id ? nodes.get(node.span.parent_id) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const visit = (node: SpanNode, depth: number): boolean => {
    node.depth = depth;
    node.children.sort(byStart);
    let failed = node.span.status === "error";
    for (const child of node.children) if (visit(child, depth + 1)) failed = true;
    node.hasError = failed;
    return failed;
  };
  roots.sort(byStart);
  for (const root of roots) visit(root, 0);
  return roots;
}

export function flattenVisible(roots: SpanNode[], collapsed: ReadonlySet<string>): SpanNode[] {
  const out: SpanNode[] = [];
  const stack = [...roots].reverse();
  while (stack.length > 0) {
    const node = stack.pop()!;
    out.push(node);
    if (!collapsed.has(node.span.span_id)) for (let i = node.children.length - 1; i >= 0; i--) stack.push(node.children[i]!);
  }
  return out;
}

export function countSpans(roots: SpanNode[]): number {
  return flattenVisible(roots, new Set()).length;
}

/** The innermost failed span for a company: the step a failure report should show first. */
export function deepestErrorSpan(roots: SpanNode[], companyId: string): ResearchSpan | null {
  let best: SpanNode | null = null;
  for (const node of flattenVisible(roots, new Set())) {
    if (node.span.status !== "error" || node.span.company_id !== companyId) continue;
    if (best === null || node.depth > best.depth || (node.depth === best.depth && node.span.started_at > best.span.started_at)) best = node;
  }
  return best ? best.span : null;
}

/** A company's node spans in start order (their outputs feed the failure report). */
export function nodeSpansFor(roots: SpanNode[], companyId: string): ResearchSpan[] {
  return flattenVisible(roots, new Set())
    .map((n) => n.span)
    .filter((s) => s.kind === "node" && s.company_id === companyId)
    .sort((a, b) => a.started_at.localeCompare(b.started_at));
}
```

`apps/web/features/research/event-filters.ts`:

```ts
import type { ResearchEvent, ResearchLevel } from "./types";

export const LEVEL_ORDER: readonly ResearchLevel[] = ["trace", "debug", "info", "warn", "error"];
export const LEVEL_RANK: Record<ResearchLevel, number> = { trace: 0, debug: 10, info: 20, warn: 30, error: 40 };

export interface EventFilters {
  minLevel: ResearchLevel;
  companyId: string | null;
  node: string | null;
  /** Event type prefix, e.g. "span." or "item.". */
  type: string;
  /** Case-insensitive substring of the message. */
  q: string;
}

export const DEFAULT_FILTERS: EventFilters = { minLevel: "trace", companyId: null, node: null, type: "", q: "" };

export function filterEvents(events: ResearchEvent[], f: EventFilters): ResearchEvent[] {
  const q = f.q.trim().toLowerCase();
  const type = f.type.trim();
  const min = LEVEL_RANK[f.minLevel];
  return events.filter(
    (e) =>
      LEVEL_RANK[e.level] >= min &&
      (!f.companyId || e.company_id === f.companyId) &&
      (!f.node || e.node === f.node) &&
      (!type || e.type.startsWith(type)) &&
      (!q || e.message.toLowerCase().includes(q)),
  );
}

/** Merge a page into the console buffer: dedupe by seq, ascending, keep only the newest `max`. */
export function appendCapped(prev: ResearchEvent[], next: ResearchEvent[], max: number): ResearchEvent[] {
  if (next.length === 0) return prev;
  const bySeq = new Map(prev.map((e) => [e.seq, e]));
  for (const e of next) bySeq.set(e.seq, e);
  const merged = [...bySeq.values()].sort((a, b) => a.seq - b.seq);
  return merged.length > max ? merged.slice(merged.length - max) : merged;
}

/** Where the live tail starts for a run opened late: only its newest `max` events. */
export function initialAfterSeq(lastSeq: number, max: number): number {
  return Math.max(0, lastSeq - max);
}

/** The page just before the oldest loaded event, or null once event #1 is loaded. */
export function olderPageQuery(oldestLoadedSeq: number | null, limit: number): { beforeSeq: number; limit: number } | null {
  if (oldestLoadedSeq === null || oldestLoadedSeq <= 1) return null;
  return { beforeSeq: oldestLoadedSeq, limit };
}
```

`apps/web/features/research/copy-bundle.ts`:

```ts
import { COPY_BUNDLE_MAX_CHARS } from "@/lib/constants/research";
import type { ResearchEvent, ResearchItem, ResearchRun, ResearchSpanDetail } from "./types";

/**
 * "Copy for Claude" bundles (spec §9.1): markdown a developer pastes into Claude Code. Context
 * first (what ran, where the code is), then fenced input / output / error / logs, each trimmed
 * so the whole bundle stays under COPY_BUNDLE_MAX_CHARS.
 */

const BUDGET = { input: 12_000, output: 12_000, error: 8_000, logs: 6_000, previous: 6_000 } as const;

export function trimMiddle(text: string, max: number): string {
  if (text.length <= max) return text;
  const keep = Math.max(0, max - 40);
  const head = Math.ceil(keep * 0.6);
  const tail = keep - head;
  return `${text.slice(0, head)}\n… [${text.length - head - tail} chars trimmed] …\n${text.slice(text.length - tail)}`;
}

export function fence(lang: string, body: string): string {
  const longestRun = Math.max(0, ...[...body.matchAll(/`+/g)].map((m) => m[0].length));
  const ticks = "`".repeat(Math.max(3, longestRun + 1));
  return `${ticks}${lang}\n${body}\n${ticks}`;
}

const json = (value: unknown) => JSON.stringify(value ?? null, null, 2);

export function logLine(e: ResearchEvent): string {
  return `${String(e.seq).padStart(6)} ${e.ts.slice(11, 19)} ${e.level.padEnd(5)} ${(e.node ?? "-").padEnd(12)} ${e.type.padEnd(16)} ${e.message}`;
}

export interface SpanBundleInput {
  span: ResearchSpanDetail;
  logs: ResearchEvent[];
  run: Pick<ResearchRun, "run_id" | "mode" | "pipeline_version"> | null;
  companyName?: string | null;
}

export function formatSpanForClaude({ span, logs, run, companyName }: SpanBundleInput): string {
  const attrs = (span.attrs ?? {}) as Record<string, unknown>;
  const header = [
    `## InterviewIQ research trace — ${span.kind} · ${span.name} · ${span.status}`,
    "",
    `- run: ${run?.run_id ?? span.run_id} (mode ${run?.mode ?? "?"}, pipeline ${run?.pipeline_version ?? "?"})`,
    `- company: ${companyName ?? span.company_id ?? "—"}`,
    `- node: ${span.node ?? "—"}`,
    `- span: ${span.span_id}${span.parent_id ? ` (parent ${span.parent_id})` : ""}`,
    `- duration: ${span.duration_ms ?? "?"} ms`,
    ...(attrs.model ? [`- model: ${String(attrs.model)}`] : []),
    ...(attrs.prompt_name ? [`- prompt: ${String(attrs.prompt_name)}@${String(attrs.prompt_version ?? "?")}`] : []),
    ...(span.error?.code_ref ? [`- code: apps/ai-service/${span.error.code_ref}`] : []),
  ];
  const parts = [header.join("\n")];
  if (span.error) {
    parts.push("### Error", fence("text", trimMiddle(`${span.error.type}: ${span.error.message}\n\n${span.error.traceback ?? ""}`, BUDGET.error)));
  }
  parts.push("### Input", fence("json", trimMiddle(json(span.input), BUDGET.input)));
  parts.push("### Output", fence("json", trimMiddle(json(span.output), BUDGET.output)));
  parts.push("### Attributes", fence("json", json(attrs)));
  if (logs.length > 0) parts.push("### Logs", fence("text", trimMiddle(logs.map(logLine).join("\n"), BUDGET.logs)));
  return trimMiddle(parts.join("\n\n"), COPY_BUNDLE_MAX_CHARS);
}

export interface FailureReportInput {
  run: ResearchRun;
  item: ResearchItem;
  failing: ResearchSpanDetail | null;
  previousOutputs: Array<{ node: string; output: unknown }>;
  logs: ResearchEvent[];
}

export function formatFailureReport({ run, item, failing, previousOutputs, logs }: FailureReportInput): string {
  const timeline = Object.entries(item.nodes ?? {}).map(([node, p]) => `- ${node}: ${p.status ?? "?"}${p.error ? ` — ${p.error}` : ""}`);
  const parts = [
    `## InterviewIQ research failure — ${item.company_name} (${item.company_slug})`,
    "",
    `- run: ${run.run_id} (mode ${run.mode}, pipeline ${run.pipeline_version ?? "?"}, trigger ${run.trigger})`,
    `- item: ${item.status} · attempts ${item.attempts} · last completed node: ${item.last_node ?? "none"}`,
    ...(item.error?.code_ref ? [`- code: apps/ai-service/${item.error.code_ref}`] : []),
    "",
    "### Node timeline",
    timeline.length > 0 ? timeline.join("\n") : "- (no node started)",
  ];
  if (item.error) {
    parts.push("", "### Error", fence("text", trimMiddle(`${item.error.type}: ${item.error.message}\n\n${item.error.traceback ?? ""}`, BUDGET.error)));
  }
  for (const prev of previousOutputs) parts.push("", `### Output of ${prev.node}`, fence("json", trimMiddle(json(prev.output), BUDGET.previous)));
  if (failing) {
    parts.push(
      "", `### Failing step: ${failing.kind} · ${failing.name}`,
      "Input:", fence("json", trimMiddle(json(failing.input), BUDGET.input)),
      "Output:", fence("json", trimMiddle(json(failing.output), 4_000)),
    );
  }
  if (logs.length > 0) parts.push("", "### Logs", fence("text", trimMiddle(logs.map(logLine).join("\n"), BUDGET.logs)));
  return trimMiddle(parts.join("\n"), COPY_BUNDLE_MAX_CHARS);
}

export function formatRunSummary(run: ResearchRun, items: ResearchItem[]): string {
  const c = run.counters;
  const b = run.budget;
  return [
    `## Research run ${run.run_id} — ${run.status}${run.pause_reason ? ` (${run.pause_reason})` : ""}`,
    "",
    `- mode ${run.mode} · trigger ${run.trigger} · scope ${run.scope} · pipeline ${run.pipeline_version ?? "?"}`,
    `- started ${run.started_at ?? "—"} · finished ${run.finished_at ?? "—"}`,
    `- budget: exa ${b.exa_used}/${b.exa_cap} · llm ${b.llm_used}/${b.llm_cap} · tokens ${b.tokens_in} in / ${b.tokens_out} out`,
    `- ${c.total} total · ${c.done} done · ${c.skipped} skipped · ${c.failed} failed · ${c.cancelled} cancelled · ${c.paused} paused · ${c.running} running · ${c.queued} queued`,
    ...(run.error ? [`- error: ${run.error}`] : []),
    "",
    ...items.map((i) => `- ${i.company_name}: ${i.status}${i.error ? ` — ${i.error.type}: ${i.error.message}` : ""}`),
  ].join("\n");
}
```

`apps/web/features/research/deep-link.ts`:

```ts
/** The Intelligence page's URL state: ?tab=&run=&company=&span= (spec §9.1 deep links). */

export const INTELLIGENCE_TABS = ["companies", "runs", "briefs", "access", "questions", "resume", "prep", "agent"] as const;
export type IntelligenceTab = (typeof INTELLIGENCE_TABS)[number];

export interface DeepLink {
  tab: IntelligenceTab;
  run: string | null;
  company: string | null;
  span: string | null;
}

interface ParamsLike {
  get(name: string): string | null;
}

export function parseDeepLink(params: ParamsLike): DeepLink {
  const raw = params.get("tab");
  const run = params.get("run") || null;
  const tab = (INTELLIGENCE_TABS as readonly string[]).includes(raw ?? "") ? (raw as IntelligenceTab) : run ? "runs" : "companies";
  return { tab, run, company: params.get("company") || null, span: params.get("span") || null };
}

export function deepLinkHref(current: URLSearchParams, patch: Partial<DeepLink>): string {
  const next = new URLSearchParams(current);
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === undefined || value === "") next.delete(key);
    else next.set(key, value);
  }
  const qs = next.toString();
  return qs ? `?${qs}` : "?";
}
```

`apps/web/features/research/time.ts`:

```ts
/** "5m ago" for recent instants, a short date for anything older than a week. */
export function timeAgo(iso: string, now: number = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "—";
  const s = Math.max(0, Math.round((now - then) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 7 * 86_400) return `${Math.floor(s / 86_400)}d ago`;
  return new Date(then).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}
```

`apps/web/features/research/clipboard.ts`:

```ts
import { toast } from "sonner";

export async function copyText(text: string, what = "Copied"): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${what} · ${text.length.toLocaleString()} chars`);
    return true;
  } catch {
    toast.error("Could not copy: the browser blocked clipboard access");
    return false;
  }
}

export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
```

- [ ] **Step 4: Run the helper tests**

Run: `pnpm --filter @interviewiq/web exec vitest run features/research`
Expected: PASS.

- [ ] **Step 5: Implement the API, hooks and barrel**

`apps/web/features/research/api.ts`:

```ts
import { apiFetch } from "@/lib/api-client/client";
import { EVENTS_PAGE_LIMIT, RESEARCH_ENDPOINTS as E } from "@/lib/constants/research";
import type {
  AdminCompany, AdminCompanyList, CreateCompanyRequest, ResearchBudgetUpdate, ResearchEvent, ResearchEventPage,
  ResearchLevel, ResearchRun, ResearchRunDetail, ResearchRunList, ResearchSpanDetailResponse, ResearchSpanList,
  RunAction, SeedResult, StartResearchRunRequest, UpdateCompanyRequest,
} from "./types";

export function listAdminCompanies(): Promise<AdminCompanyList> {
  return apiFetch<AdminCompanyList>(E.companies);
}

export function createCompany(body: CreateCompanyRequest): Promise<AdminCompany> {
  return apiFetch<AdminCompany>(E.companies, { method: "POST", json: body });
}

export function updateCompany(id: string, patch: UpdateCompanyRequest): Promise<AdminCompany> {
  return apiFetch<AdminCompany>(E.company(id), { method: "PATCH", json: patch });
}

export function deleteCompany(id: string): Promise<void> {
  return apiFetch<void>(E.company(id), { method: "DELETE" });
}

export function seedCompanies(): Promise<SeedResult> {
  return apiFetch<SeedResult>(E.seed, { method: "POST" });
}

export function listRuns(limit = 20): Promise<ResearchRunList> {
  return apiFetch<ResearchRunList>(`${E.runs}?limit=${limit}`);
}

export function getRun(runId: string): Promise<ResearchRunDetail> {
  return apiFetch<ResearchRunDetail>(E.run(runId));
}

export function startRun(body: StartResearchRunRequest): Promise<ResearchRun> {
  return apiFetch<ResearchRun>(E.runs, { method: "POST", json: body });
}

export function controlRun(runId: string, action: RunAction): Promise<ResearchRun> {
  return apiFetch<ResearchRun>(E.control(runId, action), { method: "POST" });
}

export function raiseBudget(runId: string, body: ResearchBudgetUpdate): Promise<ResearchRun> {
  return apiFetch<ResearchRun>(E.budget(runId), { method: "PATCH", json: body });
}

export interface EventPageParams {
  afterSeq?: number;
  beforeSeq?: number;
  limit?: number;
  level?: ResearchLevel;
  spanId?: string;
}

export function listRunEvents(runId: string, params: EventPageParams = {}): Promise<ResearchEventPage> {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== null) qs.set(key, String(value));
  const s = qs.toString();
  return apiFetch<ResearchEventPage>(`${E.events(runId)}${s ? `?${s}` : ""}`);
}

export function listRunSpans(runId: string, companyId?: string | null): Promise<ResearchSpanList> {
  return apiFetch<ResearchSpanList>(`${E.spans(runId)}${companyId ? `?companyId=${encodeURIComponent(companyId)}` : ""}`);
}

export function getSpan(spanId: string): Promise<ResearchSpanDetailResponse> {
  return apiFetch<ResearchSpanDetailResponse>(E.span(spanId));
}

/** Everything needed to look at a run offline: the run, its items, every span and every event. */
export async function collectRunExport(runId: string) {
  const [detail, spans] = await Promise.all([getRun(runId), listRunSpans(runId)]);
  const events: ResearchEvent[] = [];
  let afterSeq = 0;
  for (;;) {
    const page = await listRunEvents(runId, { afterSeq, limit: EVENTS_PAGE_LIMIT });
    events.push(...page.events);
    if (page.events.length < EVENTS_PAGE_LIMIT) break;
    afterSeq = page.events[page.events.length - 1]!.seq;
  }
  return { exported_at: new Date().toISOString(), ...detail, spans: spans.spans, events };
}
```

`apps/web/features/research/hooks.ts`:

```ts
"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CONSOLE_MAX_ROWS, EVENTS_PAGE_LIMIT, RESEARCH_POLLING, RESEARCH_QUERY_KEYS as K } from "@/lib/constants/research";
import {
  controlRun, createCompany, deleteCompany, getRun, getSpan, listAdminCompanies, listRunEvents, listRunSpans,
  listRuns, raiseBudget, seedCompanies, startRun, updateCompany,
} from "./api";
import { appendCapped, initialAfterSeq, olderPageQuery } from "./event-filters";
import { isRunActive } from "./status";
import type { ResearchEvent, RunAction, UpdateCompanyRequest } from "./types";

export function useAdminCompanies() {
  return useQuery({ queryKey: K.companies, queryFn: listAdminCompanies, refetchInterval: RESEARCH_POLLING.listsMs });
}

export function useCreateCompany() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: createCompany, onSuccess: () => qc.invalidateQueries({ queryKey: K.companies }) });
}

export function useUpdateCompany() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateCompanyRequest }) => updateCompany(id, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: K.companies }),
  });
}

export function useDeleteCompany() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => deleteCompany(id), onSuccess: () => qc.invalidateQueries({ queryKey: K.companies }) });
}

export function useSeedCompanies() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: () => seedCompanies(), onSuccess: () => qc.invalidateQueries({ queryKey: K.companies }) });
}

export function useResearchRuns() {
  return useQuery({ queryKey: K.runs, queryFn: () => listRuns(20), refetchInterval: RESEARCH_POLLING.listsMs });
}

export function useResearchRun(runId: string | null) {
  return useQuery({
    queryKey: K.run(runId ?? "none"),
    queryFn: () => getRun(runId!),
    enabled: !!runId,
    refetchInterval: (q) => (q.state.data && isRunActive(q.state.data.run.status) ? RESEARCH_POLLING.liveMs : false),
  });
}

export function useRunSpans(runId: string | null, live: boolean) {
  return useQuery({
    queryKey: K.spans(runId ?? "none"),
    queryFn: () => listRunSpans(runId!),
    enabled: !!runId,
    refetchInterval: live ? RESEARCH_POLLING.spansMs : false,
  });
}

export function useSpanDetail(spanId: string | null) {
  return useQuery({
    queryKey: K.span(spanId ?? "none"),
    queryFn: () => getSpan(spanId!),
    enabled: !!spanId,
    refetchInterval: (q) => (q.state.data?.span.status === "running" ? RESEARCH_POLLING.liveMs : false),
  });
}

export function useStartRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: startRun,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: K.runs });
      qc.invalidateQueries({ queryKey: K.companies });
    },
  });
}

export function useRunControl() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ runId, action }: { runId: string; action: RunAction }) => controlRun(runId, action),
    onSuccess: (_run, { runId }) => {
      qc.invalidateQueries({ queryKey: K.run(runId) });
      qc.invalidateQueries({ queryKey: K.runs });
    },
  });
}

export function useRaiseBudget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ runId, exaCap, llmCap }: { runId: string; exaCap?: number; llmCap?: number }) => raiseBudget(runId, { exaCap, llmCap }),
    onSuccess: (_run, { runId }) => qc.invalidateQueries({ queryKey: K.run(runId) }),
  });
}

/**
 * The console's event buffer. Opens at the run's newest CONSOLE_MAX_ROWS events, then tails by seq
 * while the run is live. "Load older" fetches the page before the oldest row; after that the buffer
 * stops trimming so the older rows stay put.
 */
export function useRunEvents(runId: string | null, opts: { live: boolean; lastSeq: number | undefined }) {
  const [events, setEvents] = React.useState<ResearchEvent[]>([]);
  const [loadingOlder, setLoadingOlder] = React.useState(false);
  const cursor = React.useRef<number | null>(null);
  const keepAll = React.useRef(false);

  React.useEffect(() => {
    setEvents([]);
    cursor.current = null;
    keepAll.current = false;
  }, [runId]);

  const query = useQuery({
    queryKey: K.events(runId ?? "none"),
    enabled: !!runId && opts.lastSeq !== undefined,
    refetchInterval: opts.live ? RESEARCH_POLLING.liveMs : false,
    queryFn: async () => {
      if (cursor.current === null) cursor.current = initialAfterSeq(opts.lastSeq ?? 0, CONSOLE_MAX_ROWS);
      for (;;) {
        const page = await listRunEvents(runId!, { afterSeq: cursor.current, limit: EVENTS_PAGE_LIMIT });
        if (page.events.length > 0) {
          cursor.current = page.events[page.events.length - 1]!.seq;
          const batch = page.events;
          setEvents((prev) => appendCapped(prev, batch, keepAll.current ? Number.POSITIVE_INFINITY : CONSOLE_MAX_ROWS));
        }
        if (page.events.length < EVENTS_PAGE_LIMIT) return page.last_seq;
      }
    },
  });

  const oldest = events[0]?.seq ?? null;
  const loadOlder = React.useCallback(async () => {
    const q = olderPageQuery(oldest, EVENTS_PAGE_LIMIT);
    if (!q || !runId) return;
    setLoadingOlder(true);
    try {
      const page = await listRunEvents(runId, q);
      keepAll.current = true;
      setEvents((prev) => appendCapped(prev, page.events, Number.POSITIVE_INFINITY));
    } finally {
      setLoadingOlder(false);
    }
  }, [oldest, runId]);

  return { events, error: query.error, loadOlder, canLoadOlder: olderPageQuery(oldest, EVENTS_PAGE_LIMIT) !== null, loadingOlder };
}
```

`apps/web/features/research/index.ts`:

```ts
export * from "./types";
export * from "./api";
export * from "./hooks";
export * from "./status";
export * from "./trace-tree";
export * from "./event-filters";
export * from "./copy-bundle";
export * from "./deep-link";
export * from "./time";
export * from "./clipboard";
```

- [ ] **Step 6: Typecheck and run the web tests**

Run: `pnpm --filter @interviewiq/web typecheck && pnpm --filter @interviewiq/web exec vitest run features/research`
Expected: PASS.

- [ ] **Step 7: Checkpoint**

Run `git status`; leave the changes uncommitted.

---

## Task 15: Companies tab

**Files:**
- Create: `apps/web/app/(app)/intelligence/_components/research/AddCompanyForm.tsx`, `apps/web/app/(app)/intelligence/_components/research/CompaniesTab.tsx`
- Test: `apps/web/app/(app)/intelligence/_components/research/CompaniesTab.test.tsx`

**Interfaces:**
- Consumes: `@/features/research` (Task 14).
- Produces:
  - `CompaniesTab` (no props).
  - `AddCompanyForm` (no props) and `parseAliasInput(raw) -> string[]`.
  - "Research now" starts `{scope: "selected", companyIds: [id]}`, then navigates to `?tab=runs&run=<id>`.

- [ ] **Step 1: Write the failing test**

`apps/web/app/(app)/intelligence/_components/research/CompaniesTab.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { makeCompany } from "@/features/research/testing";

const h = vi.hoisted(() => ({
  companies: { data: undefined as unknown, isLoading: false },
  runs: { data: { runs: [] as unknown[] } },
  startMutateAsync: vi.fn(),
  push: vi.fn(),
  deleteMutate: vi.fn(),
  updateMutate: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: h.push, replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams("tab=companies"),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/api-client/client", () => {
  class ApiFetchError extends Error {
    constructor(readonly status: number, readonly code: string | undefined, message: string) {
      super(message);
    }
  }
  return { ApiFetchError, apiFetch: vi.fn() };
});
vi.mock("@/features/research", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/research")>()),
  useAdminCompanies: () => h.companies,
  useResearchRuns: () => h.runs,
  useStartRun: () => ({ mutateAsync: h.startMutateAsync, isPending: false }),
  useSeedCompanies: () => ({ mutate: vi.fn(), isPending: false }),
  useCreateCompany: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateCompany: () => ({ mutate: h.updateMutate, isPending: false }),
  useDeleteCompany: () => ({ mutate: h.deleteMutate, isPending: false }),
}));

import { ApiFetchError } from "@/lib/api-client/client";
import { parseAliasInput } from "./AddCompanyForm";
import { CompaniesTab } from "./CompaniesTab";

const research = (over: object) => ({ lastRunId: "r".repeat(32), lastResearchedAt: null, lastStatus: null, latestDraftId: null, latestDraftStatus: null, ...over });
const MEESHO = makeCompany({ id: "00000000-0000-4000-8000-00000000000a", name: "Meesho", slug: "meesho", research: research({ lastStatus: "done", latestDraftStatus: "pending_review" }) });
const RAZORPAY = makeCompany({ id: "00000000-0000-4000-8000-00000000000b", name: "Razorpay", slug: "razorpay" });
const TCS = makeCompany({ id: "00000000-0000-4000-8000-00000000000c", name: "TCS", slug: "tcs", publishedAt: "2026-01-01T00:00:00Z", research: research({ lastStatus: "running" }) });

function row(name: string) {
  return screen.getByText(name).closest("tr")!;
}

describe("CompaniesTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.companies = { data: { companies: [MEESHO, RAZORPAY, TCS], researchAvailable: true }, isLoading: false };
    h.runs = { data: { runs: [] } };
  });

  it("shows each company's research status in words", () => {
    render(<CompaniesTab />);
    expect(within(row("Meesho")).getByText("Awaiting review")).toBeInTheDocument();
    expect(within(row("Razorpay")).getByText("Never researched")).toBeInTheDocument();
    expect(within(row("TCS")).getByText("Researching")).toBeInTheDocument();
  });

  it("Research now starts a selected run and opens it on the Runs tab", async () => {
    h.startMutateAsync.mockResolvedValue({ run_id: "f".repeat(32) });
    render(<CompaniesTab />);
    await userEvent.click(within(row("Razorpay")).getByRole("button", { name: "Research now" }));
    expect(h.startMutateAsync).toHaveBeenCalledWith({ scope: "selected", companyIds: [RAZORPAY.id] });
    expect(h.push).toHaveBeenCalledWith(`?tab=runs&run=${"f".repeat(32)}`);
  });

  it("explains a 409 run_active instead of failing silently", async () => {
    h.startMutateAsync.mockRejectedValue(new ApiFetchError(409, "run_active", "run x is still active"));
    render(<CompaniesTab />);
    await userEvent.click(within(row("Meesho")).getByRole("button", { name: "Research now" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("already active");
  });

  it("Research selected sends every ticked company", async () => {
    h.startMutateAsync.mockResolvedValue({ run_id: "e".repeat(32) });
    render(<CompaniesTab />);
    await userEvent.click(screen.getByRole("checkbox", { name: "Select Meesho" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Select Razorpay" }));
    await userEvent.click(screen.getByRole("button", { name: "Research selected (2)" }));
    expect(h.startMutateAsync).toHaveBeenCalledWith({ scope: "selected", companyIds: [MEESHO.id, RAZORPAY.id] });
  });

  it("delete needs a confirming second click", async () => {
    render(<CompaniesTab />);
    await userEvent.click(within(row("Razorpay")).getByRole("button", { name: "Delete" }));
    expect(h.deleteMutate).not.toHaveBeenCalled();
    await userEvent.click(within(row("Razorpay")).getByRole("button", { name: "Confirm delete" }));
    expect(h.deleteMutate).toHaveBeenCalledWith(RAZORPAY.id, expect.any(Object));
  });

  it("says when research status is unavailable", () => {
    h.companies = { data: { companies: [RAZORPAY], researchAvailable: false }, isLoading: false };
    render(<CompaniesTab />);
    expect(screen.getByText(/research status is unavailable/i)).toBeInTheDocument();
  });
});

describe("parseAliasInput", () => {
  it("splits on commas and drops blanks", () => {
    expect(parseAliasInput(" TCS, Tata CS ,, ")).toEqual(["TCS", "Tata CS"]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @interviewiq/web exec vitest run "app/(app)/intelligence/_components/research/CompaniesTab.test.tsx"`
Expected: FAIL. `./CompaniesTab` cannot be resolved.

- [ ] **Step 3: Implement**

`apps/web/app/(app)/intelligence/_components/research/AddCompanyForm.tsx`:

```tsx
"use client";

import * as React from "react";
import { toast } from "sonner";
import { HudCard } from "@/components/hud";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiFetchError } from "@/lib/api-client/client";
import { useCreateCompany } from "@/features/research";

/** "TCS, Tata CS" → ["TCS", "Tata CS"]. The API trims, dedupes and validates. */
export function parseAliasInput(raw: string): string[] {
  return raw.split(",").map((a) => a.trim()).filter(Boolean);
}

/** Add a company to the curated research list. The next run (or "Research now") picks it up. */
export function AddCompanyForm() {
  const create = useCreateCompany();
  const [name, setName] = React.useState("");
  const [website, setWebsite] = React.useState("");
  const [aliases, setAliases] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const company = await create.mutateAsync({ name, website: website.trim() || null, aliases: parseAliasInput(aliases) });
      toast.success(`${company.name} added · the next research run picks it up`);
      setName("");
      setWebsite("");
      setAliases("");
    } catch (err) {
      setError(err instanceof ApiFetchError ? err.message : "Could not add the company.");
    }
  }

  return (
    <HudCard title="Add a company" spotlight={false}>
      <form
        onSubmit={onSubmit}
        aria-label="Add a company"
        className="grid gap-3 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end"
      >
        <div className="grid gap-1.5">
          <Label htmlFor="company-name">Name</Label>
          <Input id="company-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Meesho" required maxLength={255} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="company-website">Website (optional)</Label>
          <Input id="company-website" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="meesho.com" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="company-aliases">Aliases (optional, comma-separated)</Label>
          <Input id="company-aliases" value={aliases} onChange={(e) => setAliases(e.target.value)} placeholder="Fashnear Technologies" />
        </div>
        <Button type="submit" disabled={create.isPending || !name.trim()}>
          {create.isPending ? "Adding…" : "Add company"}
        </Button>
      </form>
      {error ? <p role="alert" className="m-0 mt-3 text-[13px] text-destructive">{error}</p> : null}
    </HudCard>
  );
}
```

`apps/web/app/(app)/intelligence/_components/research/CompaniesTab.tsx`:

```tsx
"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { StatusDot, padCount } from "@/components/hud";
import { CardEmpty, ConsoleCard, HeaderCount } from "@/components/observability/ConsoleCard";
import { HairlineHead, HairlineTable, Td, Th, Tr } from "@/components/observability/HairlineTable";
import { Button } from "@/components/ui/button";
import { ApiFetchError } from "@/lib/api-client/client";
import {
  COMPANY_STATUS_META,
  companyResearchStatus,
  deepLinkHref,
  isRunActive,
  timeAgo,
  useAdminCompanies,
  useDeleteCompany,
  useResearchRuns,
  useSeedCompanies,
  useStartRun,
  useUpdateCompany,
  type AdminCompany,
} from "@/features/research";
import { AddCompanyForm } from "./AddCompanyForm";

function errorMessage(err: unknown): string {
  return err instanceof ApiFetchError ? err.message : "Something went wrong. Check the API logs.";
}

/** Intelligence → Companies: the curated list the research job works through (spec §9.1). */
export function CompaniesTab() {
  const companies = useAdminCompanies();
  const runs = useResearchRuns();
  const start = useStartRun();
  const seed = useSeedCompanies();
  const router = useRouter();
  const params = useSearchParams();
  const [selected, setSelected] = React.useState<ReadonlySet<string>>(new Set());
  const [notice, setNotice] = React.useState<string | null>(null);

  const rows = companies.data?.companies ?? [];
  const activeRun = runs.data?.runs.find((r) => isRunActive(r.status)) ?? null;

  const openRun = (runId: string) =>
    router.push(deepLinkHref(new URLSearchParams(params.toString()), { tab: "runs", run: runId, company: null, span: null }));

  async function research(ids: string[]) {
    setNotice(null);
    try {
      const run = await start.mutateAsync({ scope: "selected", companyIds: ids });
      setSelected(new Set());
      openRun(run.run_id);
    } catch (err) {
      setNotice(
        err instanceof ApiFetchError && err.code === "run_active"
          ? "A research run is already active. Resume or stop it before starting another."
          : errorMessage(err),
      );
    }
  }

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="flex flex-col gap-5">
      <AddCompanyForm />
      <ConsoleCard title="Companies" meta={<HeaderCount>{padCount(rows.length)}</HeaderCount>}>
        <div className="flex flex-wrap items-center gap-2 pb-3">
          <Button size="sm" disabled={selected.size === 0 || start.isPending} onClick={() => research([...selected])}>
            Research selected{selected.size > 0 ? ` (${selected.size})` : ""}
          </Button>
          <Button
            size="sm"
            variant="strong"
            disabled={seed.isPending}
            onClick={() =>
              seed.mutate(undefined, {
                onSuccess: (r) => toast.success(`Starter catalogue loaded · ${r.companies} new`),
                onError: (e) => toast.error(errorMessage(e)),
              })
            }
          >
            Load starter companies
          </Button>
          {activeRun ? (
            <button
              type="button"
              onClick={() => openRun(activeRun.run_id)}
              className="ml-auto text-[13px] text-muted-foreground underline-offset-4 hover:underline"
            >
              Active run · {activeRun.status} · open
            </button>
          ) : null}
        </div>
        {notice ? (
          <p role="alert" className="m-0 mb-3 text-[13px] text-destructive">
            {notice}
            {activeRun ? (
              <>
                {" "}
                <button type="button" className="underline" onClick={() => openRun(activeRun.run_id)}>
                  Open the active run
                </button>
              </>
            ) : null}
          </p>
        ) : null}
        {companies.data && !companies.data.researchAvailable ? (
          <p className="m-0 mb-3 text-[13px] text-muted-foreground">Research status is unavailable: the AI service is not reachable.</p>
        ) : null}
        {companies.isLoading ? (
          <p className="m-0 text-[13px] text-muted-foreground">Loading companies…</p>
        ) : rows.length === 0 ? (
          <CardEmpty title="No companies yet" hint="Add one above, or load the starter catalogue." />
        ) : (
          <HairlineTable label="Companies" className="min-w-[760px]">
            <HairlineHead>
              <Th className="w-8"><span className="sr-only">Select</span></Th>
              <Th>Company</Th>
              <Th>Research</Th>
              <Th>Last researched</Th>
              <Th>Published</Th>
              <Th><span className="sr-only">Actions</span></Th>
            </HairlineHead>
            <tbody>
              {rows.map((c) => (
                <CompanyRow
                  key={c.id}
                  company={c}
                  checked={selected.has(c.id)}
                  onToggle={() => toggle(c.id)}
                  onResearch={() => research([c.id])}
                  onOpenRun={openRun}
                  busy={start.isPending}
                />
              ))}
            </tbody>
          </HairlineTable>
        )}
      </ConsoleCard>
    </div>
  );
}

function CompanyRow({
  company,
  checked,
  onToggle,
  onResearch,
  onOpenRun,
  busy,
}: {
  company: AdminCompany;
  checked: boolean;
  onToggle: () => void;
  onResearch: () => void;
  onOpenRun: (runId: string) => void;
  busy: boolean;
}) {
  const update = useUpdateCompany();
  const del = useDeleteCompany();
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const status = COMPANY_STATUS_META[companyResearchStatus(company)];
  const archived = company.status === "archived";
  const lastRunId = company.research?.lastRunId ?? null;

  return (
    <Tr className={archived ? "opacity-60" : undefined}>
      <Td>
        <input type="checkbox" aria-label={`Select ${company.name}`} checked={checked} onChange={onToggle} disabled={archived} />
      </Td>
      <Td>
        <div className="flex flex-col">
          <span>{company.name}</span>
          <span className="font-mono text-[11px] text-faint">
            {company.slug}
            {archived ? " · archived" : ""}
          </span>
        </div>
      </Td>
      <Td><StatusDot state={status.dot} label={status.label} /></Td>
      <Td className="whitespace-nowrap text-[13px] text-muted-foreground">
        {company.research?.lastResearchedAt ? timeAgo(company.research.lastResearchedAt) : "—"}
      </Td>
      <Td className="font-mono text-[12px] text-muted-foreground">
        {company.publishedVersion ? `v${company.publishedVersion}` : company.publishedAt ? "seed" : "—"}
      </Td>
      <Td>
        <div className="flex flex-wrap justify-end gap-1.5">
          <Button size="sm" variant="strong" disabled={busy || archived} onClick={onResearch}>Research now</Button>
          {lastRunId ? <Button size="sm" variant="ghost" onClick={() => onOpenRun(lastRunId)}>Last run</Button> : null}
          <Button
            size="sm"
            variant="ghost"
            disabled={update.isPending}
            onClick={() =>
              update.mutate(
                { id: company.id, patch: { status: archived ? "active" : "archived" } },
                { onError: (e) => toast.error(errorMessage(e)) },
              )
            }
          >
            {archived ? "Restore" : "Archive"}
          </Button>
          {confirmDelete ? (
            <>
              <Button
                size="sm"
                variant="destructive"
                disabled={del.isPending}
                onClick={() =>
                  del.mutate(company.id, { onError: (e) => toast.error(errorMessage(e)), onSettled: () => setConfirmDelete(false) })
                }
              >
                Confirm delete
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>Cancel</Button>
            </>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(true)}>Delete</Button>
          )}
        </div>
      </Td>
    </Tr>
  );
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @interviewiq/web exec vitest run "app/(app)/intelligence/_components/research"`
Expected: PASS.

- [ ] **Step 5: Checkpoint**

Run `git status`; leave the changes uncommitted.

---

## Task 16: Runs debugger and page wiring

**Files:**
- Create in `apps/web/app/(app)/intelligence/_components/research/`: `RunsTab.tsx`, `RunControlBar.tsx`, `BudgetMeters.tsx`, `TraceTree.tsx`, `GraphMiniMap.tsx`, `GraphMiniMapInner.tsx`, `SpanDetail.tsx`, `PayloadViewer.tsx`, `LiveConsole.tsx`
- Modify: `apps/web/app/(app)/intelligence/page.tsx`, `apps/web/features/intelligence/{api,hooks,index,types}.ts`, `apps/web/lib/constants/intelligence/index.ts`
- Delete: `apps/web/app/(app)/intelligence/_components/CompaniesPanel.tsx`, `apps/web/app/(app)/intelligence/_components/RemoveCompanyButton.tsx`
- Test, in the same folder: `RunControlBar.test.tsx`, `TraceTree.test.tsx`, `LiveConsole.test.tsx`, `SpanDetail.test.tsx`

**Interfaces:**
- Consumes: `@/features/research` (Task 14).
- Produces:
  - `RunsTab` (no props).
  - `RunControlBar({runs, run, items, onSelectRun})`.
  - `BudgetMeters({run})`.
  - `TraceTree({roots, items, selectedSpanId, onSelectSpan, onCopyFailure})`.
  - `GraphMiniMap({item})`.
  - `SpanDetail({spanId, run, companyName})`.
  - `PayloadViewer({value, language?, height?})`.
  - `LiveConsole({events, items, live, onSelectSpan, canLoadOlder, onLoadOlder, loadingOlder})`.
  - The page is URL-driven: `?tab=&run=&company=&span=`.

- [ ] **Step 1: Write the failing component tests**

`RunControlBar.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { makeItem, makeRun } from "@/features/research/testing";

const h = vi.hoisted(() => ({ controlMutate: vi.fn(), startMutate: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/api-client/client", () => ({ ApiFetchError: class extends Error {}, apiFetch: vi.fn() }));
vi.mock("@/features/research", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/research")>()),
  useRunControl: () => ({ mutate: h.controlMutate, isPending: false }),
  useStartRun: () => ({ mutate: h.startMutate, isPending: false }),
  useAdminCompanies: () => ({ data: { companies: [], researchAvailable: true } }),
}));

import { RunControlBar } from "./RunControlBar";

const enabled = (name: string) => !(screen.getByRole("button", { name }) as HTMLButtonElement).disabled;

describe("RunControlBar", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ["running", { "Start all": false, Pause: true, Resume: false, Stop: true }],
    ["paused", { "Start all": false, Pause: false, Resume: true, Stop: true }],
    ["completed", { "Start all": true, Pause: false, Resume: false, Stop: false }],
  ] as const)("%s run enables exactly the controls that apply", (status, expected) => {
    const run = makeRun({ status });
    render(<RunControlBar runs={[run]} run={run} items={[makeItem()]} onSelectRun={vi.fn()} />);
    for (const [name, on] of Object.entries(expected)) expect(enabled(name)).toBe(on);
  });

  it("pause sends the control for this run", async () => {
    const run = makeRun({ status: "running" });
    render(<RunControlBar runs={[run]} run={run} items={[]} onSelectRun={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(h.controlMutate).toHaveBeenCalledWith({ runId: run.run_id, action: "pause" }, expect.any(Object));
  });

  it("says why a run paused itself", () => {
    const run = makeRun({ status: "paused", pause_reason: "budget_exhausted" });
    render(<RunControlBar runs={[run]} run={run} items={[]} onSelectRun={vi.fn()} />);
    expect(screen.getByText(/budget cap reached/i)).toBeInTheDocument();
  });

  it("Start all uses the chosen mode", async () => {
    render(<RunControlBar runs={[]} run={undefined} items={[]} onSelectRun={vi.fn()} />);
    await userEvent.selectOptions(screen.getByLabelText("Mode"), "replay");
    await userEvent.click(screen.getByRole("button", { name: "Start all" }));
    expect(h.startMutate).toHaveBeenCalledWith({ scope: "all", mode: "replay" }, expect.any(Object));
  });
});
```

`TraceTree.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { buildSpanTree } from "@/features/research";
import { makeItem, makeSpan } from "@/features/research/testing";

vi.mock("./GraphMiniMap", () => ({ GraphMiniMap: ({ item }: { item: { company_id: string } }) => <div data-testid="minimap">{item.company_id}</div> }));

import { TraceTree } from "./TraceTree";

const t = (s: number) => `2026-10-02T10:00:0${s}+00:00`;
const SPANS = [
  makeSpan({ span_id: "run", kind: "run", name: "run", started_at: t(0) }),
  makeSpan({ span_id: "co", parent_id: "run", kind: "company", name: "Meesho", company_id: "c-meesho", status: "ok", started_at: t(1) }),
  makeSpan({ span_id: "res", parent_id: "co", kind: "node", name: "resolve", company_id: "c-meesho", status: "error", started_at: t(2) }),
];

describe("TraceTree", () => {
  it("shows nested steps with a minimap per company, and selects on click", async () => {
    const onSelect = vi.fn();
    render(<TraceTree roots={buildSpanTree(SPANS)} items={[makeItem()]} selectedSpanId={null} onSelectSpan={onSelect} onCopyFailure={vi.fn()} />);
    expect(screen.getByTestId("minimap")).toHaveTextContent("c-meesho");
    await userEvent.click(screen.getByRole("button", { name: /resolve/ }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ span_id: "res" }));
  });

  it("marks a collapsed company whose steps failed", async () => {
    render(<TraceTree roots={buildSpanTree(SPANS)} items={[makeItem()]} selectedSpanId={null} onSelectSpan={vi.fn()} onCopyFailure={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Collapse Meesho" }));
    expect(screen.queryByRole("button", { name: /resolve/ })).not.toBeInTheDocument();
    expect(screen.getAllByLabelText("a step inside failed").length).toBeGreaterThan(0);
  });

  it("offers a failure report for a failed company", async () => {
    const onCopyFailure = vi.fn();
    const failed = makeItem({ status: "failed" });
    render(<TraceTree roots={buildSpanTree(SPANS)} items={[failed]} selectedSpanId={null} onSelectSpan={vi.fn()} onCopyFailure={onCopyFailure} />);
    await userEvent.click(screen.getByRole("button", { name: "Copy failure report for Meesho" }));
    expect(onCopyFailure).toHaveBeenCalledWith(failed);
  });
});
```

`LiveConsole.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { makeEvent, makeItem } from "@/features/research/testing";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/api-client/client", () => ({ ApiFetchError: class extends Error {}, apiFetch: vi.fn() }));

import { LiveConsole } from "./LiveConsole";

const EVENTS = [
  makeEvent({ seq: 1, level: "debug", level_rank: 10, type: "span.start", message: "node · resolve", span_id: "s1", company_id: "c-meesho", node: "resolve" }),
  makeEvent({ seq: 2, level: "warn", level_rank: 30, message: "Meesho evidence dropped", company_id: "c-meesho", node: "resolve" }),
];

function renderConsole(onSelectSpan = vi.fn()) {
  render(<LiveConsole events={EVENTS} items={[makeItem()]} live onSelectSpan={onSelectSpan} canLoadOlder={false} onLoadOlder={vi.fn()} loadingOlder={false} />);
  return onSelectSpan;
}

describe("LiveConsole", () => {
  it("filters by minimum level and by text", async () => {
    renderConsole();
    expect(screen.getByText("node · resolve")).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Minimum level"), "warn");
    expect(screen.queryByText("node · resolve")).not.toBeInTheDocument();
    expect(screen.getByText("Meesho evidence dropped")).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Minimum level"), "trace");
    await userEvent.type(screen.getByLabelText("Search messages"), "evidence");
    expect(screen.queryByText("node · resolve")).not.toBeInTheDocument();
  });

  it("clicking a line that belongs to a step selects that step", async () => {
    const onSelectSpan = renderConsole();
    await userEvent.click(screen.getByText("node · resolve"));
    expect(onSelectSpan).toHaveBeenCalledWith("s1", "c-meesho");
  });

  it("copies only the visible lines", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    renderConsole();
    await userEvent.selectOptions(screen.getByLabelText("Minimum level"), "warn");
    await userEvent.click(screen.getByRole("button", { name: "Copy visible" }));
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.calls[0]![0]).toContain("Meesho evidence dropped");
    expect(writeText.mock.calls[0]![0]).not.toContain("node · resolve");
  });
});
```

`SpanDetail.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { makeEvent, makeRun, makeSpan } from "@/features/research/testing";

const h = vi.hoisted(() => ({ detail: { data: undefined as unknown, isLoading: false, isError: false, error: null } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/api-client/client", () => ({ ApiFetchError: class extends Error {}, apiFetch: vi.fn() }));
vi.mock("./PayloadViewer", () => ({ PayloadViewer: ({ value }: { value: unknown }) => <pre data-testid="payload">{typeof value === "string" ? value : JSON.stringify(value)}</pre> }));
vi.mock("@/features/research", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/research")>()),
  useSpanDetail: () => h.detail,
}));

import { SpanDetail } from "./SpanDetail";

const LLM_SPAN = {
  ...makeSpan({
    span_id: "s".repeat(32), kind: "llm", name: "resolve_company@v1", node: "resolve", company_id: "c-meesho", status: "error",
    attrs: { model: "gemma-3-27b-it", prompt_name: "resolve_company", prompt_version: "v1", tokens_in: 900 },
    error: { type: "ValidationError", message: "canonical_name missing", traceback: "Traceback (most recent call last)…", code_ref: "app/research/nodes/resolve.py:resolve" },
  }),
  input: { system: "SYSTEM PROMPT", user: "Company name as entered: Meesho" },
  output: { data: { is_company: true }, content: "{\"is_company\": true}" },
};

describe("SpanDetail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.detail = { data: { span: LLM_SPAN, logs: [makeEvent({ seq: 4, message: "resolve meesho: 5 results" })] }, isLoading: false, isError: false, error: null };
  });

  it("asks to pick a step when none is selected", () => {
    render(<SpanDetail spanId={null} run={makeRun()} companyName={null} />);
    expect(screen.getByText("Pick a step")).toBeInTheDocument();
  });

  it("opens a failed step on its error, with the code location", () => {
    render(<SpanDetail spanId={LLM_SPAN.span_id} run={makeRun()} companyName="Meesho" />);
    expect(screen.getByRole("tab", { name: "Error" })).toHaveAttribute("data-state", "active");
    expect(screen.getByTestId("payload")).toHaveTextContent("ValidationError: canonical_name missing");
    expect(screen.getByRole("button", { name: /app\/research\/nodes\/resolve\.py:resolve/ })).toBeInTheDocument();
  });

  it("shows the full prompt and the raw reply for LLM steps", async () => {
    render(<SpanDetail spanId={LLM_SPAN.span_id} run={makeRun()} companyName="Meesho" />);
    await userEvent.click(screen.getByRole("tab", { name: "Prompt" }));
    expect(screen.getByTestId("payload")).toHaveTextContent("SYSTEM PROMPT");
    expect(screen.getByTestId("payload")).toHaveTextContent("Company name as entered: Meesho");
    await userEvent.click(screen.getByRole("tab", { name: "Reply" }));
    expect(screen.getByTestId("payload")).toHaveTextContent('{"is_company": true}');
  });

  it("Copy for Claude puts a context-first markdown bundle on the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<SpanDetail spanId={LLM_SPAN.span_id} run={makeRun()} companyName="Meesho" />);
    await userEvent.click(screen.getByRole("button", { name: "Copy for Claude" }));
    const text = writeText.mock.calls[0]![0] as string;
    expect(text).toContain("## InterviewIQ research trace — llm · resolve_company@v1 · error");
    expect(text).toContain("- code: apps/ai-service/app/research/nodes/resolve.py:resolve");
    expect(text).toContain("resolve meesho: 5 results");
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @interviewiq/web exec vitest run "app/(app)/intelligence/_components/research"`
Expected: FAIL. The components cannot be resolved.

- [ ] **Step 3: Implement the viewer, minimap and tree**

`PayloadViewer.tsx`:

```tsx
"use client";

import dynamic from "next/dynamic";
import { useTheme } from "next-themes";

// Monaco reads browser-only APIs; never render it during SSR / `next build`.
const Editor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => <div data-motion className="h-[420px] animate-pulse rounded-md bg-panel" />,
});

/** Read-only Monaco for span payloads: folding, search (⌘F), word wrap. Text is the full value. */
export function PayloadViewer({ value, language = "json", height = 420 }: { value: unknown; language?: "json" | "plaintext"; height?: number }) {
  const { resolvedTheme } = useTheme();
  const text = language === "plaintext" && typeof value === "string" ? value : JSON.stringify(value ?? null, null, 2);
  return (
    <div className="overflow-hidden rounded-md border border-line-2">
      <Editor
        height={height}
        language={language}
        value={text}
        theme={resolvedTheme === "dark" ? "vs-dark" : "light"}
        options={{
          readOnly: true, domReadOnly: true, minimap: { enabled: false }, wordWrap: "on", folding: true,
          scrollBeyondLastLine: false, fontSize: 12, renderLineHighlight: "none", automaticLayout: true,
        }}
      />
    </div>
  );
}
```

`GraphMiniMap.tsx`:

```tsx
"use client";

import dynamic from "next/dynamic";
import type { ResearchItem } from "@/features/research";

// react-flow reads layout/ResizeObserver APIs; client-only, like the agent pipeline canvas.
const GraphMiniMapInner = dynamic(() => import("./GraphMiniMapInner"), {
  ssr: false,
  loading: () => <div data-motion className="h-14 animate-pulse rounded-md bg-panel" />,
});

/** The company's LangGraph as a strip of nodes coloured by progress; the running node pulses. */
export function GraphMiniMap({ item }: { item: ResearchItem }) {
  return <GraphMiniMapInner item={item} />;
}
```

`GraphMiniMapInner.tsx`:

```tsx
"use client";

import { useMemo } from "react";
import { Position, ReactFlow, ReactFlowProvider, type Edge, type Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { NODE_ORDER } from "@/lib/constants/research";
import { nodeStates, type NodeState, type ResearchItem } from "@/features/research";

const NODE_CLASS: Record<NodeState, string> = {
  idle: "border-dashed border-line-3 bg-card text-faint",
  running: "border-brand bg-card text-foreground ring-2 ring-brand/20 motion-safe:animate-[iq-breathe_1.4s_ease-in-out_infinite]",
  ok: "border-faint-2 bg-card text-foreground",
  error: "border-destructive bg-destructive/10 text-destructive",
};

const EDGES: Edge[] = NODE_ORDER.slice(0, -1).map((name, i) => ({ id: `${name}->${NODE_ORDER[i + 1]}`, source: name, target: NODE_ORDER[i + 1]! }));

export default function GraphMiniMapInner({ item }: { item: ResearchItem }) {
  const nodes = useMemo<Node[]>(
    () =>
      nodeStates(item).map(({ name, state }, i) => ({
        id: name,
        position: { x: i * 160, y: 0 },
        data: { label: name.replace(/_/g, " ") },
        draggable: false,
        selectable: false,
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        className: `!w-auto !rounded-full !border !px-3 !py-1 !font-mono !text-[11px] ${NODE_CLASS[state]}`,
      })),
    [item],
  );
  // Same HUD-zoom inversion as PipelineCanvasInner: React Flow must run at an effective zoom of 1.
  return (
    <div className="h-14">
      <div className="h-full [zoom:calc(1/var(--hud-zoom,1))]">
        <div className="h-full [--xy-attribution-background-color:transparent] [--xy-edge-stroke:hsl(var(--line-4))]">
          <ReactFlowProvider>
            <ReactFlow
              nodes={nodes}
              edges={EDGES}
              nodesDraggable={false}
              nodesConnectable={false}
              elementsSelectable={false}
              zoomOnScroll={false}
              panOnDrag={false}
              zoomOnDoubleClick={false}
              preventScrolling={false}
              fitView
              proOptions={{ hideAttribution: true }}
            />
          </ReactFlowProvider>
        </div>
      </div>
    </div>
  );
}
```

`TraceTree.tsx`:

```tsx
"use client";

import * as React from "react";
import { ChevronRight, ClipboardCopy } from "lucide-react";
import { StatusDot, padCount } from "@/components/hud";
import { CardEmpty, ConsoleCard, HeaderCount } from "@/components/observability/ConsoleCard";
import { formatDuration } from "@/components/observability/status";
import { cn } from "@/lib/utils/cn";
import { SPAN_STATUS_DOT, countSpans, flattenVisible, type ResearchItem, type ResearchSpan, type SpanNode } from "@/features/research";
import { GraphMiniMap } from "./GraphMiniMap";

const KIND_LABEL: Record<string, string> = {
  run: "RUN", company: "CO", node: "NODE", exa: "EXA", llm: "LLM", cache: "CACHE", merge: "MERGE", normalize: "NORM", db: "DB",
};

/** Left pane of the debugger: run → company → node → step, live status, durations, errors bubbling up. */
export function TraceTree({
  roots,
  items,
  selectedSpanId,
  onSelectSpan,
  onCopyFailure,
}: {
  roots: SpanNode[];
  items: ResearchItem[];
  selectedSpanId: string | null;
  onSelectSpan: (span: ResearchSpan) => void;
  onCopyFailure: (item: ResearchItem) => void;
}) {
  const [collapsed, setCollapsed] = React.useState<ReadonlySet<string>>(new Set());
  const rows = React.useMemo(() => flattenVisible(roots, collapsed), [roots, collapsed]);
  const itemsByCompany = React.useMemo(() => new Map(items.map((i) => [i.company_id, i])), [items]);
  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <ConsoleCard title="Trace" meta={<HeaderCount>{padCount(countSpans(roots))} steps</HeaderCount>}>
      {rows.length === 0 ? (
        <CardEmpty title="No steps yet" hint="Steps appear here as the run works." />
      ) : (
        <ul role="tree" aria-label="Run trace" className="m-0 max-h-[560px] list-none overflow-y-auto p-0">
          {rows.map((node) => {
            const s = node.span;
            const expandable = node.children.length > 0;
            const open = !collapsed.has(s.span_id);
            const item = s.kind === "company" && s.company_id ? itemsByCompany.get(s.company_id) : undefined;
            const retries = typeof s.attrs?.retries === "number" ? (s.attrs.retries as number) : 0;
            return (
              <li key={s.span_id} role="treeitem" aria-level={node.depth + 1} aria-expanded={expandable ? open : undefined} aria-selected={s.span_id === selectedSpanId}>
                <div
                  className={cn("flex items-center gap-1 rounded-md pr-2 text-[13px]", s.span_id === selectedSpanId ? "bg-line-2" : "hover:bg-accent")}
                  style={{ paddingLeft: 4 + node.depth * 14 }}
                >
                  {expandable ? (
                    <button
                      type="button"
                      aria-label={`${open ? "Collapse" : "Expand"} ${s.name}`}
                      className="grid h-5 w-5 flex-none place-items-center text-faint"
                      onClick={() => toggle(s.span_id)}
                    >
                      <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-90")} />
                    </button>
                  ) : (
                    <span aria-hidden className="h-5 w-5 flex-none" />
                  )}
                  <button type="button" className="flex min-w-0 flex-1 items-center gap-2 py-1 text-left" onClick={() => onSelectSpan(s)}>
                    <StatusDot state={SPAN_STATUS_DOT[s.status]} srLabel={s.status} />
                    <span className="w-11 flex-none font-mono text-[10px] uppercase tracking-[0.08em] text-faint">{KIND_LABEL[s.kind] ?? s.kind}</span>
                    <span className="min-w-0 flex-1 truncate">{s.name}</span>
                    {node.hasError && s.status !== "error" ? (
                      <span role="img" aria-label="a step inside failed" className="h-1.5 w-1.5 flex-none rounded-full bg-destructive" />
                    ) : null}
                    {retries > 0 ? <span className="font-mono text-[10.5px] text-faint">↻{retries}</span> : null}
                    <span className="flex-none font-mono text-[11px] tabular-nums text-faint">{s.duration_ms != null ? formatDuration(s.duration_ms) : "…"}</span>
                  </button>
                  {item?.status === "failed" ? (
                    <button
                      type="button"
                      aria-label={`Copy failure report for ${s.name}`}
                      title="Copy failure report"
                      className="grid h-6 w-6 flex-none place-items-center text-destructive"
                      onClick={() => onCopyFailure(item)}
                    >
                      <ClipboardCopy className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                </div>
                {item && open ? (
                  <div className="pb-1 pr-2" style={{ paddingLeft: 26 + node.depth * 14 }}>
                    <GraphMiniMap item={item} />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </ConsoleCard>
  );
}
```

- [ ] **Step 4: Implement the span detail, console, budget and control bar**

`SpanDetail.tsx`:

```tsx
"use client";

import { StatusDot } from "@/components/hud";
import { CardEmpty, ConsoleCard } from "@/components/observability/ConsoleCard";
import { LogTerminal } from "@/components/observability/LogTerminal";
import { formatDuration } from "@/components/observability/status";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApiFetchError } from "@/lib/api-client/client";
import { SPAN_STATUS_DOT, copyText, formatSpanForClaude, useSpanDetail, type ResearchRun } from "@/features/research";
import { PayloadViewer } from "./PayloadViewer";

/** Right pane of the debugger: one step's full input, output, logs and raw document. */
export function SpanDetail({ spanId, run, companyName }: { spanId: string | null; run: ResearchRun | undefined; companyName: string | null }) {
  const q = useSpanDetail(spanId);
  if (!spanId) {
    return (
      <ConsoleCard title="Step">
        <CardEmpty title="Pick a step" hint="Select a step in the trace, or a console line, to see its full input, output and logs." />
      </ConsoleCard>
    );
  }
  if (q.isLoading) {
    return (
      <ConsoleCard title="Step">
        <p className="m-0 text-[13px] text-muted-foreground">Loading step…</p>
      </ConsoleCard>
    );
  }
  if (q.isError || !q.data) {
    return (
      <ConsoleCard title="Step">
        <p role="alert" className="m-0 text-[13px] text-destructive">
          Could not load this step: {q.error instanceof ApiFetchError ? q.error.message : "unknown error"}
        </p>
      </ConsoleCard>
    );
  }

  const { span, logs } = q.data;
  const isLlm = span.kind === "llm";
  const input = (span.input ?? null) as Record<string, unknown> | null;
  const output = (span.output ?? null) as Record<string, unknown> | null;
  const scalarAttrs = Object.entries(span.attrs ?? {}).filter(([, v]) => v !== null && v !== undefined && typeof v !== "object");
  const firstTab = span.error ? "error" : isLlm ? "prompt" : "output";

  return (
    <ConsoleCard title={`${span.kind} · ${span.name}`} meta={<StatusDot state={SPAN_STATUS_DOT[span.status]} label={span.status} />}>
      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11.5px] text-muted-foreground">
          <span>{span.duration_ms != null ? formatDuration(span.duration_ms) : "running…"}</span>
          {scalarAttrs.map(([k, v]) => (
            <span key={k}>
              {k} <span className="text-foreground">{String(v)}</span>
            </span>
          ))}
          {span.error?.code_ref ? (
            <button
              type="button"
              className="underline-offset-4 hover:underline"
              onClick={() => copyText(`apps/ai-service/${span.error!.code_ref}`, "Code location copied")}
            >
              code {span.error.code_ref}
            </button>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" onClick={() => copyText(formatSpanForClaude({ span, logs, run: run ?? null, companyName }), "Copied for Claude")}>
            Copy for Claude
          </Button>
          <Button size="sm" variant="strong" onClick={() => copyText(JSON.stringify(q.data, null, 2), "Step JSON copied")}>
            Copy JSON
          </Button>
        </div>
        <Tabs key={span.span_id} defaultValue={firstTab}>
          <TabsList className="flex-wrap">
            {span.error ? <TabsTrigger value="error">Error</TabsTrigger> : null}
            {isLlm ? <TabsTrigger value="prompt">Prompt</TabsTrigger> : null}
            {isLlm ? <TabsTrigger value="reply">Reply</TabsTrigger> : null}
            <TabsTrigger value="input">Input</TabsTrigger>
            <TabsTrigger value="output">Output</TabsTrigger>
            <TabsTrigger value="logs">Logs ({logs.length})</TabsTrigger>
            <TabsTrigger value="raw">Raw</TabsTrigger>
          </TabsList>
          {span.error ? (
            <TabsContent value="error">
              <PayloadViewer language="plaintext" value={`${span.error.type}: ${span.error.message}\n\n${span.error.traceback ?? ""}`} />
            </TabsContent>
          ) : null}
          {isLlm ? (
            <TabsContent value="prompt">
              <PayloadViewer language="plaintext" value={`${String(input?.system ?? "")}\n\n────── user ──────\n\n${String(input?.user ?? "")}`} />
            </TabsContent>
          ) : null}
          {isLlm ? (
            <TabsContent value="reply">
              <PayloadViewer
                language="plaintext"
                value={typeof output?.content === "string" ? output.content : JSON.stringify(output?.data ?? null, null, 2)}
              />
            </TabsContent>
          ) : null}
          <TabsContent value="input"><PayloadViewer value={span.input ?? null} /></TabsContent>
          <TabsContent value="output"><PayloadViewer value={span.output ?? null} /></TabsContent>
          <TabsContent value="logs"><LogTerminal logs={logs} title="Step logs" className="h-[420px]" /></TabsContent>
          <TabsContent value="raw"><PayloadViewer value={q.data} /></TabsContent>
        </Tabs>
      </div>
    </ConsoleCard>
  );
}
```

`LiveConsole.tsx`:

```tsx
"use client";

import * as React from "react";
import { Copy } from "lucide-react";
import { padCount } from "@/components/hud";
import { ConsoleCard, HeaderCount } from "@/components/observability/ConsoleCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NODE_ORDER } from "@/lib/constants/research";
import { cn } from "@/lib/utils/cn";
import {
  DEFAULT_FILTERS, LEVEL_ORDER, copyText, filterEvents, logLine,
  type EventFilters, type ResearchEvent, type ResearchItem, type ResearchLevel,
} from "@/features/research";

const SELECT = "h-8 rounded-full border border-input bg-card px-3 font-mono text-[12px]";

/** Bottom pane: every trace event, live. Filters, follow-tail, older pages, copy. */
export function LiveConsole({
  events,
  items,
  live,
  onSelectSpan,
  canLoadOlder,
  onLoadOlder,
  loadingOlder,
}: {
  events: ResearchEvent[];
  items: ResearchItem[];
  live: boolean;
  onSelectSpan: (spanId: string, companyId: string | null) => void;
  canLoadOlder: boolean;
  onLoadOlder: () => void;
  loadingOlder: boolean;
}) {
  const [filters, setFilters] = React.useState<EventFilters>(DEFAULT_FILTERS);
  const [follow, setFollow] = React.useState(true);
  const bodyRef = React.useRef<HTMLDivElement | null>(null);
  const shown = React.useMemo(() => filterEvents(events, filters), [events, filters]);
  const companies = React.useMemo(() => new Map(items.map((i) => [i.company_id, i.company_name])), [items]);

  React.useEffect(() => {
    const el = bodyRef.current;
    if (follow && el) el.scrollTop = el.scrollHeight;
  }, [shown, follow]);

  const onScroll = () => {
    const el = bodyRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    if (!atBottom && follow) setFollow(false);
  };
  const set = <K extends keyof EventFilters>(key: K, value: EventFilters[K]) => setFilters((f) => ({ ...f, [key]: value }));

  return (
    <ConsoleCard title="Console" meta={<HeaderCount>{padCount(shown.length)} / {padCount(events.length)}{live ? " · live" : ""}</HeaderCount>}>
      <div className="flex flex-wrap items-center gap-2 pb-3">
        <select aria-label="Minimum level" className={SELECT} value={filters.minLevel} onChange={(e) => set("minLevel", e.target.value as ResearchLevel)}>
          {LEVEL_ORDER.map((l) => <option key={l} value={l}>{l}+</option>)}
        </select>
        <select aria-label="Company" className={SELECT} value={filters.companyId ?? ""} onChange={(e) => set("companyId", e.target.value || null)}>
          <option value="">All companies</option>
          {[...companies].map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <select aria-label="Node" className={SELECT} value={filters.node ?? ""} onChange={(e) => set("node", e.target.value || null)}>
          <option value="">All nodes</option>
          {NODE_ORDER.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <Input aria-label="Event type prefix" placeholder="type, e.g. span." value={filters.type} onChange={(e) => set("type", e.target.value)} className="h-8 w-36 rounded-full font-mono text-[12px]" />
        <Input aria-label="Search messages" placeholder="search…" value={filters.q} onChange={(e) => set("q", e.target.value)} className="h-8 w-44 rounded-full text-[12px]" />
        <Button size="sm" variant={follow ? "ink" : "strong"} aria-pressed={follow} onClick={() => setFollow((f) => !f)}>
          {follow ? "Following" : "Follow tail"}
        </Button>
        <Button size="sm" variant="ghost" disabled={!canLoadOlder || loadingOlder} onClick={onLoadOlder}>
          {loadingOlder ? "Loading…" : "Load older"}
        </Button>
        <Button size="sm" variant="ghost" disabled={shown.length === 0} onClick={() => copyText(shown.map(logLine).join("\n"), "Visible lines copied")}>
          Copy visible
        </Button>
      </div>
      <div
        ref={bodyRef}
        onScroll={onScroll}
        role="log"
        aria-label="Research events"
        className="h-[420px] overflow-y-auto rounded-md border border-line-2 bg-panel p-2 font-mono text-[11.5px] leading-[1.55]"
      >
        {shown.length === 0 ? (
          <p className="m-0 p-2 text-faint">{events.length > 0 ? "No events match these filters." : "Waiting for events…"}</p>
        ) : (
          shown.map((e) => (
            <div
              key={e.seq}
              className={cn(
                "group flex gap-2 rounded px-1 hover:bg-accent",
                e.level === "error" && "text-destructive",
                e.level === "warn" && "text-[hsl(var(--color-lc-medium))]",
              )}
            >
              <span className="w-12 flex-none text-right tabular-nums text-faint">{e.seq}</span>
              <span className="w-16 flex-none tabular-nums text-faint">{e.ts.slice(11, 19)}</span>
              <span className="w-10 flex-none uppercase">{e.level}</span>
              <span className="w-24 flex-none truncate text-faint">{e.company_id ? (companies.get(e.company_id) ?? e.company_id.slice(0, 8)) : "—"}</span>
              <span className="w-20 flex-none truncate text-faint">{e.node ?? "—"}</span>
              <span className="w-28 flex-none truncate">{e.type}</span>
              {e.span_id ? (
                <button type="button" title={e.message} className="min-w-0 flex-1 truncate text-left hover:underline" onClick={() => onSelectSpan(e.span_id!, e.company_id ?? null)}>
                  {e.message}
                </button>
              ) : (
                <span title={e.message} className="min-w-0 flex-1 truncate">{e.message}</span>
              )}
              <button
                type="button"
                aria-label={`Copy event ${e.seq}`}
                className="invisible flex-none text-faint group-focus-within:visible group-hover:visible"
                onClick={() => copyText(JSON.stringify(e, null, 2), "Event copied")}
              >
                <Copy className="h-3 w-3" />
              </button>
            </div>
          ))
        )}
      </div>
    </ConsoleCard>
  );
}
```

`BudgetMeters.tsx`:

```tsx
"use client";

import * as React from "react";
import { toast } from "sonner";
import { HudCard, SegmentMeter } from "@/components/hud";
import { HeaderCount } from "@/components/observability/ConsoleCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiFetchError } from "@/lib/api-client/client";
import { useRaiseBudget, type ResearchRun } from "@/features/research";

function Meter({ label, used, cap }: { label: string; used: number; cap: number }) {
  const ratio = cap > 0 ? used / cap : 1;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="iq-eyebrow">{label}</span>
        <span className="font-mono text-[12px] tabular-nums">{used} / {cap}</span>
      </div>
      <SegmentMeter segments={20} filled={ratio * 20} tone={ratio >= 1 ? "brand" : "ink"} label={`${label}: ${used} of ${cap} used`} />
    </div>
  );
}

/** Exa / LLM calls used vs cap, plus tokens. Reaching a cap auto-pauses the run; raise it here, then Resume. */
export function BudgetMeters({ run }: { run: ResearchRun }) {
  const raise = useRaiseBudget();
  const b = run.budget;
  const [exaCap, setExaCap] = React.useState(String(b.exa_cap));
  const [llmCap, setLlmCap] = React.useState(String(b.llm_cap));
  React.useEffect(() => {
    setExaCap(String(b.exa_cap));
    setLlmCap(String(b.llm_cap));
  }, [b.exa_cap, b.llm_cap]);

  function save(e: React.FormEvent) {
    e.preventDefault();
    raise.mutate(
      { runId: run.run_id, exaCap: Number(exaCap), llmCap: Number(llmCap) },
      {
        onSuccess: () => toast.success("Budget caps updated"),
        onError: (err) => toast.error(err instanceof ApiFetchError ? err.message : "Could not update the caps"),
      },
    );
  }

  return (
    <HudCard
      title="Budget"
      spotlight={false}
      meta={<HeaderCount>{b.tokens_in.toLocaleString()} in · {b.tokens_out.toLocaleString()} out tokens</HeaderCount>}
    >
      <div className="grid gap-4 md:grid-cols-[1fr_1fr_auto] md:items-end">
        <Meter label="Exa searches" used={b.exa_used} cap={b.exa_cap} />
        <Meter label="LLM calls" used={b.llm_used} cap={b.llm_cap} />
        <form onSubmit={save} aria-label="Set budget caps" className="flex items-end gap-2">
          <div className="grid gap-1">
            <Label htmlFor="exa-cap" className="text-[11px]">Exa cap</Label>
            <Input id="exa-cap" type="number" min={b.exa_used} value={exaCap} onChange={(e) => setExaCap(e.target.value)} className="h-8 w-24 font-mono text-[12px]" />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="llm-cap" className="text-[11px]">LLM cap</Label>
            <Input id="llm-cap" type="number" min={b.llm_used} value={llmCap} onChange={(e) => setLlmCap(e.target.value)} className="h-8 w-24 font-mono text-[12px]" />
          </div>
          <Button size="sm" variant="strong" type="submit" disabled={raise.isPending}>Set caps</Button>
        </form>
      </div>
    </HudCard>
  );
}
```

`RunControlBar.tsx`:

```tsx
"use client";

import * as React from "react";
import { toast } from "sonner";
import { HudCard, StatusDot } from "@/components/hud";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ApiFetchError } from "@/lib/api-client/client";
import {
  RUN_STATUS_DOT, collectRunExport, copyText, downloadJson, formatRunSummary, runControls, timeAgo,
  useAdminCompanies, useRunControl, useStartRun,
  type ResearchItem, type ResearchMode, type ResearchRun, type RunAction, type StartResearchRunRequest,
} from "@/features/research";

const MODES: ResearchMode[] = ["live", "record", "replay"];
const SELECT = "h-8 rounded-full border border-input bg-card px-3 font-mono text-[12px]";

function errorMessage(err: unknown): string {
  return err instanceof ApiFetchError ? err.message : "Request failed. Check the API logs.";
}

function runLabel(r: ResearchRun): string {
  const when = r.started_at ?? r.created_at;
  return `${r.run_id.slice(0, 8)} · ${r.status} · ${r.trigger} · ${timeAgo(when)}`;
}

/** Run picker, start (all / selected, by mode), pause / resume / stop, copy summary, export JSON. */
export function RunControlBar({
  runs,
  run,
  items,
  onSelectRun,
}: {
  runs: ResearchRun[];
  run: ResearchRun | undefined;
  items: ResearchItem[];
  onSelectRun: (runId: string) => void;
}) {
  const start = useStartRun();
  const control = useRunControl();
  const [mode, setMode] = React.useState<ResearchMode>("live");
  const controls = runControls(run?.status, start.isPending || control.isPending);
  const options = run && !runs.some((r) => r.run_id === run.run_id) ? [run, ...runs] : runs;

  const startRun = (body: StartResearchRunRequest) =>
    start.mutate(body, { onSuccess: (r) => onSelectRun(r.run_id), onError: (e) => toast.error(errorMessage(e)) });
  const act = (action: RunAction) => {
    if (run) control.mutate({ runId: run.run_id, action }, { onError: (e) => toast.error(errorMessage(e)) });
  };
  async function exportRun() {
    if (!run) return;
    try {
      downloadJson(`research-run-${run.run_id}.json`, await collectRunExport(run.run_id));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <HudCard title="Research run" spotlight={false} meta={run ? <StatusDot state={RUN_STATUS_DOT[run.status]} label={run.status} /> : null}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {options.length > 0 ? (
            <select aria-label="Run" className={`${SELECT} max-w-[340px]`} value={run?.run_id ?? ""} onChange={(e) => onSelectRun(e.target.value)}>
              {options.map((r) => <option key={r.run_id} value={r.run_id}>{runLabel(r)}</option>)}
            </select>
          ) : null}
          <select aria-label="Mode" className={SELECT} value={mode} onChange={(e) => setMode(e.target.value as ResearchMode)}>
            {MODES.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <Button size="sm" disabled={!controls.start} onClick={() => startRun({ scope: "all", mode })}>Start all</Button>
          <StartSelected disabled={!controls.start} onStart={(ids) => startRun({ scope: "selected", companyIds: ids, mode })} />
          <Button size="sm" variant="strong" disabled={!controls.pause} onClick={() => act("pause")}>Pause</Button>
          <Button size="sm" variant="strong" disabled={!controls.resume} onClick={() => act("resume")}>Resume</Button>
          <Button size="sm" variant="ghost" disabled={!controls.stop} onClick={() => act("stop")}>Stop</Button>
          <div className="ml-auto flex flex-wrap gap-1.5">
            <Button size="sm" variant="ghost" disabled={!run} onClick={() => run && copyText(formatRunSummary(run, items), "Run summary copied")}>
              Copy run summary
            </Button>
            <Button size="sm" variant="ghost" disabled={!run} onClick={exportRun}>Export run JSON</Button>
          </div>
        </div>
        {run ? <RunFacts run={run} /> : null}
      </div>
    </HudCard>
  );
}

function RunFacts({ run }: { run: ResearchRun }) {
  const c = run.counters;
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 font-mono text-[11.5px] text-muted-foreground">
      <span>mode {run.mode}</span>
      <span>trigger {run.trigger}</span>
      <span>scope {run.scope}</span>
      <span>
        {c.total} total · {c.done} done · {c.skipped} skipped · {c.failed} failed · {c.running} running · {c.paused} paused · {c.queued} queued · {c.cancelled} cancelled
      </span>
      {run.started_at ? <span>started {timeAgo(run.started_at)}</span> : null}
      {run.pause_reason === "budget_exhausted" ? <span className="text-destructive">paused: budget cap reached. Raise a cap, then Resume</span> : null}
      {run.error ? <span className="text-destructive">error: {run.error}</span> : null}
    </div>
  );
}

function StartSelected({ disabled, onStart }: { disabled: boolean; onStart: (ids: string[]) => void }) {
  const companies = useAdminCompanies();
  const [open, setOpen] = React.useState(false);
  const [picked, setPicked] = React.useState<ReadonlySet<string>>(new Set());
  const active = (companies.data?.companies ?? []).filter((c) => c.status === "active");
  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="strong" disabled={disabled}>Start selected…</Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-3">
        <fieldset className="m-0 flex max-h-64 flex-col gap-1.5 overflow-y-auto border-0 p-0">
          <legend className="iq-eyebrow mb-2">Companies to research</legend>
          {active.length === 0 ? <p className="m-0 text-[13px] text-muted-foreground">No active companies. Add one on the Companies tab.</p> : null}
          {active.map((c) => (
            <label key={c.id} className="flex items-center gap-2 text-[13px]">
              <input type="checkbox" checked={picked.has(c.id)} onChange={() => toggle(c.id)} />
              {c.name}
            </label>
          ))}
        </fieldset>
        <Button
          size="sm"
          className="mt-3 w-full"
          disabled={picked.size === 0}
          onClick={() => {
            onStart([...picked]);
            setOpen(false);
            setPicked(new Set());
          }}
        >
          Start {picked.size > 0 ? picked.size : ""} selected
        </Button>
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 5: Implement RunsTab**

`RunsTab.tsx`:

```tsx
"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { HudEmpty } from "@/components/hud";
import {
  buildSpanTree, copyText, deepLinkHref, deepestErrorSpan, formatFailureReport, getSpan, isRunActive, nodeSpansFor,
  parseDeepLink, useResearchRun, useResearchRuns, useRunEvents, useRunSpans,
  type ResearchItem, type ResearchSpan,
} from "@/features/research";
import { BudgetMeters } from "./BudgetMeters";
import { LiveConsole } from "./LiveConsole";
import { RunControlBar } from "./RunControlBar";
import { SpanDetail } from "./SpanDetail";
import { TraceTree } from "./TraceTree";

/** Intelligence → Runs: the research debugger (spec §9.1). Every selection lives in the URL. */
export function RunsTab() {
  const params = useSearchParams();
  const router = useRouter();
  const link = parseDeepLink(params);
  const runs = useResearchRuns();
  const runId = link.run ?? runs.data?.runs[0]?.run_id ?? null;
  const detail = useResearchRun(runId);
  const run = detail.data?.run;
  const items = React.useMemo(() => detail.data?.items ?? [], [detail.data]);
  const live = run ? isRunActive(run.status) : false;
  const spans = useRunSpans(runId, live);
  const roots = React.useMemo(() => buildSpanTree(spans.data?.spans ?? []), [spans.data]);
  const events = useRunEvents(runId, { live, lastSeq: run?.last_seq });

  const navigate = (patch: { run?: string | null; company?: string | null; span?: string | null }) =>
    router.replace(deepLinkHref(new URLSearchParams(params.toString()), { tab: "runs", ...patch }), { scroll: false });
  const selectSpan = (span: Pick<ResearchSpan, "span_id" | "company_id">) => navigate({ span: span.span_id, company: span.company_id });

  async function copyFailure(item: ResearchItem) {
    if (!run) return;
    try {
      const failingSpan = deepestErrorSpan(roots, item.company_id);
      const failing = failingSpan ? (await getSpan(failingSpan.span_id)).span : null;
      const okNodes = nodeSpansFor(roots, item.company_id).filter((s) => s.status === "ok");
      const previousOutputs = await Promise.all(
        okNodes.map(async (s) => ({ node: s.name, output: (await getSpan(s.span_id)).span.output ?? null })),
      );
      const logs = events.events.filter((e) => e.company_id === item.company_id).slice(-200);
      await copyText(formatFailureReport({ run, item, failing, previousOutputs, logs }), "Failure report copied");
    } catch {
      toast.error("Could not build the failure report");
    }
  }

  if (!runId) {
    return (
      <div className="flex flex-col gap-4">
        <RunControlBar runs={[]} run={undefined} items={[]} onSelectRun={(id) => navigate({ run: id, company: null, span: null })} />
        <HudEmpty title="No research runs yet" hint="Start one above, or use Research now on the Companies tab." />
      </div>
    );
  }

  const companyName = link.company ? (items.find((i) => i.company_id === link.company)?.company_name ?? null) : null;

  return (
    <div className="flex flex-col gap-4">
      <RunControlBar runs={runs.data?.runs ?? []} run={run} items={items} onSelectRun={(id) => navigate({ run: id, company: null, span: null })} />
      {run ? <BudgetMeters run={run} /> : null}
      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(320px,420px)_minmax(0,1fr)]">
        <TraceTree roots={roots} items={items} selectedSpanId={link.span} onSelectSpan={selectSpan} onCopyFailure={copyFailure} />
        <SpanDetail spanId={link.span} run={run} companyName={companyName} />
      </div>
      <LiveConsole
        events={events.events}
        items={items}
        live={live}
        onSelectSpan={(spanId, companyId) => navigate({ span: spanId, company: companyId })}
        canLoadOlder={events.canLoadOlder}
        onLoadOlder={events.loadOlder}
        loadingOlder={events.loadingOlder}
      />
    </div>
  );
}
```

- [ ] **Step 6: Wire the page and remove the superseded company UI**

Before deleting, run `git diff --stat -- "apps/web/app/(app)/intelligence/_components/CompaniesPanel.tsx" "apps/web/app/(app)/intelligence/_components/RemoveCompanyButton.tsx"`. These files carry uncommitted HUD-restyle edits from another session. The Companies tab supersedes them, so deleting them is intended. Delete both files.

Replace `apps/web/app/(app)/intelligence/page.tsx` with:

```tsx
"use client";

import { Suspense, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RequireAdmin } from "@/components/auth/RequireAdmin";
import { PAGE_SCAFFOLD } from "@/components/layout/page";
import { deepLinkHref, parseDeepLink, type IntelligenceTab } from "@/features/research";
import { LiveIngestionPanel } from "./_components/LiveIngestionPanel";
import { AccessControlPanel } from "./_components/AccessControlPanel";
import { QuestionBankPanel } from "./_components/QuestionBankPanel";
import { ResumeBenchPanel } from "./_components/ResumeBenchPanel";
import { InterviewPrepBenchPanel } from "./_components/InterviewPrepBenchPanel";
import { AgentDiagnosticsPanel } from "./_components/AgentDiagnosticsPanel";
import { CompaniesTab } from "./_components/research/CompaniesTab";
import { RunsTab } from "./_components/research/RunsTab";

const TABS: ReadonlyArray<{ value: IntelligenceTab; label: string; Panel: () => ReactNode }> = [
  { value: "companies", label: "Companies", Panel: CompaniesTab },
  { value: "runs", label: "Runs", Panel: RunsTab },
  { value: "briefs", label: "Briefs (legacy)", Panel: LiveIngestionPanel },
  { value: "access", label: "Access", Panel: AccessControlPanel },
  { value: "questions", label: "Question bank", Panel: QuestionBankPanel },
  { value: "resume", label: "Resume bench", Panel: ResumeBenchPanel },
  { value: "prep", label: "Interview prep", Panel: InterviewPrepBenchPanel },
  { value: "agent", label: "Agent diagnostics", Panel: AgentDiagnosticsPanel },
];

export default function IntelligencePage() {
  return (
    <RequireAdmin>
      {/* The tabs read ?tab=&run=&span= via useSearchParams, which needs a Suspense boundary. */}
      <Suspense fallback={null}>
        <IntelligenceTabs />
      </Suspense>
    </RequireAdmin>
  );
}

function IntelligenceTabs() {
  const params = useSearchParams();
  const router = useRouter();
  const { tab } = parseDeepLink(params);
  const onTab = (value: string) =>
    router.replace(deepLinkHref(new URLSearchParams(params.toString()), { tab: value as IntelligenceTab }), { scroll: false });

  return (
    <div className={PAGE_SCAFFOLD}>
      <div className="min-w-0">
        <p className="iq-eyebrow m-0">Admin</p>
        <h1 className="m-0 mt-1.5 text-[26px] font-normal leading-[1.1] tracking-[-0.04em] sm:text-[30px]">Interview Intelligence</h1>
        <p className="m-0 mt-1.5 max-w-2xl text-[14px] leading-[1.5] text-muted-foreground">
          Curate the companies we research, run and debug the research pipeline step by step, test the resume, prep and
          agent pipelines, and manage who has admin access.
        </p>
      </div>

      <Tabs value={tab} onValueChange={onTab} className="mt-5">
        <div className="sticky top-0 z-20 -mx-4 bg-card px-4 sm:-mx-8 sm:px-8 lg:-mx-10 lg:px-10">
          <TabsList
            aria-label="Intelligence sections"
            className="-mx-4 flex h-auto w-auto justify-start gap-6 overflow-x-auto rounded-none bg-transparent p-0 px-4 text-faint shadow-[inset_0_-1px_0_hsl(var(--line-2))] sm:mx-0 sm:px-0"
          >
            {TABS.map((t) => (
              <TabsTrigger
                key={t.value}
                value={t.value}
                className="shrink-0 rounded-none border-b-[1.5px] border-transparent px-0 pb-3 pt-3.5 text-sm font-normal text-faint transition-colors hover:text-foreground focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-offset-0 data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none"
              >
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        {TABS.map(({ value, Panel }) => (
          <TabsContent key={value} value={value} className="mt-6 rounded-[14px] focus-visible:ring-1 focus-visible:ring-offset-4">
            <Panel />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
```

Keep the existing page's tab-bar class strings exactly as they are in the working tree if they differ from the above (the HUD session may have restyled them). Only the `TABS` list, the URL-driven `value`/`onValueChange` and the Suspense wrapper are this task's changes.

Clean up the old company plumbing:
- In `features/intelligence/api.ts`, delete `listCompanies`, `createCompany`, `deleteCompany` and `seedCompanies`, plus their type imports.
- In `features/intelligence/hooks.ts`, delete `useCompanies`, `useAddCompany`, `useDeleteCompany` and `useSeedCompanies`.
- In `features/intelligence/types.ts`, delete `CompanyWithJds` and `CreateCompanyInput`, plus any type used only by them.
- In `features/intelligence/index.ts`, drop the matching exports.
- In `lib/constants/intelligence/index.ts`, delete `ADMIN_COMPANY_ENDPOINTS` and `INTELLIGENCE_QUERY_KEYS.companies`.

Then run `grep -rn -E "CompaniesPanel|RemoveCompanyButton|useCompanies|useAddCompany|ADMIN_COMPANY_ENDPOINTS|CompanyWithJds" apps/web --include=*.ts --include=*.tsx`. Expected: no matches.

- [ ] **Step 7: Run all web checks**

Run: `pnpm --filter @interviewiq/web typecheck && pnpm --filter @interviewiq/web lint && pnpm --filter @interviewiq/web test`
Expected: PASS. The lint step allows only the pre-existing warnings.

- [ ] **Step 8: Checkpoint**

Run `git status`; leave the changes uncommitted.

---

## Task 17: Local setup, docs and end-to-end verification

**Files:**
- Modify: `apps/ai-service/.env.example`, `infra/.env.example`, `.gitignore`, `apps/ai-service/README.md`

- [ ] **Step 1: Document the settings**

Append to `apps/ai-service/.env.example`. Mirror the same block under the ai-service section of `infra/.env.example`.

```bash
# --- Company research pipeline (Intelligence → Companies / Runs) ---
RESEARCH_ENABLED=true
# Weekly run (APScheduler crontab, Asia/Kolkata; use day NAMES). Only when SCHEDULER_ENABLED=true.
RESEARCH_CRON=0 2 * * mon
# live | record | replay. Local dev: record once, then replay for free, deterministic, offline runs.
RESEARCH_MODE=live
RESEARCH_FIXTURES_DIR=.research-fixtures
RESEARCH_CONCURRENCY=2
RESEARCH_RESULTS_PER_QUERY=5
RESEARCH_STALE_AFTER_DAYS=7
RESEARCH_MAX_ROLES=8
# Per-run caps; reaching one auto-pauses the run (raise in the UI, then Resume). Dev: 60 / 250.
RESEARCH_MAX_EXA_CALLS=400
RESEARCH_MAX_LLM_CALLS=2000
RESEARCH_MAX_ATTEMPTS=2
# Full-verbosity trace retention (events + payloads). The Atlas free tier (512 MB) fills past ~50 companies.
RESEARCH_TRACE_TTL_DAYS=14
```

Add `apps/ai-service/.research-fixtures/` to the repo `.gitignore`. Recorded fixtures are real web text and must never land in git.

- [ ] **Step 2: Add the README section**

Add a section `## Company research pipeline (Phase 1)` to `apps/ai-service/README.md` with:
- **What runs:** the runner and the per-company LangGraph (`resolve` → `write_draft`), the trace collections, and the weekly cron.
- **The modes:** `live`, `record` and `replay`.
- **The CLI:** the three CLI examples from `app/research/cli.py`'s docstring.
- **The Mongo contract tests:** `RESEARCH_TEST_MONGO_URL=… .venv/bin/python -m pytest tests/research/test_store_contract.py`.
- **The local walkthrough** in Step 4 below, verbatim.

- [ ] **Step 3: Run every automated check**

Run:

```bash
cd apps/ai-service && .venv/bin/python -m pytest -q && cd ../..
pnpm --filter @interviewiq/api typecheck && pnpm --filter @interviewiq/api test
pnpm --filter @interviewiq/web typecheck && pnpm --filter @interviewiq/web lint && pnpm --filter @interviewiq/web test
```

Expected: everything passes. Paste the tail of each run into the task report. Do not claim green without that output.

- [ ] **Step 4: Local walkthrough (host processes, no Docker)**

This uses the dev databases and spends a few Exa and LLM calls in record mode: about 2 each per company in Phase 1. **Ask the user before running it.**

1. In `apps/ai-service/.env`, set:
   - `SCHEDULER_ENABLED=false`
   - `MONGODB_DB=interviewiq_intelligence_dev`
   - `RESEARCH_MAX_EXA_CALLS=60`
   - `RESEARCH_MAX_LLM_CALLS=250`
2. Start the stack with `pnpm dev`. Check the API's startup log shows migration `0002_company_research` applied, and the ai-service log shows the research runner started.
3. Sign in as an admin and open `/intelligence?tab=companies`. Add **Meesho** (website `meesho.com`), **Razorpay** and **TCS**. Each row shows "Never researched".
4. Open the **Runs** tab. Choose mode `record`, then **Start selected…** with all three. Watch for:
   - the trace tree filling up (run → company → resolve → exa / llm → write_draft);
   - the minimap pulsing the active node;
   - console lines streaming;
   - the budget meters counting up.
5. Click an `llm` step and check the Prompt, Reply, Input, Output, Logs and Raw tabs. Click **Copy for Claude** and paste it somewhere. It should start with the context header and contain the fenced blocks.
6. Start another `record` run of all three. Press **Pause** while the first company is in `resolve`. That company finishes its current node and parks; the others stay queued; the run reads `paused`. Press **Resume**: in the trace, `resolve` does **not** run again for the parked company. Then start a run and press **Stop**: the companies end `cancelled`, and no draft appears in `company_drafts` for that run.
7. **Restart check.** Pause a run, restart the ai-service, then open the run. It is still `paused`, and Resume finishes it.
8. **Replay check.** Start a `replay` run of all three. It completes with the Exa and LLM meters at 0. The companies end `skipped`, since nothing changed since their drafts.
9. **Budget check.** Start a `live` run with the LLM cap set to 1 (Set caps right after starting). The run auto-pauses with "budget cap reached". Raise the cap and Resume, and it completes.
10. On the Companies tab, every researched company reads "Awaiting review". Archive TCS, then start an "all" run: TCS is not included.
11. As a non-admin student, `/jobs` lists only the published companies. Admin-added companies stay hidden until Phase 2 approval.

Record the outcome of each numbered check in the task report, including anything that misbehaved.

- [ ] **Step 5: Checkpoint**

Run `git status` and hand over to the user to review and commit.
