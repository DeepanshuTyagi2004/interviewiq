# Agent Diagnostics — Design

- **Date:** 2026-07-07
- **Status:** Draft (awaiting user review). Verified against source by a 4-agent fact-check + adversarial-critic workflow; corrections folded in (see §16 changelog).
- **Repos touched:** `interviewiq-ai-service` (engine), `interviewiq-backend` (Spring BFF proxy), `interviewIQ-frontend` (new Intelligence tab)
- **Sequel to:** [2026-07-02-admin-pipeline-observability-resume-console-design.md](2026-07-02-admin-pipeline-observability-resume-console-design.md) (same run-store / polling substrate), [2026-07-04-pipeline2-live-interview-brain-design.md](2026-07-04-pipeline2-live-interview-brain-design.md) (the brain being diagnosed)

---

## 1. Summary

Add an **Agent Diagnostics** tab to the admin *Intelligence* section. From it an admin picks a role (JD) + candidate, runs the interview-prep pipeline with full visibility (reusing the existing prep-bench console), then starts an **interactive, text-driven diagnostic interview session**. The admin types each candidate turn; the live interview *brain* (`run_session`) runs unmodified in the FastAPI process and responds. Every turn exposes the full pipeline — `STT → brain(classify → scope → grade → pacing → route → action) → TTS` — as a live-updating `@xyflow/react` canvas, plus a per-turn decision timeline, each step's prompt-in / LLM-response / raw `<thought>` reasoning / deterministic branch-reason / timing, and the full captured log stream. A **Copy-as-Markdown** export bundles decisions + prompts + reasoning + logs for pasting into a Claude Code agent.

The purpose is diagnosis: *why did the agent take this action, and where did the turn flow* — for every branch, including silence/inactivity escalation, off-topic redirects, pivots, hints, grading, pacing gates, and time-ceiling wrap-up.

## 2. Goals / Non-goals

**Goals**
- Reuse the existing prep-bench observability console verbatim for the prep phase.
- Drive the real brain (`app/interview_agent/session.py::run_session`) with a text transport — no brain *decision-logic* changes; only additive instrumentation (with two narrowly-scoped, non-behavioral exceptions: capturing the discarded `<thought>`, and emitting explicit `skipped` step markers — see §6.3/§6.4).
- Capture, per turn, every discrete decision with structured inputs/outputs **and** the LLM's raw `<thought>` reasoning.
- Make **every** brain branch reachable from the UI: answers, clarify, off-topic, challenge, distress, idk, pivot/derive, hints, **pacing gates (wind-down / extend / must-wrap)**, silence/inactivity escalation (probe → nudges → abandon), and mid-coding probe. This requires two harness clocks (activity + elapsed) — see §6.1.
- Visualize the fixed pipeline as a live node-edge canvas with click-through detail and per-turn notes.
- One-click Markdown export of a turn or the whole session for LLM-assisted debugging.

**Non-goals**
- No real audio / STT / TTS / LiveKit / worker-process involvement (STT/TTS are pass-through boxes). *(User decision: text-driven harness.)*
- No changes to the brain's decision logic; its 148 existing tests must stay green.
- No persistence to Mongo / no callback to the backend outcome sink (the diagnostic session is ephemeral; it does not write real interview records).
- Not candidate-facing; admin-only, dev tool.

## 3. Locked decisions (from brainstorming)

1. **Text-driven brain harness.** `run_session` runs in the FastAPI process behind a queue-backed `DiagnosticTransport`. This sidesteps the hard architectural wall that killed the "watch a real live session" approach: the real interview runs in a **separate LiveKit worker process** that shares no memory with the FastAPI process that owns the run-store, log handler, and admin endpoints. Driving the brain in-process removes the cross-process transport entirely.
2. **Structured + raw LLM reasoning** captured per decision. The `<thought>` chain-of-thought that the structured-completion path currently discards is preserved and attached per LLM op.
3. **`@xyflow/react`** for the canvas (new frontend runtime dependency, explicitly user-approved — satisfies the CLAUDE.md "new dependency = stop-and-ask" gate).

## 4. Background — what already exists (do not rebuild)

### 4.1 Prep-bench observability substrate (reused as-is for prep; the *pattern* for the new session store)
- **Keyed run store**: `app/jobs/pipeline_runs.py` — `PipelineRunStore` (singleton `RUNS`), in-memory, `_MAX_RUNS = 25` LRU (`_evict_locked` evicts oldest **non-running**), `_MAX_LOGS = 2000` per-run ring buffer (`deque(maxlen=...)`), `run_id = uuid4().hex` (`new_run_id`). Per-run: `{run_id, pipeline, source, label, status, current_step, steps[], result, error, started_at, finished_at, _logs, _seq}`. Mutators: `start_run`, `begin_step`, `end_step` (computes `duration_ms`), `log`, `set_result`, `finish`, `snapshot(run_id, after)` (state + only log entries `seq > after`), `list_runs(pipeline)`. *(All confirmed at pipeline_runs.py:24,25,28,45,49,58,93,109,123,133,139,149,155,175,180,197,218,221,227,231.)*
- **Contextvar log capture**: `_current_run_id` ContextVar; `bind_run(run_id)` / `unbind_run(token)`; `PipelineRunLogHandler(logging.Handler)` routes any `logger.*` on the bound context into `RUNS.log(...)`. Installed on the root logger in `app/main.py` lifespan (main.py:46-47). This is why `[llm] iv-*` / `[structured] iv-*` lines land in a run buffer with zero call-site threading — **the diagnostic session reuses this exact mechanism**.
- **Admin endpoints**: `app/api/admin.py`, `APIRouter(prefix="/admin", dependencies=[Depends(require_internal_key)])` (admin.py:34). Interview-prep: `POST /admin/interview-prep/run` (:168), `GET /admin/interview-prep/runs` (:177), `GET /admin/interview-prep/runs/{run_id}?after=<seq>` (:183). `require_internal_key` (deps.py:12) reads header `X-Internal-Api-Key`, `secrets.compare_digest`.
- **Instrumented prep pipeline**: `app/interview_prep/tracked_pipeline.py::run_interview_prep` (:50); `STEP_NAMES = [context_assembly, cache_gate, persona_and_arc, question_ladders, candidate_probes, assemble]` (:33-40); each LLM stage captures `system_prompt + user_prompt + validated output + prompt_version` into step `detail`.

