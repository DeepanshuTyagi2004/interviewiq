# Interview Blueprint (prep phase): design

**Date:** 2026-10-07
**Status:** approved in conversation, section by section; this document is the written spec for review.
**Replaces:** Pipeline 1 (`InterviewPlan`) and Pipeline 2 (the live voice agent), both deleted in full.

## 1. Goal

When a candidate books a round, prepare an **interview blueprint**: a structured, validated playbook a
live AI interviewer can run naturally. It covers:

- which problems to ask (chosen by company, JD and round);
- who the interviewer is;
- how the conversation flows;
- what to do in every common situation (stuck, wrong, asks for a hint, goes off-topic, asks for something);
- what a correct answer looks like;
- which evaluation signals to collect.

The candidate sees friendly progress while it prepares, then a short briefing. Admins can see exactly how
every blueprint was built, and why one failed, in a new Intelligence tab.

**Success:** booking a round produces a validated blueprint long before the slot; the candidate sees clear
prep status; an admin can trace every selection, every LLM call and every check.

**Out of scope (later phases):**
- the live interviewer that runs a blueprint;
- the post-interview report;
- the interview-score formula, pass thresholds and readiness rules (human decisions; see the root `CLAUDE.md`).

## 2. Decisions taken

| Decision | Choice |
|---|---|
| Old architecture | Pipeline 1 **and** the live agent are deleted; nothing survives. Live interviews are unavailable until the next phase rebuilds the agent on the blueprint. |
| When prep runs | At booking. Re-prepared automatically if the inputs change, until 30 minutes before the slot. |
| Blueprint shape | **Playbook**: per-question playbooks with condition → action branches from a fixed vocabulary, plus global policies and evaluation signals. The agent improvises only when no rule matches. |
| Problem selection | Deterministic and explainable (§6). No user context, except excluding problems the user has already been given. |
| Answer keys | Built at prep time and cached per problem. DSA keys are LLM-written and sandbox-checked against the source's two examples. Other rounds start from the bank's expected-design / strong-answer content, and an LLM adds key insights, common wrong paths and edge cases. |
| Candidate visibility | Progress steps plus a briefing (interviewer, format, duration). **Never** topics, problem names or difficulty. |
| Prep animation | Five original looping outline-SVG mascot sets, one chosen at random per visit (§9). |
| Diagnostics | An admin-only Intelligence tab with a run list, a bench, stage traces, a blueprint viewer and diffs (§10). |

## 3. Removal (nothing survives)

### AI service (`apps/ai-service`)

**Delete outright:**
- `app/interview_prep/`, the whole folder.
- `app/interview_agent/`, the whole folder.
- `app/jobs/agent_sessions.py`.

**Remove from `app/api/routes.py`:**
- `POST /interview-plans`, `POST /interview-plans/start`, `GET /interview-plans/runs/{id}`.
- The plan purge in `POST /users/purge`. The endpoint itself stays; it is rewritten to purge blueprint data (§11).

**Remove from `app/api/admin.py`:** `/admin/interview-prep/*` and `/admin/interview-agent/*`.

**Storage and wiring:**
- Mongo: the `INTERVIEW_PLANS` collection and its index (`app/db/mongo.py`); `upsert_plan`, `get_plan` and
  `delete_plans_for_sessions` (`app/db/repositories.py`). The existing collection is dropped by a one-off
  cleanup in the new startup index code.
- `app/main.py`: the `AgentDiagLogHandler` install.
- `app/llm/client.py`: the `diagnostics_emit` hook.
- Any docstrings naming the deleted code.

**Config (`app/config.py` and `.env.example`):**
- `prep_llm_model`;
- the `prep_*` block;
- the whole Pipeline 2 `interview_*` block;
- `livekit_*` and `deepgram_api_key`.

**Dependencies (`requirements.txt`):** `langgraph`, `livekit-agents`, `livekit-plugins-deepgram`.

**Tests:**
- Delete every `tests/test_interview_prep_*`, `test_interview_plan_endpoint.py`, `test_plan_reserve.py`,
  `test_persona_gender.py`, all of `tests/interview_agent/`, `tests/api/test_admin_interview_agent.py`,
  `tests/api/conftest.py` (if agent-only) and `tests/jobs/test_agent_sessions.py`.
- Edit `test_engineering_levels.py`, `test_user_purge.py`, `test_pipeline_runs.py`, `conftest.py`,
  `test_config.py`, `test_linkedin_import.py` and `llm/test_thought_capture.py`.

### API (`apps/api`)

**Delete:**
- `src/services/interviewPrep.ts`.
- `src/services/codingSignals.ts`, after confirming it has no other consumer. The new request assembly
  in §5.1 owns its own profile projection.
- The `InterviewPrepJob` in `src/jobs/jobs.ts`, with its `index.ts` registration.
- The Mongo `session_outcomes` collection and `SessionOutcomeRepository`.
- The `POST /internal/sessions/:id/outcome` route and `LiveSessionService.recordOutcome`.

**Remove from routes, services and integrations:**
- The prep and agent bench routers in `src/routes/intelligence.ts` and their mounts in `src/app.ts`.
- The ai-service client methods `startInterviewPlan`, `getInterviewPlanRun`, `*InterviewPrepRun*` and
  `*AgentRun*`, and the `Plan*` types in `src/integrations/aiService/types.ts`.
- `regenerate()` and the `/sessions/:id/regenerate` route.

