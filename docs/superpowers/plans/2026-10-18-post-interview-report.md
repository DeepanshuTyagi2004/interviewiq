# Post-Interview Report (Module 04) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After every completed mock round, grade it with two independent LLM graders, compute a 1-10 score against a
booking-time pass mark, gate the next round, and show the candidate a detailed, evidence-linked report.

**Architecture:** The AI service gets a new `app/evaluation/` package (inputs → LLM part grading ×2 + tiebreak →
synthesis → pure arithmetic → report doc), run as an async job exactly like blueprint prep. The API snapshots the pass mark
at booking, starts/collects evaluation runs (on round end + a 60 s reconcile tick), stores the report in Mongo
`round_reports` and summary columns in Postgres, and enforces gating/cooldown in `nodeStates`. The web replaces the
report placeholder with the full report page and shows scores/states on the loop dashboard.

**Tech Stack:** Python 3.11 FastAPI + Motor + pydantic v2 (AI service); Node 22 Express 5 + Drizzle + Mongo driver +
zod + Vitest (API); Next.js 16 + React 19 + TanStack Query v5 + Tailwind 3 + `@/components/hud` (web).

**Spec:** `docs/superpowers/specs/2026-10-18-post-interview-report-design.md` — read it before any task.

## Global Constraints

- **Do not `git commit`.** Leave every change in the working tree; the owner commits. Many interviewer files already have
  uncommitted changes from earlier work — build on them, never revert or stash them.
- **Tests:** run only the tests named in your task (targeted `pytest path::name` / `pnpm --filter … vitest run path`). Do
  not run whole suites, `tsc`, or eslint unless the task says so.
- No `.py` edits under `apps/ai-service/app/` while blueprint prep runs are in flight (uvicorn `--reload` orphans them):
  if a local AI service is running, ask the controller before editing.
- Never call a paid LLM from tests: graders are tested with a fake chat object; `tests/conftest.py` already blanks keys.
- Scores are floats on 1.0-10.0 rounded to one decimal; pass mark clamp 5.5-8.5.
- Copy: "resume" never "résumé"; never "badge", "certified", "cleared {company}"; outcome copy is mock-framed
  ("Passed · Meesho SDE1 mock round 2").
- The candidate-visible transcript never contains interviewer orders, tool calls, briefs, persona, or guard-dropped /
  unplayed (`spoken: false`) interviewer text.
- Grader prompts are product IP: write them clearly, mark the module docstring "DRAFT — owner review before production".
- Web: new signed-in UI uses `@/components/hud`; don't change radii; orange `brand` is the only accent; numbers in Geist
  Mono; viewport units use `calc(Nvh/var(--hud-zoom,1))`.
- API types for the web come only from `packages/contracts/openapi.yaml` via `pnpm contracts:types`.

## Review Focus

1. **A round with no code at all** (candidate talked only, editor empty) in a DSA round → grading must not crash; code
   correctness scores low via the grader, must-have cap applies, report shows "No code was written". (Task 4, Task 6 tests.)
2. **Grader cites a turn id that isn't in the visible transcript** (e.g. an interviewer order turn or a made-up id) →
   rejected, repaired once, re-run once, then the run fails with `invalid_grades` (never published). (Task 5 test.)
3. **Legacy COMPLETED sessions** (booked before this module, no `pass_mark`, `eval_status = 'legacy'`) → loop progress
   unchanged, node shows completed "Not scored", next round stays unlocked. (Task 7 test.)
4. **Candidate ended the round after 3 minutes** → scored (not unscorable) on what was done, unreached core parts count
   `not_reached`; a `technical` end of the same length → unscorable, free retake. (Task 3 test.)
5. **Dispute that would lower a score** → stored as `upheld`, score unchanged; a dispute flipping below_pass → passed
   clears `retake_after` and unlocks the next node. (Task 6 and Task 9 tests.)

---

## AI service

### Task 1: Live round records per-problem code, final board and pastes

**Files:**
- Modify: `apps/ai-service/app/interviewer/conductor.py` (`Item` dataclass ~L250-262 region where `Item` is defined —
  find `class Item`; `on_code_change` ~L1511; `on_board_change` ~L1525; `checkpoint` ~L1926; `restore`)
- Modify: `apps/ai-service/app/interviewer/protocol.py` (`ProctorKind` L24, `ProctorEventMessage` ~L245)
- Modify: `apps/ai-service/app/interviewer/run.py` (message dispatch ~L1860-1880; `finish` ~L2103)
- Test: `apps/ai-service/tests/interviewer/test_conductor.py`, `apps/ai-service/tests/interviewer/test_run.py`

**Interfaces:**
- Produces: `Item.code_final: str = ""`, `Item.code_language: str = ""`, `Item.board_final: str = ""` (defaults so old
  checkpoints restore); `Conductor.on_code_change(text: str | None = None, language: str | None = None) -> None`;
  `Conductor.on_board_summary(text: str) -> None`; `Conductor.on_paste(source: str, chars: int, lines: int, at: float) -> None`
  appending `{"source", "chars", "lines", "at", "item_id"}` to `Conductor.pastes: list[dict]` (in `checkpoint()` as
  `"pastes"`, restored with default `[]`). `live_runs` doc gains `board_scene: str | None` (base64 of the last
  `board.backup` gzip bytes) written by `finish`.

- [ ] **Step 1: Write failing tests** in `test_conductor.py`:
  - `test_code_snapshot_recorded_on_active_slot`: with a DSA blueprint fixture, start the first slot, call
    `on_code_change("def f(): pass", "python")` → `current().code_final == "def f(): pass"` and `code_language == "python"`;
    advance to the next slot, call `on_code_change("x=1", "python")` → first item's `code_final` unchanged.
  - `test_board_summary_recorded_on_active_item`: `on_board_summary('rectangle "API"')` → active item `board_final` set.
  - `test_paste_recorded_without_escalation`: `on_paste("external", 420, 12, 1000.0)` three times → `len(c.pastes) == 3`,
    `c.full_violations == 0`, no order of kind `end`/`final_warning` created.
  - `test_restore_old_checkpoint_without_new_fields`: a checkpoint dict missing `pastes` and item `code_final` restores.
  In `test_run.py`: `test_foreign_paste_message_routes_to_on_paste` (a `proctor.event` with `kind:"foreign_paste"`,
  `source`, `chars`, `lines` reaches `on_paste`, not `on_proctor`) and `test_finish_persists_board_scene` (workspace
  `board_backup = (b"...", {})` → `finalize_run` patch contains `board_scene` base64).