### 4.2 Backend BFF proxy (mirrored for the new endpoints)
- `AdminInterviewPrepController` at `@RequestMapping(value = "/api/{version}/intelligence/interview-prep", version = "1")` (AdminInterviewPrepController.java:45). **Error mapping is 3-way** (:167-183): `IllegalArgumentException → ApiError("prep_bad_request") @ 400`; `HttpClientErrorException.NotFound → ApiError("run_not_found") @ 404`; generic `RestClientException → ApiError("ai_service_unreachable") @ 502`.
- ADMIN-gated by `SecurityConfig`: `/api/v1/intelligence/**` → `hasRole("ADMIN")`. The prep controller's `version="1"` mapping is served under `/api/v1/...` and is correctly gated today — **the new controller must mirror the identical mapping style so it falls under the same working gate** (see §7 + §16 fix).
- `AiServiceClient` holds `internalApiKey` (`@Value("${internal.api-key}")`), attaches `X-Internal-Api-Key`, targets `baseUrl + /admin/interview-prep/*`. Browser never holds the internal key.

### 4.3 Frontend observability stack (reused)
- Tab host: `app/(app)/intelligence/page.tsx` — shadcn `Tabs`, 6 existing tabs (`ingestion, companies, access, questions, resume, prep`). Adding a 7th `TabsTrigger`/`TabsContent` is trivial.
- Prep panel to clone: `app/(app)/intelligence/_components/InterviewPrepBenchPanel.tsx` + `features/interview-prep-bench/{api,hooks,index}.ts`.
- Polling engine: `features/observability/hooks.ts::useRunPolling(prefix, runId, fetchFn)` — `POLL_MS = 1000`, stops when `isTerminal(status)` (`completed|failed`), incremental log stitching via a per-`runId` `useRef` accumulator + `?after=lastSeq`.
- Client types: `features/observability/types.ts` — `RunSnapshot`, `RunStep{name,status,started_at,finished_at,duration_ms,detail}`, `RunLogEntry{seq,ts,level,message}`, `RunStepStatus = pending|running|ok|failed|skipped`.
- Render components: `components/observability/{RunConsole,RunTimeline,RunLogStream}.tsx`.
- API client: single fetch wrapper `lib/api-client/client.ts::apiFetch<T>` (Bearer + one silent refresh-retry on 401, `NEXT_PUBLIC_API_URL` = Spring backend). Endpoint path constants in `lib/constants/observability/index.ts`. Admin gate `components/auth/RequireAdmin.tsx`.
- **`TranscriptEntry` shape confirmed matching**: `features/interview-live/session/types.ts` defines `{ speaker: 'interviewer'|'candidate'|'system', text }` — identical to the server payload in §6.2, so **no adapter needed**. `TranscriptPanel` (`features/interview-live/work/TranscriptPanel.tsx`) renders `candidate` as "You", `system` italic.
- `useJds()` (`features/jobs`) and `usePrepCandidates()` (`features/interview-prep-bench`) exist — reused for the picker.
- **`@xyflow/react` / react-flow / reactflow is NOT in package.json** — confirmed genuinely new.

### 4.4 The brain being diagnosed (`app/interview_agent/`) — verified
- Driver: `session.py::run_session(transport, plan, settings)` (session.py:339). Talks to the outside world **only** through the `Transport` Protocol (transport.py:20-26): `async say(text)`, `async next_utterance() -> tuple[str, UtteranceTiming] | None`, `async current_artifact() -> Artifact | None`, `async end_session()`, `def seconds_since_activity() -> float`. Plus Python `logging`. `ScriptedTransport` (transport.py:29-71) is the existing test double.
- **The session clock is transport-driven**: `state.elapsed_s = timing.t_end` (session.py:290 opening, :408 main loop). `UtteranceTiming` = `{t_start, t_end, time_to_first_word_s}` (types.py:86-90). `pacing.evaluate_gate(state.elapsed_s, ...)` (session.py:148) reads `elapsed_s`. **⇒ the transport controls elapsed session time via the `t_end` it returns per turn.** This is the lever that makes pacing/time-ceiling branches reachable (see §6.1).
- Per-turn main loop (session.py:364 `while not state.session_over:` → 440): `classify_utterance` (:419) → scope guard `scope.out_of_scope_by_markers` under `PIVOT_REQUEST` only (graph.py:101-107) → `_score_last_answer` gated `class==answer`, `llm_ops.grade_answer`, artifact-aware for `_ARTIFACT_ROUNDS = {DSA, LLD, SYSTEM_DESIGN}` (session.py:29,422-428) → `_update_pacing` (:436→144-162): deterministic `pacing.evaluate_gate` rails, then LLM `llm_ops.judge_pacing` **only** for `MAY_WIND_DOWN`/`MAY_EXTEND` → `graph.build_inputs` + `graph.decide` (session.py:438-440; graph.py:32,53) → `_apply_action` (:440→202). `_say` (:83), `_gen` (:88).
- `_apply_action`: `PIVOT_DERIVE → _derive_flow → llm_ops.derive_ladder` (session.py:241-242,178); `EXTEND_RESERVE → take_reserve()+splice_ladder()` (:204-210).
- Opening phase `_run_opening` (session.py:295), never scored/paced: GREET (:303) → RAPPORT loop `MAX_RAPPORT_TURNS=2` (:37,313-319) → ORIENT (:321) → `classify_opening_turn` → `"question"|"ready"` (:327; llm_ops.py:83) → ANSWER_OPENING loop `MAX_OPENING_EXCHANGES=3` (:33,325-336).
- Silence/inactivity (deterministic on `seconds_since_activity()`): `INACTIVITY_WINDOW_S=45.0` (:45), `MAX_INACTIVITY_NUDGES=3` (:46), `CODE_PROBE_EVERY_CYCLES=2` (:53). Active coding < window resets nudges and every 2 windows on an `_ARTIFACT_ROUNDS` round emits `Action.PROBE_ARTIFACT` (:370-387); genuine idle → nudges ×3 (:389-392) → final warning (:393-396) → grace → `EndedReason.ABANDONED` (:400-402).
- LLM ops (llm_ops.py, stable log labels): `iv-classify` (:67), `iv-opening-classify` (:82), `iv-gender` (:95), `iv-grade` (:106), `iv-pacing` (:123), `iv-converse` (:135), `iv-derive` (:146). Each → `complete_structured` → `llm.complete_json` (structured.py:68).
- Enums (types.py): `Action` (:42-67, incl. `PROBE_ARTIFACT` :67); `TurnClass` (:12-19: answer, clarify, off_topic, challenge, distress, idk_silence, pivot_request); `TopicScope` (:22-25); `PacingGate` (:28-33: locked, continue, may_wind_down, may_extend, must_wrap); `PacingDirective` (:36-39: continue, wind_down, extend); `EndedReason` (:70-77: natural_complete, early_weak, time_ceiling, aborted_technical, abandoned).
- `GraphDeps` (graph.py:18-22): `{llm, settings, scorer}` — constructed `session.py:351`. The natural place to thread the emitter.
- Terminal: `outcome.py::finalize(state, ended_reason) -> SessionOutcome`. In production the **worker** (not `run_session`) calls `outcome_sink.post_outcome`. The harness drives `run_session` directly and does **not** post — it stores the returned `SessionOutcome` as the run result.
- Reasoning gap: the brain calls `complete_json` which **discards** the `(data, thought)` tuple's `thought` (`_THINK_BLOCK` regex + `extract_thought` in `llm/client.py`). `LLM_CAPTURE_THOUGHTS` today surfaces thoughts only in the *brief* pipeline, not the brain.

