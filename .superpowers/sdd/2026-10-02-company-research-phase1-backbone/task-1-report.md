# Task 1: Research settings and shared vocabulary — Implementation Report

**Date:** 2026-10-02  
**Status:** DONE  
**Test Results:** 18/18 passing, output pristine

---

## What Was Implemented

Completed Task 1 of the company-research pipeline: added research configuration settings and shared vocabulary (enums, state machines, field shapes) to support the full pipeline infrastructure.

### Files Created

1. **`apps/ai-service/tests/research/__init__.py`** — Empty marker file for test package.

2. **`apps/ai-service/tests/research/test_research_config.py`** — Two test cases:
   - `test_research_defaults`: Verifies all 12 research settings have correct default values.
   - `test_research_mode_must_be_known`: Validates that invalid research mode values raise `ValidationError`.

3. **`apps/ai-service/tests/research/test_models.py`** — 16 test cases (6 explicit + parameterized):
   - `test_field_shape`: Verifies the field dict shape and source_urls conversion.
   - `test_unavailable_is_an_empty_low_confidence_field`: Confirms unavailable() produces correct structure.
   - `test_paused_run_still_holds_the_active_slot`: Validates ACTIVE_RUN_STATUSES membership.
   - `test_phase_one_node_order`: Confirms NODE_ORDER is ("resolve", "write_draft").
   - `test_allowed_transitions`: 6 parameterized cases for valid state transitions.
   - `test_rejected_transitions`: 6 parameterized cases for invalid state transitions.

4. **`apps/ai-service/app/research/__init__.py`** — Module docstring referencing the pipeline spec.

5. **`apps/ai-service/app/research/models.py`** — Core vocabulary module containing:
   - **Enums:**
     - `RunStatus` (8 values: queued, running, pausing, paused, stopping, stopped, completed, failed)
     - `ItemStatus` (7 values: queued, running, paused, done, failed, skipped, cancelled)
     - `Control` (3 values: none, pause, stop)
     - `Mode` (3 values: live, record, replay)
   - **Constants:**
     - `PIPELINE_VERSION = "research-v1"`
     - `ACTIVE_RUN_STATUSES`: frozenset of run statuses that hold the single active-run slot
     - `NODE_ORDER = ("resolve", "write_draft")` for Phase 1
     - Type aliases: `Confidence`, `Provenance`
   - **Functions:**
     - `field(value, *, confidence, provenance, source_urls=(), note=None) -> dict`: Builds snapshot-leaf fields with metadata.
     - `unavailable(note=None) -> dict`: Returns low-confidence unavailable field.
     - `check_transition(status: str, action: str) -> None`: State machine validator; raises `InvalidTransition` for disallowed transitions.
   - **Exception:**
     - `InvalidTransition(ValueError)`: For HTTP 409 responses when an admin control doesn't apply to the run's current status.

### Files Modified

1. **`apps/ai-service/app/config.py`**:
   - Updated typing import: `from typing import Annotated, Literal`
   - Added 11 new `Field` definitions to the `Settings` class after `brief_inter_call_delay_seconds`:
     - `research_enabled` (bool, default True)
     - `research_cron` (str, default "0 2 * * mon" — Asia/Kolkata weekly Monday 2am)
     - `research_mode` (Literal["live", "record", "replay"], default "live")
     - `research_fixtures_dir` (str, default ".research-fixtures")
     - `research_concurrency` (int, default 2, ge=1)
     - `research_results_per_query` (int, default 5, ge=1)
     - `research_stale_after_days` (int, default 7, ge=0)
     - `research_max_roles` (int, default 8, ge=1)
     - `research_max_exa_calls` (int, default 400, ge=0)
     - `research_max_llm_calls` (int, default 2000, ge=0)
     - `research_max_attempts` (int, default 2, ge=1)
     - `research_trace_ttl_days` (int, default 14, ge=1)

---

## TDD Evidence

### RED (Failing Tests)

**Command:** `cd apps/ai-service && .venv/bin/python -m pytest tests/research -q`

**Output before implementation:**
```
ERROR tests/research/test_models.py - ModuleNotFoundError: No module named 'app.research'
FAILED tests/research/test_research_config.py::test_research_defaults - AttributeError: 'Settings' object has no attribute 'research_enabled'
FAILED tests/research/test_research_config.py::test_research_mode_must_be_known - Failed: DID NOT RAISE ValidationError
```

**Why expected:** The config fields and models module did not exist yet.

### GREEN (Passing Tests)

