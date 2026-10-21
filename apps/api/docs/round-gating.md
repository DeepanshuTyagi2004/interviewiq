# Round score, pass mark and gating (Module 04, API)

Built 2026-10-18. Spec: `docs/superpowers/specs/2026-10-18-post-interview-report-design.md`. Grading itself is in
`apps/ai-service/docs/evaluation.md`. This page covers what the API decides and enforces. Constants live in
`apps/api/src/domain/evaluation.ts` and `apps/api/src/domain/process.ts`. They are versioned product constants the owner can change;
the exact numbers remain owner decisions.

## Pass mark

`passMark({level, tier, difficulty})` in `domain/evaluation.ts`:

- Base by engineering level (`PASS_BASE`): intern 6.0, fresher 6.0, sde1 6.5, sde2 7.0, sde3 7.5, staff 7.5, principal 7.5,
  distinguished 7.5. An unknown level uses sde1.
- Plus company tier: tier 1 +0.5, tier 2 +0.25, else 0.
- Plus 0.25 for a hard round.
- Clamped to 5.5-8.5, one decimal, half up.

**Fixed at booking** and never recomputed: the session stores `pass_mark`, `code_standard`, `company_tier` and `round_difficulty`
(`services/interviewSessions.ts`), so later edits to a company never change a booked round. Difficulty comes from the loop node for loop
bookings; for non-loop JD bookings it comes only from the admin-published brief (the AI brief is not fetched at booking, so booking stays
fast and offline from the AI service), and null means no hard bonus. Sessions booked before this shipped get the snapshot computed once at
evaluation time (`RoundEvaluationService.withSnapshot`) and stored. The pass mark is shown before the round and with the result.

## Code standard

`codeStandardFor(tier, businessModel, override)`: an admin override on the company (`companies.code_standard`) wins. Otherwise tier 1 or
2 with a product or hybrid business model is `runnable`; tier 4 or a service model is `pseudo_ok`; everything else is `near_runnable`.
The AI service turns it into grading text.

## Outcome and cooldown

Outcomes: `passed` (score >= pass mark), `below_pass`, `auto_fail` (the interviewer ended the round for conduct or integrity; never
unscorable, however early it ended), `unscorable`.
`retakeAfter(outcome, score, passMark, evaluatedAt)`: below pass by less than 1.0 gives 7 days; by 1.0 or more, or `auto_fail`,
gives 14 days; `passed` and `unscorable` have no cooldown. The server enforces it; the UI only reflects it. A failed evaluation
sets no cooldown (and is retried hourly, never final). A dispute never restarts the clock: the cooldown is counted from the original evaluation time, and a flip
to `passed` clears it.

## Node states and precedence

`nodeStates` in `domain/process.ts`: `locked`, `available`, `booked`, `evaluating`, `passed`, `cooldown`, `completed` (legacy).
Precedence: passed or completed > booked > evaluating > cooldown > available or locked. A round is available once every round feeding
into it is passed or legacy completed. Passed is sticky: a later attempt never re-locks anything. A node whose latest finished attempt
has evalStatus pending or running is `evaluating`. Cancelled and aborted sessions free the node.

## Legacy sessions

A COMPLETED session with no `eval_status` or `eval_status = legacy` was finished before grading existed. Migration
`drizzle/0011_round_evaluation.sql` marks existing completed sessions `legacy`. It is not scored, shows no report ("legacy" status), and
counts as passed for gating and progress (state `completed`).

## Readiness levels (official loops only)

`readinessLevel(passed, total)`: all rounds passed is `interview_ready`; none is `getting_started`; one left is `nearly_ready`; else
`progressing`. Rounds passed only, not score height. Only unedited, suggested (official) loops count (`countsTowardReadiness`); an
edited loop is standalone, gets full analysis and never counts, and its report carries no readiness. Copy is always framed as
mock-interview readiness, never as a badge or a company endorsement.

## Evaluation lifecycle

`interview_sessions.eval_status`: `pending` (round ended with no run attached, or a retry is queued), `running` (a run is attached and tracked by `eval_run_id`), `ready`, `unscorable`, `failed`, `legacy`. Other columns: `eval_run_id`, `eval_run_started_at`,
`eval_attempts`, `eval_retry_window_start`, `eval_error_code`, `score`, `outcome`, `verdict`, `retake_after`, `eval_version`,
`evaluated_at`.