**Edit:**
- `accountDeletion.ts` and `accountExport.ts`, to match §11.
- The `profileScoring.ts` diagnostic checks `"interview-prep"` and `"voice"`.
- `src/config.ts`: remove the `INTERVIEW_PREP_*` settings; keep `SCHEDULER_ENABLED` and the LiveKit
  settings.

**Migration (additive only, per apps/api/CLAUDE.md and the Hibernate-compatibility test):**
- `plan_version`, `input_hash` and `prep_error` stay in `interview_sessions` but are no longer mapped or written.
- Add the columns in §5.2.
- Future sessions that were `PREP_READY`/`PREP_FAILED` under the old plan are re-queued (`PREP_QUEUED`) so they get a blueprint.

**Tests:** delete or rewrite every prep, agent and outcome test listed in the footprint map.

**Stays:**
- booking, slots, reschedule and cancel;
- the `SESSION_STATUSES` values (generic lifecycle; booked rows untouched);
- `practice_prep` snapshots;
- the LiveKit token and room plumbing (`startLive`, `getLive`);
- the live-room UI shell.

### Contract (`packages/contracts/openapi.yaml`)

**Remove:**
- `InterviewPlan`, `PlanProvenance`, `InterviewerPersona`, `RoundBeat`, `QuestionLadder`,
  `RubricCriterion`, `CandidateProbe`, `GenerateInterviewPlanRequest` and every `Plan*` schema.
- The `/interview-plans*` and `/regenerate` paths.
- The `planReady`, `planVersion`, `inputHash` and `prepError` fields on `InterviewSession`.
- The Pipeline 1 description text.

**Add:** the schemas in §5 and §10. Then regenerate the web types.

### Web (`apps/web`)

**Delete the orphaned bench code:**
- `app/(app)/intelligence/_components/agent/*`;
- `features/interview-prep-bench/` and `features/agent-diagnostics/`;
- the `INTERVIEW_PREP_BENCH_ENDPOINTS` and `INTERVIEW_AGENT_ENDPOINTS` constants;
- `SESSION_DOT` in `pills.ts`.

**Replace:** regenerate/retry wiring and the plan-status copy, per §8.

### Docs

**Delete:**
- `apps/api/docs/architecture/interview-prep-pipeline1-hld-lld.md`.
- Every Pipeline 2, live-runtime, voice, conversational-interviewer and agent-diagnostics spec and plan
  (`apps/ai-service/docs/superpowers/*`, `apps/api/docs/superpowers/*`, `apps/web/docs/superpowers/*`).
  Git keeps the history.

**Update:**
- The root `README.md` lifecycle and live-agent sections, and `apps/ai-service/README.md`.
- The root `CLAUDE.md`, which also corrects the problem-bank paragraph: DSA content is source-grounded
  and verified only; no solutions in the bank; nothing unverified is stored.
- `apps/api/CLAUDE.md`.
- `apps/ai-service/docs/question-bank.md`, to link to this design.

## 4. Pipeline overview

```
API                                         AI service
───                                         ──────────
book round ──► session PREP_QUEUED
            ──► assemble inputs + fingerprint
            ──► POST /blueprints/runs ─────► run (async, one per session; at most
                                              BLUEPRINT_MAX_PARALLEL_RUNS execute at once, the
                                              rest wait with every step pending)
                                              1 context      (no LLM)
                                              2 selection    (no LLM)
                                              3 answer keys  (cache, LLM on miss)
                                              4 persona+arc  (LLM)
                                              5 personalize  (LLM)
                                              6 playbooks    (LLM, one call per slot, concurrent)
                                                 every LLM call: quota waits, plus 2 retries of a
                                                 malformed/truncated reply or dropped connection
                                              7 policies     (template)
                                              8 assemble+validate → interview_blueprints
reconcile job (1 min) ◄── GET /blueprints/runs/{id}
  apply if fingerprint still current → PREP_READY | PREP_FAILED
GET /sessions/:id while preparing ──► live step from the run
```

## 5. API side

### 5.1 Inputs and fingerprint

`BlueprintRunRequest` is assembled by the API. The AI service never reads the API's databases.

