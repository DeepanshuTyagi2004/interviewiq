# Interview Agent — Self-Eval & (Budget-Bounded) Autonomous Improvement Loop — Design

- **Date:** 2026-07-08 (rev. 2 after adversarial stress-test)
- **Status:** Draft (awaiting user review). Fact-checked + adversarially attacked by an 8-agent workflow (52 raw → 32 ranked findings, 12 high-severity); all folded in — see §16 changelog.
- **Repos touched:** `interviewiq-ai-service` (eval engine — new `app/interview_eval/` package + prompt registry seam), `interviewiq-backend` (Spring BFF proxy), `interviewIQ-frontend` (new *Self-Eval* Intelligence tab)
- **Sequel to:** [2026-07-04-pipeline2-live-interview-brain-design.md](2026-07-04-pipeline2-live-interview-brain-design.md) (the brain being evaluated), [2026-07-07-agent-diagnostics-design.md](2026-07-07-agent-diagnostics-design.md) (same in-process `run_session` harnessing, transport-double pattern, run-store/polling substrate, Intelligence-tab shell)

---

## 1. Summary

Build a **self-evaluation harness** for the live interview agent, plus a **budget-bounded autonomous prompt-improvement loop** on top of it. The harness reuses the **frozen decision brain** (`run_session` / `decide`) driven through a new `SimulatedCandidateTransport` (an LLM playing seeded candidate personas), captures each run's transcript + decision trace + outcome, scores it with an **LLM realism judge** against a fixed **realism rubric**, and aggregates batches into a ranked, transcript-anchored **defect backlog**. On top of measurement, an **optimizer** autonomously rewrites the agent's *system prompts*, A/B-tests candidates behind static + runtime + regression gates, and promotes winners into a **staging** prompt version; a human's **staging→prod flip is the single gate** and the explicit backstop against judge-overfit.

**v1 reality (from the stress-test + provisioning decision):** the configured model backend is a **single free-tier** provider (Google AI Studio; RPM 15 / RPD 1,500). That ceiling means the **measurement + regression harness is the primary v1 deliverable** — it runs on small suites daily and feeds a human-driven improvement track. The **autonomous optimizer is real but rate-bound**: it runs tiny suites when request budget allows and cannot execute the large multi-round sweeps a paid tier would; genuine judge *diversity* (independent backends) is not available, so single-backend judge correlation is accepted and caught by the human staging→prod review. Scaling the autonomous half up is a later change (add a paid/second backend — §12/§15), not a redesign.

This is **the frame spec** for a program of realism work; six follow-on capability slices (A–F, §11) each land *into* this harness and are graded by it.

## 2. Goals / Non-goals

**Goals**
- Evaluate the **real production decision path** — `decide` (graph.py:53) and `run_session` (session.py:370) run unmodified; the eval package adds **no new call into the brain's decision logic** (`decide`/`graph`). *(The brain's I/O layer `llm_ops` gains one registry indirection — see §6; this is not a decision-logic change but it is a change, stated honestly in §12.)*
- Drive the brain with a reactive **LLM simulated candidate** (seeded personas) so genuine back-and-forth realism is stressed.
- Score every run against a fixed, versioned **realism rubric** with an LLM judge → per-dimension scores + transcript-anchored defects + suggested fixes.
- Produce a ranked **defect backlog** + **regression signal** that drives a **human-driven improvement track** (the primary loop on free tier) *and* feeds the autonomous optimizer.
- Provide a **budget-bounded autonomous** optimize → static-gate → A/B → runtime-gate → regression-gate → promote-to-`staging` loop, with **auto-promotion only into `staging`**; the human `staging→prod` flip is the one gate and the judge-overfit backstop.
- Make system prompts **versioned + runtime-swappable** via a Mongo-backed registry with per-environment (`prod`/`staging`) pointers and a **synchronous, no-Mongo default resolver seam** (returns the seeded Python constant when nothing is bound — keeps `llm_ops` call-compatible and never fails a live interview on a registry read).
- Surface everything in a new **Self-Eval Intelligence tab** + a **CLI regression gate** for CI.
- Bake in **anti-reward-hacking guardrails**: a two-stage invariant gate (static prompt-text lint + runtime per-utterance gate), an anti-*padding* substance-ratio check, a per-dimension **and per-persona** regression floor, a **technical-soundness** invariant, held-out scenarios, and the human evidence-review flip.