1. The round-end hook calls `RoundEvaluationService.start` at once. The status is `pending` until a run is attached; `attachEvalRun` claims the session (so replicas are safe) and moves it to `running`. It claims only a COMPLETED session whose status is `pending` or `failed` with no run attached, so a round that turned out to be a technical end (unscorable) or that already has a report is never revived. A transient failure or an admin re-run puts it back to `pending`. The run request carries the session's end reason (`ended_reason`); the AI service uses it when the live run's own record has none.
   A start that fails (the AI service unreachable, the request not assembled) leaves the session `pending` with `eval_error_code =
   start_failed` and counts in `eval_attempts`; after 3 start failures in a row (`MAX_START_FAILURES`) the session is parked as `failed`
   (no cooldown, free retake) and starts again an hour later, indefinitely: a result is always available.
2. `EvaluationReconcileJob` (`jobs/jobs.ts`, every `EVALUATION_RECONCILE_INTERVAL_MS`, default 60 s) starts pending sessions that have no
   run, collects finished runs and dispute re-checks, times out stuck runs, and retries every failure but `stale_report`.
3. **Timeout**: a run still running after `EVALUATION_RUN_TIMEOUT_MINUTES` (default 20) is cancelled and handled as a `timeout` failure.
4. **Retries** (owner rule: a result is always available): transient codes (`llm_unavailable`, `timeout`, `interrupted`, `internal_error`,
   `live_not_final`: the interviewer worker had not written its final record of the round yet) retry at once, `EVALUATION_AUTO_RETRIES`
   (default 2) per rolling hour. After that, or on any other code (`invalid_grades`, `missing_inputs`, `cancelled`, `start_failed`), the
   session stays `failed` between attempts (no cooldown, the round is available again, the report page shows "taking longer than usual")
   and the reconcile job starts a fresh run once the rolling hour has passed, for as long as it takes. Only `stale_report` is never
   retried. `report()` answers `failed` meanwhile; the web page polls every 30 s and the report appears when it lands. An admin can also re-run.
5. A run whose id the AI service no longer knows (404) is detached and restarted.

Admin re-run: `POST /api/v1/intelligence/evaluations/sessions/{sessionId}/rerun` (`RoundEvaluationService.rerun`) resets the bookkeeping
and starts a run with trigger `admin`, so the result publishes and gating applies. Diagnostics: `GET /api/v1/intelligence/evaluations/runs`
and `/runs/{runId}`.

## Disputes

Candidate disputes one question or one area with a reason of 1-500 characters. Limits, all enforced by the API with a 409 or 400:

- The report must be `ready` (not unscorable, failed, evaluating or legacy).
- Within 14 days (`DISPUTE_WINDOW_DAYS`) of the first report. The window is enforced by the API only, so a candidate may try once after
  day 14 and see a plain message.
- At most 3 disputes per report (`MAX_DISPUTES`), one per target; a target already disputed, or a re-check in flight, is refused.
- The target must exist in the latest report version.

A dispute starts a `dispute` run; the session stays `ready` while it runs, so gating is never re-locked. The disputed target is
remembered on the report version (`round_reports.recheck`); while the run is attached the report carries `recheckPending: true` and
`recheckTarget`, the web polls every 5 s and shows "Re-checking…" on that target with every dispute button hidden, and the decision
appears inline when the new version lands. The result is a new report
version and a recomputed score, outcome and verdict. A re-check can only keep or raise a score. A failed re-check leaves the report as
it was and the candidate may dispute again.

## Endpoints

- `GET /api/v1/interviews/sessions/{sessionId}/report`: the camelCase report with top-level `status` (`evaluating`, `failed`, `legacy`,
  `ready`), plus `retakeAfter`, `nextRound` (only after a pass), `readiness` (official loops only), `recheckPending` / `recheckTarget`,
  and the score build-up `baseScore`, `bonusTotal` (after the +0.5 cap) and `penaltyTotal`, so the page shows
  "Base · Bonuses · Penalties · Cap · Score". Delivery stats `slowStarts` and `longSilences` are counts. No wrapper.
- `POST /api/v1/interviews/sessions/{sessionId}/report/disputes` body `{target: {type: "question" | "area", id}, reason}`: 202
  `{status: "rechecking"}`.
- `GET /api/v1/intelligence/evaluations/runs`, `GET .../runs/{runId}`, `POST .../sessions/{sessionId}/rerun`: admin only.

The web report page is `apps/web/app/(app)/interviews/[sessionId]/report/` (score build-up, per-question cards with the strong answer,
delivery, conduct, topics to work on, transcript with jump-to-moment, dispute dialog). The score and report are shown on the result page
only, after the round. Types come from `packages/contracts/openapi.yaml`.

## Settings (`apps/api/src/config.ts`)

`EVALUATION_RECONCILE_INTERVAL_MS` 60000, `EVALUATION_RUN_TIMEOUT_MINUTES` 20, `EVALUATION_AUTO_RETRIES` 2.