| Field | Content |
|---|---|
| `session` | id, candidateId, company, role, level, specialization, roundType, scheduledAt, loopId, nodeId |
| `jobDescription` | id, title, description, techStack (or the practice snapshot's descriptor) |
| `round` | the booked round from the published brief, matched by loop node, else by round type: type, durationMins, format, topics, named problems, difficulty |
| `companyBrief` | dominant topics, difficulty calibration, interviewer style notes, company patterns, red flags |
| `candidateProfile` | a minimal projection: headline, current level, years of experience, skills, projects (name, stack, summary), experience (title, company, summary), education, coding summary (solved counts by difficulty, top topics). No contact details. |
| `exclusions` | slugs already given to this user in live sessions (§7.4), plus slugs in the user's other active blueprints |
| `trigger` | `booking`, `reconcile`, `refresh`, `retry` or `bench` |
| `options` | bench only: `bypassBlueprintCache`, `bypassAnswerKeyCache`, `ignoreExclusions` |

- **The fingerprint** is sha256 of the canonical JSON of everything except `trigger` and `options`. The
  API stores it as `prep_input_hash`.
- **Its parts** (`jd`, `round`, `brief`, `profile`, `exclusions`, `level`) are hashed separately as well,
  so diagnostics can say which part changed.

### 5.2 Session columns (migration)

**Add:**
- `prep_run_id` (varchar)
- `prep_input_hash` (varchar)
- `blueprint_version` (int)
- `prep_error_code` (varchar)
- `prep_refreshing` (bool, default false)
- `prep_retry_count` (int, default 0)
- `prep_retry_window_start` (timestamptz)
- `prepared_at` (timestamptz)
- `prep_briefing` (jsonb): the candidate-safe briefing copied from the current blueprint (§5.5)

- `prep_run_started_at` (timestamptz): when the active run started, for the reconcile timeout

**Not dropped** (additive migrations): `plan_version`, `input_hash`, `prep_error` remain, unused.

### 5.3 Lifecycle

- **Booking:** `SCHEDULED → PREP_QUEUED`, then the run starts immediately. A failure to reach the AI
  service leaves the session `PREP_QUEUED` with no `prep_run_id`; the reconcile job retries.
- **First prep:** the run completes and validates → `PREP_READY`, setting `blueprint_version`,
  `prepared_at` and `prep_input_hash`. It fails → `PREP_FAILED` with `prep_error_code`.
- **Refresh:** a `PREP_READY` session keeps its status. `prep_refreshing=true` while the new run is
  active; on success the new version becomes current; on failure the old blueprint stays and
  `prep_refreshing=false`. Only diagnostics records the failure.
- **Automatic re-run (added 2026-10-08):** a first prep that fails for the infrastructure's reasons
  (`llm_unavailable`, `timeout`, `internal_error`, `interrupted`) is queued again at once, up to 2 times
  per rolling hour, while the slot is still beyond the refresh cutoff. The session stays `PREP_QUEUED`
  (the page keeps showing the steps); the re-runs count against the same `prep_retry_count` window as
  the candidate's own retries. Input problems (`round_not_found`, `not_enough_problems`, …) are never
  re-run.
- **Retry** (`POST /api/v1/interviews/sessions/:id/prep/retry`):
  - allowed from `PREP_FAILED`;
  - at most 3 per rolling hour (`prep_retry_count` within `prep_retry_window_start`, else `429`).
- **Cancel:** cancels any active run (`POST /blueprints/runs/{id}/cancel`). The session's blueprints stay
  until purge.
- **Reschedule:** keeps the blueprint and recomputes the fingerprint; a change triggers a refresh.
- **Stale guard:** a finished run is applied only if its fingerprint equals the session's current one,
  recomputed at apply time. Otherwise it is discarded, recorded as `superseded`, and a fresh run starts.

### 5.4 Reconcile job (`BlueprintReconcileJob`, every 60 s, under `SCHEDULER_ENABLED`)

1. **Start:** `PREP_QUEUED` sessions with no active run.
2. **Collect:** sessions with a `prep_run_id` whose run is terminal; apply (§5.3).
3. **Time out:** runs active for more than 12 minutes → cancel, then re-run automatically (§5.3) or
   mark `PREP_FAILED` (`timeout`), or end the refresh.
4. **Refresh,** every 15th tick (configurable):
   - which sessions: `PREP_READY`, future, more than 30 minutes before the slot, not refreshing;
   - recompute the fingerprint, and start a `refresh` run if it differs.

**Config:**
- `BLUEPRINT_RECONCILE_INTERVAL_MS` (60000)
- `BLUEPRINT_REFRESH_EVERY_TICKS` (15)
- `BLUEPRINT_REFRESH_CUTOFF_MINUTES` (30)
- `BLUEPRINT_RUN_TIMEOUT_MINUTES` (17; was 12 before Gemini, kept a little above the AI service's 900 s)
- `BLUEPRINT_RETRY_LIMIT_PER_HOUR` (3)
- `LIVE_INTERVIEWER_AVAILABLE` (false)

### 5.5 Session response (contract)

`InterviewSession` gains:

```
prep: {
  step: "context" | "selection" | "answer_keys" | "persona" | "personalization" | "playbooks" | "policies" | "validate" | null,
  steps: [{ id, state: "done" | "active" | "pending", elapsedMs }],   // present while preparing or refreshing
  refreshing: boolean,
  preparedAt: string | null,
  errorCode: string | null
}
briefing: { interviewerName, interviewerStyle, format, durationMins } | null   // only when PREP_READY
liveAvailable: boolean                                                        // = LIVE_INTERVIEWER_AVAILABLE
```

- **Live step:** while preparing or refreshing, `GET /sessions/:id` fetches the active run's stage from the
  AI service, so steps are live. If that call fails, the steps are omitted and the status is still
  returned.
- **Briefing:** `briefing` is copied from the current blueprint's candidate-safe `briefing` at apply time
  and stored in `prep_briefing` (§5.2), so reads never touch the AI service.

## 6. Blueprint run (AI service)

**New package:** `app/blueprint/`.
- `context.py`
- `topics.py` (the dictionary)
- `selection.py`
- `answer_keys.py`
- `persona.py`
- `personalize.py`
- `playbooks.py`
- `policies.py` (the template)
- `assemble.py`
- `validate.py`
- `models.py`
- `prompts/` (product-IP drafts)
- `runs.py` (the run store and trace)
- `pipeline.py`

**Routes (internal, `X-Internal-Api-Key`):**
- `POST /blueprints/runs`
- `GET /blueprints/runs/{id}`
- `POST /blueprints/runs/{id}/cancel`
- `GET /blueprints/sessions/{sessionId}` (the current blueprint)

Admin routes are in §10.

**The LLM client:** the routed `ResearchLLMClient`: Gemini first when `GEMINI_API_KEY` is set (a paid key,
`gemini-3.8-flash`, its own output budget; revised 2026-10-08 after Groq's free tier timed runs out), then the
Groq-first free-tier chain with quota-aware waits. Settings:
- `BLUEPRINT_MAX_OUTPUT_TOKENS`
- `BLUEPRINT_DEADLINE_SECONDS` (300; Gemini gets 60% of it)
- `BLUEPRINT_CONCURRENCY` (default 4)
- `BLUEPRINT_RUN_TIMEOUT_SECONDS` (900)

Every structured output is validated against its Pydantic model, with one repair attempt.

**The trace:** every stage writes a trace record: input summary, output, status, timings, and, for LLM
calls, the prompt (system and user), raw response, parsed output, validation errors and repairs, retries,
provider, model, tokens and latency.

### Stage 1: context (no LLM)

- Resolve the round from the request.
- Error `round_not_found` if neither the brief nor the practice snapshot gives this round.
- Normalize the round topics, company dominant topics and JD-derived topics through `topics.py` (§7.2).

### Stage 2: selection (no LLM)

Described in §7.

### Stage 3: answer keys (cached)

- **Cache:** collection `answer_keys`, keyed by `(round_type, slug, content_hash, KEY_VERSION)`.
- **On a miss,** an LLM writes the key:
  - **DSA:** approaches (brute force → optimal, each with time and space complexity), complexity target,
    key insights, common wrong paths `{path, whyWrong, nudge}`, edge cases, and a reference solution
    `{language: python, entryPoint, code, verifiedAgainstExamples}`. Grounded in the problem's stored content (statement,
    constraints, the two examples).
  - **System design and LLD:** must-cover points; the expected design (copied from the bank); trade-offs
    (from the bank); key insights; common wrong paths; edge cases (failure scenarios, concurrency, scale
    limits).
  - **Behavioural and HR:** the strong answer and STAR guide (from the bank); what the interviewer listens
    for; weak patterns; red flags (from the bank); edge cases (e.g. no work experience → accept a project
    or academic example).
- **DSA check:** the reference solution runs once in the sandbox against the problem's two source
  examples (order-insensitive when `answer_order_irrelevant`).
  - On failure: one repair round with the exact mismatch.
  - Still failing: the problem is **swapped** for the next-ranked candidate in its slot, the swap is
    recorded, and the failed key is **not cached**.
  - A key is cached only when it passes (DSA) or validates (others).

### Stage 4: persona and arc (LLM)

- **The persona** is grounded in the company brief's interviewer-style notes and the round: name,
  seniority, style, disposition, an opening line, a closing line, `groundedIn[]`.
- **The arc** is a list of phases from `greeting | small_talk | framing | candidate_intro | core |
  candidate_questions | wrap_up`, each with `timeboxMins`, `scored` and `guidance`.
  - `greeting`, `small_talk`, `framing` and `wrap_up` are always `scored=false`.
  - The timeboxes must sum to the round duration (§8 invariants).

### Stage 5: personalization (LLM)

- **Inputs:** the candidate profile with the company and JD.
- **Outputs:**
  - `rapportHooks[] {line, source}`: non-scoring small talk grounded in the resume.
  - `resumeProbes[] {prompt, groundedIn, whatItTests}`: deep-dive probes, required for hiring-manager
    rounds.
  - `levelExpectations`: what this level must show in this round.
- **Rule:** never invent facts about the candidate; every hook and probe names its source item.

### Stage 6: playbooks (LLM, one call per slot, concurrent)

For each slot (core and reserve):

- `ask {opening, clarifications[] {question, answer}}`
- `hintLadder[] {step, hint}`: three or more, gentle → explicit
- `branches[] {condition, action, say, notes}`
- `probes[]`, `followUps[]`
- `expectations {mustShow[], strongSignals[], weakSignals[]}`: level-calibrated
- `evaluationSignals[] {signal, observe}`

A slot whose output fails validation is retried once; still failing → the run fails with
`playbook_failed`.

**Quality rules (added 2026-10-08 after reading real blueprints):**

- The prompt explains every condition (`CONDITION_MEANINGS`): bare names were misread ("seen before" came
  back as "I've seen this before" or "the candidate repeated a story").
- Four conditions have a policy-fixed action (`PINNED_ACTIONS`): `seen_before → switch_to_reserve`,
  `asks_for_answer → decline_politely`, `off_topic → redirect`, `over_time → wrap_up_slot`. A branch with
  another action is replaced by the default rule (notes "policy rule (pinned action)", recorded in the trace).
- One company per interview: a branch, line or signal naming another company or another company's culture
  (its name, "Leadership Principles", "Googleyness") fails the check and gets the repair round.
- The playbook sees a few candidate facts (level, years, headline, project names, "title at company",
  education) and may assume nothing else; scenarios are calibrated to the level (freshers talk about
  college projects and internships, never about leading teams).
- A question's `principle` is shown only when the question is tied to the booked company.
- Spoken lines lose a leading "Name:" prefix.
- A behavioural question asks for the candidate's own past example: no hypothetical scenario, and clarifications
  never supply facts about the candidate's past.
- No placeholders in spoken lines ("you mentioned X", "[project name]"): the check sends them back for repair
  (code such as `[1, 2, 3]` or `Map<String, Integer>` is left alone).
- The persona's name is one seeded pick from a balanced pool, given to the model rather than chosen by it:
  offered four, the model picked men's names about 80% of the time.
- The `seen_before` line is always the default ("Thanks for telling me. Let's try a different one."): the
  playbook can't know which reserve the interviewer moves to, and named the wrong one.
- Hints and lines are language-neutral (no Python operators for a Java candidate); a line ending in a colon ends
  as a sentence.

### Stage 7: policies (template, no LLM)

`policies.py` holds a versioned template (`POLICY_VERSION`), the same for every interview and **product IP
drafted for review**:

- **`requests[] {kind, decision, how}`.** Kinds:
  - `repeat_question` → comply
  - `clarify_requirement` → comply
  - `ask_hint` → comply via the hint ladder
  - `ask_solution` → decline (nudge instead)
  - `ask_if_correct` → partial (ask them to verify)
  - `change_language` → comply
  - `use_internet_or_ai` → decline
  - `take_break` → comply (brief)
  - `skip_question` → partial (offer a hint first, then the reserve)
  - `extend_time` → partial
  - `ask_about_company` → comply in the candidate-questions phase
  - `ask_for_feedback_now` → decline (after the interview)
  - `personal_or_inappropriate` → decline politely
- **`offTopic`, `timeManagement`, `integrity`, `fallback`:** short guidance strings.

### Stage 8: assemble and validate

Build the blueprint (§8), the candidate-safe `briefing`, and `provenance`. Run the invariants (§8.3).

- **Pass:** save as a new version in `interview_blueprints`, and mark the run `completed` with
  `blueprintVersion`.
- **Fail:** `validation_failed`, with the failed checks in the trace.

**Blueprint cache:** a run whose fingerprint equals the session's current blueprint's `inputHash`
completes immediately with `cached=true`, unless `bypassBlueprintCache`.

## 7. Problem retrieval (stage 2)

### 7.1 Pool

- Bank records for the round family with usable content: `verified` for DSA and `online-assessment`,
  `generated` otherwise.
- **Family mapping:**
  - `dsa` and `online-assessment` → `dsa`;
  - `system-design` → `system-design`;
  - `lld` (and machine coding) → `lld`;
  - `behavioural` → `behavioural`;
  - `hiring-manager` → `hiring-manager` plus `behavioural` categories `leadership-ownership`,
    `self-introduction` and `strengths-weaknesses`.
- **Removals:** anything in `exclusions` (unless the bench sets `ignoreExclusions`).

### 7.2 Topic dictionary (`topics.py`)

- Canonical topic ids with aliases, e.g. `dynamic-programming` ← "dp", "dynamic programming",
  "dp on subsequences", "memoization".
- **DSA:** about 40 canonical topics, aligned with the API's JD-fit `DSA_TOPICS` ids.
- **System design and LLD:** components and domains (`payments`, `messaging`, `feed`, `search`,
  `storage`, `rate-limiting`…).
- **Behavioural:** categories.
- **Coverage:** applies to brief topics, JD text (whole-word match), and bank `topic_tags`, `patterns`,
  `components_tested` and `domain`.
- Product IP draft.

### 7.3 Difficulty window

- **Target:** the round's difficulty from the brief; else by level:

  | Level | Range |
  |---|---|
  | intern / fresher | easy–medium |
  | sde1 | easy–hard, mostly medium |
  | sde2 and above | medium–hard |

- **Window:** target ± one step, inside the level's range.
- **Missing difficulty:** a record with no difficulty is treated as medium.

### 7.4 Score (weights in `BLUEPRINT_SELECTION_WEIGHTS`, defaults)

| Signal | Points |
|---|---|
| Named in this company's experiences for this round (brief `problems`, matched by slug/title) | +40 |
| Company tag with evidence `reported` | +25 |
| Company tag with evidence `inferred` | +10 |
| Topic overlap (overlap coefficient on canonical topics: shared ÷ the smaller set, vs round ∪ company-dominant ∪ JD topics) | 0–25 |
| Exact target difficulty | +10 |
| Adjacent difficulty | +4 |
| Level tag includes the session level | +5 |
| Popularity: min(5, companies reporting it ÷ 4) | 0–5 |

**Seen-before:** a problem is added to the user's seen list when its session goes live (from the
next phase on; stored by the API, sent as `exclusions`). Slugs in the user's other upcoming blueprints
are also excluded.

### 7.5 Composition

| Round | Core | Reserve | Rules |
|---|---|---|---|
| DSA / OA | 2 (DSA: 1 when the round is 35 minutes or less, targets hard, or has a round-questions part; a real senior round is one hard problem with follow-ups) | 2 | Distinct primary pattern; difficulty non-decreasing; reserves = 1 harder extension + 1 same-level alternate |
| System design | 1 | 1 | The alternate swaps in on `seen_before`; a company-domain match adds topic score |
| LLD | 1 | 1 | Same as system design |
| Behavioural | 4 | 3 | Distinct categories (motivation, conflict, failure, ownership); company principles first where they exist |
| Hiring manager | 3 | 2 | Motivation and career questions; the resume deep-dive comes from personalization |
| Mixed technical (round mentions Leadership Principles, behavioural, Googleyness, culture fit or core values, or the company's brief says its principles come up in every interview) | 1 technical + 2 behavioural | technical reserves + 1 behavioural | The behavioural questions open the round (as Amazon's "a coding problem plus Leadership Principle questions" loop rounds do), from the company's principles category with two different principles, else distinct general categories; 8 minutes each when the core is 40+ minutes, else 6; slot ids `culture-1`, `culture-2`, `culture-reserve`; DSA keeps one coding problem. The briefing's format says "…, plus behavioural questions". |

**One company per interview.** A behavioural question written for another company (its content names a
company it is tagged with but the booked one isn't, or it belongs to another company's principles category)
never enters the pool; the selection summary counts them as `other_company`. Answer keys for non-DSA
questions are cached per problem across companies, so they are written company-neutral unless the question
belongs to one company's principles, and per **level band** (early: intern/fresher/SDE-1, mid: SDE-2/3,
senior: staff and above; `EXTRAS_KEY_VERSION` k3, key version `k3-<band>`): a fresher is not graded on a
staff engineer's answer. A generic question's bank `principle` is dropped from its key.