**Command:** `cd apps/ai-service && .venv/bin/python -m pytest tests/research -q`

**Output after implementation:**
```
.................... 18 passed in 0.03s
```

**Detailed output with -v:**
```
tests/research/test_research_config.py::test_research_defaults PASSED
tests/research/test_research_config.py::test_research_mode_must_be_known PASSED
tests/research/test_models.py::test_field_shape PASSED
tests/research/test_models.py::test_unavailable_is_an_empty_low_confidence_field PASSED
tests/research/test_models.py::test_paused_run_still_holds_the_active_slot PASSED
tests/research/test_models.py::test_phase_one_node_order PASSED
tests/research/test_models.py::test_allowed_transitions[running-pause] PASSED
tests/research/test_models.py::test_allowed_transitions[queued-pause] PASSED
tests/research/test_models.py::test_allowed_transitions[paused-resume] PASSED
tests/research/test_models.py::test_allowed_transitions[pausing-stop] PASSED
tests/research/test_models.py::test_allowed_transitions[paused-stop] PASSED
tests/research/test_models.py::test_allowed_transitions[running-stop] PASSED
tests/research/test_models.py::test_rejected_transitions[paused-pause] PASSED
tests/research/test_models.py::test_rejected_transitions[running-resume] PASSED
tests/research/test_models.py::test_rejected_transitions[pausing-resume] PASSED
tests/research/test_models.py::test_rejected_transitions[completed-stop] PASSED
tests/research/test_models.py::test_rejected_transitions[stopped-resume] PASSED
tests/research/test_models.py::test_rejected_transitions[failed-pause] PASSED
```

All 18 tests pass with no warnings or noise.

---

## Self-Review Findings

**Completeness:** ✓ All spec items implemented exactly as written.
- All 11 settings fields with correct types, defaults, aliases, and validators.
- All enums, constants, type aliases, and functions per the brief.
- State machine validates both allowed and rejected transitions correctly.
- Field() and unavailable() produce the expected dict shapes with proper list conversion of source_urls tuple.

**Quality:** ✓ Code follows project conventions and existing patterns.
- Docstrings match style in rest of codebase.
- Type hints are precise (StrEnum, Literal, frozenset, dict).
- Comments in config.py explain the purpose and constraints of each setting.
- Exception class follows ValueError pattern for validation errors.

**Discipline:** ✓ No overbuilding; only what the spec required.
- No additional enums, functions, or fields beyond the brief.
- No unused imports or dead code.
- Pure module (app/research/models.py) has zero I/O, safe to import anywhere.

**Testing:** ✓ Tests are comprehensive and actually verify behavior.
- Config tests verify defaults AND validation (Literal type checking).
- Models tests verify dict shapes, enum membership, constants, and state machine transitions.
- Parameterized tests cover 6 allowed + 6 rejected transitions.
- Tests import from actual modules, not mocks.
- Test output is pristine (no warnings, deprecations, or noise).

**No issues or concerns detected.**

---

## Project Rules Compliance

- ✓ **No commits:** Changes left in working tree as per project rule.
- ✓ **No new dependencies:** All code uses Python stdlib + pydantic (existing).
- ✓ **File structure:** Followed the exact structure in the brief.
- ✓ **Test command:** Used specified pytest command: `.venv/bin/python -m pytest`.
- ✓ **Untouched files:** Only modified config.py and created research/ files. Did not touch any concurrent edits in the working tree.

---

## Files Summary

| Path | Type | Status |
|------|------|--------|
| `apps/ai-service/app/config.py` | Modified | Added import + 11 settings |
| `apps/ai-service/app/research/__init__.py` | Created | Docstring |
| `apps/ai-service/app/research/models.py` | Created | 4 enums, 5 constants, 2 functions, 1 exception |
| `apps/ai-service/tests/research/__init__.py` | Created | Marker |
| `apps/ai-service/tests/research/test_research_config.py` | Created | 2 tests |
| `apps/ai-service/tests/research/test_models.py` | Created | 16 tests |

---

## Deviations from the Brief

None. All code transcribed verbatim and all tests pass as specified.

---

## Next Steps (Not Part of This Task)

The implementation is foundation-complete for the pipeline:
- Config is ready to be fed to scheduler and job runners.
- Vocabulary is available for any module that needs RunStatus, ItemStatus, ACTIVE_RUN_STATUSES, check_transition, field(), or unavailable().
- Tests serve as golden reference for state machine rules and settings structure.

Task 2 (company-research service endpoints) can now import from app.research.models and app.config without any gaps.
