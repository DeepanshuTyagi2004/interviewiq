# Post-interview report, round score and gating (Module 04): design

Status: design, 2026-10-18. Owner decisions from the brainstorm are marked **(decided)**; calls made by the author
are marked **(author's call)** and can be overridden in review.

## 1. Why

A candidate finishes a mock round and today sees a placeholder ("Scoring isn't live yet"). The product promise is a
debrief that reads like a real interviewer's feedback packet: what was asked, what they answered, what a strong answer
would have been, what to study, how they came across, what went wrong in conduct or integrity, and one score against a
pass mark that decides whether the next round of the loop opens.

Fairness is the core requirement. **A candidate who thinks the score is unfair must be able to see exactly why**:
every point lost is tied to a moment in the round, with the strong answer and how to improve **(decided)**.

## 2. Goals

1. After every completed round, produce a scored, explained report automatically (background job, minutes not hours).
2. One round score on a **1-10 scale with one decimal**, compared with a **pass mark on the same 1-10 scale**
   **(decided: 1-10; one decimal is the author's call)**. Both are shown only on the result page after the round
   **(decided)**; the pass mark is also shown on the round page before the round starts (author's call).
3. The pass mark depends on the role level, the company tier and the round difficulty **(decided)**, is fixed at
   booking and never moves after (author's call).
4. Round-type-specific skill areas with round-type-specific weights **(decided)**, with partial credit everywhere: each
   area and each answer is scored on the 1-10 scale, not right/wrong **(decided)**.
5. Explicit penalties and bonuses for discrete events (help taken, going beyond, conduct, integrity) **(decided)**.
6. Gating: score ≥ pass mark unlocks the next round; below it, a retake after a cooldown (server-enforced).
7. All twelve realism features in §6 ship in this module **(decided: "all of these looks good")**.

## 3. Non-goals

- Interview-score aggregation across rounds/loops (a profile-level interview score), leaderboards, the shareable
  readiness report. Readiness *level* is computed (§10) but the shareable report is a later module.
- Audio-based tone analysis. Audio is not stored and STT word confidence is dropped today; delivery is read from words
  and timing only (§7.6).
- Running candidate code. **No sandbox (decided)**: code is graded by the LLM.
- Live (in-round) scoring visible to the candidate **(decided: result page only)**.
- Changing the live interviewer's behaviour beyond recording the data the report needs (§9).

## 4. Anti-goals (a failure even if it works)

- A score the candidate cannot trace: any point without a quoted moment or a named event.
- Penalising accent, English fluency or nervousness heavily. First market is Tier 2/3 Indian students; delivery sits
  inside Communication with a small weight and the grader is told explicitly not to judge accent or grammar.
- Penalising good interview behaviour: asking for constraints, clarifying, asking to repeat cost **0 (decided)**.
- An LLM deciding the final number. The LLM grades; code does the arithmetic (§7.1).
- Badge or endorsement wording. Never "Cleared Meesho"; always "mock" framing (e.g. "Passed · Meesho SDE1 mock round 2").
- Different scores for the same round on re-grading beyond the two-grader tolerance (§7.3).

## 5. Who decides what

| Thing | Decided by |
|---|---|
| Skill-area scores 1-10, per-question verdicts, quotes, ideal answers, gaps, topics, moments, "self-found bug", "edge case raised", clarification vs help-request classification, delivery reading, level-calibrated remarks | LLM grader |
| Weights, part shares, adjustments, caps, clamp, pass mark, verdict, outcome, cooldown, gating, readiness level | Code (deterministic) |
| Hints given and their depth, problem-change requests, warnings, integrity events, timings, silences | Code, from what the round recorded |

## 6. The twelve features (all in scope)

| # | Feature | Who decides |
|---|---|---|
| 1 | Hiring verdict next to the number (Strong No Hire … Strong Hire) | Code, from score − pass mark (§8.4) |
| 2 | Judged against the level ("at SDE2 you'd be expected to raise trade-offs yourself") | LLM, given the level band text |
| 3 | Credit for recovery (wrong start, self-corrected) | LLM |
| 4 | Help weighed by what it gave away (hint depth; self-found vs pointed-out bugs; clarification ≠ help) | Both |
| 5 | Unprompted good habits (edge cases, complexity, dry run, thinking aloud; long silent coding) | Both |
| 6 | Two independent graders + tiebreak | Code orchestrates, LLM grades |
| 7 | Marked moments in the transcript (hint, warning, strong moment, bug, …) with jump links | Both |
| 8 | Weak topics linked to unseen practice problems from the bank | LLM names topics; code finds problems |
| 9 | Progress across retakes (per-area 5.9 → 7.2) | Code |
| 10 | Unscorable rounds said plainly, free retake | Code |
| 11 | Quality of the candidate's own questions at the end | LLM |
| 12 | "Question this score" re-check | LLM re-check; code recomputes |

## 7. How a round is graded

### 7.1 Principle

The LLM returns structured grades with evidence; code validates them and computes everything numeric. A grade without
at least one quoted candidate turn id (or, for code/board areas, a reference to the code or board) is rejected and that
call is repaired once, then re-run once; if still invalid the run fails (transient retry rules in §11.3).

### 7.2 Inputs (per session)

From the AI service's own stores (already recorded, plus §9 additions):
- **Blueprint**: slots (problem content, answer key, expectations must_show/strong/weak, evaluation_signals, hint
  ladder), round questions (fundamentals with expected answers), resume probes (with profile source), global signals,
  shape, realism, persona, `duration_mins`.
- **Live run**: checkpoint items (status, ended_at, ended_by, hint_step, turns), refusals, change_requests,
  changes_round, gave_up_items, warnings_given, conduct ledger, proctor ledger, away episodes, flow_log, signals
  (director problem_signal), extensions; `live_turns` (speaker, text, at, item_id, timings, interrupted); `live_evidence`
  (director observations per item/signal with turn ids); `live_briefs`.
- **Per-problem code and final board** (§9).

From the API in the run request: session meta (company, role, level, round type, round minutes, pass mark, code
standard, company tier, difficulty), whether the loop is official, the candidate's minimal profile (resume skills,
projects, experience lines; for resume-claim checks), the previous attempt's per-area scores for the same node (if any),
and the candidate's seen problem slugs (exclusions for practice suggestions).

### 7.3 LLM calls

**A. Part grading (one call per graded part × 2 graders).** A *part* is a blueprint goal that actually ran: a coding
problem, a design problem, an LLD problem, a fundamentals block, a resume/project deep-dive, a behavioural question
group, the candidate-questions phase. Input: the part's question(s) and reference material, the band anchors (§7.5) for
the areas this part feeds, the transcript turns of that part (with turn ids), the director's evidence notes for the
part, the code for that problem (with language) or the board summary, the level band text, the company code standard,
how many minutes the part was planned for and actually took, and how it ended (and who ended it). Output (strict JSON,
pydantic-validated):
- per question: `asked` (what was asked, short), `answer_quotes[]` (turn ids + short quotes), `verdict`
  (`correct|mostly|partly|wrong|not_answered|not_reached`), `score` 1-10, `strong_answer` (what a strong answer covers,
  grounded in the reference), `gap` (what was missing or wrong, specific), `topics[]` (subject + topic, e.g.
  `{subject:"DSA", topic:"Graphs: topological sort"}`), `resume_consistency` for resume/project questions
  (`consistent|unsupported|contradicts|n/a` + note).
- per skill area this part feeds: `score` 1-10 + `evidence[]` (turn ids/quotes or `code`/`board` refs) + one-line reason.
- for code: `trace[]`: for each provided example, the grader's hand trace and the output it predicts the code gives,
  and `expected`; `logic_works` (`yes|syntax_only|partly|no`), `syntax_slips[]`, `complexity_stated_by_candidate`,
  `actual_complexity`.
- events: `self_found_bugs[]`, `pointed_out_bugs[]`, `unprompted_edge_cases[]`, `unprompted_complexity`,
  `unprompted_dry_run`, `recovery` (a wrong start the candidate corrected on their own), `beyond_level` (a better
  solution than the level expects), `help_requests[]` each classified `clarification|repeat|help` (only `help` counts
  as a hint request; hints themselves come from the recorded ladder).
- moments: `{turn_id, kind: strong|weak|bug|recovery|edge_case, note}`.
- `must_have_met` for the part (§8.3).

**B. Round synthesis (one call, grader A's results + both graders' area scores as input).** Produces: the
level-calibrated summary (3-5 sentences), top strengths (≤3), the **focus list** (3-5 prioritised "work on" items each
linked to the moments that justify it), topic gaps grouped by subject, the delivery reading (§7.6), the end-questions
assessment (feature 11), and the interviewer-style note. It may not change any score.

**Two graders (feature 6).** Grader A and grader B run the part-grading call independently (separate requests, no
shared output; B sees the turns in the same order but a differently ordered instruction block and temperature 0.3 vs
0.0 for A — author's call, builder may tune). For every skill area and question score: if |A − B| ≤ 1.5 the value is
the mean; if larger, a **tiebreak** call (grader C, same input plus both graders' reasons) decides and the value is the
median of A, B, C. Disagreements are stored for admin diagnosis.
Categorical fields that drive arithmetic (`logic_works`, `must_have_met`, question `verdict`, event lists) follow the
same rule: if A and B agree, that value; if not, grader C's tiebreak call decides by majority of A, B, C (author's
call). Event lists (bugs, edge cases) keep only items both A and B report, or C confirms.

**Model** (author's call): configurable `EVALUATION_MODEL` / `EVALUATION_TIEBREAK_MODEL`, routed through the
OpenRouter client the interviewer already uses, default the interviewer's current model. Expected volume: 2 × parts
(typically 3-6) + tiebreaks + 1 synthesis ≈ 8-15 calls per round. Choosing a stronger grading model and the budget per
graded round is an **open item for the owner** (§14).

### 7.4 Skill areas and weights per round type (decided in principle; numbers are the author's)

Areas sum to 100 within a round type. "Communication" always includes clarity, thinking aloud, receptiveness to hints,
composure and delivery (§7.6).

| Round type | Skill areas (weight) | Practical / theory |
|---|---|---|
| **dsa** | Understanding & clarifying 10 · Approach & optimisation 25 · Code correctness 25 · Code quality 10 · Testing & edge cases 10 · Complexity analysis 10 · Communication 10 | 70 / 30 |
| **system-design** | Requirements & scope 15 · High-level design 25 · Deep dive (data, storage, APIs) 20 · Trade-offs 20 · Scale & failure 10 · Communication 10 | 50 / 50 |
| **lld** | Requirements & entities 15 · Class modelling 25 · Design principles & patterns 20 · Extensibility 15 · Code 15 · Communication 10 | 55 / 45 |
| **behavioural** | Structure (STAR) 15 · Ownership 25 · Impact 20 · Self-awareness & learning 20 · Company values 10 · Communication 10 | — |
| **hiring-manager** | Project depth & ownership 25 · Technical depth on resume claims 25 · Motivation & role fit 15 · Behavioural 15 · Communication 10 · Questions asked 10 | 50 / 50 |
| **online-assessment** | Code correctness 60 · Complexity 25 · Code quality 15 | 75 / 25 |

Total: 34 skill areas across six round types (DSA 7, system design 6, LLD 6, behavioural 6, hiring manager 6, online
assessment 3).

- **Parts and shares.** A part's planned minutes are its blueprint timebox (`slot.timebox_mins` for problem slots; the
  planned minutes of the round-question / resume / behavioural goals from the arc and realism outline). Shares use
  **planned** minutes of parts that ran, never actual minutes (extensions don't shift weight). No blueprint change is
  needed; if a goal has no planned minutes, it shares the remaining planned minutes equally (author's call).
- **Mixed rounds** (e.g. "Coding + Leadership Principles", coding + projects, coding + fundamentals): each *part family*
  is weighted by its share of the planned minutes of the parts that ran; inside a part family its own table applies.
  Fundamentals and resume/project questions inside a technical round form a "Knowledge" part family with areas
  Correctness 70 · Depth 20 · Communication 10, and count toward the theory share.
- **Company flavour** renames behavioural areas (Amazon → Leadership Principles; "Company values" lists the company's
  stated values when the brief has them) without changing weights.
- **Theory / practical split** (practical areas: DSA approach, code correctness, code quality, testing; system design
  requirements, high-level design, scale & failure; LLD class modelling, extensibility, code; hiring-manager project depth,
  technical depth; online assessment code correctness, code quality; everything else theory) is shown on the report as two sub-scores computed from the same area scores (each area is
  tagged practical or theory in the weights table).
- Weights live in a versioned constant (`EVAL_WEIGHTS_VERSION`, e.g. `w1`) stored on every report, so an old report can
  always be recomputed exactly.

### 7.5 Band anchors (partial credit, decided)

Every area and every answer uses fixed band descriptions the grader must pick from (then a number inside the band).
Generic answer bands: 9-10 correct and complete · 7-8 mostly correct, a minor gap · 5-6 partly correct, a key point
missing · 3-4 mostly wrong or very shallow · 1-2 wrong or no real answer. Area-specific anchors exist for every area;
the example for **Code correctness**:

| Score | Meaning |
|---|---|
| 10 | Logic correct on all examples and edge cases |
| 8 | Examples correct, one edge case wrong |
| 6-7 | Logic correct, syntax slips (cost depends on code standard, below) |
| 4-5 | Partly works: main idea right, a key case fails |
| 2-3 | Attempted, wrong approach |
| 1 | Nothing usable |

**Code standard (decided in principle; derivation is the author's call).** Each company has one of:
`runnable` (syntax slips cost a little: cap the area at 8 with slips), `near_runnable` (default: a few small slips are
free, many cost a little), `pseudo_ok` (complete, clear logic in any notation counts as working). Stored as a nullable
`companies.code_standard` column an admin can set; when null it is derived: tier 1-2 with `business_model` product or
hybrid → `runnable`; tier 4 or `business_model` service → `pseudo_ok`; otherwise `near_runnable`. Snapshotted on the
session at booking.

**No sandbox (decided).** The grader receives the code, the problem, the reference solution, the examples, the edge
cases and the known wrong approaches, and must hand-trace each example before scoring correctness (author's call; the
trace is shown in the report so the candidate can check it).

### 7.6 Delivery ("confident or nervous")

Audio is not stored, so delivery is read from words and timing only. Code computes per candidate turn: time to start
answering after the interviewer finished (from turn `at` and the stored endpointing timings), filler-word counts
(`um, uh, like, basically, actually, you know, so yeah` — STT may drop some fillers, so this is a lower bound), long
silences while coding (no candidate speech for > 90 s while a coding part is open), and self-corrections. The synthesis
call reads hedging ("I think maybe…"), clarity and composure from the transcript. The report shows it as **observations
with examples, not a label** ("You took 6-9 s to start on 4 of 11 answers; that's fine — consider saying your first
thought aloud"). It feeds only the Communication area. The grader is instructed never to judge accent, grammar or
English fluency.

## 8. From grades to a score

### 8.1 Formula (code)

```
part_score(p)  = Σ_area w(a) · s(a)              // within the part family's table, /100
base           = Σ_p share(p) · part_score(p)    // share = planned-minutes share of parts that ran
adjusted       = base + bonuses (≤ +0.5 total) + penalties (no total limit)
capped         = must-have missed ? min(adjusted, pass_mark − 0.5) : adjusted
score          = clamp(round1(capped), 1.0, 10.0)
```

Parts that did not run because of the interviewer's or the plan's choice (skipped goal, unreached bonus problem, a
second problem the interviewer did not give) are **excluded**, not zero — the report judges against what the round's
length allowed (realism spec). A core part the candidate did not reach because of their own pace counts with
`not_reached` (score 1 for its questions) and is said so.

### 8.2 Adjustments (decided, values per the brainstorm)

Clarifying, asking constraints, asking to repeat: **0**. Each line on the report links to its moment.

| Event | Effect | Source |
|---|---|---|
| Hint, small nudge (ladder step 1) | −0.1 | recorded hint_step |
| Hint, gives direction (step 2) | −0.25 | recorded |
| Hint, near-solution (step 3+) | −0.5 (hints capped at −0.8 per problem) | recorded |
| Interviewer points out a bug | −0.1 each, up to −0.3 | LLM |
| Candidate finds and fixes own bug | +0.1 each, up to +0.2 | LLM |
| First request to change the problem | **−1.0 (decided: very high)** | recorded |
| Each further change request | −0.5 more | recorded |
| Problem change granted | −1.0 more | recorded |
| Better solution than the level expects | +0.2 | LLM |
| Bonus problem solved | +0.3 | LLM + slot `bonus` |
| Thoughtful questions at the end | +0.1 to +0.2 | LLM |
| Rudeness warning | −0.5 | warnings_given |
| Rudeness final warning | −1.0 more | warnings_given |
| Round ended for conduct | **Automatic fail** | end reason / conduct |
| Tab switch / window blur / external display | first weight-1 event free; then −0.25 per weight unit (0.5-weight kinds −0.125) | proctor ledger |
| Paste from outside the editor | −0.5 each; that code region is marked "not credited" to the grader | proctor `foreign_paste` |
| Stayed away past the limit | −0.25 each | away episodes |
| Round ended for integrity | **Automatic fail** | end reason / proctor |

Bonuses total at most +0.5. Copy for change requests: "You asked to switch problems N times. Interviewers read this as
giving up on the problem — work through it out loud instead, even when stuck."

### 8.3 Must-have cap (decided)

If the round's core deliverable was not met, the score is capped at `pass_mark − 0.5` however good the rest was, and the
report says so ("Capped at 6.5: the solution didn't reach working logic"). Must-haves: **dsa / online-assessment**:
working logic on the main problem (`logic_works ∈ {yes, syntax_only}`, or `partly` with only an edge case failing;
pseudo-code counts when the code standard allows it; small syntax slips never trigger the cap **(decided)**);
**system-design**: a design that works end to end; **lld**: the core classes modelled; **behavioural /
hiring-manager**: at least one real example of the candidate's own. Mixed rounds: the main part family's must-have.

### 8.4 Outcome and verdict

- `outcome`: `passed` (score ≥ pass mark) · `below_pass` · `auto_fail` (conduct/integrity end) · `unscorable`.
- `verdict` from d = score − pass mark: ≥ +1.5 Strong Hire · ≥ +0.5 Hire · ≥ 0 Lean Hire · ≥ −0.75 Lean No Hire ·
  ≥ −2.0 No Hire · else Strong No Hire. Auto-fail is at most "No Hire". Shown as the mock interviewer's recommendation,
  never as an endorsement.

### 8.5 Pass mark (decided inputs, author's numbers)

```
base by level:   intern/fresher 6.0 · sde1 6.5 · sde2 7.0 · sde3 / staff / principal / distinguished 7.5
company tier:    tier 1 +0.5 · tier 2 +0.25 · tier 3-4 +0 · unknown company +0
round difficulty: hard +0.25 · medium/easy/unknown +0
pass_mark = clamp(sum, 5.5, 8.5)
```

Computed at booking (session level + company tier looked up by the session's company + the round node's difficulty, or
the practice template's) and stored on the session. Sessions booked before this module get it computed once at their
first evaluation with the same function and stored. **The stored snapshot always wins** (author's call): admin re-runs,
disputes and re-grading never recompute the pass mark, code standard, tier or difficulty from live company data.
Round difficulty (`easy|medium|hard`) comes from the loop graph's round node (`difficulty`, required on round nodes), or
for practice sessions from the practice prep snapshot — the same resolution `blueprintPrep.resolveRound` already does;
booking reuses it and stores `round_difficulty` on the session.

### 8.6 Unscorable (feature 10)

No score, no cooldown, free retake, when: the round ended `technical`; or the core parts that ran total < 40% of their
planned minutes and the candidate did not end the round themselves; or the grading inputs are missing (no turns). The
report says why in one plain sentence. A candidate who ends the round early themselves is scored on what they did.

**Evaluation that fails for good** (still failing after the transient retries, or invalid grader output after repair and
re-run): `eval_status = failed`. The candidate is never stuck: the report says "We couldn't grade this round", the node
becomes available with **no cooldown** (a free retake), and admins see it in the Evaluations tab and can re-run it; a
later successful re-run publishes the report and applies gating then (author's call).

## 9. What the live round must additionally record (small interviewer changes)

- **Per-problem code**: when a coding/LLD item ends (or the round ends with it open), store `{language, text}` on the
  checkpoint item (`code_final`). The editor is shared across problems today; the grader gets the snapshot taken at
  that item's end, and for a later problem only the text that changed since `code_base` is attributed when practical
  (builder's call).
- **Final board**: persist the last `board.summary` per item (`board_final`) and the last `board.backup` scene JSON for
  the round (gzip'd, stored with the live run) so the report can render the diagram read-only.
- **Foreign paste**: make sure `proctor.event` kind `foreign_paste` lands in the proctor ledger with `chars`/`lines` and
  the time (it is reported by the web but the conductor's ledger handling must be verified; add it if missing).
- Nothing else changes in the live interviewer.

## 10. Gating, cooldown and readiness

- **Unlock**: the next round of a loop opens only when the previous round has **a** `passed` attempt. Passed is sticky:
  once a node has a passed attempt it stays passed; a passed node cannot be booked again inside the loop (practise it
  as a standalone round instead). A later attempt still evaluating never re-locks anything (author's call). Server-enforced
  in `nodeStates` and booking. Applies to official and standalone loops alike; only official loops count toward
  readiness (author's call).
- **Cooldown** (author's call within the decided 1-2 weeks): `below_pass` by < 1.0 → 7 days; `below_pass` by ≥ 1.0 →
  14 days; `auto_fail` → 14 days; `unscorable` → none (free retake). Stored as `retake_after` on the session.
- **Node states** become: locked · available · booked · evaluating · passed · retake (with `retakeAfter`) · cooldown
  → available again after the date · unscorable → available.
- **Legacy sessions**: rounds completed before this module stay counted as completed ("Not scored"), so nobody loses
  progress; new evaluation runs are attempted for them only if their live data still exists (author's call).
- **Readiness level per official loop** (author's call; formulas are owner decisions, flagged): Getting started (0
  passed) · Progressing (≥ 1) · Nearly ready (all but one) · Interview-ready (all). Rounds passed only, not score
  height. Copy: "Interview-ready · Meesho SDE1 mock process".

## 11. Architecture

### 11.1 Where things run

- **AI service** owns all LLM grading: new package `app/evaluation/` (models, weights/anchors, adjustments, prompts,
  graders, aggregation, pipeline, store, api). Mirrors `app/blueprint/` (POST `/evaluations/runs`, GET
  `/evaluations/runs/{run_id}`, GET `/evaluations/sessions/{session_id}`, cancel; `X-Internal-Api-Key`; asyncio task;
  semaphore `EVALUATION_MAX_PARALLEL_RUNS`=2; timeout; restart recovery; Mongo `evaluation_runs`, `round_evaluations`).
  Arithmetic (§8) lives in a pure module so the API's gating never needs the LLM.
- **API** owns pass mark, cooldown, gating, readiness, and what the web sees. It starts a run when a session reaches
  COMPLETED (immediately via `background.run`, plus a reconcile tick every 60 s that starts missing runs, collects
  finished ones, auto-retries transient failures up to 2 per hour, times out after 20 min). On success it stores the
  report document in API Mongo `round_reports` (one per session, with version history for disputes) and the summary
  columns in Postgres.

### 11.2 Data

Postgres `interview_sessions` new columns: `pass_mark numeric(3,1)`, `code_standard varchar(16)`,
`company_tier smallint`, `round_difficulty varchar(8)` (snapshots at booking); `eval_status`
(`pending|running|ready|failed|unscorable`), `eval_run_id`, `eval_attempts`, `score numeric(3,1)`, `outcome`, `verdict`,
`retake_after timestamptz`, `eval_version`. `live_score_final` stays unused (dropped later). `companies.code_standard`
(nullable). Drizzle migration.

API Mongo `round_reports`: `{sessionId, candidateId, version, createdAt, report}` where `report` is the contract below.

### 11.3 Contract (`packages/contracts/openapi.yaml`)

- `InterviewSession` gains `passMark`, `score`, `outcome`, `verdict`, `retakeAfter`, `evaluationStatus`.
- `GET /api/v1/interviews/sessions/{id}/report` → `RoundReport` (or 202-style `{status:"evaluating"}`):
  - `meta` (company, role, level, round, roundMinutes, minutesPlayed, codeStandard, weightsVersion, evalVersion)
  - `score`, `passMark`, `outcome`, `verdict`, `cap` (null or reason), `practicalScore`, `theoryScore`, `retakeAfter`,
    `nextRound` (unlocked node or null), `readiness` (level after this round)
  - `areas[]` `{key, label, weight, score, reason, evidence[], previousScore?}`
  - `adjustments[]` `{kind, label, delta, turnId?, at?, note}`
  - `questions[]` `{id, part, kind, asked, answerQuotes[], verdict, score, strongAnswer, gap, topics[],
    resumeConsistency?, code?{language,text,trace[],logicWorks,syntaxSlips[]}, board?{summary, notes[]}}`
  - `delivery` `{observations[] {text, examples[]}}`
  - `conduct[]` and `integrity[]` `{kind, at, turnId?, effect}`
  - `focus[]` `{title, why, moments[]}`, `topicGaps[]` `{subject, topics[] {topic, why, practice[] {slug,title,difficulty}}}`
  - `strengths[]`, `summary`, `endQuestions?`
  - `transcript[]` `{turnId, speaker, text, at, markers[]}` (spoken text only; never orders, tool calls or briefs;
    candidate turns shown as recorded, interrupted ones marked "cut off"; interviewer sentences the guard dropped or
    never played (`spoken:false`) are hidden; an interrupted interviewer turn shows the heard part when recorded; grader
    quotes may only cite turns that appear in this transcript)
  - `disputes[]`
- `POST /api/v1/interviews/sessions/{id}/report/disputes` `{target:{type:"question"|"area", id}, reason (≤500)}` → the
  dispute record; limits: one per target, at most 3 per report, only within 14 days of the **first** report version.
- `LoopNodeState` enum gains the states in §10; loop node payload gains `score`, `passMark`, `retakeAfter`.
- Admin: `GET /api/v1/intelligence/evaluations` (runs list) and `/{runId}` (raw grader outputs, disagreements,
  tiebreaks, timings), passthrough like blueprints.

### 11.4 Disputes (feature 12)

A dispute starts an evaluation run with `trigger: "dispute"` scoped to the target: one LLM re-check call that sees the
original grades from both graders, the candidate's reason, and the full transcript of that part, and must answer
`upheld` (score unchanged, with explanation) or `revised` (new score + reason). Code recomputes the round; a new report
version is stored; if the outcome changes from below_pass to passed, gating updates (the cooldown is cleared). The
report shows the dispute and its result either way.
A re-check can **keep or raise** the target's score, never lower it (author's call: an appeal never punishes). If the
outcome flips to passed, the cooldown is cleared and the next round unlocks; a retake the candidate already booked stays
booked (they can cancel it).

### 11.5 Practice suggestions (feature 8)

For each topic gap the AI service queries the bank (`topic_tags` regex, the round's round_type, same company first, then
any) excluding the candidate's seen slugs, up to 3 per topic, preferring difficulty ≤ the round's. Content statements are
not included, only slug, title, difficulty.

## 12. UI

Design language: the signed-in app's HUD layer (`@/components/hud`: HudCard, Readout, SegmentMeter, StatusDot, Count,
HudEmpty), rounder corners, orange `brand` the only accent, Geist Mono for numbers. Copy says "resume", never "résumé".

### 12.1 Report page `/interviews/[sessionId]/report`

States: **evaluating** (progress steps: "Reading your answers · Grading · Checking with a second grader · Writing your
report"; polls every 5 s), **failed** (retrying automatically; "taking longer than usual"), **unscorable** (one sentence
why + "Retake now"), **ready**.

Ready layout (desktop: left sticky summary rail 320 px + main column; mobile: stacked):

```
┌───────────────────────────── DEBRIEF · MEESHO · SDE1 · ROUND 2 — DSA ──────────────────────────────┐
│ ┌── SCORE ─────────────┐  ┌── OVERVIEW ──────────────────────────────────────────────────────────┐ │
│ │  6.8 /10             │  │ Summary (level-calibrated, 3-5 sentences)                            │ │
│ │  Pass mark 7.0       │  │ Strengths: · … · …                                                   │ │
│ │  ▓▓▓▓▓▓▓░░░ │        │  │ Practical 7.1 · Theory 6.2                                           │ │
│ │  Below pass mark     │  └──────────────────────────────────────────────────────────────────────┘ │
│ │  Lean No Hire        │  ┌── HOW YOUR SCORE WAS BUILT ──────────────────────────────────────────┐ │
│ │  Retake from 25 Oct  │  │ Approach & optimisation   25%  ███████░░░ 7.0   (prev 5.5 ↑)  [why]  │ │
│ │ ──────────────────── │  │ Code correctness          25%  ██████░░░░ 6.0                  [why]  │ │
│ │  Overview            │  │ …                                                                    │ │
│ │  Score build-up      │  │ Base 7.4 · Adjustments −0.6 · Cap — · Score 6.8                     │ │
│ │  Questions (3)       │  │ − 0.25  Hint: gave direction            12:41 ↗                     │ │
│ │  Work on (4)         │  │ − 0.1   Interviewer pointed out a bug   19:02 ↗                     │ │
│ │  Delivery            │  │ + 0.1   Found and fixed own bug         21:30 ↗                     │ │
│ │  Conduct & integrity │  └──────────────────────────────────────────────────────────────────────┘ │
│ │  Transcript          │  ┌── QUESTIONS ─────────────────────────────────────────────────────────┐ │
│ └──────────────────────┘  │ Q1 · Course schedule (graphs)       Mostly correct · 7.5   [Question] │ │
│                           │   You said: "…" (quote, ↗ moment)                                     │ │
│                           │   A strong answer: …                                                  │ │
│                           │   What was missing: …           Topics: Graphs · Topological sort    │ │
│                           │   ▸ Your code (python) · grader's trace per example · syntax slips    │ │
│                           │ Q2 · "Why Redis in your project?"   Partly · 5.0 · Resume: consistent │ │
│                           └──────────────────────────────────────────────────────────────────────┘ │
│                           WORK ON (focus list 3-5, each with moments)                            │
│                           TOPIC GAPS by subject → practice problems (unseen, from the bank)       │
│                           DELIVERY observations with examples (no label)                          │
│                           CONDUCT & INTEGRITY events with time and effect                         │
│                           TRANSCRIPT with markers; filter by marker; ↗ links scroll here          │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

- Score readout uses `Readout` (lg); the bar marks the pass mark as a tick. Outcome chip: Passed (brand) / Below pass
  mark (ink) / Automatic fail (warn) / Not scored.
- Primary CTA: Passed → "Book round N+1"; below → "Retake from {date}" (disabled until then); unscorable → "Retake now".
- System design / LLD questions render the final board read-only (Excalidraw viewer from the saved scene) with the
  grader's notes listed beside it.
- "Question this score" on each question and area opens a dialog (reason, 500 chars) → "Re-checking…" → result inline.
- Every ↗ jumps to the transcript turn and highlights it.

### 12.2 Elsewhere

- **Loop dashboard** round nodes: completed nodes show `6.8 / 7.0` and Passed / Retake from {date}; evaluating nodes
  show a `StatusDot` "Grading". Progress meter counts passed rounds; readiness copy shows the level (§10).
- **Round page / briefing** (before start): "Pass mark 7.0 / 10".
- **Ended view** (live page after the round): "Your report is being prepared — usually a few minutes" → link.
- **Interviews list**: score chip on finished rounds.
- **Admin Intelligence → Evaluations tab**: runs list (status, duration, calls, disagreement count), run detail (both
  graders' raw outputs side by side, tiebreaks, final arithmetic), and "re-run evaluation".

## 13. Acceptance

- A completed DSA, system-design, behavioural and hiring-manager round each produce a report with every section filled,
  every area and adjustment carrying evidence, and the arithmetic in the report reproducible from its stored grades.
- Grading the same round twice gives final scores within 0.5 of each other.
- Gating: below pass → next node locked, retake disabled until `retake_after`; passed → next node available; unscorable
  → retake now; auto-fail → 14 days.
- The candidate sees no interviewer internals (orders, tool calls, briefs, persona) in the transcript.
- No "badge/cleared/certified" wording anywhere.

## 14. Open items for the owner

1. **Grading model and budget per graded round** (default: the interviewer's OpenRouter model; ~8-15 calls per round).
2. The numbers in §7.4, §8.2, §8.5 and §10 are proposals that ship as versioned constants; the owner can change them
   without code changes beyond the constant.
3. Readiness levels (§10) are flagged as a product formula.

Build and test against stubbed LLM clients and recorded fixtures; live grading calls only in a small manual check
when OpenRouter has credit (author's call).

## 15. Left to the builder

Exact prompt wording (the prompts are product IP: draft, then owner review before production use); how parts map from
blueprint goals in each shape; the attribution of shared-editor code to later problems; exact band anchors for each of
the 34 areas (following §7.5's style); filler-word list tuning; Excalidraw read-only viewer choice (the live page's
board component in view mode is preferred); polling and loading details; admin page layout.