**Unsuitable questions** (summary `unsuitable`, added 2026-10-08 after the judge read real rounds):

- introduction questions ("Tell me about yourself", "the general icebreaker"): the `candidate_intro` phase
  already opens every round with it;
- for intern and fresher rounds, questions that assume a job ("Why do you want to leave your current company?",
  "What would your previous boss say?");
- a design problem the brief names whose content designs a different system (older bank content turned
  "Design a parking lot" into a bike-sharing dock); other drifted records stay usable, since the candidate never
  sees the internal title.

**No near-duplicates:** the bank holds the same behavioural or design question from several sources; two whose
title words overlap more than half never share a round.

**Hiring-manager rounds:** personalization also sees the round's own topics and notes (internal, never shown to
the candidate) and the planned questions, and writes up to four `round_questions` for what the notes call for and
the bank can't supply (CS fundamentals through the candidate's projects, HR checks such as relocation and
shifts). The deep-dive (resume probes and round questions) gets two shares of the core time.

**Technical rounds with non-problem parts** ("DSA and puzzles", "Coding and data modelling: SQL joins", "resume,
OOP, DBMS and simple problem solving"; a keyword list per family in `context.has_extra_part`, summary
`round_questions_part`): a coding round asks one problem, the round questions get one share of the core time
(`deep_dive_mins`), and personalization must write 2-4 of them. Every other round gets no round questions, even
if the model writes some: they contradicted the slots.

