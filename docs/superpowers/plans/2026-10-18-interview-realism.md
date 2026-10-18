# Interview Realism Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every mock interview of the same round has the same difficulty but a different length, outline, flow, interviewer
behaviour and wording, with the interviewer model deciding within code-enforced guardrails, and no regression of the
2026-10-17/18 fixes.

**Architecture:** Blueprint prep draws a per-session `realism` block (persona traits, speech habits, outline with promises,
change stance) from a stored random seed; the API draws the round length (30-45) at booking. The live run reads the block:
the outline becomes promises the conductor tracks and enforces, fixed lines become no-repeat pools, problem-change decisions come
from one fast talker-model call bounded by hard caps, and new guard rules/trace checks catch every new failure mode.

**Tech Stack:** Python 3.12 (FastAPI AI service, LiveKit Agents 1.8.7, OpenRouter deepseek talker), Node 22 / Express 5 /
Drizzle (API), Next.js 16 (web), Vitest, pytest.

**Spec:** `docs/superpowers/specs/2026-10-18-interview-realism-design.md` (read it before every task).

## Global Constraints

- Round length: 30, 35, 40 or 45 minutes, uniform draw at booking; reschedule/re-prep keep it; already-booked sessions keep 45.
- The interviewer never says any duration or minutes aloud (round length, part minutes, time left). "We're short on time" without a number is allowed.
- Change requests: at most `CHANGE_CAP = 1` change per round (decided 2026-10-18); at least one refusal before the round's first change; `end_coding` only after at least one refusal on the current problem; a new problem needs `MIN_SECOND_PROBLEM_S` (480 s) left; the harder reserve is never a replacement; nothing after the coding ended.
- Decision call latency: median under 800 ms, timeout 1.2 s, then the persona's prior.
- The proctoring and conduct ladders (when warnings/endings happen) do not change; warnings and endings stay alone and are never softened.
- Difficulty, scoring, thresholds, readiness, problem bank: unchanged.
- A blueprint without a `realism` block (prepared before this ships) behaves exactly as today.
- Owner rules: **do not commit or stage** (the owner commits); **do not run pytest, vitest, tsc, mypy or eslint**. Verify with `py_compile` / import checks and by calling the test functions you wrote directly as plain Python (async tests via `asyncio.run`). The owner runs the suites.
- The working tree has a lot of uncommitted work from other sessions: targeted edits only, never revert or reformat others' code. Never edit ai-service `.py` files while a blueprint prep run is in flight.
- A hook can make the Read tool return only line 1 of a file: re-read with offset 1 / limit 2000 or use `cat`; check line counts.
- Match the surrounding style: short "why" comments, dated decisions "(decided 2026-10-18)", ~150-char lines.
- No new runtime dependency; no LLM calls except Task 7's two rehearsals (OpenRouter has about $0.55).

## Review Focus

1. A session prepared before this ships (no `realism` block) runs exactly as today: same outline text, same change rule — test in Task 4 and Task 6.
2. A 30-minute DSA round leaves the first problem at least 15 minutes and treats the second as optional — test in Task 2 (`plan_arc`).
3. The decision call times out, errors or returns garbage: the turn still gets a reply within budget and no cap is broken — test in Task 6.
4. A promised area where the candidate says "I don't know": the area counts as covered once asked; it is never re-asked in a loop — test in Task 4.
5. Time words that are not durations ("O(n) time", "time complexity", "take your time", "one more time", "first time") are never blocked by `time_spoken` — test in Task 1.

---

### Task 1: Never say any time of the round

**Files:**
- Modify: `apps/ai-service/app/interviewer/talker.py` (guard rule next to `schedule_again` ~L1322)
- Modify: `apps/ai-service/app/interviewer/closing.py` (new predicate `says_duration`)
- Modify: `apps/ai-service/app/interviewer/conductor.py` (~L385-390 coding-outline order text), `run.py` (~L896-907 `_problem_hint` minutes), `plan.py` (any outline/opening text with minutes), `prompts.py` (rules mentioning minutes)
- Modify: `apps/ai-service/app/interviewer/tracecheck.py` (new check `time_spoken`; retire `schedule_again`/`round_length` if they only police the spoken minutes, or keep them consistent)
- Modify: root `CLAUDE.md` (one sentence in the Interview blueprint paragraph)
- Test: `apps/ai-service/tests/interviewer/test_closing.py`, `test_talker.py`, `test_tracecheck.py`