- [ ] **Step 2: Run** `cd apps/ai-service && pytest tests/interviewer/test_conductor.py -k "code_snapshot or board_summary or paste or old_checkpoint" tests/interviewer/test_run.py -k "foreign_paste or board_scene" -v` — expect FAIL.
- [ ] **Step 3: Implement.** Add `"foreign_paste"` to `ProctorKind`; add optional `source: str | None`, `chars: int | None`,
  `lines: int | None` to `ProctorEventMessage` and allow `weight` to stay `Literal[1, 0.5]`. In `run.py` dispatch,
  `foreign_paste` calls `conductor.on_paste(...)` only (no escalation, no spoken mention — live behaviour unchanged);
  `code.snapshot` passes `m.language`; `board.summary` also calls `conductor.on_board_summary(m.text)`. `on_code_change`
  writes `code_final`/`code_language` on the current item when it is an active `slot`. `finish` adds `board_scene`.
- [ ] **Step 4: Run** the same command — expect PASS.

### Task 2: Evaluation models and weights

**Files:**
- Create: `apps/ai-service/app/evaluation/__init__.py`, `apps/ai-service/app/evaluation/models.py`,
  `apps/ai-service/app/evaluation/weights.py`
- Test: `apps/ai-service/tests/evaluation/__init__.py`, `apps/ai-service/tests/evaluation/test_weights.py`

**Interfaces (Produces, used by Tasks 3-6):**
- `models.py` (pydantic v2, `extra="ignore"`):
  `Verdict = Literal["correct","mostly","partly","wrong","not_answered","not_reached"]`;
  `Quote(turn_id: int, text: str)`; `TopicRef(subject: str, topic: str)`;
  `QuestionGrade(id: str, asked: str, answer_quotes: list[Quote], verdict: Verdict, score: float[1,10], strong_answer: str, gap: str, topics: list[TopicRef], resume_consistency: Literal["consistent","unsupported","contradicts","n/a"] = "n/a", resume_note: str = "")`;
  `AreaGrade(key: str, score: float[1,10], evidence: list[str], reason: str)` — evidence items are `"turn:<id>"`, `"code"` or `"board"`;
  `TraceStep(example: str, predicted: str, expected: str, matches: bool)`;
  `CodeGrade(trace: list[TraceStep], logic_works: Literal["yes","syntax_only","partly","no"], syntax_slips: list[str], complexity_stated: str | None, actual_complexity: str)`;
  `HelpRequest(turn_id: int, kind: Literal["clarification","repeat","help"])`;
  `Events(self_found_bugs: list[Quote], pointed_out_bugs: list[Quote], unprompted_edge_cases: list[Quote], unprompted_complexity: bool, unprompted_dry_run: bool, recovery: Quote | None, beyond_level: bool, bonus_solved: bool, help_requests: list[HelpRequest])` (all default empty/False);
  `Moment(turn_id: int, kind: Literal["strong","weak","bug","recovery","edge_case"], note: str)`;
  `PartGrade(part_id: str, questions: list[QuestionGrade], areas: list[AreaGrade], code: CodeGrade | None, events: Events, moments: list[Moment], must_have_met: bool)`;
  `FocusItem(title: str, why: str, turn_ids: list[int])`; `GapTopic(topic: str, why: str)`; `TopicGap(subject: str, topics: list[GapTopic])`;
  `Observation(text: str, examples: list[int])`;
  `EndQuestions(quality: Literal["none","basic","thoughtful"], bonus: float[0,0.2], note: str)`;
  `Synthesis(summary: str, strengths: list[str], focus: list[FocusItem], topic_gaps: list[TopicGap], delivery: list[Observation], end_questions: EndQuestions, interviewer_note: str)`;
  `SessionMeta(company: str, role: str, level: str, round_type: str, round_minutes: int, pass_mark: float, code_standard: Literal["runnable","near_runnable","pseudo_ok"], company_tier: int | None, difficulty: str | None, official: bool)`;
  `DisputeInput(target_type: Literal["question","area"], target_id: str, reason: str, report_version: int)`;
  `EvaluationRunRequest(session_id: str, candidate_id: str, trigger: Literal["completion","reconcile","retry","admin","dispute"], meta: SessionMeta, candidate_profile: dict = {}, previous_areas: dict[str, float] | None = None, exclusions: list[str] = [], dispute: DisputeInput | None = None)`.
- `weights.py`: `EVAL_WEIGHTS_VERSION = "w1"`; `EVAL_VERSION = "eval1"`;
  `@dataclass(frozen=True) Area(key: str, label: str, weight: int, practical: bool, anchors: str)`;
  `FAMILIES: dict[str, tuple[Area, ...]]` with keys `dsa`, `system-design`, `lld`, `behavioural`, `hiring-manager`,
  `online-assessment`, `knowledge`; `areas_for(family: str, company: str | None = None) -> tuple[Area, ...]` (Amazon →
  behavioural `company_values` label "Leadership Principles"); `MUST_HAVE: dict[str, str]` (family → plain sentence used
  in the cap reason).

Area keys/weights/practical flags (spec §7.4, exact):
`dsa`: understanding 10 F · approach 25 T · code_correctness 25 T · code_quality 10 T · testing 10 T · complexity 10 F · communication 10 F.
`system-design`: requirements 15 T · high_level_design 25 T · deep_dive 20 F · trade_offs 20 F · scale_failure 10 T · communication 10 F.
`lld`: requirements 15 F · class_modelling 25 T · principles 20 F · extensibility 15 T · code 15 T · communication 10 F.
`behavioural`: structure 15 F · ownership 25 F · impact 20 F · self_awareness 20 F · company_values 10 F · communication 10 F.
`hiring-manager`: project_depth 25 T · technical_depth 25 T · motivation 15 F · behavioural 15 F · communication 10 F · questions_asked 10 F.
`online-assessment`: code_correctness 60 T · complexity 25 F · code_quality 15 T.
`knowledge`: correctness 70 F · depth 20 F · communication 10 F.
(T = practical.) Anchors: every area gets a five-band anchor string in the §7.5 style; `code_correctness` uses the
spec's table verbatim; `communication` must say "never judge accent, grammar or English fluency".

- [ ] **Step 1: Write failing tests** `test_weights.py`: every family's weights sum to 100; DSA practical share == 70,
  system-design 50, lld 55, hiring-manager 50, online-assessment 75; total distinct (family, key) pairs excluding
  `knowledge` == 34; `areas_for("behavioural", "Amazon")` label of `company_values` == "Leadership Principles";
  `QuestionGrade(score=11, …)` raises `ValidationError`.
- [ ] **Step 2: Run** `pytest tests/evaluation/test_weights.py -v` — FAIL.
- [ ] **Step 3: Implement** the two modules.
- [ ] **Step 4: Run** — PASS.