**Core difficulty:** DSA core problems never sit above the round's target difficulty (two hards in one SDE-2
round is not an interview); the harder reserve holds the stretch.

### 7.6 Variety

- **Draw:** each slot draws a weighted sample from the top 8 eligible candidates (weight ∝ score),
  using a PRNG seeded with `sessionId + slotId`.
- **Bench:** bench runs seed with the run id.
- **Result:** reproducible per session, varied across users.

### 7.7 Relaxation

If a slot can't be filled, relax in order, recording each step. Company and topics are scores, not
filters, so only the slot's composition rule and the difficulty window can block a slot:

1. `diversity`: drop the slot's composition rule (distinct pattern/category, harder-than-core);
2. `difficulty+1`: widen difficulty by one step beyond the window;
3. `any_difficulty`: any difficulty.

When the level's range reaches above the round's window (an SDE-1 on an easy round), the harder reserve tries
`difficulty+1` before `diversity`; an intern's or fresher's harder reserve never leaves their level's range. A
behavioural slot inside a technical round ignores difficulty.

Still short → `not_enough_problems`.

### 7.8 Selection trace

For each slot: every candidate considered, with its score breakdown and outcome. Outcomes:
- `picked`
- `excluded_seen`
- `out_of_difficulty`
- `lost_to_diversity`
- `not_drawn`
- `swapped_out` (answer-key failure)