**Interfaces:**
- Produces: `closing.says_duration(text: str) -> bool`; talker blocked rule name `"time_spoken"`; tracecheck check `time_spoken(record) -> list[Finding]` in `CHECKS`.

- [ ] **Step 1: Write the failing tests**

```python
def test_a_duration_or_minutes_is_never_spoken_but_ordinary_time_words_are():
    from app.interviewer.closing import says_duration
    for t in ["We'll spend about twenty-two minutes on problems.", "You have 10 minutes left.", "This round is forty-five minutes long.",
              "Take a couple of minutes to read it.", "We have half an hour."]:
        assert says_duration(t), t
    for t in ["What's the time complexity?", "That's O(n) time.", "Take your time.", "Say it one more time.", "Is this your first time?",
              "We're short on time, so I'll skip the React questions."]:
        assert not says_duration(t), t
```
Plus `test_talker.py::test_a_sentence_giving_minutes_is_blocked_as_time_spoken` (the guard drops the sentence, rule `time_spoken`, the rest of the turn stays) and `test_tracecheck.py::test_time_spoken_finds_minutes_said_aloud` (a record with an interviewer turn "We'll spend about twenty-two minutes on problems." yields one `time_spoken` finding at that seq).

- [ ] **Step 2: Implement `says_duration`, the guard rule (always on, every phase) and the check; remove every order/prompt text that asks the talker to say minutes (the coding outline "about N minutes", outline minutes, part minutes). Add to CLAUDE.md: "The interviewer never says any duration or minutes aloud (decided 2026-10-18)."**
- [ ] **Step 3: Verify:** `py_compile` the edited files; call the three new tests directly; run `.venv/bin/python <scratchpad>/check_bae.py 2a2cb5c2-9acc-4e1d-be62-855446c82f57` (scratchpad = `/private/tmp/claude-501/-Users-salescode-Desktop-project-interviewiq/6dacfb2b-876f-4cdc-8c97-001ebdf7e408/scratchpad`) and confirm `time_spoken` fires at seq 11. Do not commit.

### Task 2: Round length 30-45 minutes

