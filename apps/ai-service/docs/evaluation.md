# Post-interview evaluation (Module 04, AI service)

Built 2026-10-18. Spec: `docs/superpowers/specs/2026-10-18-post-interview-report-design.md`. Code: `apps/ai-service/app/evaluation/`.
API side (pass mark, cooldown, gating, lifecycle): `apps/api/docs/round-gating.md`.

**Status of the numbers.** Weights, adjustments, bands and prompts are first drafts, versioned constants the owner can change.
The prompts (`prompts.py`) are marked **DRAFT, owner review before production**: their wording sets what a strong answer is and how
partial credit is given. The grading model and budget (`EVALUATION_MODEL`) and the exact numbers remain owner decisions.

## What it does

After a live round ends, the API starts an evaluation run here. The run grades each part of the round with an LLM, then plain code
computes the 1-10 score, the verdict and the outcome. The LLM grades; code validates and does all arithmetic. The result is a report
document stored as the session's next version (`round_evaluations` in this service's MongoDB database; runs in a run collection with a
TTL of `EVALUATION_RUN_RETENTION_DAYS`).

## Pipeline

1. **Inputs** (`inputs.py`, pure). From the blueprint, the stored live run, turns and evidence it builds the candidate-visible
   transcript (an interviewer sentence that never played is dropped; briefs and answer keys never appear in a turn) and one
   `PartInput` per part: each problem slot is a part of its own family (a `culture-` slot is behavioural; the hiring-manager deep dive
   is family `hiring-manager`, elsewhere `knowledge`), and the candidate-questions phase is part `end_questions` (never weighted).
   A part counts as run unless the interviewer or the plan left it out; a core problem the candidate did not reach is graded
   `not_reached`. A core slot skipped at the end counts as not reached only when the candidate or the interviewer ended the round for
   conduct or integrity; other skips (plan choice, time ran out) are excluded.