Plus the relaxations applied.

## 8. Blueprint contract

Collection `interview_blueprints`: one document per version; the session's current version is the
highest `version` with `status: "current"`.

```
Blueprint
  id, sessionId, candidateId, version, status ("current" | "superseded"), inputHash, inputParts{...}, createdAt, runId
  round        { type, durationMins, company, role, level, specialization, source: "brief" | "practice", format }
  persona      { name, seniority, style, disposition, opening, closing, groundedIn[] }
  arc[]        { phase, timeboxMins, scored, guidance }
  personalization { rapportHooks[] {line, source}, resumeProbes[] {prompt, groundedIn, whatItTests}, levelExpectations }
  slots[]      { slotId, kind: "core" | "reserve", order, timeboxMins,
                 problem    { roundType, slug, title, contentHash, content },          // snapshot
                 answerKey  { key, keyVersion, cacheHit },                             // snapshot
                 ask        { opening, clarifications[] {question, answer} },
                 hintLadder[] { step, hint },
                 branches[] { condition, action, say, notes },
                 probes[], followUps[],
                 expectations { mustShow[], strongSignals[], weakSignals[] },
                 evaluationSignals[] { signal, observe } }
  policies     { version, requests[] {kind, decision, how}, offTopic, timeManagement, integrity, fallback }
  evaluation   { globalSignals[] {signal, observe} }      // factors to collect; no scoring formula
  briefing     { interviewerName, interviewerStyle, format, durationMins }   // the ONLY candidate-visible part
  provenance   { models[], promptVersions{}, policyVersion, keyVersion, selectionSeed, answerKeyHits, answerKeyMisses }
```

Blueprints are **immutable**; a re-prep writes a new version and marks the previous one `superseded`.

### 8.1 Condition vocabulary (fixed enums)

| Family | Conditions |
|---|---|
| All | `stuck`, `long_silence`, `asks_clarification`, `asks_hint`, `asks_for_answer`, `off_topic`, `seen_before`, `over_time`, `nervous` |
| DSA, LLD | `wrong_approach`, `partially_correct`, `correct_suboptimal`, `correct_optimal`, `bug_in_code` |
| System design | `skips_requirements`, `shallow_design`, `ignores_scale`, `strong_design` |
| Behavioural, HR | `vague_answer`, `no_result`, `only_we`, `inconsistent`, `strong_story` |

### 8.2 Action vocabulary