**Files:**
- Modify: `apps/api/src/db/pg/schema.ts` (`interview_sessions.round_minutes integer`, nullable), then `pnpm --filter @interviewiq/api db:generate` for an additive migration in `apps/api/drizzle/`
- Modify: `apps/api/src/domain/liveRound.ts` (`MOCK_ROUND_MINUTES = 45` stays as the max; add `MOCK_ROUND_MIN_MINUTES = 30`, `ROUND_MINUTE_CHOICES = [30, 35, 40, 45]`, `drawRoundMinutes(rand: () => number = Math.random): number`, `sessionRoundMinutes(s: { roundMinutes: number | null }): number` = `s.roundMinutes ?? MOCK_ROUND_MINUTES`)
- Modify: `apps/api/src/services/interviewSessions.ts` (`book` sets `roundMinutes: drawRoundMinutes()`; reschedule keeps it), `blueprintPrep.ts` (~L99/114 send `sessionRoundMinutes(session)` as `duration_mins`), `liveSessions.ts` (~L138 fallback), `jobs/jobs.ts` (~L77 ceiling uses the session's minutes), `loops.ts` / `domain/process.ts` (pre-booking durations: keep 45 as the stored node duration but the API response for display carries `"30-45"` semantics — see web), the session response DTO (expose `roundMinutes`), `packages/contracts/openapi.yaml` (new optional field) and regenerate web types (`scripts/generate-types.ts`)
- Modify: web `apps/web/lib/constants/interview/index.ts` (export `ROUND_MINUTES_LABEL = "30-45 min"`), every pre-booking display listed by `grep -rln MOCK_ROUND_MINUTES apps/web` (presets, FlowNodes, SlotDialog, NodePalette, ProcessEditor, nodeDragPreview, RoundsPanel) shows `ROUND_MINUTES_LABEL`; `BriefingCard.tsx` keeps showing the booked session's real minutes
- Modify: `apps/ai-service/app/blueprint/stages.py` `plan_arc` (30-minute DSA: first problem ≥ 15 min), `apps/ai-service/app/interviewer/tracecheck.py` (`round_length` reads the record's duration, or is removed if Task 1 removed spoken minutes entirely)
- Modify: root `CLAUDE.md`: replace "Every mock interview round is 45 minutes (decided 2026-10-09 …)" with "A mock round is 30, 35, 40 or 45 minutes, drawn at booking (decided 2026-10-18)…", keeping the live-guidance sentence and the 1.5× ceiling (now of the session's own length)
- Test: `apps/api/test/` (booking, prep payload, ceiling), `apps/web` component tests of changed displays, `apps/ai-service/tests/blueprint/` (`plan_arc`)

**Interfaces:**
- Produces: `interviewSessions.roundMinutes`; API `drawRoundMinutes`, `sessionRoundMinutes`; prep receives `duration_mins ∈ {30,35,40,45}`.

- [ ] **Step 1: Write the failing tests:** `drawRoundMinutes` returns only 30/35/40/45 and all four for `rand` values 0, 0.3, 0.6, 0.99; booking stores a drawn value; reschedule keeps it; the prep payload's `duration_mins` equals the session's value; a session with `roundMinutes = null` uses 45; the reconcile ceiling for a 30-minute session is `1.5 * 30 + SWEEP_GRACE_MINUTES`; `plan_arc` for a 30-minute DSA round with two slots gives the first slot ≥ 15 minutes and all minutes sum to 30; web pre-booking displays render "30-45 min".
- [ ] **Step 2: Implement as listed. Migration must be additive (nullable column).**
- [ ] **Step 3: Verify:** read through the diff for type consistency (tsc/vitest are not run); call the new Python `plan_arc` test directly. Do not commit.

### Task 3: The realism block at prep

**Files:**
- Create: `apps/ai-service/app/blueprint/realism.py`
- Modify: `apps/ai-service/app/blueprint/models.py` (pydantic `Realism`, `RealismOutlinePart`, `ChangeStance`, `SpeechHabits`; `Blueprint.realism: Realism | None = None`)
- Modify: `apps/ai-service/app/blueprint/pipeline.py` (generate and store `realism_seed` per prep run with `secrets.randbits(63)`; re-prep of the same session reuses the stored seed like `pick_shape` reuses the shape), `stages.py` (draw traits before `persona_stage` and pass them into the persona prompt; draw the outline after resume probes and round questions exist), `prompts.py` (persona prompt: "Your traits: …; write the persona consistent with them"), `store.py` (recent trait combos for the candidate, like `recent_shapes_for_candidate`)
- Test: `apps/ai-service/tests/blueprint/test_realism.py`

**Interfaces:**
- Consumes: `shapes.choose_shape`/shape library (outline order source), `interviewer.plan.round_question_areas(personal)` and `deep_dive_probes(personal)` (areas, projects).
- Produces (later tasks rely on these exact names):
  - `TRAIT_AXES: dict[str, tuple[str, str, str]]` with keys `pace, warmth, formality, verbosity, probing, hints, firmness`
  - `draw_traits(rng: random.Random, avoid: list[dict[str, str]]) -> dict[str, str]`
  - `draw_habits(rng: random.Random, traits: dict[str, str]) -> SpeechHabits` (`acks: list[str]` 5-8, `backchannels: list[str]` 3-4, `fillers: dict[str, list[str]]` per existing `fillers.py` stage)
  - `draw_outline(rng, family: str, shape_order: list[str], areas: list[str], projects: list[str], duration_mins: int) -> list[RealismOutlinePart]` where `RealismOutlinePart(part: str, promises: list[str])` and promises look like `"projects:Vibe"`, `"fundamentals:Java"`
  - `change_stance(traits) -> ChangeStance(firmness: str, refusals_prior: int)` (soft 1, normal 1-2, firm 2-3 drawn)
  - `validate_realism(r: Realism, blueprint: dict) -> list[str]` (empty = valid)
  - `Realism(seed: int, traits: dict[str, str], habits: SpeechHabits, outline: list[RealismOutlinePart], change: ChangeStance)` stored as `blueprint["realism"]`

- [ ] **Step 1: Write the failing tests:** same seed → same `Realism`; two seeds → different (over 20 seeds at least 15 distinct trait combos and at least 2 distinct outline orders for a DSA round); `draw_traits` never returns a combo in `avoid` when another exists; every outline fits its family (DSA: core present, every part of the shape order present); promised areas ⊆ `areas`, 1-3 of them, projects 1-2; `validate_realism` rejects an area not in the pool, a missing core, an out-of-range `duration_mins`; habits lists are within the curated vocabulary and the declared sizes; an invalid plan makes the pipeline store `realism = None` and log.
- [ ] **Step 2: Implement.** Curated vocabularies live in `realism.py` (acks: "Right.", "Sure.", "Got it.", "Makes sense.", "Okay, cool.", "Fair enough.", "Hmm, okay.", "Okay.", "Alright.", "Nice.", "I see."; backchannels: "Mm-hmm.", "Right.", "Yeah.", "Okay.", "Sure."; fillers: extend `fillers.py` stages to 5-6 per stage). Exclude incoherent trait pairs by construction (e.g. `warmth=very warm` excludes `formality=very formal`).
- [ ] **Step 3: Verify:** `py_compile`; call the new tests directly. Do not commit.

### Task 4: The outline said in the interviewer's words, and kept

**Files:**
- Modify: `apps/ai-service/app/interviewer/plan.py` (`outline_parts` / `_deep_dive_parts` read `blueprint["realism"]["outline"]` when present, else today's template), `conductor.py` (promises ledger), `run.py` (mark coverage after each interviewer turn; pass outline content to framing), `prompts.py` (framing gives parts/areas as content not a sentence; deep dive: questions are a pool per area, interviewer picks order and follow-ups, must cover each promised area; replaces "Ask the listed questions in the order given" ~L342-343), `talker.py` (guard `outline_mismatch`), `tracecheck.py` (`outline_unkept`, `outline_mismatch`)
- Test: `tests/interviewer/test_plan.py`, `test_conductor.py`, `test_run.py`, `test_talker.py`, `test_tracecheck.py`

**Interfaces:**
- Consumes: Task 3 `Realism.outline` (`part`, `promises`).
- Produces: `Conductor.promises: dict[str, str]` (promise → `"open" | "covered" | "dropped"`, checkpointed); `Conductor.mark_covered(text: str) -> list[str]` (promises a turn's text covers: area via `plan._AREAS` patterns, project by name); `Conductor.uncovered() -> list[str]`; `Conductor.drop_with_notice(promises: list[str]) -> Order`; `closing.outline_areas(text: str) -> set[str]`.

- [ ] **Step 1: Write the failing tests:** with a realism outline promising Java and databases, the framing order names exactly those areas; the guard blocks a spoken outline that omits "Java" or adds "React" (rule `outline_mismatch`) and passes one naming both in any wording; a deep-dive turn asking about SQL marks `fundamentals:databases` covered; the conductor refuses to leave `deep_dive` for `candidate_questions` while `fundamentals:Java` is open and the round has time, and orders the next open area; when time runs out it issues `drop_with_notice` whose order text asks for one sentence naming the skipped area without numbers; a candidate answering "I don't know" still leaves the area covered and it is not re-asked; a blueprint without `realism` produces today's outline text exactly; `outline_unkept` fires for a record whose promised area was never asked and never dropped; `outline_mismatch` fires for the spoken outline of session `bf82d318-06c3-4e25-9c08-2df571bdb324` turn 11 vs its blueprint only if a realism block existed (else skipped).
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Verify:** `py_compile`; call the new tests directly; `check_bae.py` on `bf82d318-06c3-4e25-9c08-2df571bdb324` runs without error. Do not commit.

### Task 5: Variety in fixed lines, fillers and openers

**Files:**
- Create: `apps/ai-service/app/interviewer/lines.py`
- Modify: `conductor.py` (GIVE_UP_LINE, CODING_OVER_LINE, swap line, VIOLATION_LINES, FINAL_WARNING_LINES, AWAY_OVERSTAY_LINES, PROCTOR_END_LINE, CONDUCT_WARNING_LINE, ABUSE_END_LINE), `plan.py` (`problem_put_up`, `problem_swap_put_up`, `problem_intro`), `run.py` (LINE_CHECK_REPLY, BACKCHANNEL, YIELD_LINE), `said.py` (NEUTRAL_LINES, GO_AHEAD_LINE), `talker.py` (UNCLEAR_REPLY; guard `repeated_opener`; talker prefix gets "How you talk" from `realism.habits` and `realism.traits`), `fillers.py` (random draw, no repeat of the last 2 per stage, vocabulary from habits when present), `closing.py` and `tracecheck.py` (matchers use `lines.matches(key, text)` instead of exact strings), `prompts.py` (rules that prescribe one exact example sentence, e.g. the bridges at ~L78 and "Okay." as the good example at ~L70-72, describe the intent and take their examples from the persona's habits or a pool instead), `llm.py` (explicit `temperature`: talker 0.7, director 0.2; config `INTERVIEWER_TALKER_TEMPERATURE`, `INTERVIEWER_DIRECTOR_TEMPERATURE` in `app/config.py` + `.env.example`)
- Test: `tests/interviewer/test_lines.py` (new), plus updates where tests assert today's exact lines

**Interfaces:**
- Produces: `LINES: dict[str, tuple[str, ...]]` keys `put_up:<ordinal>`, `intro:<ordinal>`, `swap_put_up`, `give_up`, `coding_over`, `unclear`, `presence`, `line_check`, `yield`, `go_ahead`, `neutral`, `violation:<kind>`, `final_warning:<kind>`, `away_overstay:<kind>`, `proctor_end`, `conduct_warning`, `abuse_end` (3-6 variants each; warnings/endings 2-3, same meaning and firmness); `class LinePicker: __init__(self, rng: random.Random, used: dict[str, list[str]] | None = None)`, `pick(self, key: str) -> str` (no repeat within the round until the pool is exhausted), `state(self) -> dict[str, list[str]]` (checkpointed by the run); `matches(key: str, text: str) -> bool`; talker blocked rule `repeated_opener`; tracecheck check `repeated_opener`.

- [ ] **Step 1: Write the failing tests:** `pick` never returns the same variant twice for a key until all were used; every pool's variants pass `matches` for that key and fail for other keys of different meaning; `repeated_opener` blocks an opener ("Mm, okay.") used in the previous interviewer turn and one used twice in the last five turns, and passes a fresh one; fillers never repeat the previous draw of a stage; the talker prefix contains the persona's habits when `realism` exists and today's text when it doesn't; the existing tests that pin today's exact strings now assert `matches(key, ...)`; tracecheck `problem_line_twice`, `changed_twice`/its successor, `move_announced_not_made`, `warning_glued` still fire on the stored sessions `c8ccd40d-8b68-404f-acd5-4e2a3700e878` and `2a2cb5c2-9acc-4e1d-be62-855446c82f57` as before (run `check_bae.py`).
- [ ] **Step 2: Implement.** The rng is seeded from `realism.seed` (or the session id when absent) so a rehearsal replays.
- [ ] **Step 3: Verify:** `py_compile`; call the new tests directly; `check_bae.py` on both sessions shows the same findings as before this task plus any new `repeated_opener`. Do not commit.

### Task 6: Problem changes decided by the interviewer

**Files:**
- Create: `apps/ai-service/app/interviewer/change_decision.py`
- Modify: `conductor.py` (`on_change_request` returns allowed actions; `CHANGE_CAP = 1`; refusal tracking; `apply_change_action`), `run.py` (on a change-request turn: decide, execute, then speak), `talker.py` (guard `repeated_refusal`), `prompts.py` (resist guidance: say something new each time, persona voice; director rule updated), `tracecheck.py` (`changes_over_cap`, `change_without_refusal`, `change_flow_valid` replacing `changed_twice` / `give_up_handled`; `repeated_refusal`), `scripts/flow_scenarios/personas/*.json` (expectation ids renamed), root `CLAUDE.md` (replace the 2026-10-18 change-rule sentences with the new rule)
- Test: `tests/interviewer/test_change_decision.py` (new), `test_conductor.py`, `test_run.py`, `test_talker.py`, `test_tracecheck.py`, `test_expectations.py`

**Interfaces:**
- Consumes: Task 3 `Realism.change` (`firmness`, `refusals_prior`); Task 5 `LinePicker` for the change lines.
- Produces:
  - `ChangeAction = Literal["resist", "change", "end_coding"]`
  - `async def decide_change(chat, *, firmness: str, refusals_problem: int, refusals_round: int, changes_round: int, candidate_text: str, attempted: bool, minutes_left: float, allowed: frozenset[str], timeout_s: float = 1.2) -> tuple[ChangeAction, str]` (second item `"model"` or `"fallback"`; never raises; output outside `allowed` → fallback)
  - `def fallback_action(refusals_prior: int, refusals_problem: int, allowed: frozenset[str]) -> ChangeAction`
  - `Conductor.allowed_change_actions() -> frozenset[str]` (applies every hard limit from Global Constraints)
  - `Conductor.apply_change_action(action: ChangeAction) -> Order` (resist → `keep_problem` order with the refusal points already said; change → `_change_problem` mechanics with a pooled line; end_coding → `_end_coding`)
  - `Conductor.refusal_points: set[str]` (checkpointed); `closing.refusal_points(text: str) -> set[str]` with families `partial_fine`, `see_how_far`, `give_it_a_try`, `start_small`, `stay_with_it`

- [ ] **Step 1: Write the failing tests:** `allowed_change_actions` excludes `change` before any refusal this round, after the round's one change (`CHANGE_CAP = 1`), with under 480 s left, with no non-harder replacement, and after the coding ended; excludes `end_coding` before a refusal on the current problem; `decide_change` with a chat that times out, raises, or answers "swap please" returns the fallback within 1.3 s and never an action outside `allowed`; with a stub answering `{"action": "change"}` it returns `("change", "model")`; the run executes the change (problem shown) before the talker speaks; a resist order lists already-said refusal points and the guard blocks a sentence repeating one (`repeated_refusal`); a blueprint without `realism` follows today's rule (first ask resisted, second ask the change, after it resist then end coding) via `fallback_action` with `refusals_prior=1`; tracecheck: `changes_over_cap` and `change_flow_valid` fire on `c8ccd40d-8b68-404f-acd5-4e2a3700e878` turn 14, `repeated_refusal` fires on a record with "a partial solution is fine" in two refusals.
- [ ] **Step 2: Implement.** Decision prompt: persona firmness and prior, counts, attempted yes/no, minutes left, allowed actions, the candidate's words; output JSON `{"action": ..., "why": ...}`; the talker model via the existing OpenRouter chat with `max_tokens` ≤ 60 and reasoning off. Record `change_decision: {action, source, ms}` on the turn doc.
- [ ] **Step 3: Verify:** `py_compile`; call the new tests directly (async via `asyncio.run`); `check_bae.py` on `c8ccd40d…` shows the new checks at turn 14. Do not commit.

### Task 7: Variety report and two rehearsals

**Files:**
- Modify: `apps/ai-service/scripts/rehearse_flow.py` (new subcommand `variety RECORD.json RECORD.json [...]`: per pair, which of {length, outline order, promised areas, projects asked, persona traits, five most used openers} differ; pass = every pair differs in ≥ 3)
- Test: `tests/interviewer/test_rehearse_variety.py` (new) for the pair comparison on two synthetic records

- [ ] **Step 1: Write the failing test** (two records differing in length, areas and openers → 3 differences → pass; identical → fail).
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Run exactly two persona rehearsals** (budget about $0.55 total): `scripts/flow_scenarios/personas/struggler_gives_up.json` twice with two different `--session` ids (or seeds) so prep draws different realism blocks; then `check` on each record and `variety` on the pair. If either record shows failed attempts / HTTP 402, stop and report (do not rerun).
- [ ] **Step 4: Report** the trace check findings, the variety result, the change decisions made (`change_decision` per turn), and cost. Do not commit.