### Task 3: Scoring arithmetic (pure)

**Files:**
- Create: `apps/ai-service/app/evaluation/score.py`
- Test: `apps/ai-service/tests/evaluation/test_score.py`

**Interfaces:**
- Consumes: Task 2 models/weights.
- Produces:
  - `TIEBREAK_GAP = 1.5`; `needs_tiebreak(a: float, b: float) -> bool`; `merge_score(a: float, b: float, c: float | None) -> float` (mean if gap ≤ 1.5, else median of a,b,c; `c` required then);
    `majority(a, b, c=None)` for categorical values (a if a == b else c).
  - `@dataclass PartScore(part_id: str, family: str, share: float, areas: dict[str, float], must_have_met: bool)`.
  - `part_shares(planned: dict[str, float | None]) -> dict[str, float]` — parts with `None` minutes split the remainder
    equally (remainder = round_minutes − sum of known, floor 0; if all known, shares are proportional).
  - `@dataclass Adjustment(kind: str, label: str, delta: float, turn_id: int | None = None, at: float | None = None, note: str = "")`.
  - `@dataclass AdjustmentInputs(hint_steps_by_problem: dict[str, list[int]], pointed_out_bugs: int, self_found_bugs: int, change_requests: int, change_granted: bool, beyond_level: bool, bonus_solved: bool, end_questions_bonus: float, conduct_warnings: list[dict], proctor: list[dict], pastes: list[dict], away_overstays: list[dict])` and `adjustments(x: AdjustmentInputs) -> list[Adjustment]` implementing spec §8.2 exactly (hint −0.1/−0.25/−0.5 for step 1/2/≥3, per-problem hint floor −0.8; pointed-out bug −0.1 each floor −0.3; self-found +0.1 each cap +0.2; change request first −1.0, each further −0.5, granted −1.0; beyond level +0.2; bonus solved +0.3; end questions as given; conduct warning −0.5, final warning −1.0; proctor: first weight-1 event free, then −0.25 per weight unit; paste −0.5 each; overstay −0.25 each).
  - `@dataclass ScoreResult(base: float, bonus_total: float, penalty_total: float, cap: str | None, score: float, outcome: Literal["passed","below_pass","auto_fail","unscorable"], verdict: str | None, practical: float | None, theory: float | None)`.
  - `compute(parts: list[PartScore], adjustments: list[Adjustment], pass_mark: float, main_family: str, auto_fail: bool) -> ScoreResult` — §8.1 formula; bonuses summed then capped at +0.5; cap = `pass_mark − 0.5` when the main family's part(s) `must_have_met` is false, reason from `MUST_HAVE`; clamp 1.0-10.0; round to 1 decimal; `auto_fail` → outcome `auto_fail` and verdict at most "No Hire".
  - `verdict_for(score: float, pass_mark: float) -> str` (§8.4 bands: ≥+1.5 "Strong Hire", ≥+0.5 "Hire", ≥0 "Lean Hire", ≥−0.75 "Lean No Hire", ≥−2.0 "No Hire", else "Strong No Hire").
  - `unscorable_reason(end_reason: str, core_planned_min: float, core_ran_min: float, candidate_ended: bool, has_turns: bool) -> str | None` (§8.6: technical end; core ran < 40% of planned and not candidate-ended; no turns).

- [ ] **Step 1: Write failing tests** with exact numbers:
  - `test_merge_mean_within_gap`: `merge_score(6, 7, None) == 6.5`; `test_merge_median_on_gap`: `merge_score(4, 7, 6) == 6`.
  - `test_hint_penalties`: steps `[1,2]` → −0.35 total; `[3,3,2]` on one problem → −0.8 (floor).
  - `test_change_requests_very_high`: 2 requests, granted → −2.5.
  - `test_bonus_cap`: beyond_level + bonus_solved + end questions 0.2 + 2 self-found bugs → bonus_total 0.5.
  - `test_proctor_first_free`: events weights `[1, 1, 0.5]` → −0.375.
  - `test_cap_applied`: DSA part areas giving base 7.6, `must_have_met=False`, pass 7.0 → score 6.5, `cap` not None, outcome `below_pass`.
  - `test_verdict_bands`: (8.6, 7.0) → "Strong Hire"; (6.8, 7.0) → "Lean No Hire"; (4.9, 7.0) → "Strong No Hire".
  - `test_auto_fail`: score 8.0 pass 7.0 auto_fail → outcome `auto_fail`, verdict "No Hire".
  - `test_unscorable`: technical → reason; candidate_ended at 3 of 30 planned min → None; interviewer-side end at 10 of 30 → reason.
  - `test_part_shares_unknown_minutes`: `{"a": 20, "b": None, "c": None}` with round 40 → b=c=10/40.
  - `test_practical_theory_split`: DSA all areas 8 except complexity 4 → practical 8.0, theory ≈ 6.7.
- [ ] **Step 2: Run** `pytest tests/evaluation/test_score.py -v` — FAIL.
- [ ] **Step 3: Implement** `score.py`.
- [ ] **Step 4: Run** — PASS.

### Task 4: Evidence assembly (parts, transcript, delivery stats)

**Files:**
- Create: `apps/ai-service/app/evaluation/inputs.py`
- Test: `apps/ai-service/tests/evaluation/test_inputs.py`, fixtures `apps/ai-service/tests/fixtures/evaluation/` (a small
  DSA blueprint + live run checkpoint + turns, and a mixed coding+behavioural one; build them by trimming real shapes
  from `tests/fixtures` / `tests/interviewer` fixtures)