`give_hint`, `clarify`, `probe_deeper`, `ask_follow_up`, `reframe`, `redirect`, `encourage`,
`acknowledge_move_on`, `ask_complexity`, `ask_dry_run`, `switch_to_reserve`, `decline_politely`,
`wrap_up_slot`.

### 8.3 Invariants (validate stage)

- **Slot counts:** core and reserve counts match §7.5 (mixed technical rounds: 3 cores, technical reserves + 1).
- **Problems:** every slot's problem has usable content, and no slug repeats.
- **Coverage:** every slot's branches cover **every** condition of the "All" family plus its own family
  (a `culture-` slot is behavioural).
- **Answer keys:** every slot has one; every DSA key (not `culture-` slots) has `verifiedAgainstExamples=true`.
- **Hints:** each hint ladder has three or more steps.
- **Arc:** contains `greeting`, `core` and `wrap_up`; the timeboxes sum to `round.durationMins` (±1);
  the non-scored phases are `scored=false`.
- **Personalization:** for hiring-manager rounds, `resumeProbes` has one or more entries; every hook and
  probe has a `source` or `groundedIn`.
- **The briefing leaks nothing:** it contains no problem title, slug, topic id or difficulty word,
  checked by string match against the slots.
- **Policies:** the version is set.

## 9. Candidate UI

Surfaces:
- **The session page** `/interviews/[sessionId]` (`SessionDetail`, `SessionAction`).
- **Compact status in:** `SessionsList`, the dashboard `UpNextCard` and the loop `ScheduleTab`.

### 9.1 Preparing

- **The animation** (§9.4), above a stepper.
- **The stepper's friendly labels,** mapped from the run stages:

  | Run stage | Label |
  |---|---|
  | context | Reading the job description |
  | selection | Choosing your questions |
  | answer_keys | Preparing the interviewer's notes |
  | persona | Meeting your interviewer |
  | personalization | Tailoring the interview to you |
  | playbooks | Planning the conversation |
  | policies + validate | Final checks |

- **Step states:** done, active or pending, with the elapsed time.
- **Polling:** the page polls every 3 s while `PREP_QUEUED` or `prep.refreshing`.

### 9.2 Ready

- **The briefing card:**
  - the interviewer's name and style line;
  - format (e.g. "45-minute coding interview with a shared editor");
  - duration;
  - "Prepared {time}. If your profile or the job changes before your slot, we'll refresh it
    automatically."
- **Refreshing:** while refreshing, the card stays, with "Updating for your latest profile…".
- **Never shown:** topics, problem names or difficulty.
- **Joining:**
  - With `liveAvailable=false`: "Your interviewer is ready. Live sessions open soon.", and **Enter room**
    is disabled.
  - With `true`: the current enter-room behaviour.

### 9.3 Failed

- "We couldn't prepare this interview" with a **Retry** button, and the error code in a collapsible
  "details" section.
- On a `429`: "Too many retries. Try again in {minutes} min."

### 9.4 Prep animations (revised 2026-10-08: the SVG cat)

The mascot is the **InterviewIQ cat** from the user's "Cat Reader Loader" design: a round clay-orange
cat on a warm stage, drawn in SVG. The cat is never parked: in every chapter it **walks about**,
pulls faces and reacts, and stays cute throughout.

- **Rig** (`prep-animation/Cat.tsx`, `pose.ts`):
  - the whole cat walks (stepping feet, a bob), faces left or right, hops, squashes, and **falls over
    and gets up**;
  - a cross **bandage** appears after a fall or a bonk and stays for the rest of the chapter;
  - the arm is **natural**: capped at its reach from the shoulder, so the cat walks up to whatever it
    touches instead of stretching.
- **Faces:** open, wide-eyed, squint, blink, happy `^^`, closed, laughing `> <`, dizzy spirals with
  circling stars, and a wink. Mouths: the cat "w", an "o", a smile, a tongue blep, flat, wavy, a
  **toothy grin**, and an open-mouthed **laugh with fangs**. Also blush, a sweat drop, and ears that perk
  up or droop.
- **Five ~12 s chapters,** played in turn from a random start:
  1. **Reader:** walks in with a magnifier, reads the sliding page, spots something, highlights it,
     belly-laughs and winks.
  2. **Card sorter:** walks to the deck and flips cards: a shrug for one, a head shake for the next,
     both flicked over its shoulder. It slips on one and falls over, gets up with a bandage and a
     sheepish toothy grin, finds the one, sends it up to the "picked" spot and laughs.
  3. **Note-taker:** hugs a clipboard and writes while pacing, tongue out. It thinks with the pencil to
     its lips, has an idea, adds a line and a heart, and pins the note to a board.
  4. **Architect:** blocks drop onto a table. It nudges the table leg to settle a crooked one, a falling
     block bonks it (dizzy, then a bandage, then it laughs it off), the clock dings, a flag goes up,
     and it does a proud dance.
  5. **Warm-up:** wears a headset and walks to its tea for a sip, eyes closed. It sings and dances
     across the floor, its voice cracks and it giggles, then it waves "hi!" with a grin.
- **Colour:** the cat's illustration palette is the `--cat-*` tokens in `app/globals.css`, with a dark
  set (dark stage, light outlines; the fur stays the same). No raw colours in components.
- **Status line:** playful and generic per moment (e.g. "Reading your resume", "Oops"); never
  topics, problems or difficulty.
- **Behaviour:**
  - frames are written straight to the SVG (`stage.ts`) on requestAnimationFrame, which pauses with
    the tab, so React renders only when the chapter changes;
  - `prefers-reduced-motion` shows one still per mount;
  - the whole player is `aria-hidden`.