## 5. Architecture overview

```
FRONTEND (interviewIQ-frontend)                 BACKEND (Spring BFF)            AI-SERVICE (FastAPI, in-proc brain)
Intelligence ▸ "Agent diagnostics" tab
  AgentDiagnosticsPanel                          AdminInterviewAgentController    /admin/interview-agent/*
   ├─ Phase 1: prep (reuse prep-bench console) ── /intelligence/interview-prep ── /admin/interview-prep/*  (unchanged)
   └─ Phase 2: interactive session               /intelligence/interview-agent    ── run  ─▶ start session task
        • @xyflow/react pipeline canvas    ─poll─▶   (ADMIN-gated, adds          ── turn ─▶ atomic-accept → transport queue
        • per-turn decision timeline               X-Internal-Api-Key via        ── GET runs/{id}?after ─▶ AgentSessionStore.snapshot
        • prompt/response/thought viewer           AiServiceClient)              ── end  ─▶ force-abort (_END sentinel)
        • recent-sessions selector                                               ── GET runs ─▶ list
        • log stream + Copy-as-Markdown

                                                  AI-SERVICE session task (asyncio, in FastAPI process):
                                                    bind_run(run_id)                       ← reuse contextvar log capture
                                                    run_session(DiagnosticTransport, plan, settings)   ← brain UNCHANGED
                                                       emitter taps → AgentSessionStore    ← structured decisions + <thought> + skipped markers
```

## 6. ai-service design (the engine)

### 6.1 `DiagnosticTransport` — `app/interview_agent/diagnostic_transport.py` (new)
Implements the `Transport` Protocol so `run_session` is used unmodified. Backed by a session record in the `AgentSessionStore` and an `asyncio.Queue`.

**Inbox message types** (three distinct values — resolves the force-end ambiguity):
- `_TurnInput{text, artifact, advance_seconds}` — a spoken candidate turn.
- `_SILENCE` sentinel — an explicit silence window (candidate said nothing this window).
- `_END` sentinel — a distinct force-terminate signal (NOT reused from silence).

**Two clocks (both harness-controlled):**
- **Elapsed session clock** — `self._clock: float` accumulator. Each `_TurnInput` (and each silence window) advances it by `advance_seconds` (default e.g. 60s for a normal answer; 0 allowed). Returned as `UtteranceTiming(t_start=prev_clock, t_end=self._clock, time_to_first_word_s=...)`, so the brain sets `state.elapsed_s = t_end` → drives `pacing.evaluate_gate`. This makes `MAY_WIND_DOWN` / `MAY_EXTEND` / `MUST_WRAP`, `judge_pacing`, `EXTEND_RESERVE`, and `EndedReason.time_ceiling` / `natural_complete` deterministically reachable.
- **Activity clock** — `self._activity_seconds: float`, returned by `seconds_since_activity()`. A silence window sets it high (≥ `INACTIVITY_WINDOW_S`) to drive inactivity escalation; a spoken turn resets it low.