**Interfaces:**
- Consumes: blueprint dict, `live_runs` doc (with Task 1 fields), `live_turns` list, `live_evidence` list, Task 2 weights.
- Produces:
  - `@dataclass VisibleTurn(turn_id: int, speaker: Literal["interviewer","candidate"], text: str, at: str, cut_off: bool)`;
    `visible_transcript(turns: list[dict]) -> list[VisibleTurn]` (turn_id = `seq`; drops interviewer turns with
    `spoken is False` or empty text, removes `blocked` sentences, uses `heard` text for interrupted interviewer turns when
    present; candidate turns as recorded with `cut_off` from `interrupted`/`cancelled`).
  - `@dataclass PartInput(part_id: str, family: str, title: str, planned_min: float | None, ran: bool, excluded_reason: str | None, ended_by: str | None, turns: list[VisibleTurn], reference: dict, code: dict | None, board: str | None, evidence_notes: list[dict], hint_steps: list[int], is_bonus: bool)`.
  - `build_parts(blueprint: dict, run: dict, turns: list[VisibleTurn], evidence: list[dict]) -> list[PartInput]` — one part
    per checkpoint item that ran (problem slots → their family; round questions / resume probes → `knowledge`;
    behavioural/culture slots → `behavioural`; candidate-questions phase → part `end_questions`, never weighted).
    Items `skipped` by interviewer/plan or unreached bonus slots → `ran=False`, `excluded_reason` set. Turns are attributed
    by the turn's `item_id`. `reference` carries the slot's problem content summary, answer key, expectations,
    evaluation_signals (or the round question's expected answer / the resume probe and its profile source).
  - `@dataclass DeliveryStats(answer_latencies_s: list[float], slow_starts: list[int], filler_counts: dict[str,int], long_silences: list[dict], self_corrections: int)`;
    `delivery_stats(turns: list[dict], visible: list[VisibleTurn]) -> DeliveryStats` (fillers: um, uh, like, basically,
    actually, "you know", "so yeah"; slow start ≥ 6 s; long silence = > 90 s without candidate speech while a coding slot is active).
  - `adjustment_inputs(run: dict, parts: list[PartInput], merged_events: dict) -> score.AdjustmentInputs`.

- [ ] **Step 1: Write failing tests:** `visible_transcript` hides a `spoken: False` turn and a guard-blocked sentence;
  `build_parts` on the DSA fixture returns the main problem `ran=True` with its `code_final` and the unreached second
  problem `ran=False, excluded_reason="not given by the interviewer"`; mixed fixture gives `dsa` + `behavioural` parts
  with planned minutes from `timebox_mins`; **no-code round** (empty `code_final`) yields `code={"language":"", "text":""}`
  not None; `delivery_stats` counts "um" ×3 and one slow start in a crafted turn list.
- [ ] **Step 2: Run** `pytest tests/evaluation/test_inputs.py -v` — FAIL.
- [ ] **Step 3: Implement** `inputs.py`.
- [ ] **Step 4: Run** — PASS.

### Task 5: Prompts and graders

**Files:**
- Create: `apps/ai-service/app/evaluation/prompts.py`, `apps/ai-service/app/evaluation/graders.py`
- Modify: `apps/ai-service/app/config.py` (settings), `apps/ai-service/.env.example`
- Test: `apps/ai-service/tests/evaluation/test_graders.py`

**Interfaces:**
- Consumes: Tasks 2-4; `app.interviewer.llm.OpenRouterChat.json(messages, schema_name, schema, max_tokens) -> (dict, usage)`
  and `.with_temperature(t)`; `LLMUnavailable`.
- Produces:
  - Settings: `evaluation_model: str` (default = the talker model setting's default), `evaluation_tiebreak_model: str | None = None`,
    `evaluation_timeout_s: float = 90`, `evaluation_max_parallel_runs: int = 2`, `evaluation_run_timeout_seconds: float = 1200`,
    `evaluation_run_retention_days: int = 30`. Env names upper-case of each.
  - `prompts.part_messages(part: PartInput, meta: SessionMeta, variant: Literal["A","B","C"], prior: list[PartGrade] | None = None) -> list[dict]`;
    `prompts.synthesis_messages(parts, grades, stats: DeliveryStats, meta) -> list[dict]`;
    `prompts.dispute_messages(part, grades: list[PartGrade], dispute: DisputeInput, meta) -> list[dict]`.
    Part prompt includes: level band text (`app.blueprint.prompts.BAND_TEXT`/`LEVEL_BAND`), code standard rule (§7.5),
    the area anchors, the instruction to hand-trace every example before scoring `code_correctness`, the "pasted code is
    not credited" note when the part has pastes, "never judge accent, grammar or English fluency", and that every grade
    must cite turn ids from the given transcript. Variant B reorders the instruction blocks; variant C receives `prior`.
  - `class GradingError(Exception)` with `.code` (`invalid_grades` | `llm_unavailable`).
  - `async def grade_part(chat, part, meta, variant, prior=None) -> PartGrade` — validate with pydantic, then
    `check_citations(grade, visible_ids: set[int])` (every `turn:<id>` evidence/quote/moment/help turn id ∈ visible ids;
    areas must be exactly the part family's keys); on failure one repair message listing the errors, then one full re-run;
    still invalid → `GradingError("invalid_grades")`.
  - `async def grade_round(chat_a, chat_b, chat_c, parts, meta) -> dict[str, PartGrade]` — A and B concurrently per part,
    tiebreak C only when `needs_tiebreak` on any area/question score or categorical disagreement (`logic_works`,
    `must_have_met`, verdicts); returns merged `PartGrade` per part (scores via `merge_score`, categoricals via `majority`,
    event lists = intersection of A and B, or C's confirmed list), and records `disagreements: list[dict]`.
  - `async def synthesize(chat, parts, merged, stats, meta) -> Synthesis`.
  - `async def recheck(chat, part, grades, dispute, meta) -> tuple[Literal["upheld","revised"], float, str]` — revised
    scores below the current one are coerced to `upheld`.

- [ ] **Step 1: Write failing tests** with a `FakeChat` returning queued dicts:
  - `test_grade_part_valid` → `PartGrade` returned.
  - `test_grade_part_rejects_unknown_turn`: first reply cites `turn:999`, repair reply valid → success, 2 calls made.
  - `test_grade_part_fails_after_rerun`: three invalid replies → `GradingError` code `invalid_grades`.
  - `test_tiebreak_only_on_gap`: A/B area scores 6 and 6.5 → C not called; 4 and 7 → C called and merged = median.
  - `test_logic_works_majority`: A "yes", B "no", C "no" → merged `no`.
  - `test_recheck_never_lowers`: fake returns revised 5.0 for a current 6.0 → `("upheld", 6.0, …)`.
- [ ] **Step 2: Run** `pytest tests/evaluation/test_graders.py -v` — FAIL.
- [ ] **Step 3: Implement** prompts, graders, settings.
- [ ] **Step 4: Run** — PASS.

### Task 6: Evaluation pipeline, store, practice suggestions and HTTP routes

**Files:**
- Create: `apps/ai-service/app/evaluation/store.py`, `apps/ai-service/app/evaluation/pipeline.py`,
  `apps/ai-service/app/evaluation/practice.py`, `apps/ai-service/app/evaluation/report.py`, `apps/ai-service/app/evaluation/api.py`
- Modify: `apps/ai-service/app/main.py` (register routers + `recover_interrupted_runs` in lifespan),
  `apps/ai-service/app/db/mongo.py` (`ensure_evaluation_indexes` in `ensure_indexes`), the users purge route (add
  evaluation purge next to `app.interviewer.store.purge`)
- Test: `apps/ai-service/tests/evaluation/test_pipeline.py`, `apps/ai-service/tests/evaluation/test_report.py`

**Interfaces:**
- Consumes: Tasks 2-5; `app.interviewer.store` collections (`live_runs`, `live_turns`, `live_evidence`);
  `app.blueprint.store.current_blueprint(session_id)`; `app.db.repositories.query_questions` (topic regex).
- Produces:
  - Mongo `evaluation_runs` (`run_id` unique, partial unique one running per session, TTL `expires_at`) and
    `round_evaluations` (`session_id`+`version` unique) — store functions mirroring `app/blueprint/store.py`
    (`insert_run`, `update_run`, `finish_run`, `get_run`, `list_runs`, `recover_interrupted_runs`, `save_evaluation`,
    `current_evaluation`, `purge`). Run ids `evr_` + 20 hex.
  - `report.build_report(meta, parts, merged, synthesis, result: ScoreResult, adjustments, stats, visible, practice, run: dict, previous_areas) -> dict` — the snake_case report document whose fields mirror the contract `RoundReport` (spec §11.3): `meta`, `score`, `pass_mark`, `outcome`, `verdict`, `cap`, `practical_score`, `theory_score`, `areas[]` (with `previous_score`), `adjustments[]`, `questions[]` (with `code{language,text,trace,logic_works,syntax_slips}` and `board{summary, scene, notes}` — `scene` only on the part that owns the final board), `delivery`, `conduct[]`, `integrity[]`, `focus[]`, `topic_gaps[]` (each topic with `practice[]`), `strengths`, `summary`, `end_questions`, `transcript[]` (`turn_id, speaker, text, at, markers[], cut_off`), `disputes[]`, `weights_version`, `eval_version`. Unscorable → `{outcome:"unscorable", unscorable_reason, meta, transcript}` only.
  - `practice.suggest(topic_gaps, round_type, company, exclusions, per_topic=3) -> dict[str, list[dict]]` (slug, title, difficulty; same company first; difficulty ≤ round's).
  - `pipeline.start_run(req: EvaluationRunRequest, settings) -> {"run_id","status","existing"}`, `cancel_run(run_id, settings)`, `_execute` with semaphore `evaluation_max_parallel_runs` and `asyncio.timeout(evaluation_run_timeout_seconds)`; error codes `llm_unavailable` (transient), `invalid_grades`, `missing_inputs`, `timeout`, `internal_error`. Successful run doc carries `result: {"version", "outcome", "score", "verdict", "pass_mark"}`.
  - `trigger == "dispute"`: loads `current_evaluation`, runs `recheck` on the target, recomputes with `compute`, appends to `disputes[]`, saves version+1.
  - Routes (internal key): `POST /evaluations/runs`, `GET /evaluations/runs/{run_id}`, `POST /evaluations/runs/{run_id}/cancel`, `GET /evaluations/sessions/{session_id}` (`?version=`); admin: `GET /admin/evaluations/runs`, `GET /admin/evaluations/runs/{run_id}` (raw grader outputs both graders, tiebreaks, disagreements, arithmetic), `POST /admin/evaluations/runs/{run_id}/rerun`.

- [ ] **Step 1: Write failing tests** (stores via the same Mongo test setup `tests/blueprint` uses; LLM via `FakeChat`
  injected through a module-level factory `pipeline.chat_factory`):
  - `test_full_run_dsa_fixture`: DSA fixture → run `completed`, report has every section, `score` equals recomputing
    `compute` from the stored merged grades (reproducible arithmetic).
  - `test_no_code_round_caps`: empty code fixture → `cap` set, outcome `below_pass`, question card code text "".
  - `test_unscorable_technical`: run doc `end_reason="technical"` → outcome `unscorable`, no LLM calls made.
  - `test_dispute_upheld_and_revised`: upheld keeps score; revised raises a question score and the round score, version 2.
  - `test_duplicate_start_returns_existing`.
  - `test_report_hides_internal_turns` (`test_report.py`): transcript has no orders/tool_calls; markers include `hint`
    and `warning` at the right turn ids.
- [ ] **Step 2: Run** `pytest tests/evaluation/test_pipeline.py tests/evaluation/test_report.py -v` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS. Also run `pytest tests/evaluation -v` once — PASS.

## API

### Task 7: Evaluation domain: pass mark, code standard, cooldown, readiness, node states

**Files:**
- Create: `apps/api/src/domain/evaluation.ts`
- Modify: `apps/api/src/domain/process.ts` (`PASS_THRESHOLD`/`RETAKE_COOLDOWN_DAYS` constants removed; `NodeState`,
  `NodeSession`, `nodeStates`, `progressOf`)
- Test: `apps/api/test/domain/evaluation.test.ts`, `apps/api/test/domain/process.test.ts`

**Interfaces:**
- Produces:
  - `PASS_BASE: Record<EngineeringLevel, number>` (intern 6.0, fresher 6.0, sde1 6.5, sde2 7.0, sde3/staff/principal/distinguished 7.5).
  - `passMark(input: { level: string | null; tier: number | null; difficulty: "easy" | "medium" | "hard" | null }): number` (unknown level → sde1; tier 1 +0.5, tier 2 +0.25; hard +0.25; clamp 5.5-8.5; round half up to one decimal, e.g. 6.75 → 6.8).
  - `type CodeStandard = "runnable" | "near_runnable" | "pseudo_ok"`; `codeStandardFor(tier: number | null, businessModel: string | null, override: CodeStandard | null): CodeStandard`.
  - `type EvalOutcome = "passed" | "below_pass" | "auto_fail" | "unscorable"`; `retakeAfter(outcome: EvalOutcome, score: number | null, passMark: number, evaluatedAt: Date): Date | null` (below by < 1.0 → +7 d; ≥ 1.0 → +14 d; auto_fail → +14 d; unscorable → null).
  - `type ReadinessLevel = "getting_started" | "progressing" | "nearly_ready" | "interview_ready"`; `readinessLevel(passed: number, total: number): ReadinessLevel`.
  - `process.ts`: `NodeState = "locked" | "available" | "booked" | "evaluating" | "passed" | "cooldown" | "completed"`
    (`completed` = legacy, not scored, counts as passed); `NodeSession { nodeId: string | null; status: string; evalStatus?: string | null; outcome?: EvalOutcome | null; retakeAfter?: Date | null }`;
    `nodeStates(g, sessions, now: Date = new Date())` per spec §10 (passed sticky; legacy `evalStatus === "legacy"` → `completed`; COMPLETED with `evalStatus` pending/running → `evaluating`; latest finished below_pass/auto_fail with `retakeAfter > now` → `cooldown`; failed/unscorable/after-date → available if every predecessor is passed/completed, else locked); `progressOf` counts passed + completed.

- [ ] **Step 1: Write failing tests:** passMark(sde1, tier 2, medium) = 6.8 (6.75 rounded half up); (sde2, tier 1, hard) = 7.8;
  (fresher, null, null) = 6.0; (distinguished, 1, hard) = 8.3; codeStandardFor(1,"product",null) = runnable,
  (4,"product",null) = pseudo_ok, (3,"service",null) = pseudo_ok, (3,"product",null) = near_runnable, override wins;
  retakeAfter below by 0.4 → +7 d, by 1.0 → +14 d; readinessLevel(0,4)=getting_started, (3,4)=nearly_ready, (4,4)=interview_ready, (1,1)=interview_ready.
  `process.test.ts`: legacy completed node unlocks its successor and counts in progress; passed attempt then a later
  below_pass attempt stays `passed`; COMPLETED + evalStatus "running" → `evaluating`, successor locked; below_pass with
  future retakeAfter → `cooldown`; same with past date → `available`; failed eval → `available`. Update existing
  `process.test.ts` cases that assumed `completed` for scored sessions.
- [ ] **Step 2: Run** `cd apps/api && pnpm vitest run test/domain/evaluation.test.ts test/domain/process.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS.

### Task 8: Schema, migration, repositories and booking snapshot

**Files:**
- Create: `apps/api/drizzle/0011_round_evaluation.sql` (+ journal/snapshot entry following how `0010_round_minutes` was added)
- Modify: `apps/api/src/db/pg/schema.ts` (`interviewSessions`, `companies`), `apps/api/src/repositories/pg.ts`
  (`InterviewSessionRepository`), `apps/api/src/repositories/mongo.ts` (new `RoundReportRepository`),
  `apps/api/src/services/interviewSessions.ts` (`createSession` snapshot + node-state guards)
- Test: `apps/api/test/db/roundEvaluationMigration.test.ts`, `apps/api/test/services/interviewSessionsEvaluation.test.ts`

**Interfaces:**
- Consumes: Task 7.
- Produces:
  - Columns on `interview_sessions`: `pass_mark numeric(3,1)`, `code_standard varchar(16)`, `company_tier smallint`,
    `round_difficulty varchar(8)`, `eval_status varchar(16)` (`pending|running|ready|failed|unscorable|legacy`),
    `eval_run_id varchar(64)`, `eval_run_started_at timestamptz`, `eval_attempts integer not null default 0`,
    `eval_retry_window_start timestamptz`, `eval_error_code varchar(64)`, `score numeric(3,1)`, `outcome varchar(16)`,
    `verdict varchar(24)`, `retake_after timestamptz`, `eval_version varchar(16)`, `evaluated_at timestamptz`; index
    `idx_session_eval_status (eval_status)`. Migration sets `eval_status = 'legacy'` for existing `COMPLETED` rows.
    `companies.code_standard varchar(16)` nullable. Drizzle reads numerics as numbers (use the column helper's mode/number mapping already used in the codebase or `Number()` in the repo layer).
  - `InterviewSessionRepository`: `findEvaluationWork(): Promise<InterviewSessionRow[]>` (COMPLETED with eval_status pending/running, or failed with attempts < cap in window); `attachEvalRun(id, runId): Promise<InterviewSessionRow | null>` (only when `eval_run_id` is null); `applyEvaluation(id, patch: Partial<...>)`; `findLatestForNode(candidateId, loopId, nodeId)`.
  - `RoundReportRepository` (Mongo `round_reports`, unique `(sessionId, version)`): `save(sessionId: string, candidateId: string, version: number, report: unknown): Promise<void>`; `latest(sessionId): Promise<{version:number; report:any; createdAt: Date} | null>`; `first(sessionId)`; `deleteByCandidate(candidateId)` (wire into account deletion where `blueprint_seen` is deleted).
  - `createSession` stores `passMark`, `codeStandard`, `companyTier`, `roundDifficulty` (difficulty via the same
    resolution `blueprintPrep.resolveRound` uses — extract a shared helper if needed; tier/business model via the company
    lookup by the session's company name; custom practice → tier null). Booking errors: `cooldown` →
    `409 round_cooldown` (message includes the date), `passed`/`completed` → `409 round_already_completed`,
    `evaluating` → `409 round_evaluating`.

- [ ] **Step 1: Write failing tests:** migration test asserts the new columns and that a pre-existing COMPLETED row
  becomes `legacy`; booking test asserts a Meesho (tier 2) SDE1 medium round gets `passMark 6.8`, `codeStandard`
  `runnable`; booking a node in cooldown returns 409 `round_cooldown`.
- [ ] **Step 2: Run** `pnpm vitest run test/db/roundEvaluationMigration.test.ts test/services/interviewSessionsEvaluation.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS.

### Task 9: Evaluation client, service, reconcile job and round-end hook

**Files:**
- Modify: `apps/api/src/integrations/aiService/client.ts`, `apps/api/src/integrations/aiService/types.ts`,
  `apps/api/src/services/liveSessions.ts` (`end`), `apps/api/src/jobs/jobs.ts`, `apps/api/src/container.ts`,
  `apps/api/src/index.ts`, `apps/api/src/config.ts`
- Create: `apps/api/src/services/roundEvaluation.ts`
- Test: `apps/api/test/jobs/evaluationReconcile.test.ts`, `apps/api/test/services/roundEvaluation.test.ts`,
  `apps/api/test/integrations/aiServiceClient.test.ts` (extend)

**Interfaces:**
- Consumes: Tasks 7-8; AI routes from Task 6.
- Produces:
  - Client: `startEvaluationRun(req: EvaluationRunRequest): Promise<{ run_id: string; status: string; existing: boolean }>`,
    `getEvaluationRun(runId): Promise<{ run_id; status: "running"|"completed"|"failed"|"cancelled"; error?: {code; message}; result?: {version; outcome; score; verdict; pass_mark} }>`,
    `getSessionEvaluation(sessionId, version?): Promise<any>`, `cancelEvaluationRun(runId)`, admin `listEvaluationRuns(query)`, `getEvaluationRunAdmin(runId)`, `rerunEvaluation(runId)`.
  - Config: `EVALUATION_RECONCILE_INTERVAL_MS` (60000), `EVALUATION_RUN_TIMEOUT_MINUTES` (20), `EVALUATION_AUTO_RETRIES` (2 per rolling hour).
  - `class RoundEvaluationService { start(session, trigger): Promise<void>; collect(session): Promise<void>; report(candidateId, sessionId): Promise<{ status: "evaluating" | "failed" | "ready"; report?: any }>; dispute(candidateId, sessionId, body: { target: { type: "question" | "area"; id: string }; reason: string }): Promise<any> }`.
    `start` assembles `EvaluationRunRequest` (meta from session snapshot — computing and storing the snapshot first for
    sessions without `pass_mark`; candidate profile via the same assembler blueprint prep uses; `previous_areas` from
    the previous attempt's latest report for the same loop node; `exclusions` from `blueprint_seen`), calls
    `attachEvalRun`, sets `eval_status running`. `collect`: completed → fetch evaluation, `RoundReportRepository.save`,
    set score/outcome/verdict/`retake_after` (Task 7 `retakeAfter`; dispute flip to passed clears it)/`evaluated_at`/
    `eval_status ready|unscorable`; failed → transient codes (`llm_unavailable`, `timeout`) auto-retry up to 2 per rolling
    hour, otherwise `eval_status failed` + `eval_error_code`; run older than 20 min → cancel + treat as `timeout`.
    `dispute` enforces: report ready, ≤ 14 days since the first version, one per target, ≤ 3 per report, reason ≤ 500
    chars; starts a `dispute` run and returns `{ status: "rechecking" }`.
  - `class EvaluationReconcileJob { tick(): Promise<void> }` — like `BlueprintReconcileJob`: start pending without run, collect with run.
  - `liveSessions.end`: when the new status is `COMPLETED`, set `eval_status = 'pending'` in the same transition patch and
    `background.run(() => evaluation.start(updated, "completion"))`. `ABORTED_TECHNICAL` → `eval_status = 'unscorable'`, no run.

- [ ] **Step 1: Write failing tests:** reconcile starts a pending session once (second tick doesn't double-start);
  collect applies a completed run (score 6.8, pass 7.0 → outcome below_pass, retake_after +7 d, report saved v1);
  transient failure retried, third failure in the hour → `failed`; dispute flip to passed clears `retake_after`;
  dispute after 15 days → 409 `dispute_window_closed`; 4th dispute → 409 `dispute_limit`; technical end → unscorable without a run.
- [ ] **Step 2: Run** `pnpm vitest run test/jobs/evaluationReconcile.test.ts test/services/roundEvaluation.test.ts test/integrations/aiServiceClient.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS.

### Task 10: Contract and routes

**Files:**
- Modify: `packages/contracts/openapi.yaml`, `apps/api/src/routes/interviews.ts`, `apps/api/src/routes/intelligence.ts`,
  `apps/api/src/services/loops.ts` (node payload + readiness), the session response mapper (where `InterviewSession`
  responses are built), `apps/web/lib/api-client/generated/schema.d.ts` (regenerated)
- Test: `apps/api/test/routes/interviewReport.test.ts`, extend the loops route test

**Interfaces:**
- Produces (contract, camelCase): `InterviewSession` + `passMark`, `score`, `outcome`, `verdict`, `retakeAfter`,
  `evaluationStatus`; `RoundReport` schema mirroring Task 6's report (camelCase) + `status` (`evaluating|failed|ready`);
  `GET /api/v1/interviews/sessions/{id}/report` → 200 `RoundReport` (status `evaluating`/`failed` carry no body fields
  beyond `status` and `meta`); `POST /api/v1/interviews/sessions/{id}/report/disputes` → 202 `{status:"rechecking"}`;
  `LoopNodeState` enum = Task 7 `NodeState`; loop node payload + `score`, `passMark`, `retakeAfter`; `Loop` +
  `readiness` (`ReadinessLevel`); admin `GET /api/v1/intelligence/evaluations/runs`, `GET …/runs/{runId}`,
  `POST …/runs/{runId}/rerun` (ADMIN, snake_case passthrough like blueprints). Report mapping snake → camel happens in
  the API route.
- [ ] **Step 1: Write failing route tests:** owner gets the report (camelCase keys, transcript present); another user
  gets 404; evaluating session returns `{status:"evaluating"}`; dispute validation 400 on 501-char reason; loops payload
  includes `readiness` and node `score`.
- [ ] **Step 2: Run** `pnpm vitest run test/routes/interviewReport.test.ts` — FAIL.
- [ ] **Step 3: Implement**, then `pnpm contracts:types`.
- [ ] **Step 4: Run** the route test and the loops route test — PASS.

## Web

### Task 11: Report feature layer

**Files:**
- Create: `apps/web/features/report/{api.ts,hooks.ts,types.ts,presentation.ts,index.ts}`,
  `apps/web/lib/constants/report/index.ts`
- Test: `apps/web/features/report/presentation.test.ts`

**Interfaces:**
- Consumes: generated `components["schemas"]["RoundReport"]` etc.
- Produces: `REPORT_ENDPOINTS.report(id)`, `.disputes(id)`; `REPORT_QUERY_KEYS.report(id)`; `getReport(id)`,
  `createDispute(id, body)`; `useReport(id)` (`refetchInterval` 5000 while `status === "evaluating"` or any dispute is
  `pending`, else false); `useCreateDispute(id)` (invalidates report + `INTERVIEW_QUERY_KEYS.session(id)` + `["loops"]`);
  presentation: `formatScore(n) -> "6.8"`, `outcomeMeta(outcome) -> {label, tone}` (Passed / Below pass mark /
  Automatic fail / Not scored), `verdictLabel`, `deltaLabel(+0.1 → "+0.1", −0.25 → "−0.25")`, `markerMeta(kind)`,
  `mockOutcomeLine(meta, outcome)` → e.g. "Passed · Meesho SDE1 mock round 2".
- [ ] **Step 1: Write failing tests** for each presentation helper (exact strings above; never contains "cleared",
  "certified", "badge").
- [ ] **Step 2: Run** `pnpm --filter @interviewiq/web vitest run features/report/presentation.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS.

### Task 12: Report page — shell, states, score rail, overview, score build-up

**Files:**
- Modify: `apps/web/app/(app)/interviews/[sessionId]/report/page.tsx`
- Delete: `…/report/_components/ReportPlaceholder.tsx`, `ReportPlaceholder.test.tsx`
- Create in `…/report/_components/`: `ReportView.tsx` (client; state switch), `ReportEvaluating.tsx`, `ReportUnscorable.tsx`,
  `ScoreRail.tsx`, `OverviewCard.tsx`, `ScoreBuildUp.tsx`, `ReportView.test.tsx`

**Interfaces:**
- Consumes: Task 11 hooks/presentation; `@/components/hud` (`HudCard`, `Readout`, `SegmentMeter`, `StatusDot`, `HudEmpty`).
- Produces: `ReportView({ sessionId })`; section anchor ids `overview`, `score`, `questions`, `work-on`, `delivery`,
  `conduct`, `transcript` (Task 13 renders the last five); `jumpToTurn(turnId)` helper exported from `ReportView.tsx`
  (scrolls to `#turn-<id>` and adds a 2 s highlight class).
- Layout per spec §12.1: desktop two columns (sticky rail 320 px + main), mobile stacked. Rail: `Readout` "6.8 /10",
  "Pass mark 7.0", a 10-segment bar with the pass-mark tick, outcome chip, verdict ("Mock interviewer's recommendation:
  Lean No Hire"), primary CTA (Passed → "Book round N+1" to the loop; below/auto_fail → "Retake from {date}" disabled
  until then; unscorable/failed → "Retake now"), section nav. Overview: summary, strengths, Practical/Theory sub-scores.
  Score build-up: one row per area (label, weight %, bar, score, `prev → now` when `previousScore`, "why" expands
  reason + evidence links via `jumpToTurn`), then "Base · Adjustments · Cap · Score" line, then the adjustments list
  (signed delta, label, time, ↗). Cap shown as its own warn-toned row with the reason. Evaluating state: four progress
  steps ("Reading your answers · Grading · Checking with a second grader · Writing your report") with `StatusDot live`.
- [ ] **Step 1: Write failing tests** (`ReportView.test.tsx`, mocking `useReport`): evaluating shows the four steps;
  unscorable shows its reason and "Retake now"; ready shows "6.8", "Pass mark 7.0", "Below pass mark", "Lean No Hire",
  a cap row when `cap` is set, and an adjustment "−0.25".
- [ ] **Step 2: Run** `pnpm --filter @interviewiq/web vitest run "app/(app)/interviews/[sessionId]/report"` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS.

### Task 13: Report page — questions, work on, delivery, conduct, transcript, disputes

**Files:**
- Create in `…/report/_components/`: `QuestionsSection.tsx`, `QuestionCard.tsx`, `CodeAnswer.tsx`, `BoardAnswer.tsx`,
  `WorkOnSection.tsx`, `DeliverySection.tsx`, `ConductSection.tsx`, `TranscriptSection.tsx`, `DisputeDialog.tsx`,
  `sections.test.tsx`
- Modify: `ReportView.tsx` (mount the sections)

**Interfaces:**
- Consumes: Task 11, Task 12 `jumpToTurn`; the live page's board component in view mode for `BoardAnswer`
  (`apps/web/features/interview-live/work/DiagramBoard.tsx` — load with `next/dynamic` `ssr:false`, `viewModeEnabled`,
  scene from `question.board.scene`; if the scene is absent show the text summary).
- Behaviour per spec §12.1: QuestionCard = title, verdict chip + score, "You said" quotes (↗), "A strong answer",
  "What was missing", topics chips, resume consistency chip when present, collapsible code (language, code block, the
  grader's trace table example/predicted/expected/✓✗, syntax slips list) or board (viewer + grader notes), and a
  "Question this score" button. WorkOn: focus items (title, why, ↗ moments) then topic gaps grouped by subject with
  practice links (`/practice?problem=<slug>` — if no such route exists, render title + difficulty without a link).
  Delivery: observations with example ↗ links; copy note "Based on what you said and when — we don't analyse your voice
  or accent." Conduct & integrity: rows (time, what happened, effect) or `HudEmpty` "Nothing to report". Transcript:
  every turn with `id="turn-<turnId>"`, speaker, time, text, "cut off" tag, marker chips; filter chips by marker kind.
  DisputeDialog: target label, textarea (max 500, counter), submit → `useCreateDispute`; shows pending/upheld/revised
  inline on the card or area row; button hidden when the report says the window is closed or the target already has one.
- [ ] **Step 1: Write failing tests** (`sections.test.tsx`): a question card shows its quote and "A strong answer";
  code trace row with ✗ for a mismatched example; transcript renders `#turn-12` with a "Hint" marker; dispute dialog
  blocks a 501-char reason; conduct empty state "Nothing to report".
- [ ] **Step 2: Run** `pnpm --filter @interviewiq/web vitest run "app/(app)/interviews/[sessionId]/report"` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS.

### Task 14: Scores across the app and the admin Evaluations tab

**Files:**
- Modify: `apps/web/features/loops/components/FlowNodes.tsx` (`STATE_META` + node footer), `apps/web/app/(app)/loops/_components/LoopDetail.tsx`,
  `apps/web/features/loops/readiness.ts`, `apps/web/app/(app)/interviews/[sessionId]/live/_components/EndedView.tsx`,
  `apps/web/features/interview/presentation.ts` (`sessionSteps` debrief note), the interviews list row component, the
  pre-round briefing component (find where `prepBriefing` is rendered), `apps/web/app/(app)/intelligence/page.tsx`
- Create: `apps/web/app/(app)/intelligence/_components/evaluations/{EvaluationsTab.tsx,EvaluationRunList.tsx,EvaluationRunDetail.tsx}`,
  `apps/web/features/evaluations-admin/{api.ts,hooks.ts,index.ts}`
- Test: `apps/web/features/loops/components/FlowNodes.test.tsx` (create or extend), `apps/web/features/loops/readiness.test.ts`

**Interfaces:**
- Consumes: Task 10 contract (`LoopNodeState`, node `score`/`passMark`/`retakeAfter`, loop `readiness`).
- Behaviour: node states — evaluating ("Grading", `StatusDot active`), passed ("Passed · 7.4 / 7.0", Check), cooldown
  ("Retake from 25 Oct", Clock, faint), completed ("Completed · Not scored"); LoopDetail readiness line "Readiness:
  Progressing · Meesho SDE1 mock process" for official loops only; EndedView: "Your report is being prepared — usually a
  few minutes." + link; briefing: "Pass mark 7.0 / 10"; interviews list: score chip "6.8 / 7.0" on finished rounds.
  Admin tab "Evaluations": runs list (status, session, company, round, duration, calls, disagreements) and detail
  (graders A/B side by side per part, tiebreaks, arithmetic block, error), "Re-run" button.
- [ ] **Step 1: Write failing tests:** FlowNodes renders "Retake from" for cooldown and "Passed · 7.4 / 7.0" for passed;
  `readinessSummary` returns the level label.
- [ ] **Step 2: Run** `pnpm --filter @interviewiq/web vitest run features/loops` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS.

### Task 15: Docs

**Files:** Modify `CLAUDE.md` (Module 04 paragraph: what shipped, constants and where they live, "formulas are versioned
constants the owner can change"), create `apps/ai-service/docs/evaluation.md` (pipeline, prompts are DRAFT, models,
weights, adjustments, how to re-run) and `apps/api/docs/round-gating.md` (pass mark, cooldown, node states, readiness).
No tests.
- [ ] **Step 1: Write the three docs from the spec and the code as built.**