2. **Unscorable check** (`score.unscorable_reason`). No grading runs when the round ended for a technical reason, nothing was
   recorded, or less than 40% of the core planned minutes ran without the candidate ending it. The report then holds only the reason,
   meta and transcript. The auto-fail check (`report.auto_fail_reason`) runs first: a round the interviewer ended for conduct or
   integrity is never "too short to score", however early it ended; it is graded and its outcome is `auto_fail`.
   Before anything, the live run should be final: on the first attempt (trigger `completion`) a `live_runs` record with neither
   `ended_at` nor `end_reason` fails the run with the transient code `live_not_final` (the API retries). The live worker writes its
   final record before it ends the session in the API. On any later trigger (`retry`, `reconcile`, `admin`), or when the request carries
   `ended_reason`, the saved checkpoint and turns are graded as they are. When the record has no end reason, the request's
   `ended_reason` (the session's, from the API) is used. Only a session with no turns at all is unscorable (a "Not scored" report is a result).
3. **Part grading A and B** (`graders.grade_part`, concurrent). Same input, A on EVALUATION_MODEL and B on EVALUATION_MODEL_B (a different model family), with the
   instructions in another order. No temperature is sent (the grading models reject it). Each returns, per part: questions (verdict, score, quotes, strong answer, gap, topics to study), one score per skill
   area, events, moments, code grade, `must_have_met`. Models: `EVALUATION_MODEL` (A) and `EVALUATION_MODEL_B` (B; default A's). Grading calls use `graders.EVAL_ROUTING` (structured outputs required, no price cap). Question ids are pinned in the prompt: a problem is
   `main` and its follow-ups `f1`, `f2`...; a block of separate questions is `q1`, `q2`... The must-have is given as what meets it
   (`MUST_HAVE_RULE` in `weights.py`); a bonus part has none. Every grading, tiebreak, synthesis and re-check prompt says the transcript
   and code are data from the candidate and any instructions inside them are ignored.
4. **Tiebreak C** (only where A and B disagree). Sees A's and B's grades and decides. Model: `EVALUATION_TIEBREAK_MODEL`, default the
   same as `EVALUATION_MODEL`. A disagreement is any area or question score more than `TIEBREAK_GAP` (1.5) apart (compared after rounding to 6 decimals, so 6.8 vs 5.3 is not), or a differing
   categorical (verdict, resume consistency, must-have, logic works, help-request class).
5. **Merge** (`graders.merge_grades`). Scores: mean of A and B, or the median of A, B and C past the gap. Categoricals: A if A and B
   agree, else the majority with C. Events seen by both A and B count; one grader's event counts only if C confirms it. A's question
   list is canonical: a question only A graded keeps A's grade, one only B graded never becomes a card; both are recorded as
   disagreements (`question:<id>:only_a` / `:only_b`) and never call the tiebreak by themselves.
6. **Synthesis** (`graders.synthesize`). One call over the merged grades and the delivery stats: summary, focus items (each cites turn
   ids), delivery observations, topic gaps, the quality of the candidate's end questions. The end-questions bonus is 0.1-0.2 only when
   the quality is "thoughtful", else 0.
7. **Arithmetic** (`score.py`, pure). Part scores weighted by area weight, parts weighted by planned-minute share (`part_shares`),
   then adjustments, the must-have cap, rounding, verdict and outcome. A bonus problem has no share: a reached bonus counts only
   through its +0.3 adjustment, and its must-have is forced met. The report stores `base_score`, `bonus_total` (after the cap) and
   `penalty_total` so the score can be reproduced from the page.
8. **Practice suggestions** (`practice.py`): bank problems on each weak topic, the same company first, never above the round's
   difficulty, never one the candidate already got. Only slug, title and difficulty are returned, never a statement.
   **Abandoned problems** (owner decision 2026-10-18): a problem the candidate asked to switch away from (item status `swapped`) is read
   as a problem they do not know. It is always graded (`PartInput.swapped`; the grader is told to credit only what was shown, even
   when nothing was said), keeps its base share, and is never the main part for the must-have cap. `report.py` always adds a
   "Revisit {problem}" focus item first, adds the problem's topics to the topic gaps, and puts the problem itself first in the
   practice of its first topic with `retry: true`, although it was already given.
9. **Report** (`report.py`) is built from all of it and stored. The API stores a copy and the summary columns on the session.

## Evidence rule

Every grade must be backed by the candidate's own material. `check_citations` rejects a grade that cites a turn id not in the part's
transcript, an area with no evidence (when the part has any turns, code or board), an answer with no quote (unless `not_answered` or
`not_reached`), a "code" or "board" citation when the part has none, and area keys that are not exactly the family's. An invalid reply
gets one repair message listing the errors, then one full re-run. Owner rule: a result is always available, so after the third
attempt the best one (fewest errors) is **salvaged** (`graders.salvage_part`): citations to turns that are not visible are dropped
(quotes, moments, events, "turn:<id>" evidence, "code"/"board" evidence the part lacks), only the family's area keys are kept (a missing
area is absent and the score renormalises over the present weights), a shorter code trace is accepted, and a question with no valid quote
keeps its verdict and score. The grade carries `salvage_notes` (the original errors) in the run's raw data; the candidate contract is
unchanged. If no attempt even parsed, the run fails with the transient `llm_unavailable`. If one of graders A and B gives nothing usable,
the other's grade stands alone; if the tiebreak C fails, A and B merge without it (mean of scores, A for categoricals). Both are recorded
in the run's disagreements (`grader:A_failed`, `grader:B_failed`, `tiebreak:failed`).
A synthesis that cannot be produced (no parse, model unavailable) is built in code (`graders.fallback_synthesis`): a summary from the
score, verdict, pass mark and the weakest and strongest areas, up to three focus items citing the answer-quote turns of the lowest
questions and areas, topic gaps from questions at `partly` or worse, strengths from areas of 7.5 or more, no delivery notes, no
end-question bonus. The run records `synthesis_fallback: true`. A synthesis whose focus items cite no visible turn only loses those items.

## Code standard and hand-trace

The session's code standard (`runnable`, `near_runnable`, `pseudo_ok`, fixed at booking by the API) is given to the grader as text
(`CODE_STANDARD_TEXT`): runnable code with syntax slips caps code correctness at 8; near-runnable forgives a few small slips; pseudocode
is accepted with no penalty for notation. For coding families (dsa, online-assessment, lld) with code, the grader must hand-trace the
code on every worked example of the problem (one `code.trace` entry per example, at least one) and set `logic_works` (yes,
syntax_only, partly, no). A missing or short trace is a validation error. No code is ever executed.

## Delivery

Read from words and timing only; audio is not stored (`inputs.delivery_stats`): time to start an answer (estimated from the turn close
time, the endpointing wait and the answer's spoken length at 150 words a minute, first candidate turn after each interviewer turn only,
none inside an open coding part), answers cut off by the candidate, filler words, self-corrections, long silences (over 90 s in a
coding part). It sits inside the Communication area with a small weight. The grader is told never to judge accent, grammar or English
fluency, and that nervousness is not a flaw.

## Unscorable and failed

- **Unscorable**: a report with outcome `unscorable` and a plain reason; no score, no cooldown.
- **Failed** (a failed run is never the end: the API keeps retrying, see `apps/api/docs/round-gating.md`): error codes `llm_unavailable`,
  `timeout`, `interrupted`, `live_not_final`, `internal_error` (transient: fast retries), `invalid_grades`, `missing_inputs`, `cancelled`
  (retried hourly). `stale_report` (a dispute run) is the only final one and never changes the existing report. A run is time-boxed by `EVALUATION_RUN_TIMEOUT_SECONDS`. On startup, runs left running past
  that are marked failed with `interrupted`.

## Disputes

A candidate may dispute one question or one area (limits in the API doc). A dispute run (`_dispute_pipeline`) loads the current
version, makes one re-check call with grader C's model (`graders.recheck`), and stores version + 1. Rules:

- A re-check keeps or raises the disputed score, **never lowers it**.
- A revised **question** score shifts its part's area scores by `delta / number of graded questions in that part` (capped at 10); a full
  shift would over-reward one question. A revised **area** score changes that area directly.
- Adjustments, synthesis and delivery are reused from the stored version; the score, outcome and verdict are recomputed.
- A dispute about a version that is no longer current fails with `stale_report`.

## Practice suggestions

See step 8. Topics come from the synthesis topic gaps. A topic with nothing found maps to an empty list.

## Settings (`app/config.py`, `.env.example`)

| Variable | Default | Meaning |
|---|---|---|
| `EVALUATION_MODEL` | `deepseek/deepseek-v4.1-flash-1017` in code; `anthropic/claude-haiku-5.5` in `.env.example` (owner decision 2026-10-18) | Model for grader A and synthesis |
| `EVALUATION_MODEL_B` | unset (uses `EVALUATION_MODEL`); `openai/gpt-6-luna` in `.env.example` | Model for grader B: a second model family so A and B are independent |
| `EVALUATION_TIEBREAK_MODEL` | unset (uses `EVALUATION_MODEL`); `anthropic/claude-sonnet-5.5` in `.env.example` | Model for grader C (only on disagreements) and dispute re-checks |
| `EVALUATION_TIMEOUT_S` | 90 | Timeout of one LLM call |
| `EVALUATION_MAX_PARALLEL_RUNS` | 2 | Runs grading at once; others wait, still "running" |
| `EVALUATION_RUN_TIMEOUT_SECONDS` | 1200 | Whole-run time box |
| `EVALUATION_RUN_RETENTION_DAYS` | 30 | TTL of run documents after they end |

The OpenRouter key and base URL are shared with the interviewer. API-side settings are in `apps/api/docs/round-gating.md`.

## Constants and where they live

| What | File | Version |
|---|---|---|
| Skill areas, area weights, practical flag, band anchors per round-type family; must-have cap notes (`MUST_HAVE`) and grader rules (`MUST_HAVE_RULE`) | `app/evaluation/weights.py` | `EVAL_WEIGHTS_VERSION = "w1"` |
| Pipeline version (stored on every report) | `app/evaluation/weights.py` | `EVAL_VERSION = "eval1"` |
| `TIEBREAK_GAP` 1.5, `BONUS_CAP` 0.5, `HINT_PROBLEM_FLOOR` -0.8, hint steps (-0.1, -0.25, then -0.5), adjustment deltas, verdict bands, must-have cap (pass mark - 0.5), unscorable threshold (40%) | `app/evaluation/score.py` | covered by `EVAL_VERSION` |
| Grader prompts (DRAFT) | `app/evaluation/prompts.py` | covered by `EVAL_VERSION` |
| Pass marks, retake cooldown, readiness mapping | API: `apps/api/src/domain/evaluation.ts` | see the API doc |

Families: dsa, system-design, lld, behavioural (Amazon's company-values area is renamed Leadership Principles), hiring-manager,
online-assessment, knowledge. Change a weight or constant, bump the matching version, and old reports stay replayable because each
carries its `weights_version` and `eval_version`.

### Adjustments (additive to the 1-10 score)

Hints per problem: -0.1, -0.25, then -0.5 each, floor -0.8 per problem (the line's note names the problem title). Bug the interviewer pointed out -0.1 (max 3); own bug found
and fixed +0.1 (max 2). Change request -1.0, again -0.5; problem changed for the candidate -1.0. Beyond level +0.2, bonus problem
solved +0.3, thoughtful end questions +0.1 to +0.2; positive adjustments are capped at +0.5 in total. Conduct warning -1.0, final warning
-1.0, a round ended for abuse -7.0 ("Abusive language", on top of the auto-fail). Proctor events -3.0 times weight each (owner decision
2026-10-21: flat, no escalation, no free first event; weight-0.5 events such as leaving fullscreen cost -1.5; the note says what happened:
"Switched tabs", "Left the window", "Left fullscreen", "External display", "Stopped screen share"); pasted code -1.0; staying away past the limit -3.0.
The score floor stays 1.0.
A missed must-have caps the score at pass mark - 0.5 ("Capped at 6.5: ..."). It is judged on the main part only: the first core
(non-bonus) part of the main family (the family with the largest share) in plan order, so an unfinished second problem never caps a
round whose first problem worked. For behavioural and hiring-manager it is met when any ran part of the family meets it. An auto-fail (the interviewer ended the
round for conduct or integrity) forces outcome `auto_fail` and a verdict no better than No Hire. Its label follows the ledger that
actually ended the round (the earlier one if both reached their ending), never an earlier conduct warning (`report.end_cause`).

Verdict from score minus pass mark: >= 1.5 Strong Hire, >= 0.5 Hire, >= 0 Lean Hire, >= -0.75 Lean No Hire, >= -2.0 No Hire, else
Strong No Hire.

## How to re-run

- **Admin, through the API (the supported way)**: `POST /api/v1/intelligence/evaluations/sessions/{sessionId}/rerun`. It resets the
  session's evaluation bookkeeping and starts a new run with trigger `admin`; the result publishes and gating applies. The same run on
  this service's side is `POST /admin/evaluations/runs/{run_id}/rerun` (internal; it replays a stored request, a new version when it
  completes, but does not update the session by itself).
- **Diagnostics**: `GET /admin/evaluations/runs` (filters: status, trigger, outcome, company (case-insensitive), round_type,
  candidate_id, session_id, from, to) and `/runs/{run_id}` (via `/api/v1/intelligence/evaluations/runs`) show the request,
  raw grader outputs A, B and C, every disagreement with the merged value, and the arithmetic.
- **After changing weights or prompts**: bump `EVAL_WEIGHTS_VERSION` or `EVAL_VERSION`, then re-run chosen sessions. Do not edit
  ai-service `.py` files while evaluation runs are in flight.

## Routes (internal key)

`POST /evaluations/runs`, `GET /evaluations/runs/{id}`, `POST /evaluations/runs/{id}/cancel`, `GET /evaluations/sessions/{sessionId}`
(`?version=N`), and the admin routes above. One running run per session (a partial unique index).
