# Task 8 report

Implemented targets.py and runner.py verbatim from the brief, plus tests/research/test_targets.py (2) and test_runner.py (17 brief tests + 1 added seq test). Nothing committed.

## TDD evidence
- RED (brief tests): I wrote the implementation straight from the brief before running the tests, so no clean RED run of the brief tests exists (the Task 7 placeholders would have raised NotImplementedError / ImportError for TargetsUnavailable and RunActive).
- RED (controller seq ruling): with `start_seq=run.get("last_seq", 0)` restored, the new test fails: `ERROR app.research.trace.tracer: dropping 1 trace events (... seq 3-3): duplicate (run_id, seq)` and `assert ([1,2,3,...] == ...)`.
- GREEN: `.venv/bin/python -m pytest tests/research -q` -> 105 passed, 11 skipped. Full suite: 523 passed, 11 skipped, 1 failed (tests/test_config.py::test_interview_settings_have_defaults, the pre-existing local .env failure).

## Controller ruling
`_resume_seq(run)` = max(run.last_seq, await store.max_event_seq(run_id)), used in `_drive` and `_note`'s detached tracer. Test `test_resume_continues_event_seqs_after_a_crash_between_insert_and_last_seq_update` sets last_seq=2 with N stored events, resumes, and asserts seqs are 1..M with no gaps/dupes and the control.resume note is at N+1.

## Deviations from the brief
1. `test_one_company_failing_does_not_stop_the_others`: expected code_ref `app/research/nodes/resolve.py:resolve`, but the innermost pipeline frame is `app/research/gateway.py:extract_json` (the validation error is raised there since Task 7). Changed the test assertion.
2. `test_secrets_in_upstream_errors_are_redacted_everywhere` failed: `graph.py::_traced` wrote the raw exception text to `items.nodes.<name>.error`, leaking the Exa key. Fixed by adding a public `Tracer.redact(value)` (trace/tracer.py) and using it in graph.py for that field.

## Files changed
app/research/targets.py, app/research/runner.py, app/research/graph.py (1 line), app/research/trace/tracer.py (+ `redact` method), tests/research/test_targets.py, tests/research/test_runner.py.

## Fix round 1
Changes (all in app/research/runner.py; tests in tests/research/test_runner.py):
1. `_control_lock` + `_driving_run_id`. `_launch` sets it; `_drive` finalizes and clears it under the lock (failure path too); pause/stop/resume run under the lock and decide with `_driving_run_id == run_id` instead of `busy`. Test: `test_stop_during_drive_teardown_is_not_lost` (stop fired from the tracer flush after the run is already `paused`) ends `stopped`.
2. BudgetExhausted handler reads control under the lock: STOP -> item cancelled, control untouched; PAUSE -> paused, reason kept; NONE -> set PAUSE/PAUSING/budget_exhausted. Test: `test_budget_exhaustion_does_not_override_a_pending_stop`.
3. `_run_item_slot` never raises (logs, best-effort marks the item failed via `_fail_item_after_bookkeeping_error`); `_process_items` cancels and awaits all tasks on any exception before re-raising; the dispatcher's sem is released if `_control`/`_skip_inactive` raise; the failure path reconciles `running` items to failed (`RunFailed`) via `_fail_running_items`. Tests: `test_bookkeeping_error_in_one_company_fails_only_that_company`, `test_dispatcher_failure_cancels_in_flight_companies_and_fails_the_run` (both assert no leftover tasks).
Minors: `_drive` finally clears `_tracer/_budget/_active_run_id` only `if self._tracer is tracer`; `_finalize` turns a PAUSE with nothing queued/paused/running into `completed` (control reset; test `test_pause_with_nothing_left_to_resume_completes`); `test_drive_starts_its_tracer_past_the_highest_stored_seq` spies on Tracer(start_seq) with `_note` stubbed; the redaction test now also dumps payloads, sources, extracts, company_states and drafts.
Commands: `.venv/bin/python -m pytest tests/research -q` -> 111 passed, 11 skipped. Full `.venv/bin/python -m pytest -q` -> see below (only the known test_config .env failure expected).
I did not capture separate RED runs for the new tests (written together with the fixes).

## Fix round 2
(a) tracer.py: `_flush_loop` runs each periodic flush as `await asyncio.shield(self.flush())`. Test `test_close_mid_flush_stores_every_event_exactly_once` (slow insert_events, close mid-flush): RED with shield removed (`assert [16] == [1, 2, 3, ...]`, events lost), GREEN with it; 16 events stored once, last_seq 16, no "duplicate" log.
(b) runner.py: new `_teardown(run_id, tracer)` closes the tracer, clears `_tracer/_budget/_active_run_id`, then clears `_driving_run_id`, all inside the same `_control_lock` block that finalizes (success and failure paths); `finally` only tears down if neither path did. Later notes use a detached tracer past a fully flushed seq. Tests with a 5 ms-latency store firing stop()/resume() as soon as the run is paused: `test_stop_during_drive_teardown_is_not_lost` (rewritten: the hook schedules stop() as a task, since awaiting the lock from inside the flush would deadlock) and `test_resume_during_drive_teardown_is_recorded_and_runs` assert the control event is stored once, seqs contiguous, last_seq equals the event count, and the final status is right.
(c) budget.exhausted message now says "stopping the run", "the run is already pausing; raise the cap, then resume", or "pausing the run; raise the cap, then resume" depending on the branch.
Commands: `.venv/bin/python -m pytest tests/research -q` -> 113 passed, 11 skipped.
Full suite `.venv/bin/python -m pytest -q | tail -4`:
```
tests/test_config.py:92: AssertionError
=========================== short test summary info ============================
FAILED tests/test_config.py::test_interview_settings_have_defaults - Assertio...
1 failed, 531 passed, 11 skipped in 23.14s
```