**Methods:**
- `async say(self, text)` — append an interviewer line to the **current turn's** `tts` step + transcript; log it (captured via `bind_run`). During the opening preamble the current turn is the synthetic opening turn (§6.2), so pre-first-utterance lines always have a home.
- `async next_utterance(self)` — set status `awaiting_input`; `await self._inbox.get()`. On `_TurnInput`: advance clocks, update sticky artifact (see below), open a new `AgentTurn`, flip status `running`, return `(text, UtteranceTiming(...))`. On `_SILENCE`: set high `activity_seconds`, open a `kind:"silence"` turn, return `None` (the brain's silence path). On `_END`: raise `DiagnosticSessionAborted` (see §6.5).
- `async current_artifact(self)` — returns the **sticky** artifact: the last pasted code/diagram, retained across turns until replaced (mirrors a persistent editor). `_TurnInput.artifact` replaces it; absence does **not** clear it. Cleared only on explicit empty-artifact submit.
- `async end_session(self)` — brain-initiated end; store sets terminal status on `run_session` return.
- `def seconds_since_activity(self)` — returns `self._activity_seconds`.

Queue-driven input mirrors `ScriptedTransport`, so existing brain-driver test patterns apply.

### 6.2 `AgentSessionStore` — `app/jobs/agent_sessions.py` (new; sibling to `pipeline_runs.py`)
Dedicated store (chosen over bending the flat `PipelineRunStore`) reusing the proven conventions: `run_id` keying, `_seq`-cursor incremental logs with `?after=`, ring buffer, `bind_run` log capture. **Eviction protection differs from prep**: evicts only sessions in a **terminal** status (`completed|failed|abandoned|aborted`); a session in `running` **or** `awaiting_input` is never evicted, and on eviction/expiry the store **cancels the associated asyncio task and calls `unbind_run`** so no orphaned brain lingers.

**Data model** (JSON-serializable, polled 1:1 by the frontend):

```
AgentSession = {
  run_id, pipeline: "interview_agent", label,
  status: "running" | "awaiting_input" | "completed" | "failed" | "abandoned" | "aborted",
  plan_summary: {round, persona_name, question_count, ...},
  current_turn: int,                 # 0-based; opening = turn 0 (never -1)
  current_step: str | null,
  turns: AgentTurn[],
  transcript: TranscriptEntry[],     # {speaker: "interviewer"|"candidate"|"system", text}
  result: SessionOutcome | null,
  ended_reason: EndedReason | null,  # surfaced explicitly (see §6.5 status vs reason)
  error: {step?, type?, message?} | null,
  started_at, finished_at,
  _logs: RunLogEntry[], _seq: int,
}

AgentTurn = {
  index: int,
  kind: "opening" | "main" | "silence",     # turn 0 is always "opening"
  candidate_text: str | null,               # null for silence turns
  artifact_present_this_turn: bool,          # artifact supplied on THIS submit
  artifact_available: bool,                  # sticky artifact currently in effect
  steps: AgentStep[],                        # includes explicit status:"skipped" entries
  started_at, finished_at, duration_ms,
  elapsed_s_at_turn: float,                  # the t_end fed to the brain this turn
}

AgentStep = {
  name: "stt"|"opening_classify"|"classify"|"scope"|"grade"|"pacing"|"route"|"action"|"tts"|"derive"|"probe"|"nudge",
  status: "pending"|"running"|"ok"|"failed"|"skipped",
  llm_label: str | null,             # iv-classify | iv-grade | ... (for LLM steps)
  started_at, finished_at, duration_ms,
  detail: { prompt_system?, prompt_user?, raw_response?, parsed_output?, thought?,
            inputs?, decision?, branch_reason?, state_delta?, error? },
}
```

**Fixed per-turn step set** (single source of truth, materialized by the emitter): every turn declares the full ordered step set for its `kind`; steps the brain bypasses are emitted with `status:"skipped"` so **canvas and timeline read the identical `turn.steps`** (no UI-side synthesis, no divergence). Expected sets: `opening` = `[stt?, opening_classify, tts]`; `main` = `[stt, classify, scope, grade, pacing, route, action, tts]`; `silence` = `[stt(silence), pacing?, probe|nudge, tts?]`. `scope` is `skipped` on non-pivot turns; `grade` `skipped` on non-answers; `derive`/`probe`/`nudge` present only when their action fires.

`snapshot(run_id, after)` returns the full session (all `turns` — small) with `_logs` filtered to `seq > after`, plus `last_seq`. Ephemeral/lost-on-restart — surfaced in the UI.

### 6.3 Decision emitter + tap points
A per-session emitter threaded via a new `GraphDeps.emitter` field (for graph/session taps) **plus** a contextvar sink for the `llm_ops`/`structured` layer (so per-op prompt/response/thought attach without signature churn). Taps observe existing values; the only non-observational additions are (a) explicit `skipped`-step markers (§6.2) and (b) the `<thought>` capture (§6.4).

| Step | Code location | `detail` captured |
|---|---|---|
| `stt` | `DiagnosticTransport.next_utterance` | candidate_text, advance_seconds, activity_seconds |
| `opening_classify` | `_run_opening` → `llm_ops.classify_opening_turn` | prompts, parsed (question\|ready), thought, label `iv-opening-classify` |
| `classify` | `session.classify_utterance` → `llm_ops.classify_turn` | prompts, TurnClass + requested_topic, thought, label `iv-classify` |
| `scope` | `scope.out_of_scope_by_markers` (graph.py:101-107) | round_type, requested topic, TopicScope, branch_reason; `skipped` unless pivot |
| `grade` | `_score_last_answer` → `llm_ops.grade_answer` + `scoring.py` | prompts, (competency,coherence), `artifact_present_this_turn`, `artifact_used_in_grade`, post-processed answer/rolling score, thought, label `iv-grade`; `skipped` on non-answer |
| `pacing` | `_update_pacing` → `pacing.evaluate_gate` (+ `judge_pacing`) | elapsed_s, rolling, coverage, reserve, PacingGate (rails), PacingDirective (LLM, only if gate opened), branch_reason, thought |
| `route` | `graph.build_inputs` + `graph.decide` | full DecisionInputs snapshot, chosen Action, branch_reason (which precedence branch of `decide` fired) |
| `action` | `_apply_action` | executed Action, generated line, state_delta; multi-op turns (e.g. PIVOT_DERIVE = converse `iv-converse` + derive `iv-derive`) get **distinct sub-step slots** (`action` + `derive`), each retaining its own prompt/response/thought |
| `tts` | `DiagnosticTransport.say` | spoken text |
| `probe`/`nudge` | silence path (session.py:370-402) | which escalation fired + reason (window count, nudge index) |

`branch_reason` for the pure router: `graph.decide` (graph.py:53-88) is a linear precedence ladder; a thin **pure, unit-tested** labeled wrapper records which branch matched (does not alter the returned `Action`).

### 6.4 Thought-capture seam (decision #2) — pinned
Single instrumentation point at **`llm/client.py::complete`** (the one place that extracts `(data, thought)` via `_THINK_BLOCK`/`extract_thought`). When a diagnostic session is active, it writes `thought` into a **contextvar keyed by `llm_label`**. Both `complete_structured` and `complete_json` inherit this because they call `complete` underneath. The emitter, when opening an LLM step, records the expected `llm_label`; on step close it reads the contextvar for that label and attaches `thought` to that step's `detail`. Keying by label (not a single "current step") prevents collision when one action turn runs multiple ops (converse + derive). `thought` is null when the model emits no `<thought>` (graceful). Gated by the diagnostic context / `LLM_CAPTURE_THOUGHTS`; production `run_session` path unchanged when inactive.

### 6.5 Session lifecycle / orchestration — `app/interview_agent/diagnostic_runner.py` (new)
```
start_agent_session(plan, settings) -> run_id:
    if AGENT_SESSIONS.active_count() >= MAX_ACTIVE_SESSIONS: raise TooManyActiveSessions   # 409
    run_id = new_run_id(); AGENT_SESSIONS.start(run_id, plan)            # seeds synthetic opening turn 0
    transport = DiagnosticTransport(run_id, AGENT_SESSIONS)
    task = asyncio.create_task(_run(run_id, transport, plan, settings))
    AGENT_SESSIONS.attach_task(run_id, task)                            # so eviction/force-end can cancel
    return run_id

_run(run_id, transport, plan, settings):
    token = bind_run(run_id)
    try:
        outcome = await run_session(transport, plan, settings)          # brain UNCHANGED; emitter taps active
        AGENT_SESSIONS.set_result(run_id, outcome)
        AGENT_SESSIONS.finish(run_id, terminal_status(outcome.ended_reason))
    except DiagnosticSessionAborted:                                    # force-end via _END
        AGENT_SESSIONS.finish(run_id, "aborted")                        # result may be null/partial
    except LLMError as e:                                               # fatal only: propagated OUT of run_session
        AGENT_SESSIONS.fail(run_id, step=AGENT_SESSIONS.current_step(run_id), error=e)   # status "failed"
    finally:
        unbind_run(token)
```
- **Force-end** (`POST /end`) sets a `force_end` flag and pushes `_END`; `next_utterance` raises `DiagnosticSessionAborted`, which propagates out of `run_session` (it is not a brain-caught type) → status `aborted`. Force-end is a hard abort (no graceful `finalize`), acceptable for a dev tool.
- **Fatal vs recoverable LLM errors** (critic #10): the session is marked `failed` **only** when an `LLMError` actually propagates out of `run_session`. Errors the brain internally tolerates (e.g. an optional pacing-judge failure the brain catches and continues past) are recorded as a `failed` **sub-step** in `detail.error` while the session stays live. This matches "taps observe" — we never convert a brain-survived error into session death.
- **`terminal_status(ended_reason)`**: `abandoned → "abandoned"`; everything else → `"completed"`. The distinct `ended_reason` (incl. `time_ceiling`, `early_weak`, `aborted_technical`, `natural_complete`) is stored in `AgentSession.ended_reason` and **rendered prominently in the UI ended state** so `"completed"` is never misread (critic #15).

### 6.6 Admin endpoints — `app/api/admin.py` (new block, `/admin` + `require_internal_key`)
- `POST /admin/interview-agent/run` — body = the `InterviewPlan` doc (the prep run's `result`). `429` if `active_count ≥ MAX_ACTIVE_SESSIONS`. Returns `{run_id, status:"running"}`.
- `POST /admin/interview-agent/runs/{run_id}/turn` — body `{text?: str, artifact?: {kind, content} | null, advance_seconds?: number, silence?: bool}`. **Atomic accept** (critic #4): in the same handler tick, under the store lock, verify `status == awaiting_input` **and** the inbox is empty; if so flip status to `running` and enqueue; else `409`. `silence:true` (or empty `text` with `silence`) enqueues `_SILENCE`. `404` unknown. Returns `{status:"accepted"}`.
- `GET /admin/interview-agent/runs/{run_id}?after=<seq>` — `AGENT_SESSIONS.snapshot(run_id, after)`; `404` unknown (UI maps to "session expired").
- `GET /admin/interview-agent/runs` — recent sessions (newest first) for the recent-sessions selector.
- `POST /admin/interview-agent/runs/{run_id}/end` — pushes `_END`; returns `{status:"accepted"}` immediately (termination is async; frontend polls for the terminal status — critic #14). `404` unknown.

### 6.7 Silence & clock protocol (worked sequences — critic #9, #3)
- **Reach `ABANDONED`**: submit successive silence windows. Each `silence:true` submit = one window; the brain re-enters `next_utterance` (status → `awaiting_input`) after each. Sequence on a non-artifact round: silence → nudge 1 → silence → nudge 2 → silence → nudge 3 → silence → final warning → silence (grace elapsed) → `ABANDONED`. UI helper text states the count.
- **Mid-coding probe**: on an `_ARTIFACT_ROUNDS` round with a sticky artifact present, silence windows below `INACTIVITY_WINDOW_S` reset nudges; every `CODE_PROBE_EVERY_CYCLES=2` windows emit `PROBE_ARTIFACT`.
- **Pacing wind-down / time-ceiling**: submit normal turns with `advance_seconds` large enough to push `elapsed_s` across the band boundaries (`INTERVIEW_MIN/BASE/MAX_DURATION_MIN`), opening `MAY_WIND_DOWN`/`MAY_EXTEND`/`MUST_WRAP` and reaching `natural_complete`/`time_ceiling`. UI exposes `advance_seconds` per turn (default 60s) with a "jump elapsed to N min" shortcut.

### 6.8 Config (reused, no new required env)
`INTERVIEW_LLM_MODEL`, `INTERVIEW_SCORER_MODEL`, all `INTERVIEW_*` pacing/scoring knobs, `INTERNAL_API_KEY`. `LLM_CAPTURE_THOUGHTS` gates the thought seam. New tunable (with default, non-required): `MAX_ACTIVE_SESSIONS` (default small, e.g. 3).

## 7. backend (Spring) design — thin BFF proxy
Mirror `AdminInterviewPrepController` + `AiServiceClient` 1:1.
- **`AdminInterviewAgentController`** — **identical mapping style** to the prep controller: `@RequestMapping(value = "/api/{version}/intelligence/interview-agent", version = "1")`, so it is served under `/api/v1/...` and falls under the existing `/api/v1/intelligence/** → hasRole("ADMIN")` gate with **no security change** (critic #12: mirroring the already-gated prep controller guarantees the same coverage; if a future non-v1 version is added, broaden the matcher to `/api/*/intelligence/**` at that time). Routes: `POST /run`, `POST /runs/{id}/turn`, `GET /runs/{id}?after=`, `GET /runs`, `POST /runs/{id}/end`.
- **Error mapping — 3-way, mirroring the prep controller** (§16 fix): `IllegalArgumentException → prep_bad_request @ 400`; `HttpClientErrorException.NotFound → run_not_found @ 404`; generic `RestClientException → ai_service_unreachable @ 502`. (Also surface ai-service `429` too-many-sessions as a distinct `sessions_at_capacity`.)
- **`AiServiceClient`** new methods targeting `baseUrl + /admin/interview-agent/*`, attaching `X-Internal-Api-Key`. Bodies pass through as opaque JSON (`JsonNode`/`Map`) — no server-side snapshot DTO (matches how the prep snapshot is proxied).

## 8. frontend design — new Intelligence tab

### 8.1 Tab + panel state machine
- Add tab `{ value: "agent", label: "Agent diagnostics" }` to `intelligence/page.tsx`; panel `AgentDiagnosticsPanel` in `_components/`.
- Phases: **idle** (JD + candidate dropdowns via `useJds()` + `usePrepCandidates()`; + recent-sessions selector from `GET /runs`) → **prep** (reuse the prep-bench `RunConsole`; on `completed`, grab `run.result` = `InterviewPlan`) → **session-starting** → **interactive** → **ended** (show `SessionOutcome` + prominent `ended_reason`). "Start session" gates prep→session; "Restart" resets.
- The recent-sessions selector lets an admin re-open a still-live or terminal session's snapshot (consumes `GET /runs` — critic #13).

### 8.2 Feature slice — `features/agent-diagnostics/{api,hooks,types,index}.ts`
- `api.ts`: `startAgentSession(plan)`, `submitTurn(runId, {text?, artifact?, advanceSeconds?, silence?})`, `getAgentSession(runId, after)`, `endAgentSession(runId)`, `listAgentSessions()` — via `apiFetch`.
- `hooks.ts`: `useStartAgentSession()`, `useSubmitTurn()`, `useEndAgentSession()`, `useAgentSessions()`, and `useAgentSession(runId)` on a **generalized poller**: extend `useRunPolling` with an `isTerminal` override (or add `useSessionPolling`) so it keeps polling while `running|awaiting_input` and stops on `completed|failed|abandoned|aborted`.
- `types.ts`: `AgentSession`, `AgentTurn`, `AgentStep`, `AgentStepStatus`; reuse `RunLogEntry` (observability) + `TranscriptEntry` (interview-live — shape confirmed matching, §4.3).
- Endpoint constants added to `lib/constants/observability/index.ts` alongside `INTERVIEW_PREP_BENCH_ENDPOINTS`.

### 8.3 `@xyflow/react` canvas — `_components/PipelineCanvas.tsx`
- Fixed node set painted from the **selected turn's `turn.steps`** (single source of truth — canvas and timeline agree): `stt → classify → scope → grade → pacing → route → action → tts`, with `opening_classify`/`derive`/`probe`/`nudge` shown when present in that turn. Node status color: idle/running(pulse)/ok/failed/**skipped**(dimmed) driven directly by each `AgentStep.status`.
- A **turn selector** chooses which turn paints the canvas; during `running` it auto-follows `current_turn` (always ≥ 0 — no `-1`/undefined hazard). Clicking a node opens a **detail drawer** for that step: prompt-in (system+user), raw response, parsed output, `thought`, `branch_reason`, inputs/decision, timing. Free-text **notes** per turn (client-side; included in export).

### 8.4 Supporting panels + export
- **Transcript** — `TranscriptPanel` idiom (interviewer / You / System).
- **Decision timeline** — `RunTimeline` idiom, grouped by turn, reading the same `turn.steps` (skipped rows shown muted).
- **Input composer** — candidate-turn text box + collapsible artifact paste (sets sticky artifact; explicit "clear artifact") + `advance_seconds` control ("jump elapsed to N min" shortcut) + "simulate silence" button. **Disabled unless `status == awaiting_input`**; on submit it optimistically disables and relies on the server's atomic-accept/409 to reject a stale double-submit (critic #4).
- **Log stream** — `RunLogStream` over `session.logs`.
- **Copy-as-Markdown** — client-side serializer (per-turn or whole-session): transcript, each decision (step, inputs, chosen action, branch_reason), prompt-in/out, `thought`, notes, and logs — formatted for pasting into Claude Code.

### 8.5 Reuse vs new (frontend)
- **Reuse:** tabs host, `RequireAdmin`, `apiFetch`, `useRunPolling` (generalized), `RunLogStream`, `RunTimeline`, `TranscriptPanel`, JD/candidate hooks, prep-bench console for Phase 1.
- **New:** `AgentDiagnosticsPanel`, `PipelineCanvas` (react-flow), `features/agent-diagnostics/*`, endpoint constants, `@xyflow/react` dep, Markdown export util, per-turn notes, recent-sessions selector.

## 9. Cross-repo contract table

| Action | Frontend (`apiFetch`) | Backend (ADMIN) | ai-service (`X-Internal-Api-Key`) | Body / returns |
|---|---|---|---|---|
| Run prep | existing | `/api/v1/intelligence/interview-prep/run` | `/admin/interview-prep/run` | `GenerateInterviewPlanRequest` → `{run_id,status}` |
| Poll prep | existing | `/interview-prep/runs/{id}?after=` | `/admin/interview-prep/runs/{id}` | `RunSnapshot`; `result` = InterviewPlan |
| Start session | new | `/intelligence/interview-agent/run` | `/admin/interview-agent/run` | InterviewPlan → `{run_id,status:"running"}` (429 if at capacity) |
| Submit turn | new | `/interview-agent/runs/{id}/turn` | `/admin/interview-agent/runs/{id}/turn` | `{text?,artifact?,advance_seconds?,silence?}` → `{status:"accepted"}` (409 if not awaiting_input / inbox non-empty) |
| Poll session | new | `/interview-agent/runs/{id}?after=` | `/admin/interview-agent/runs/{id}` | `AgentSession` snapshot (turns+steps+logs+result+ended_reason) |
| List sessions | new | `/interview-agent/runs` | `/admin/interview-agent/runs` | `AgentSessionSummary[]` (recent-sessions selector) |
| End session | new | `/interview-agent/runs/{id}/end` | `/admin/interview-agent/runs/{id}/end` | → `{status:"accepted"}` (async; poll for terminal) |

## 10. Data flow (end to end)
1. Admin picks JD + candidate → **Run prep** → Spring → ai-service `/admin/interview-prep/run` → instrumented prep pipeline; frontend polls, shows steps/prompts; `result` = `InterviewPlan`.
2. **Start session** → POST InterviewPlan → ai-service `start_agent_session` → task binds `run_id`, seeds opening turn 0, runs `run_session(DiagnosticTransport, plan)`; brain emits opening line(s) into turn 0 → blocks in `next_utterance` → `awaiting_input`.
3. Frontend polls (1s) → renders opening line + transcript; canvas shows turn 0.
4. Admin submits a turn (text + optional artifact / `advance_seconds` / silence) → atomic-accept flips `running` → inbox delivers → brain runs one turn; each sub-step (incl. explicit `skipped`) emits into the store; logs captured → blocks again → `awaiting_input`.
5. Poll picks up the new `AgentTurn` → canvas animates node statuses, timeline fills, click-through detail, logs stream.
6. Repeat until brain ends (any `EndedReason`) or admin force-ends → status terminal (`completed`/`abandoned`/`aborted`/`failed`), `result` = `SessionOutcome`, `ended_reason` shown prominently.
7. Copy-as-Markdown at any point.

## 11. Error handling & edge cases
- **Fatal LLM error** (propagates out of `run_session`) → session `failed`, failing sub-step in `error`. **Brain-tolerated LLM error** → `failed` sub-step recorded, session stays live (critic #10). A per-turn **re-submit** is available so a transient failure doesn't discard the session.
- **Silence turns** drive real inactivity escalation (feature, not error); `PROBE_ARTIFACT`/nudge/final-warning/`ABANDONED` appear as steps per §6.7.
- **Double-submit / submit when not `awaiting_input`** → `409` via atomic accept; composer disabled off `awaiting_input`.
- **Force-end while awaiting input** → `_END` → `aborted` (critic #1).
- **Store eviction / restart** → protected while non-terminal; terminal sessions evicted LRU and their tasks already done. A poll on an evicted/unknown id → `404` → UI "session expired (ephemeral store)".
- **At capacity** (`MAX_ACTIVE_SESSIONS`) → `429`/`sessions_at_capacity`; UI asks the admin to end an existing session.
- **Artifact lifecycle** — sticky until replaced; `grade.detail` records `artifact_present_this_turn` vs `artifact_used_in_grade` (critic #8). Meaningful only on `_ARTIFACT_ROUNDS`; UI hints.
- **Opening phase** has no scoring/pacing — those steps are emitted `skipped` within turn 0.

## 12. Testing strategy
- **ai-service (primary):**
  - `DiagnosticTransport`: `_TurnInput`/`_SILENCE`/`_END` handling; both clocks (elapsed via `t_end`, activity via `seconds_since_activity`); sticky-artifact retain/replace/clear.
  - `AgentSessionStore`: `?after` cursor; **eviction protects non-terminal + cancels task**; opening-turn-0 seeding; skipped-step materialization; snapshot shape.
  - Emitter: each tap records expected `detail` keys; `thought` captured per `llm_label` (converse+derive both retained in one PIVOT_DERIVE turn); `skipped` emitted for bypassed steps.
  - Router wrapper: `branch_reason` labeling is pure and returns the same `Action` as bare `graph.decide` (regression guard).
  - Integration: drive `run_session` through scripted turns covering answer / clarify / off_topic / pivot→derive / idk / **pacing wind-down + time_ceiling (via `advance_seconds`)** / silence→abandon / artifact-grade / mid-coding probe / force-end→aborted; assert the turn/step tree + `branch_reason`s + `ended_reason`.
  - **Regression:** brain's 148 existing tests stay green.
- **backend:** proxy tests — passthrough, `X-Internal-Api-Key` injection, ADMIN gate, **3-way error mapping** (400/404/502) + `429` capacity, `/end` returns `accepted`.
- **frontend:** panel phase machine; generalized poller keeps polling on `awaiting_input`; canvas + timeline both derive status from the same `turn.steps` (no divergence); composer disable/409 handling; Markdown export formatting; recent-sessions selector.

## 13. Phasing (each independently shippable + testable)
**Slice 1 — text diagnostics, no canvas.** `DiagnosticTransport` (both clocks, three inbox types) + `AgentSessionStore` (eviction protection, opening turn 0, skipped markers) + structured emitter (**no `<thought>` yet**) + ai-service admin endpoints (atomic accept, capacity, force-end) + Spring proxy (3-way errors) + `AgentDiagnosticsPanel` with prep reuse, transcript, `RunTimeline`-grouped decision timeline, input composer (text + artifact + `advance_seconds` + silence), `RunLogStream`, Markdown export, recent-sessions selector.
- **Acceptance:**
  1. Run prep → start session → conduct a full text interview; every `main` turn shows classify/grade/pacing/route/action (+ `skipped` for scope on non-pivots).
  2. Pacing: driving `advance_seconds` past the bands reaches `ended_reason ∈ {natural_complete, time_ceiling}`.
  3. Silence: the §6.7 sequence reaches `status:"abandoned"`.
  4. Artifact turn on a DSA/LLD/SD round shows `artifact_used_in_grade:true`.
  5. Double-submit returns `409`; force-end yields `status:"aborted"` + shows partial `SessionOutcome`; capacity returns `429`.
  6. Poll on an evicted/unknown id shows "session expired".
  7. Copy-as-Markdown produces a clean bundle (transcript + decisions + prompts + logs).

**Slice 2 — reasoning + canvas.** `<thought>` capture seam (client.complete contextvar keyed by `llm_label`); `@xyflow/react` `PipelineCanvas` with live node highlighting + click-detail drawer + per-turn notes.
- **Acceptance:** canvas animates node statuses per turn from `turn.steps`; clicking any node shows prompt/response/**thought**/branch_reason/timing; a PIVOT_DERIVE turn shows distinct converse + derive thoughts; notes flow into the export.

## 14. Risks / caveats / open items
- **Ephemeral store** (in-memory, LRU 25, non-terminal protected, lost on restart) — acceptable for a dev tool; surfaced in UI. Not for long-lived audit.
- **`<thought>` availability** depends on the configured model emitting `<thought>`; null-safe when absent.
- **Two narrowly-scoped non-additive changes**: explicit `skipped`-step markers and `<thought>` capture. Both are inert on the production `run_session` path (guarded by diagnostic context) and covered by the 148-test regression guard.
- **`@xyflow/react`** is a new frontend dependency (user-approved); keep it isolated to `PipelineCanvas`.
- **Pure-router `branch_reason` wrapper** must stay pure + unit-tested so brain behavior is unchanged.
- **Concurrency** capped at `MAX_ACTIVE_SESSIONS`; single-admin dev tool, not built for many parallel sessions.

## 15. Out of scope (explicit)
Real audio / STT / TTS / LiveKit / worker instrumentation; Mongo persistence of diagnostic sessions; backend outcome-sink callback; candidate-facing exposure; changing brain decision logic; graceful `finalize` on force-end (hard abort only); many parallel sessions beyond the cap.

## 16. Verification changelog (what the fact-check + critic workflow changed)
Fact-check: **47/48 existing-code claims CONFIRMED**, 1 WRONG (fixed). Adversarial critic: **16 gaps**, all folded in.
- **Backend error mapping (WRONG → fixed §4.2/§7/§12):** the prep proxy uses a **3-way** mapping (400 `prep_bad_request` / 404 `run_not_found` / 502 `ai_service_unreachable`), not `RestClientException→run_not_found`.
- **HIGH #1 force-end:** distinct `_END` sentinel (≠ `_SILENCE`); raises `DiagnosticSessionAborted` → status `aborted` (§6.1/§6.5).
- **HIGH #2 opening turns:** synthetic opening **turn 0**, `current_turn` never `-1`; pre-utterance `say()` lines attach to turn 0 (§6.1/§6.2).
- **HIGH #3 pacing clock:** resolved favorably — `state.elapsed_s = timing.t_end`, so the transport controls elapsed via `advance_seconds` → pacing/time-ceiling reachable (§4.4/§6.1/§6.7).
- **HIGH #4 double-submit:** atomic accept flips status under lock + rejects non-empty inbox (§6.6).
- **HIGH #5 eviction:** protect non-terminal statuses + cancel orphaned task on eviction; `MAX_ACTIVE_SESSIONS` cap (§6.2/§6.5).
- **MED #6 thought seam:** pinned to `client.complete` + contextvar keyed by `llm_label`; multi-op turns keep distinct thoughts (§6.4).
- **MED #7 skipped steps:** emitter materializes explicit `status:"skipped"` steps; canvas + timeline share one source (§6.2/§8.3/§8.4).
- **MED #8 artifact lifecycle:** sticky-until-replaced; grade records present-this-turn vs used-in-grade (§6.1/§11).
- **MED #9 silence protocol:** worked sequences documented (§6.7).
- **MED #10 LLM errors:** fatal (session `failed`) vs brain-tolerated (sub-step failed, session live) + per-turn re-submit (§6.5/§11).
- **MED #11 acceptance:** risky-path acceptance bullets added per slice (§13).
- **MED #12 security matcher:** mirror the prep controller's exact mapping so it's under the working v1 ADMIN gate (§7).
- **LOW #13 list endpoint:** added to the contract table + wired to a recent-sessions selector (§8.1/§9).
- **LOW #14 `/end` return:** `{status:"accepted"}`, async, poll for terminal (§6.6/§9).
- **LOW #15 terminal status:** `ended_reason` stored + rendered prominently so `completed` isn't misread (§6.5).
- **LOW #16 TranscriptEntry:** confirmed client shape `{speaker,text}` matches server — no adapter (§4.3).