- **Location:** `app/(app)/interviews/[sessionId]/_components/prep-animation/`.

## 10. Diagnostics tab ("Interview prep", admin only)

- **Where:** `?tab=prep` in `app/(app)/intelligence/page.tsx`, added to `INTELLIGENCE_TABS`. Built new;
  not the deleted bench code.
- **API proxies:** under `/api/v1/intelligence/blueprints/*` (admin) to the AI service's
  `/admin/blueprints/*`. Snake-case passthrough, like research.

### Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/admin/blueprints/runs?status&company&roundType&trigger&candidateId&from&to&limit&cursor` | Run list |
| GET | `/admin/blueprints/runs/{id}` | Run detail with the full trace |
| POST | `/admin/blueprints/bench` | Start a bench run. Body: candidateId, jdId or practice loop/node, round, options. The API assembles the full `BlueprintRunRequest` with `trigger=bench`; with no round it uses the one a booking would start on (the brief's first interview round). |
| POST | `/admin/blueprints/runs/{id}/rerun` | Re-run, optionally bypassing the blueprint or answer-key cache |
| GET | `/admin/blueprints/sessions/{sessionId}/versions` | Version list |
| GET | `/admin/blueprints/sessions/{sessionId}/diff?from&to` | Structured diff |
| GET | `/admin/blueprints/answer-keys/{roundType}/{slug}` | Cached key(s) |

### UI

- **Run list (left):**
  - columns: company · role · level · round, candidate, status, trigger, duration, cache hits and
    misses;
  - filters;
  - running rows refresh live.
- **Bench ("New run"):**
  - pick: user search → company → JD → round, or a practice template;
  - checkboxes: bypass the blueprint cache, bypass the answer-key cache, ignore seen-before;
  - bench runs never attach to a session and never touch anyone's seen list.
- **Run detail:**
  - **Timeline:** the 8 stages, each with status, duration, provider, model and tokens.
  - **Stage drawer:**
    - **Context:** the resolved inputs and the fingerprint parts; on a refresh, the changed part is
      highlighted.
    - **Selection:** a per-slot table of every candidate with its score columns and outcome reason,
      plus the relaxations.
    - **Answer keys:** hit or miss for each problem, the key, the sandbox result and any swaps.
    - **LLM stages:** prompts, raw response, parsed output, validation errors and repairs, retries,
      latency.
    - **Policies:** the version.
    - **Validate:** each invariant, pass or fail, with the reason.
- **Blueprint viewer:**
  - a persona card and the arc timeline;
  - per slot: the opening, the hint ladder, the **branch table** (condition → action → say), probes,
    expectations, signals, and the answer key (collapsible);
  - personalization, policies, global signals, and the exact candidate briefing;
  - raw JSON and a Markdown export.
- **Diff:** between versions of a session.
- **Actions:** re-run, re-run bypassing keys, copy JSON, open the candidate's session.

## 11. Data lifecycle

**Collections (AI service):**
- `interview_blueprints`;
- `blueprint_runs`, with a TTL of 30 days except a run referenced by a current blueprint, kept via
  `keep=true`;
- `answer_keys` (shared, no user data).

**Seen-before list:** stored by the API (Mongo `blueprint_seen`, per candidate: slug, roundType,
sessionId, at).

**Account deletion:** the API calls the AI service purge, which deletes the user's blueprints and runs.
The API deletes `blueprint_seen`. `answer_keys` are untouched (not personal).

**Account export:** includes each session's `prep_briefing` and status only.

## 12. Failures (stable codes)

| Code | Meaning |
|---|---|
| `round_not_found` | No round in the brief or snapshot for this booking |
| `not_enough_problems` | A slot can't be filled after relaxation |
| `answer_key_failed` | No candidate in a slot produced a passing key |
| `playbook_failed` | A slot's playbook failed validation twice |
| `llm_unavailable` | Every provider failed after quota waits |
| `validation_failed` | Invariants failed |
| `timeout` | The run exceeded its limit |
| `cancelled` | Session cancelled or run superseded |
| `ai_service_unreachable` | API-side: the run couldn't be started or read |

## 13. Product-IP drafts (human review before production)

- The policies template (§6, stage 7).
- The prompts for persona, personalization, playbooks and the answer key.
- The topic dictionary (§7.2).
- The selection weights (§7.4).
- The friendly step labels and the briefing copy.

## 14. Tests

Tests are written with the code and run when the user asks.

- **AI service:**
  - selection: pool, exclusions, the difficulty window, the score breakdown, composition and diversity,
    the seeded draw, relaxation, `not_enough_problems`;
  - topic normalization;
  - answer keys: cache hit and miss, the DSA sandbox pass, the repair, the swap, no caching on failure;
  - playbook validation and condition coverage;
  - the arc timebox invariant and the briefing leak check;
  - the blueprint cache and `bypass` options;
  - the run store: one active run per session, cancel, timeout;
  - routes and admin routes; purge.
  - LLM calls are faked.
- **API:**
  - booking starts prep;
  - the reconcile job: start, collect, apply, stale and superseded runs, timeout, refresh fingerprint,
    the 30-minute cutoff;
  - the retry rate limit (`429`);
  - the session response shape (`prep`, `briefing`, `liveAvailable`);
  - the migration;
  - deletion and export;
  - the bench proxy.
- **Web:**
  - the stepper states, the briefing card, refreshing, failed + Retry + `429`, the disabled join;
  - the random animation set and the reduced-motion still;
  - the diagnostics tab: the run list, the selection table, the branch table, and the diff from
    fixtures.
