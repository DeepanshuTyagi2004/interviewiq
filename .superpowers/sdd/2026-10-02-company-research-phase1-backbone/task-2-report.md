# Task 2 Implementation Report: Redaction and error capture

## Summary

All Task 2 deliverables completed successfully. Redaction and error capture infrastructure is in place.

## Deliverables

### Files created

**Trace module:**
- `apps/ai-service/app/research/trace/__init__.py` — module marker with docstring
- `apps/ai-service/app/research/trace/redact.py` — secret redaction and header masking
- `apps/ai-service/app/research/trace/errors.py` — exception introspection for debugging

**Tests:**
- `apps/ai-service/tests/research/test_redact.py` — 5 test cases
- `apps/ai-service/tests/research/test_errors.py` — 2 test cases

### Test results

All 7 new tests pass. Full research module suite (25 tests) passes:

```
tests/research/test_redact.py::test_redacts_secret_values_wherever_they_appear PASSED
tests/research/test_redact.py::test_redacts_auth_headers_by_name_case_insensitively PASSED
tests/research/test_redact.py::test_leaves_non_string_scalars_alone PASSED
tests/research/test_redact.py::test_tuples_become_lists_and_input_is_not_mutated PASSED
tests/research/test_redact.py::test_secrets_from_settings_names_each_llm_key_and_skips_short_values PASSED
tests/research/test_errors.py::test_error_info_points_code_ref_at_the_innermost_research_frame PASSED
tests/research/test_errors.py::test_code_ref_is_none_outside_the_research_package PASSED

.......                                        [100%]
7 passed in 0.03s (target suite: 25 passed in 0.03s)
```

## Implementation notes

**redact.py:**
- `redact(value, secrets)`: Recursively scrubs secret values and auth header keys from nested structures. Tuples become lists; non-string scalars pass through unchanged.
- `secrets_from_settings(settings)`: Extracts named secrets from config, skipping values shorter than 6 characters (prevents false positives in redaction).
- Two-pass approach: auth headers by name (case-insensitive), then string values by content match.

**errors.py:**
- `code_ref(exc)`: Walks exception traceback in reverse to find the innermost frame in `/app/research/` and returns `path:function_name` for IDE jump-to-code.
- `error_info(exc)`: Produces structured dict with type, message (capped at 2000 chars), traceback (capped at 20k chars), and code_ref.

## State

All changes uncommitted, per checkpoint step. `git status` shows the new `apps/ai-service/app/research/` and `apps/ai-service/tests/research/` directories as untracked.

## Readiness

Task 2 is complete and ready for integration into the research pipeline. No blockers. All 7 tests passing; dependency on Task 1 (check_transition, InvalidTransition, config.Settings) verified working.