**Non-goals**
- **No changes to the brain's decision logic** (`decide`/`graph`); its existing tests stay green. A test asserts no new control-flow call is introduced into `decide`/`graph`.
- **No autonomous edits to production.** The optimizer is handed a **staging-only registry client with no code path to write the `prod` pointer**; `prod` changes only via the human promote endpoint.
- **No autonomous edits to control-flow code** (`decide`, the driver loop's nudge/silence escalation, `SILENCE_TIMEOUT_S`), and **no edits to the prep-pipeline prompts** (`ladder`/`persona`) in v1. These are **measure-only** (§7.4) and improved via the human-driven track (§9.4).
- **No autonomous rewriting of the user-turn template functions** (`build_*_prompt(...)`) in v1 — the registry versions/optimizes only the `*_SYSTEM` constant half (§6).
- **No real audio / STT / TTS / LiveKit.** The loop runs on the text `Transport` seam. Timing-dependent dimensions (silence, interruption) carry an explicit live-vs-text validity caveat (§7.5).
- **Not a candidate scoring/ranking feature.** This evaluates the *agent*.
- **No always-on autonomy in v1.** Optimize runs are **manually triggered**; on free tier they are additionally rate-bound.

## 3. Locked decisions (from brainstorming + stress-test)

1. **First spec = the self-eval harness + realism rubric** (the frame). A–F realism slices are follow-on specs measured here (§11).
2. **Eval signal = LLM-judge only** for v1 (fixed rubric + few-shot anchors + prompt-variant judges).
3. **Autonomy = autonomous** optimize → A/B → promote, **but winners land in `staging` only**; a human flips `staging → prod` — the single gate. Reconciles full autonomy with the CLAUDE.md "interviewer prompt = product IP, human-review-gated" rule.
4. **Simulated candidate = LLM personas from fixed seeds** (hybrid): seeded, reactive; N samples per scenario → distribution.
5. **Provisioning = stay free-tier (measure-first).** No paid backend in v1 ⇒ tiny throttled suites; autonomous optimize is rate-bound; **judge "diversity" = prompt-variants on one backend, correlated-bias accepted**. Scaling up = add a backend later (§12/§15).
6. **Judge-overfit backstop = the human `staging→prod` flip**, made an explicit evidence-review (diff + per-dim + per-persona deltas + sampled transcripts). Held-out *judge* deferred until a second backend exists.
7. **Plan = guidelines, not a script.** The judge is fed the plan's ladder text and **rewards adaptation / penalizes verbatim recitation** (§7.3, dim 7).
8. **Architecture = in-process eval package** in `interviewiq-ai-service`, reusing the observability substrate; 3-repo shape mirrors Agent Diagnostics.
9. **Two sanctioned infra changes** beyond the eval package: (a) route `*_SYSTEM` prompt lookups through a registry resolver seam (§6); (b) add `temperature`/`seed` overrides to the LLM client path (§12). Both small, both stated up front.
10. **Optimize trigger = manual** (+ rate-bound on free tier).
11. **Scale = a tiny "smoke suite" is the default**; the full 12-persona × 4-round × 3-sample (~144-run) batch is an explicit, resumable, multi-day-on-free-tier opt-in (§8.5). 30% holdout.
12. **Agent-under-test is evaluated at its PROD temperature (0.2)**, not temp 0 — so we measure the real behavior distribution; only the sim-candidate/judge are pinned lower (§12).

## 4. Background — what already exists (reuse, do not rebuild)

### 4.1 The frozen brain + Transport seam (`interviewiq-ai-service`)
- **`run_session(transport, plan, settings)`** (session.py:370) — verified signature/location. Never raises for interview content (session.py:514-526). Talks to the world only through `Transport`.
- **`Transport` Protocol** (transport.py:20-26): `say`, `next_utterance() -> (text, UtteranceTiming) | None`, `current_artifact() -> Artifact | None`, `end_session`, `seconds_since_activity() -> float`. Impls: `ScriptedTransport` (transport.py:29), `LiveKitTransport` (transport.py:78; `push_utterance` :147). We add a third (§8.4). **The protocol is strictly turn-based — no overlap/barge-in primitive** (relevant to dim 11 / slice B, §7.5).
- Driver silence escalation (nudge→warning→abandon) + `SILENCE_TIMEOUT_S = 45.0` live in the driver loop (session.py:392-437, transport.py:14) — **frozen; measure-only** (§7.4).
- Per-turn pipeline (session.py:440-509): `begin_turn → classify → scope → grade(answer-gated) → pacing → route(decide) → action`.

### 4.2 The diagnostics emitter (reused to capture the decision trace)
- `diagnostics_emit.py` (208 lines): contextvar-based, **no-op unless bound**. `begin_turn`, `step_begin`, `step_end`, `step_skipped`, `decide_with_reason`, `record_thought`, `record_llm_io`, `record_llm_timing` — all verified present. Records into module-global `AGENT_SESSIONS` keyed by run_id (concurrency implication — §5/§13).

### 4.3 The LLM client + structured wrapper
- `app/llm/client.py` — OpenAI-compatible async client. **`build_llm_client(settings, model=<name>)` overrides only the model NAME; it hardcodes `settings.llm_base_url` + `settings.llm_api_keys` (single provider) and hardcodes `temperature=0.2` with no `seed`** (client.py ~:176, :280-288). Rate-limit cooldowns per key; free-tier limits ~RPM 15 / RPD 1,500. Diagnostics tap records thoughts/IO/timing.
- `app/llm/structured.py` — validate-and-repair against a pydantic schema (`complete_structured`, :50-58).

### 4.4 The prompts to be registered (currently module constants)
`prompts/converse.py` (`CONVERSE_SYSTEM` :11, `CONVERSE_PROMPT_VERSION="v2-conversational"` :9), `classify.py` (`CLASSIFY_SYSTEM` :8), `grade.py` (`GRADE_SYSTEM` :8), `pacing_judge.py`, `opening_classify.py`, `derive.py`, **and `gender_classify.py` (`GENDER_CLASSIFY_SYSTEM`) — a 7th prompt-backed op (`infer_gender`)**. Consumed via `llm_ops.py` (`generate_line`, `grade_answer`, `judge_pacing`, `classify_turn`, `classify_opening_turn`, `derive_ladder`, `infer_gender`). **Each optimizable call site uses TWO pieces: the `*_SYSTEM` constant AND a `build_*_prompt(...)` user-turn template** (e.g. `CONVERSE_SYSTEM` + `build_turn_prompt`). v1 registers/optimizes only the `*_SYSTEM` half (§6).

### 4.5 The observability substrate (reused for run status + live logs)
- The eval loop reuses **`app/jobs/pipeline_runs.py::RUNS` (`PipelineRunStore`) + `PipelineRunLogHandler`** — the substrate behind **résumé-parse and interview-prep** (a batch/optimize is a *linear step pipeline*, the correct fit). *(Note: Agent Diagnostics uses a **separate** sibling `app/jobs/agent_sessions.py::AgentSessionStore` + `AgentDiagLogHandler` for its interactive turn/step tree — the eval loop does **not** reuse that one.)* Admin routes gated by `require_internal_key` (`X-Internal-Api-Key`).

### 4.6 3-repo wiring precedent (mirror it, corrected)
- **Backend**: `AdminInterviewAgentController` — `@RequestMapping("/api/{version}/intelligence/interview-agent", version="1")` (resolves to `/api/v1/...`). Error mapping is **`HttpClientErrorException.NotFound → 404 "run_not_found"` / `TooManyRequests → 429 "sessions_at_capacity"` / `RestClientException → 502 "ai_service_unreachable"`** (there is **no 400 branch**). `AiServiceClient` attaches the internal key. **RestClient pinned HTTP/1.1** (uvicorn body-drop gotcha). `/api/v1/intelligence/**` is already ADMIN-gated by `SecurityConfig` — **no SecurityConfig edit needed** for a new sub-path.
- **Frontend**: Intelligence tab shell `app/(app)/intelligence/page.tsx` (add a tab). `RunLogStream` is generic-reusable. **`DecisionTimeline` (`{turns: AgentTurn[]}`) and `StepDetailDrawer` (`{step: AgentStep|null}`) are typed against `AgentTurn`/`AgentStep` from `@/features/agent-diagnostics`** and carry diagnostics-specific required fields — reusable for eval drill-down **only if** the ai-service serializes each `EvalRun` trace into the **identical `AgentTurn`/`AgentStep` JSON shape** (it can — same emitter, §4.2), and Self-Eval either imports those types cross-feature or they're promoted to `features/observability` (§10.4).

## 5. Architecture & module boundaries

New package **`app/interview_eval/`** (ai-service):

| Module | Responsibility |
|--------|---------------|
| `personas.py` | Fixed-seed `PersonaSpec` library (§8) |
| `scenarios.py` | Scenario bank = persona × round fixture × seed; `holdout` split; plan fixtures |
| `sim_candidate.py` | `SimulatedCandidateTransport(Transport)` — LLM persona player; timing + **activity/silence coupled to artifact edits** + evolving artifact buffer (§8.4) |
| `run_one.py` | Run one eval: build plan+transport, **bind the diagnostics emitter INSIDE this coroutine with a DISTINCT emitter run_id** (§13), call frozen `run_session`, capture `EvalRun` |
| `rubric.py` | Realism rubric — dimensions, weights, **confidence flags, measure-only flags**, descriptors, anchors, invariants (§7). **Product IP, versioned.** |
| `judge.py` | LLM realism judge (prompt-variant judges, median) — **fed the plan ladder text + canonical solution path** → `JudgeResult` (§7) |
| `invariants.py` | Static prompt-text lint (§9 step 4) + runtime per-utterance checks (§9 step 5.5): substance-ratio, no-redundant-reask, recitation-similarity, semantic-leak prefilter |
| `batch.py` | Run scenarios × N samples (bounded concurrency), aggregate → `BatchReport` (per-dim **and per-persona** distributions + CIs, deduped ranked defect backlog, regression vs baseline) |
| `prompt_registry.py` | Versioned prompt store + per-env pointers; Mongo-backed; **synchronous no-Mongo default resolver seam**; **scoped staging-only client** for the optimizer; seed backfill from constants (§6) |
| `cost.py` | Token/request budget accounting + free-tier rate pacing (§12) |
| `optimizer.py` | Budget-bounded autonomous loop (§9). Holds only the staging-only registry client. |
| `models.py` | pydantic records (§14) |
| `service.py` + `api` router | FastAPI routes (§10); reuses `pipeline_runs.RUNS` |
| `cli.py` | CI regression gate (§10.5) |

**Data flow (one run):** `Scenario → plan fixture + SimulatedCandidateTransport → bind emitter (own coroutine, distinct id) → run_session(frozen, prod-temp) → EvalRun{transcript, decision_trace, outcome, failed?} → judge → JudgeResult` → aggregated by `batch` → consumed by human track / optimizer.

## 6. The prompt registry seam (sanctioned infra change #1)

- **`prompt_registry.active(prompt_id, env="prod") -> str`** with a **synchronous, no-Mongo default resolver seam**: when nothing is bound (unit tests, cold start, Mongo down) it returns the **seeded Python constant** — so `llm_ops` stays call-compatible and a live interview **never fails on a registry read**. `test_llm_ops.py` injects this seam (§13).
- **Live-path change**: `llm_ops` resolves the `*_SYSTEM` text via the seam instead of importing the constant; `build_*_prompt(...)` template functions **remain imported code** (out of scope for autonomous rewrite in v1). `env` defaults to `prod` live; eval passes `staging` or a specific candidate version.
- **Caching correctness (F3):** cache key = **`(prompt_id, env, resolved_version)`** in separate namespaces, so a staging/candidate resolution can **never** populate the `prod` entry. **`run_session` snapshots all `prod` prompt texts once at session start** and pins them for the life of that interview — a promote can never mutate an in-flight session (no personality swap mid-interview). Cross-worker invalidation via a documented bounded TTL (Redis pub/sub if/when multi-worker). Fallback order on Mongo failure: last-good cache → seeded constant.
- **Prod-write capability (F2):** the `prod` pointer is writable only through a **distinct server-side capability** held solely by the human promote endpoint. The optimizer receives a **staging-only client that raises on any `env='prod'` write** (asserted by test, §13).
- **Scope**: registered = `converse`, `classify`, `grade`, `pacing_judge`, `opening_classify`, `derive` (optimizable) + `gender_classify` and the prep `ladder`/`persona` (**registered for versioning/visibility, non-optimizable**). Seed backfill imports each current constant as `v0`, set as both `prod` and `staging`, so a fresh deploy behaves exactly as today.

## 7. The realism rubric (core IP)

Two tiers + explicit flags. The optimizer maximizes a **confidence-weighted** objective over scored dimensions, subject to invariant gates and regression floors.

### 7.1 Tier 1 — Scored dimensions

| # | Dimension | Weight | Confidence (v1) | In optimizer objective? |
|---|-----------|-------:|-----------------|--------------------------|
| 1 | Tone calibration (not sweet, not rude) | 0.12 | full | yes |
| 2 | Natural language | 0.10 | full | yes |
| 3 | Turn-taking & responsiveness (+ **cross-channel awareness**, §7.3) | 0.12 | full | yes |
| 4 | Follow-up intelligence | 0.14 | **partial** → full after slice D | **NO (measure/display-only until full)** |
| 5 | Silence & nudging | 0.08 | partial (timing caveat §7.5) | **measure-only** (frozen algo, §7.4) |
| 6 | Unknown handling & answer policy | 0.10 | **partial** → full after slice E | **NO until full** |
| 7 | Adaptivity (split: adaptation LLM + verbatim-recitation deterministic) | 0.10 | full | yes |
| 8 | Scope & integrity | 0.08 | full | yes |
| 9 | Question framing | 0.06 | **partial** → full after slice C | **NO until full** |
| 10 | Pacing & arc | 0.05 | full | yes |
| 11 | Interruption handling | 0.05 | **none (weight 0)** until slice B | no |
| 12 | **Technical soundness** (new, §7.2) | 0.00 scored / **invariant** | full | invariant gate |

**Objective rule (F9):** the maximized objective sums only **full-confidence, non-measure-only** dimensions; partial/none/measure-only dimensions are **measured and displayed but excluded from the optimization objective** (so the loop cannot bake robotic follow-ups into staging by gaming dim-4's proxy). When a dimension flips `partial→full` (a slice lands), a **regression re-baseline is required**. Weights re-normalize over the active objective set.

### 7.2 Tier 2 — Hard invariants (two-stage; violation caps the run + blocks promotion)

**Stage A — static prompt-text lint** (§9 step 4, before any run): candidate prompt must not embed rubric text, must not instruct multi-question turns, must retain the existing guardrail clauses (no-solution-reveal / single-ask / acknowledge-before-act instructions).

**Stage B — runtime per-utterance gate** (§9 step 5.5, after A/B runs, before selection): checked over the actually-generated utterances. Any single violating utterance in any run hard-fails the candidate.
- **No rubric/scoring leakage** — token-scan **prefilter** + **semantic judge-confirm** (paraphrase-evasion resistant), candidate-quoted spans exempt.
- **No solution reveal** — judge-confirmed **against the plan's canonical solution path** (given to the judge); token scan is a coarse prefilter only.
- **Single-ask** — **judge-scored** (count distinct new-information requests, excluding quoted candidate text + rhetorical/discourse questions), **not** a naive `?`-count.
- **Anti-padding substance-ratio** (F10) — measure the acknowledgment/preamble span vs the substantive ask **per TURN** (not per `say()` call); bounds are **round-type- and persona-relative**. Raw length band demoted to a weak secondary signal.
- **No-redundant-reask** (F26) — deterministic semantic-dedup of the agent's questions within a session against prior answered turns.
- **No false technical claim** (F16, dim 12) — judge-confirmed against the plan's ladders/rubric; guards against the objective rewarding fluent-but-*wrong* hints. **Required before autonomous optimization is enabled.**
- **No harshness** — judge-confirmed.
- **(slice B) yields-on-barge-in**; **(slice-12 candidate) no nudge while the artifact is actively changing** (F12).

### 7.3 Judge input + output
**Input** (this closes dim-7 and no-reveal gaps): full transcript + decision trace + **the plan fixture's ladder/base-question text** + **the canonical solution path** for the active problem + the persona's intent. **Output contract:**
```json
{ "dimensions": [ { "id": "tone", "score": 0.0, "confidence": "full|partial|none",
    "rationale": "...", "defects": [ { "turn_index": 7, "problem": "...", "severity": "low|med|high", "suggested_fix": "..." } ] } ],
  "invariants": [ { "id": "no_solution_reveal", "passed": true, "evidence_turn": null } ],
  "cross_channel": { "artifact_changes_unreferenced": 0, "referenced": 0 },
  "recitation_similarity": 0.0, "overall_realism": 0.0, "would_pass_as_human": true }
```
- **Dim 7 split**: `adaptation` (LLM judgment of adapting-vs-reciting) + a **deterministic recitation-similarity** (n-gram/embedding of the agent's posed questions vs the ladder base strings) as a `confidence:full` signal.
- **Cross-channel awareness (F25)**: given the artifact diff between turns, did the agent reference a data-flow change the candidate did **not** verbalize? Scored under dim 3.

### 7.4 Measure-only vs auto-improvable (F11)
Dimensions/behaviors that live in **frozen code** — dim 5 (nudge/silence escalation + `SILENCE_TIMEOUT_S`), the `decide` four-way "I'm done" branch (next-followup / probe-impl / point-out / move-on), dim 4's routing half — are **measure-only in v1**: the optimizer cannot touch them. They are improved via the **human-driven A/B track** (§9.4), which scores hand-authored driver-loop/`decide`/threshold changes through this same rubric+harness (batch-eval, no auto-promote). This is how the user's explicit asks (better nudging, silence, and the "I'm done" branch) get gated by the realism bar without autonomous edits to control flow.

### 7.5 Timing-dependent validity caveat (F28)
Dims 5 and 11 are audio-timing behaviors; the text seam is only a proxy (no `push_utterance`-mid-`say`, STT latency, TTS duration). Gains on the text sim may not transfer to the live LiveKit path — a **deferred live-audio spot-check** (extend the §15 calibration queue) samples promoted prompts against a small real-audio run before trusting text-seam gains on these dims.

## 8. Simulated candidate: personas & scenarios

### 8.1 `PersonaSpec` — as before (id, label, skill_level, disposition, behaviors{}, writes_artifact, artifact_quality, verbosity, ttf_word_s, system_fragment).

### 8.2 Persona library (audience-calibrated: Tier 2/3 Indian ESL) — **14**
Strong-fluent *(annotated dim-1 sycophancy-trap)* · **Flawless-high-performer** *(tempts over-praise)* · Strong-terse · Weak-struggling · Nervous-apologetic · Rambler · Silent/absent · **Silent-but-coding / heads-down-implementer** *(F12)* · Asks-for-the-answer · Premature-"I'm done" · Out-of-scope-pivoter · Adversarial-challenger · ESL-hesitant · **Interrupter/talks-over** *(slice B, dim 11)*.

### 8.3 `Scenario` — as before (`plan_fixture`, persona, round_type, seed, `injected_events`, `holdout`, `max_turns`). Plan fixtures: realistic `InterviewPlan` *guideline* docs per round (DSA / LLD / SD / behavioural), frozen. 30% holdout.

### 8.4 `SimulatedCandidateTransport` — **activity/silence coupling (F12)**
Full `Transport` protocol. `next_utterance()` → seeded LLM call → `(text, UtteranceTiming)` with realistic timing, **or** a silence window. **Crucially: while a persona is silently editing (artifact buffer mutating between turns), `seconds_since_activity()` is suppressed/reset — mirroring the LiveKit path where an `artifact` message counts as activity** — so a heads-down implementer is *not* nudged, and the brain's "don't nudge while coding" branch is genuinely exercised. `current_artifact()` returns the evolving buffer (partial→buggy→refined per `skill_level`/`artifact_quality`).

### 8.5 Scale & free-tier pacing (F8)
Default = a **tiny smoke suite** (a persona-critical subset × the round(s) under test, ~10–15 runs) for routine measurement/regression. The full **14×4×3 (~168-run)** batch is an explicit, **rate-paced, resumable** opt-in that spans multiple days on free tier. `batch`/`optimizer` respect RPM/RPD via `cost.py` (§12).

## 9. The budget-bounded autonomous optimization loop

```
1. BASELINE   run `staging` prompts over the (smoke or full) TRAINING set at PROD temp → BatchReport_0 (per-dim + per-persona + CIs)
2. TARGET     top-K deduped defects (weight × severity × frequency, restricted to IN-OBJECTIVE dims), grouped by implicated *_SYSTEM prompt
3. PROPOSE    optimizer-LLM drafts N candidate edits to ONE *_SYSTEM prompt at a time (current text + its defects + invariant clauses + few-shot)
4. STATIC GATE reject any candidate failing the STATIC prompt-text lint (§7.2 Stage A) — before spending eval tokens
5. A/B        run survivors vs. incumbent over TRAINING set → per-candidate BatchReport
5.5 RUNTIME GATE reject any candidate with a RUNTIME invariant violation (§7.2 Stage B) in any run — before selection
6. SELECT     promotable ONLY if ALL hold (medians over prompt-variant judges, with CIs):
                 overall (in-objective) > incumbent + min_delta   [min_delta derived from measured per-dim stdev: delta > k·σ]
                 AND no in-objective dimension < incumbent − floor
                 AND NO PER-PERSONA cohort (esp. ESL) < its cohort floor        (F17)
                 AND no increase in invariant violations
7. HOLDOUT    re-run the best candidate over HOLDOUT scenarios; re-apply gate #6. Fail → discard. (catches SCENARIO overfit; JUDGE overfit is caught at the human flip — F5)
8. PROMOTE    winner → new PromptVersion, set `staging` pointer (staging-only client), write OptimizationRound provenance
9. LOOP       until no promotable candidate for R rounds OR max_rounds OR token/REQUEST budget exhausted (rate-bound on free tier)
```

### 9.1 Anti-reward-hacking (corrected)
- **Static lint (#4)** kills prompt-TEXT-level violations pre-run; **runtime gate (#5.5)** kills emergent behavioral violations (stacking/padding/leak) post-A/B, pre-selection. *(No claim that behavioral violations are caught before the agent runs.)*
- **Anti-padding = substance-ratio, per-turn** — bounds padding proportion, not total length.
- **Partial-confidence dims excluded from the objective** — can't be gamed to promote.
- **Per-dimension AND per-persona floors** — a fluent-majority win that regresses the ESL cohort is not promotable.
- **Technical-soundness invariant** — the objective can't reward fluent-wrong hints.
- **Holdout scenarios** catch scenario/persona memorization; **the human `staging→prod` evidence-review catches judge overfit** (correlated single-backend judges can't self-catch — F1/F5). A **held-out judge** is added when a second backend exists (§15).
- **Provenance** — every promotion records diff, targeted defects, before/after per-dim + per-persona scores + CIs, training + holdout deltas, judge variants, model + temp + budget spent.

### 9.2 Staging vs prod — mechanism, not policy
`eval_prompt_pointers: { prompt_id → { prod, staging } }`. Live reads `prod` (snapshotted per session). The optimizer's staging-only client **cannot** write `prod` (F2). The human promote endpoint copies `staging→prod` and writes a `PromotionRecord`. Thresholds (`min_delta`=`k·σ`, floors, `R`, `max_rounds`, budget) are settings.

### 9.3 Optimizer scope guard
Optimizable v1: the `*_SYSTEM` half of `converse`, `classify`, `grade`, `pacing_judge`, `opening_classify`, `derive`. **Out of scope for autonomous edits:** `decide`/driver-loop/`SILENCE_TIMEOUT_S`, the `build_*_prompt` user-turn templates, `gender_classify`, and prep `ladder`/`persona` prompts.

### 9.4 Human-driven improvement track (primary on free tier — F11)
The measurement harness scores **hand-authored** changes to the frozen zones (nudge/silence escalation, the `decide` "I'm done" four-way branch, `SILENCE_TIMEOUT_S`, `build_*_prompt` templates, prep prompts) as **A/B candidates through the same rubric+gates**, reported in the Self-Eval tab — **no auto-promote**. This is how the user's requested algorithm improvements are validated against the realism bar. It is the main day-to-day loop given the free-tier ceiling.

## 10. Persistence, surfacing & 3-repo wiring

### 10.1 Mongo collections (ai-service)
`eval_prompt_versions` · `eval_prompt_pointers` · `eval_batches` · `eval_runs` · `eval_optimization_rounds` · `eval_promotions`. A running batch/optimize is a keyed run in **`pipeline_runs.RUNS`** (polling status + `PipelineRunLogHandler`-streamed logs) — separate namespace from the per-run diagnostics-emitter ids (§13).

### 10.2 FastAPI routes (ai-service, internal-key router)
`POST /interview-eval/batches` · `GET /interview-eval/batches/{id}` · `POST /interview-eval/optimize` · `GET /interview-eval/optimize/{id}` · `GET /interview-eval/prompts` · `GET /interview-eval/prompts/{id}/diff` · `POST /interview-eval/prompts/{id}/promote` **(the human gate)** · `POST /interview-eval/prompts/{id}/revert`.

### 10.3 Backend BFF (Java) — corrected
`@RequestMapping("/api/{version}/intelligence/interview-eval", version="1")`. Error mapping mirrors the precedent: **`NotFound → 404 "run_not_found"` / `TooManyRequests → 429` / `RestClientException → 502 "ai_service_unreachable"`**; add a `400` branch only if an eval endpoint genuinely needs one (state as a NEW requirement, not precedent). `AiServiceClient` internal key; **RestClient HTTP/1.1**. No SecurityConfig edit (wildcard already covers the sub-path).

### 10.4 Frontend — *Self-Eval* Intelligence tab
1. **Batch dashboard** — per-dimension **and per-persona** bars + trend + CIs; overall (in-objective) realism; regression banner.
2. **Defect backlog** — ranked table; row → drill into the run's transcript + decision trace via `DecisionTimeline`/`StepDetailDrawer` (**ai-service must emit the identical `AgentTurn`/`AgentStep` shape**, §4.6; import those types from `features/agent-diagnostics` or promote them to `features/observability`). `RunLogStream` reused as-is.
3. **Optimization history** — rounds timeline (targeted defect → candidates → gates → winner → deltas).
4. **Prompt registry panel** — per prompt: prod vs staging version, score delta, **diff view**, and the **staging→prod evidence-review flip** (shows diff + per-dim + per-persona + sampled transcripts before allowing promote) + **Revert**. The human-overfit backstop lives here.

### 10.5 CLI / CI
`python -m app.interview_eval.cli run --suite=smoke --env=prod --fail-under=<baseline>` → non-zero exit on realism regression. A realism regression gate.

### 10.6 Trigger
Manual (+ rate-bound on free tier).

## 11. How the A–F realism slices plug in

| Slice | Adds to the harness | Flips |
|-------|---------------------|-------|
| **B** turn-taking / barge-in / silence | define Transport overlap primitive; interrupter persona; yields-on-barge-in invariant | dim 11 none→full; dim 5 proxy→live-validated |
| **C** editor question-injection | sim reads injected on-screen question; scenario field | dim 9 partial→full |
| **D** follow-up intelligence | judge gets artifact-diff context; premature-done/strong-terse already stress it | dim 4 partial→full (enters objective; re-baseline) |
| **E** unknown-handling / answer policy | reveal-vs-deny boundary (permitted concept/definition/constraint reveal vs forbidden solution-path reveal — F20) as a scored sub-check | dim 6 partial→full |
| **F** re-attempt variety | **"2nd-attempt, same candidate" scenario pairs for ALL 4 round types incl. behavioural**; freshness invariant. **Measure-only** (prep frozen) — repeats surface as a defect against the prep pipeline for human action | — |
| **A** tone / NL | already full (dims 1–2) | — |

## 12. Cross-cutting: cost, determinism, config

### 12.1 Cost model + free-tier reality (F8)
Per substantive turn ≈ 4 brain calls (classify+grade+pacing+converse; +derive/opening) + 1 sim call + K judge calls. Smoke suite (~12 runs) ≈ ~1k requests; full ~168-run batch ≈ ~13k requests + K large-context judge calls — **> the 1,500/day free cap**, hence rate-paced/multi-day/resumable. A full optimize sweep (baseline + N×A/B + holdout, × rounds) is 10⁵–10⁶ calls — **not feasible on free tier at speed**; v1 runs bounded/partial sweeps.
- **Hard caps (`cost.py`):** per-**run** token+turn cap (bounds a Rambler×max_turns runaway); per-batch and per-round budgets; budget checked **before each run and before each judge call** (not just per round); **judge calls (token-dominant) throttled first**; `N` (candidate fan-out) and `max_rounds` are first-class budget inputs; a deterministic pre-filter runs before spending judge tokens.
- Scaling up = add a paid/second backend later (§15); no redesign.

### 12.2 Determinism (honest — F7)
Hosted Gemma is non-deterministic even at temp 0; the client currently hardcodes temp 0.2 / no seed. **Sanctioned infra change #2:** add `temperature`/`seed` params to `complete`/`complete_structured`/`build_llm_client`. **Agent-under-test runs at PROD temp (0.2)** so we measure real behavior; only sim-candidate/judge pinned lower (judge temp 0). Comparability rests on **median + spread over N** + reporting **confidence intervals**; `min_delta` is derived as **`k·σ`** from measured per-dim stdev so "promotable" can't fire on sampling/judge noise.

### 12.3 Config (F22)
New settings: `EVAL_CANDIDATE_MODEL`, `EVAL_JUDGE_MODELS`, `EVAL_OPTIMIZER_MODEL`, `EVAL_CONCURRENCY`, `EVAL_SAMPLES_PER_SCENARIO`, `EVAL_TOKEN_BUDGET`, `EVAL_REQUEST_BUDGET`, gate thresholds. **List-typed settings (`EVAL_JUDGE_MODELS`) use the codebase idiom `Annotated[list[str], NoDecode]` + a comma-split `field_validator`** (mirroring `LLM_API_KEY` / `EXA_*_DOMAINS`), NOT a naive `list[str]` (pydantic-settings would JSON-decode and error). Judge "diversity" = prompt-variants on the single backend; correlated-bias documented + backstopped by the human flip.

## 13. Testing
- **Deterministic units** (default resolver seam, no Mongo): registry pointer + seed backfill + **staging-only client raises on `env='prod'`** (F2) + **cache: a staging/candidate resolution never mutates a subsequent `prod` resolution** (F3) + static/runtime invariant checks + substance-ratio + recitation-similarity + per-dim & per-persona floor gate + holdout gate + budget stop + promote/revert.
- **`test_llm_ops.py` updated** to inject the resolver seam (returns the seeded constant) — the registry refactor otherwise breaks it (F6).
- **Concurrency test (F15):** two `run_one` coroutines under `gather` bind the emitter **inside** each coroutine with **distinct emitter run_ids** → two independent, non-interleaved traces (no shared `AGENT_SESSIONS[run_id]` corruption).
- **Frozen-decision assertion:** no new call is introduced into `decide`/`graph` (retargeted from the earlier over-broad "no new call into the brain").
- **LLM-driven modules** (sim, judge, optimizer) with fake doubles — assert prompt assembly (incl. ladder + solution-path injection) + parsing + control flow.
- **End-to-end smoke:** 2-scenario suite, scripted fake candidate + fake judge → batch → report → (fake) optimize → **staging** promotion, asserting `prod` untouched.

## 14. Data models (pydantic sketch)
`PersonaSpec` · `Scenario` · `EvalRun{scenario_id, persona_id, transcript, decision_trace, outcome, failed?, tokens}` · `DimensionScore{id, score, confidence, in_objective}` · `JudgeResult` · `Defect` · `BatchReport{per_dim + per_persona distributions w/ CIs, overall_in_objective, defect_backlog, baseline_delta, run_refs, budget_spent}` · `PromptVersion` · `PromptPointers{prompt_id, prod, staging}` · `OptimizationRound` · `PromotionRecord{..., evidence_ref}`.

## 15. Open questions / deferred
- **Second/paid backend** → unlocks genuine judge diversity, a **held-out judge**, faster/larger autonomous sweeps, and a **live-audio spot-check** for dims 5/11. The single biggest lever to strengthen the autonomous half; deferred by the free-tier decision.
- **Human calibration queue** — a sampled human review of judge scores to detect leniency; natural next trust-builder.
- **Prep-prompt optimization** (`ladder`/`persona`) + `build_*_prompt` templates — deferred (measure-only / human track).
- **reveal-vs-deny boundary** (§11 slice E) needs enumerating before dim 6 goes full.

## 16. Changelog
- **2026-07-08 rev.2** — Adversarial stress-test (8-agent workflow: 4 fact-check lenses + 3 attack lenses + synthesis; 52 raw → 32 ranked findings, 12 high). **Provisioning decision: stay free-tier (measure-first);** **overfit backstop = human staging→prod flip.** Folded in: honest frozen-brain scoping + no-Mongo resolver seam (F6); scoped staging-only client (F2); env+version cache keying + per-session snapshot + Mongo fallback (F3); two-stage invariant gate — static lint + runtime gate (F4); holdout catches scenario-overfit, human flip catches judge-overfit (F5/F1); prod-temp evaluation + honest determinism + temp/seed infra change + `k·σ` min_delta (F7); cost model + per-run/judge budget caps + rate pacing + smoke-suite default (F8); partial-confidence dims excluded from objective (F9); anti-*padding* substance-ratio per-turn (F10); measure-only vs auto-improvable split + human-driven A/B track (F11); silent-but-coding persona + activity/artifact coupling (F12); judge fed ladder + solution path, dim-7 recitation split (F13); corrected controller error-mapping 404/429/502 + `/api/{version}` idiom, no SecurityConfig edit (F14/F29); emitter per-coroutine binding + distinct ids (F15); technical-soundness invariant (F16); per-persona/ESL regression floor (F17); single-ask judge-scored (F18); semantic leak-confirm (F19); reveal-vs-deny boundary (F20); registry covers `*_SYSTEM` only (F21); NoDecode list-setting idiom (F22); AgentTurn/AgentStep shape requirement for component reuse (F23); dim-11 weight 0 until slice B (F24); cross-channel awareness sub-check (F25); no-redundant-reask invariant (F26); slice-F re-attempt pairs all rounds (F27); dims 5/11 audio-validity caveat (F28); substrate attribution → `pipeline_runs.RUNS` (F30); `gender_classify` 7th prompt registered non-optimizable (F31); interrupter + flawless personas (F32).
- **2026-07-08 rev.1** — Initial draft from brainstorming (§3 decisions 1–10).
