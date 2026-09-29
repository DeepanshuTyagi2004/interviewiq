# Interview Prep (Pipeline 1) — HLD & LLD

> **Status:** Code-complete across all 4 repos · backend compiles on JDK 25 · 24 Pipeline-1 backend tests green · not yet committed · LLM prompt bodies are `v0-scaffold` placeholders (real interviewer text is product IP) · no live end-to-end run yet.
>
> **Scope:** Pipeline 1 = **prep only**. A candidate books a session (JD + round + slot); a scheduled backend job asks the ai-service to build an `InterviewPlan` before the slot; the session flips to a readiness status. There is **no live voice loop and no post-interview scoring/debrief** — those are later pipelines. `SessionStatus` is intentionally extensible for them.

This document is a map of *what is actually implemented*. Every field name, endpoint, and transition below was read from source, not from memory.

---

## 0. How to read this

- **Part I — HLD**: the shape of the system — repos, boundaries, end-to-end data flow, the happy-path sequence, and the session lifecycle.
- **Part II — LLD**: the internals of each repo — entities, endpoints, the scheduler, the ai-service pipeline, the cache gate, the frontend feature module, the contract.
- **Part III**: what is done vs. what is deliberately stubbed, plus a per-repo file index.

Diagrams are Mermaid (render inline in VS Code preview and on GitHub).

**The four repos and two trust boundaries:**

| Repo | Role | Port | Auth in |
|---|---|---|---|
| `interviewIQ-frontend` | Next.js 16 UI (student app) | — | holds JWT access token |
| `interviewiq-backend` | Spring Boot 4 / Java 25 — domain, persistence, orchestration | 8080 | **JWT** (candidate) |
| `interviewiq-ai-service` | Python FastAPI — LLM plan generation | 8000 | **`X-Internal-Api-Key`** (internal) |
| `interviewiq-infra` | `contracts/openapi.yaml` — source-of-truth contract | — | — |

---

# Part I — High-Level Design

## 1. What Pipeline 1 does

```
Candidate books an interview   →   Backend stores a SCHEDULED session
        →   A poller, N minutes before the slot, asks the ai-service to build a plan
        →   ai-service assembles context (company brief + résumé profile + JD + question bank),
            calls the LLM 3× to produce persona + question ladders + candidate probes,
            and returns an InterviewPlan
        →   Session flips to PREP_READY (or PREP_FAILED)
        →   The UI polls and shows readiness — never the plan contents.
```

**In scope:** booking, validation, the scheduled trigger, plan generation, cache-based idempotency, prep-status UI, manual retry.
**Out of scope (later pipelines):** the live interview, transcription/voice, scoring, the post-interview report. The interviewer-facing plan is generated and stored but is **never shown to the candidate** — the API only surfaces `planReady`.

## 2. System context

```mermaid
flowchart LR
    subgraph Browser["interviewIQ-frontend (Next.js 16)"]
        UI["/interviews route<br/>BookingForm + SessionsList"]
    end

    subgraph Backend["interviewiq-backend :8080 (Spring Boot 4 / Java 25)"]
        API["InterviewSessionController<br/>/api/v1/interviews/sessions"]
        SVC["InterviewSessionService<br/>(validation + ownership)"]
        SCHED["InterviewPrepScheduler<br/>@Scheduled poller"]
        PREP["InterviewPrepService<br/>(assemble + state machine)"]
        AICLI["AiServiceClient"]
        PG[("PostgreSQL 16<br/>interview_sessions")]
    end

    subgraph AI["interviewiq-ai-service :8000 (FastAPI)"]
        ROUTE["POST /interview-plans"]
        PIPE["interview_prep pipeline<br/>context -> cache gate -> generate"]
        LLM["LLMClient + complete_structured"]
        MONGO[("MongoDB<br/>interview_plans / briefs / questions")]
    end

    Contract["interviewiq-infra<br/>contracts/openapi.yaml"]

    UI -- "JWT (Bearer)" --> API
    API --> SVC --> PG
    SCHED -- "polls due sessions" --> PG
    SCHED --> PREP --> AICLI
    AICLI -- "X-Internal-Api-Key" --> ROUTE
    ROUTE --> PIPE --> LLM
    PIPE --> MONGO
    PREP --> PG

    Contract -. "codegen: npm run generate:types" .-> UI
    Contract -. "hand-written DTOs mirror it" .-> API
    Contract -. "Pydantic models mirror it" .-> ROUTE
```

The contract is the single source of truth for both boundaries. The frontend **generates** its types from it (`openapi-typescript`); the backend and ai-service **hand-write** DTOs / Pydantic models that mirror it (no codegen on the server side — an intentional convention).

## 3. End-to-end data flow (narrative)

1. **Book.** The candidate picks a job description, a round type, a date, and an hour (local). The browser converts the slot to an absolute UTC ISO-8601 instant and sends its IANA timezone alongside. `POST /api/v1/interviews/sessions`.
2. **Validate + persist.** The backend validates the request imperatively (JD exists, JD maps to an *enabled* `CompanyRoleConfig`, slot is not in the past), copies `company/role/level/specialization` from the JD onto the session, and stores it as `SCHEDULED`. **No prep happens synchronously** — the response returns immediately.
3. **Trigger.** A Spring `@Scheduled` poller runs every 60s. It selects `SCHEDULED` sessions whose slot is within the lead-time window (`scheduledAt <= now + 15min`) and drives each through prep.
4. **Assemble.** For each due session the backend flips it to `PREP_QUEUED`, then assembles the ai-service request from the session context, the JD, and the candidate profile (via `CandidateProfileService`). A missing profile is tolerated — an empty profile is sent.
5. **Generate.** The ai-service builds a grounding context (company brief + difficulty calibration + seed questions from the bank), computes a fused **input hash**, and — if a stored plan already matches that hash — returns it with **zero LLM calls**. Otherwise it runs three concurrent, schema-validated LLM calls (persona+arc, question ladders, candidate probes), assembles the `InterviewPlan`, stores it in Mongo keyed by `sessionId`, and returns it.
6. **Settle.** The backend reads `provenance.planVersion` and `provenance.inputHash` off the returned plan, records them on the session, and flips it to `PREP_READY`. Any upstream/transport failure flips it to `PREP_FAILED` with a stable error code.
7. **Reflect.** The UI polls the session list every 5s while anything is `SCHEDULED`/`PREP_QUEUED`, and stops once everything is `PREP_READY`/`PREP_FAILED`. A failed session shows a **Retry** button that re-queues prep.

## 4. Happy-path sequence

```mermaid
sequenceDiagram
    autonumber
    actor C as Candidate
    participant FE as Frontend (/interviews)
    participant BE as Backend :8080
    participant PG as PostgreSQL
    participant SC as PrepScheduler
    participant AI as ai-service :8000
    participant MG as MongoDB

    C->>FE: pick JD + round + date + hour
    FE->>BE: POST /sessions (JWT)<br/>scheduledAt=UTC ISO, timezone=IANA
    BE->>BE: validate slot, JD, enabled role config
    BE->>PG: insert session (SCHEDULED)
    BE-->>FE: 201 InterviewSession
    FE->>BE: poll GET /sessions every 5s
    Note over SC: every 60s, lead-time = 15 min
    SC->>PG: find SCHEDULED where scheduledAt ≤ now+15m
    SC->>BE: generatePrep(sessionId)
    BE->>PG: status = PREP_QUEUED
    BE->>AI: POST /interview-plans (X-Internal-Api-Key)
    AI->>MG: get_plan(sessionId) + brief + questions
    alt input hash unchanged
        AI-->>BE: cached InterviewPlan (0 LLM calls)
    else new or changed inputs
        AI->>AI: 3 concurrent LLM calls -> validate/repair
        AI->>MG: upsert_plan(sessionId)
        AI-->>BE: fresh InterviewPlan
    end
    BE->>PG: record planVersion + inputHash, status = PREP_READY
    FE->>BE: next poll returns PREP_READY
    FE-->>C: "Ready" pill, polling stops
```

## 5. Session lifecycle (state machine)

```mermaid
stateDiagram-v2
    [*] --> SCHEDULED: POST /sessions (validations pass)
    SCHEDULED --> PREP_QUEUED: scheduler picks up due session<br/>(scheduledAt ≤ now + leadTime)
    PREP_QUEUED --> PREP_READY: ai-service returns a plan<br/>(planVersion + inputHash recorded)
    PREP_QUEUED --> PREP_FAILED: upstream non-2xx or transport error<br/>(prepError = stable code)
    PREP_FAILED --> PREP_QUEUED: POST /sessions/{id}/regenerate (retry)
    PREP_READY --> PREP_QUEUED: POST /sessions/{id}/regenerate<br/>(idempotent - cache returns same plan)

    note right of PREP_READY
        Only planReady/planVersion/inputHash
        are exposed. Plan CONTENTS never leave
        the backend in Pipeline 1.
    end note
```

`SessionStatus` has exactly four values today: `SCHEDULED`, `PREP_QUEUED`, `PREP_READY`, `PREP_FAILED`. Future live/debrief states (e.g. `LIVE_IN_PROGRESS`, `DEBRIEF_READY`) are anticipated but **not** in the enum yet.

---

# Part II — Low-Level Design

## 6. Backend (`interviewiq-backend`)

### 6.1 Persistence / entity relationships

```mermaid
erDiagram
    INTERVIEW_SESSION }o--|| JOB_DESCRIPTION : "books against"
    JOB_DESCRIPTION }o--|| COMPANY_ROLE_CONFIG : "validated by (company,role,level)"
    INTERVIEW_SESSION }o--|| COMPANY : "company slug -> display name"
    INTERVIEW_SESSION }o--|| CANDIDATE_PROFILE : "read at assemble time"

    INTERVIEW_SESSION {
        uuid id PK
        uuid candidate_id "idx_session_candidate"
        uuid job_description_id
        string company "JD slug, copied at booking"
        string role
        string level
        string specialization
        string round_type "RoundTypeConverter -> wire value"
        instant scheduled_at "idx_session_status_scheduled(status,scheduled_at)"
        string timezone "IANA"
        string status "EnumType.STRING, default SCHEDULED"
        string plan_version "set on PREP_READY"
        string input_hash "set on PREP_READY"
        string prep_error "stable code on PREP_FAILED"
        instant created_at
        instant updated_at
    }
    JOB_DESCRIPTION {
        uuid id PK
        string company
        string role
        string level
        string title
        string specialization
        text description
        text tech_stack
    }
    COMPANY_ROLE_CONFIG {
        string company "uq_company_role_level"
        string role
        string level
        boolean enabled "booking rejected if false"
    }
    CANDIDATE_PROFILE {
        uuid user_id "uq_candidate_profile_user"
        string full_name
        string headline
        string target_role
        jsonb education
        jsonb experience
        jsonb skills
        jsonb detected_links
    }
```

**Table `interview_sessions`** carries two indexes that matter:
- `idx_session_candidate (candidate_id)` — the dashboard list query.
- `idx_session_status_scheduled (status, scheduled_at)` — the poller's due-set query.

`round_type` is persisted by its **wire value** (`"system-design"`, not `SYSTEM_DESIGN`) via `RoundTypeConverter`. `status` is persisted as the enum name (`@Enumerated(EnumType.STRING)`).

### 6.2 REST API surface — `InterviewSessionController`

Base path `/api/v1/interviews` (Spring MVC API versioning: `@RequestMapping(version = "1")` + `spring.mvc.apiversion.use.path-segment=1`). All handlers read the candidate id from `jwt.getSubject()`; **ownership is enforced in the service** (a non-owner gets `404`, never `403`).

| Verb | Path | Body | Success | Notes |
|---|---|---|---|---|
| POST | `/sessions` | `CreateInterviewSessionRequest` | `201` `InterviewSession` | validates + persists as `SCHEDULED` |
| GET | `/sessions` | — | `200` `InterviewSessionListResponse` | newest slot first, candidate-scoped |
| GET | `/sessions/{sessionId}` | — | `200` `InterviewSession` | owner-only |
| POST | `/sessions/{sessionId}/regenerate` | — | `202` `InterviewSession` | owner-only; re-queues prep |

Errors are returned as a stable `{ code, message }` envelope (`ApiError`) via a controller-local `@ExceptionHandler`. `InterviewSessionException` carries both the HTTP status and the code.

`CreateInterviewSessionRequest` is `record(UUID jobDescriptionId, RoundType roundType, Instant scheduledAt, String timezone)` — **no** JSR-380 annotations; all validation is imperative (see 6.3). The response record `InterviewSessionResponse` exposes `planReady/planVersion/inputHash/prepError` but **never the plan body**.

### 6.3 Session-creation validation (`InterviewSessionService.createSession`)

Executed in order; each failure throws `InterviewSessionException.badRequest(code, message)` → HTTP 400:

```mermaid
flowchart TD
    A[POST /sessions] --> B{jobDescriptionId null?}
    B -- yes --> E1[session_jd_required]
    B -- no --> C{roundType null?}
    C -- yes --> E2[session_round_required]
    C -- no --> D{scheduledAt null?}
    D -- yes --> E3[session_slot_required]
    D -- no --> F{timezone blank?}
    F -- yes --> E4[session_timezone_required]
    F -- no --> G{scheduledAt in past?}
    G -- yes --> E5[session_slot_in_past]
    G -- no --> H{JD exists?}
    H -- no --> E6[session_jd_not_found]
    H -- yes --> I{"CompanyRoleConfig for (company,role,level)?"}
    I -- no --> E7[session_role_not_configured]
    I -- yes --> J{config.enabled?}
    J -- no --> E8[session_role_disabled]
    J -- yes --> K[insert session SCHEDULED -> 201]
```

The JD → `CompanyRoleConfig` check (`findByCompanyAndRoleAndLevel`) is what ties booking to the *configured, enabled* interview targets — you can only book rounds the platform is set up to prep for.

### 6.4 The trigger — `InterviewPrepScheduler`

```java
@Scheduled(
  fixedDelayString  = "${interviewprep.poll-interval-ms:60000}",
  initialDelayString = "${interviewprep.poll-initial-delay-ms:30000}")
```

Each tick:
1. `cutoff = now + leadTimeMinutes` (default **15 min**, `interviewprep.lead-time-minutes`).
2. `findByStatusAndScheduledAtLessThanEqual(SCHEDULED, cutoff)` — the due set.
3. For each, call `InterviewPrepService.generatePrep(id)`; a per-session `try/catch` isolates failures so one bad session doesn't stop the batch (`generatePrep` records `PREP_FAILED` itself).

Plain Spring `@Scheduled` (not jobrunr/Quartz) — mirrors the existing `ProfileRefreshScheduler` / `LeetCodeRefreshScheduler`. `@EnableScheduling` + `@EnableAsync` live on the application class.

### 6.5 Prep orchestration — `InterviewPrepService` + `AiServiceClient`

`generatePrep(sessionId)` runs the slow HTTP call **outside** any DB transaction; each state change is its own `save()`:

```mermaid
flowchart TD
    S[generatePrep sessionId] --> L{session exists?}
    L -- no --> X[log warn, no-op]
    L -- yes --> Q[status = PREP_QUEUED]
    Q --> A["assembleRequest():<br/>session ctx + JD + candidate profile"]
    A --> H["AiServiceClient.generateInterviewPlan()<br/>POST baseUrl/interview-plans<br/>header X-Internal-Api-Key"]
    H -- 2xx JsonNode --> OK["applySuccess:<br/>planVersion + inputHash from provenance,<br/>status = PREP_READY"]
    H -- RestClientResponseException --> F1["applyFailure:<br/>prep_generation_upstream_STATUS"]
    H -- other RuntimeException --> F2["applyFailure:<br/>prep_generation_failed"]
```

`assembleRequest` builds `GenerateInterviewPlanRequest { session, jobDescription, candidateProfile }`. The profile comes from `CandidateProfileService.getProfile(candidateId)`; when absent it sends an **empty** `PlanCandidateProfile` (profile is additive, never required). `applySuccess` reads only `provenance.planVersion` and `provenance.inputHash` off the returned plan — the plan body is not persisted backend-side.

`regenerate(candidateId, sessionId)` verifies ownership, sets `PREP_QUEUED`, clears `prepError`, then fires `generateAsync` (`@Async`, fire-and-forget) and returns `202` immediately.

`AiServiceClient` uses a shared `RestClient` bean. **Note:** no explicit connect/read timeouts are configured (JDK `HttpClient` defaults), so a slow-ai-service timeout surfaces as the generic `prep_generation_failed` code rather than an `upstream_<status>` code.

### 6.6 Stable error codes (backend)

| Code | Meaning | HTTP |
|---|---|---|
| `session_jd_required` / `session_round_required` / `session_slot_required` / `session_timezone_required` | missing field | 400 |
| `session_slot_in_past` | slot already passed | 400 |
| `session_jd_not_found` | JD id unknown | 400 |
| `session_role_not_configured` | JD has no `CompanyRoleConfig` | 400 |
| `session_role_disabled` | config exists but disabled | 400 |
| `session_not_found` | unknown **or** not owned | 404 |
| `prep_generation_upstream_<status>` | ai-service returned non-2xx (stored in `prepError`) | — |
| `prep_generation_failed` | transport/other failure (stored in `prepError`) | — |

---

## 7. AI-service (`interviewiq-ai-service`)

### 7.1 Pipeline internals — `POST /interview-plans`

Route: `app/api/routes.py`, `dependencies=[Depends(require_internal_key)]` (constant-time compare of `X-Internal-Api-Key`). `PrepDataError → 422`, `LLMError → 502`.

```mermaid
flowchart TD
    R["POST /interview-plans<br/>GenerateInterviewPlanRequest"] --> C1["Stage 1: build_context (NO LLM)"]
    C1 --> C2["load brief (company,role,level,spec)<br/>derive difficulty calibration"]
    C2 --> C3["gather seed questions from bank<br/>first non-empty filter wins"]
    C3 --> C4["compute profile_hash + input_hash"]
    C4 --> G0{"has_brief_content OR questions?"}
    G0 -- no --> PDE["raise PrepDataError -> 422"]
    G0 -- yes --> CG{"stored plan.provenance.inputHash<br/>== computed input_hash?"}
    CG -- yes --> HIT["return cached plan<br/>(0 LLM calls)"]
    CG -- no --> GEN["Stage 2: generate_plan_parts<br/>3 concurrent LLM calls"]
    GEN --> P1["persona + round_arc"]
    GEN --> P2["question ladders (+ rubric)"]
    GEN --> P3["candidate probes"]
    P1 & P2 & P3 --> AS{"all 3 non-null?"}
    AS -- no --> LE["raise LLMError -> 502"]
    AS -- yes --> ASM["assemble InterviewPlan + PlanProvenance"]
    ASM --> UP["upsert_plan(sessionId) in Mongo"]
    UP --> OUT["return camelCase plan doc"]
```

Each of the three LLM calls goes through `complete_structured(...)` and its own optional Langfuse span. They run concurrently under a semaphore (`gather_capped`, `prep_concurrency`). If **any** returns null, the whole plan fails (`LLMError`) — a plan needs all three parts.

### 7.2 Stage 1 context + the input hash (cache key)

`build_context` produces the grounding blob and, critically, the **fused input hash** that gates everything. The hash is `"sha256:" + sha256(json.dumps(payload, sort_keys=True))` over exactly this tuple:

```mermaid
flowchart LR
    subgraph inputs["input_hash =  sha256 of"]
        A["brief_generated_at"]
        B["profile_hash<br/>(sha256 of full profile)"]
        C["jd_id"]
        D["round_type"]
        E["question_slugs<br/>(sorted)"]
    end
    inputs --> H["input_hash<br/>stored on plan.provenance.inputHash<br/>mirrored to session.inputHash"]
```

Because the hash folds the brief timestamp, the profile content, the JD, the round, and the exact seed questions, **any** change to the candidate's inputs busts the cache; nothing else does. This is what makes `regenerate` cheap and idempotent.

Seed-question selection tries filters in order and takes the **first non-empty** result: `(company, difficulty)` → `(company, any)` → `(any, difficulty)` → `(any, any)`. Only thin metadata (`slug, title, url, difficulty, topic_tags`) is passed to the LLM — never full problem text.

### 7.3 Stage 2 — structured LLM generation (`app/llm/structured.py`)

`complete_structured(llm, system, user, response_model, *, max_repairs, label)` is a hand-rolled validate-and-repair loop over `LLMClient.complete_json` — **no `instructor` dependency**:

- Attempt → `model_validate`. On `ValidationError`, append a compact repair note (up to 8 error lines + the offending JSON echoed back, truncated to 2000 chars) to the prompt and re-ask.
- `max_repairs` (default 2, `PREP_MAX_REPAIRS`) means **3 total attempts**. Exhausted → raise `LLMError`. A raw `ValidationError` never escapes.
- Client key rotation, cooldowns, and JSON salvage are inherited from the existing `LLMClient`.

Observability (`app/obs/`) is an **optional** Langfuse span — a true no-op unless `LANGFUSE_ENABLED` and both keys are set; `langfuse` is not even in `requirements.txt` and is imported lazily.

### 7.4 `InterviewPlan` schema (the plan doc)

Stored in Mongo `interview_plans` (one doc per `sessionId`, unique index) as the **camelCase wire shape**. Pydantic models are camelCase-on-the-wire, snake-in-Python (`alias_generator=to_camel`).

```mermaid
classDiagram
    class InterviewPlan {
        sessionId, candidateId
        company, role, level, specialization
        roundType : RoundType
        provenance : PlanProvenance
        persona : InterviewerPersona
        roundArc : RoundBeat[]
        questionLadders : QuestionLadder[]
        candidateProbes : CandidateProbe[]
        redFlagWatchlist : string[]
    }
    class PlanProvenance {
        planVersion, inputHash, model, generatedAt
        personaPromptVersion, ladderPromptVersion, probesPromptVersion
        briefGeneratedAt, profileHash
    }
    class InterviewerPersona {
        name, seniority, disposition
        styleNotes, opening, closing
        groundedIn : string[]
    }
    class RoundBeat {
        phase : intro|warm-up|core|curveball|candidate-qs|wrap
        title, description
        timeboxMins : int
    }
    class QuestionLadder {
        questionSlug, basePrompt
        difficulty : easy|medium|hard
        followUps : string[]
        hints : string[]
        rubric : RubricCriterion[]
        timeboxMins : int
    }
    class RubricCriterion {
        criterion, weight
        strongDescriptor, weakDescriptor
    }
    class CandidateProbe {
        prompt, whatItTests, groundedIn
    }
    InterviewPlan --> PlanProvenance
    InterviewPlan --> InterviewerPersona
    InterviewPlan --> RoundBeat
    InterviewPlan --> QuestionLadder
    InterviewPlan --> CandidateProbe
    QuestionLadder --> RubricCriterion
```

The **rubric** (`RubricCriterion`) is interviewer-only and lives **only** on `InterviewPlan` — it is never grafted onto any `ProfileSummary`/descriptive contract. This is a hard product rule (Profile Builder is purely descriptive; evaluation lives here).

Prompts (`app/interview_prep/prompts/{persona,ladder,probes}.py`) are functional but currently `*_PROMPT_VERSION = "v0-scaffold"` placeholders — the real interviewer-voice text is product IP to be human-drafted. Each version is recorded on `provenance`, so bumping a prompt version busts nothing automatically but is traceable per plan.

### 7.5 Idempotency & failure mapping (summary)

| Situation | Result |
|---|---|
| Same inputs as stored plan | cached plan returned, **0 LLM calls** |
| No brief content **and** no questions | `PrepDataError` → 422 |
| LLM never produces all 3 valid parts | `LLMError` → 502 |
| Success | plan upserted, returned; backend records `planVersion` + `inputHash` |

---

## 8. Frontend (`interviewIQ-frontend`)

### 8.1 Feature module map

```mermaid
flowchart TD
    subgraph route["app/(app)/interviews/"]
        PAGE["page.tsx<br/>Server Component shell"]
        BF["_components/BookingForm.tsx<br/>(client)"]
        SL["_components/SessionsList.tsx<br/>(client)"]
        SP["_components/StatusPill.tsx"]
    end
    subgraph feature["features/interview/"]
        TYPES["types.ts<br/>re-export generated types"]
        API["api.ts<br/>4 fetch wrappers"]
        HOOKS["hooks.ts<br/>useMySessions / useCreateSession / useRegenerateSession"]
    end
    subgraph consts["lib/constants/interview/"]
        EP["INTERVIEW_ENDPOINTS"]
        QK["INTERVIEW_QUERY_KEYS"]
        POLL["INTERVIEW_POLLING (5000ms)"]
        RO["ROUND_OPTIONS : {value: RoundType}[]"]
        META["SESSION_STATUS_META"]
    end
    GEN["lib/api-client/generated/schema.d.ts<br/>(from infra contract)"]

    PAGE --> BF & SL
    SL --> SP
    BF --> HOOKS
    SL --> HOOKS
    HOOKS --> API --> EP
    HOOKS --> QK & POLL
    TYPES --> GEN
    RO --> GEN
```

Types are **imported from the generated schema**, never hand-written (`npm run generate:types` → `tsx scripts/generate-types.ts` reads `../interviewiq-infra/contracts/openapi.yaml`). `ROUND_OPTIONS[].value` is typed to the generated `RoundType` union, so contract drift is a compile error.

### 8.2 Adaptive polling (`useMySessions`)

TanStack Query v5 `useQuery` with a functional `refetchInterval`:

```
refetchInterval = (query) =>
    query.data?.sessions?.some(s => s.status === "SCHEDULED" || s.status === "PREP_QUEUED")
        ? 5000        // still preparing → poll
        : false       // all PREP_READY / PREP_FAILED → stop
```

Booking (`useCreateSession`) and retry (`useRegenerateSession`) both `invalidateQueries(["interviews","sessions"])` on success — a successful retry flips a session back toward `PREP_QUEUED`, which **restarts** polling automatically.

### 8.3 Components

- **`BookingForm`** (client): role `<select>` from `useJds()`, round `<select>` from `ROUND_OPTIONS`, a shadcn `Popover` + `Calendar` (react-day-picker, past dates disabled), and a fixed 09:00–18:00 hour grid with **past slots disabled**. On submit it builds `slot.toISOString()` (absolute UTC) and sends `Intl.DateTimeFormat().resolvedOptions().timeZone` as the IANA `timezone`. Validation: `canSubmit` requires JD + round + date + a non-past hour.
- **`SessionsList`** (client): renders the polling query — skeletons while loading, an alert on error, an empty state, else one `SessionCard` per session. `SessionCard` shows company/round/slot + a `StatusPill`; on `PREP_FAILED` it shows a **Retry** button wired to `useRegenerateSession`.
- **`StatusPill`**: maps `SESSION_STATUS_META[status].tone` to a badge variant + lucide icon; the icon spins (`animate-spin`) only for the `pending` tone (`PREP_QUEUED`).

All timestamps are stored as UTC instants and rendered in the viewer's local zone via `toLocaleString`.

---

## 9. The contract (`interviewiq-infra/contracts/openapi.yaml`)

OpenAPI `3.0.3`, `InterviewIQ Contract` v`0.2.0` (Pipeline 1 is the 0.2.0 surface). Two security schemes: `bearerAuth` (JWT, candidate paths) and `internalApiKey` (`X-Internal-Api-Key`, the `/interview-plans` path, server overridden to `:8000`).

Key facts the code must keep matching:
- Enums are verbatim: `RoundType = [online-assessment, dsa, system-design, lld, behavioural, hiring-manager]`; `SessionStatus = [SCHEDULED, PREP_QUEUED, PREP_READY, PREP_FAILED]`; `Difficulty = [easy, medium, hard]`.
- There is **no** separate `InterviewSessionResponse` schema — single-session ops reference `InterviewSession` directly; the list is `{ sessions: InterviewSession[] }`.
- `InterviewSession` optional fields are exactly `companyName, planVersion, inputHash, prepError`.
- `InterviewPlan` requires **all** its fields; `QuestionLadder.rubric` is the only place rubric appears.

The three consumers stay in sync by convention: frontend regenerates types; backend and ai-service keep hand-written DTOs/models mirroring it. **Any schema change means touching all three** — there is no runtime enforcement.

## 10. Cross-cutting concerns

| Concern | Implementation |
|---|---|
| **Auth boundaries** | Candidate → backend: JWT Bearer, subject = candidate id. Backend → ai-service: `X-Internal-Api-Key`, constant-time compare. Ownership: 404 on non-owner (no existence leak). |
| **Idempotency** | Fused `input_hash` (brief ts + profile hash + JD id + round + sorted question slugs). Cache hit = 0 LLM calls. `regenerate` is safe to spam. |
| **Config knobs** | `interviewprep.lead-time-minutes` (15), `interviewprep.poll-interval-ms` (60000), `interviewprep.poll-initial-delay-ms` (30000), `aiservice.base-url`, `internal.api-key`; ai-service `PREP_PLAN_VERSION` (v1), `PREP_MAX_REPAIRS` (2), `PREP_CONCURRENCY`, `LLM_MODEL_NAME`, `LANGFUSE_*`. |
| **Resilience** | Scheduler isolates per-session failures; ai-service failures map to `PREP_FAILED` with stable codes; frontend surfaces failure + Retry. |
| **Descriptive-vs-evaluative rule** | Evaluation (rubric) exists **only** inside `InterviewPlan`. The candidate never sees the plan. Profile stays purely descriptive. |

---

# Part III — Status & gaps

## 11. Done & verified (2026-07-02)

- All 4 repos wired end-to-end (contract → backend → ai-service → frontend).
- Backend compiles clean on JDK 25 (`openjdk@25`).
- 24 Pipeline-1 backend tests green: `InterviewSessionControllerTest` (7), `InterviewSessionServiceTest` (9), `InterviewPrepServiceTest` (5), `InterviewPrepSchedulerTest` (3).
- Frontend: zero TypeScript/lint errors in the interview feature; types generated from the contract.

## 12. Not done / caveats

- **Uncommitted.** All backend Pipeline-1 files are still untracked in git.
- **Prompts are `v0-scaffold` placeholders.** The pipeline runs and validates, but generated plans are stub-grade until the real interviewer prompts are drafted (product IP — human-authored, then bump `*_PROMPT_VERSION`).
- **No live end-to-end run.** The path is unit-tested per repo but has not been exercised against a real Mongo + real LLM + the running backend together.
- **No explicit ai-service client timeouts** — slow-service failures land as the generic `prep_generation_failed` code.
- **Scope reminder:** live interview, transcription, scoring, and the post-interview report are later pipelines. The interviewer plan is generated but never shown to the candidate.

## 13. File index

**backend** (`src/main/java/com/interviewiq/interviewiq_backend/`)
- `models/`: `InterviewSession`, `RoundType`, `RoundTypeConverter`, `SessionStatus`, (reads `JobDescription`, `CompanyRoleConfig`, `CandidateProfile`, `Company`)
- `dtos/`: `CreateInterviewSessionRequest`, `InterviewSessionResponse`, `InterviewSessionListResponse`
- `controllers/InterviewSessionController` · `services/InterviewSessionService`, `InterviewPrepService`, `InterviewSessionException`
- `jobs/InterviewPrepScheduler` · `integrations/aiservice/{AiServiceClient, GenerateInterviewPlanRequest}`
- `repositories/InterviewSessionRepository` · `resources/application.properties`
- tests: `controllers/InterviewSessionControllerTest`, `services/{InterviewSessionServiceTest, InterviewPrepServiceTest}`, `jobs/InterviewPrepSchedulerTest`

**ai-service** (`app/`)
- `interview_prep/{schema, context, generate, pipeline}.py` + `prompts/{persona, ladder, probes}.py`
- `llm/structured.py` · `obs/{__init__, tracing}.py` · `api/{routes, deps}.py` · `db/{mongo, repositories}.py`

**frontend** (`interviewIQ-frontend/`)
- `features/interview/{types, api, hooks, index}.ts` · `lib/constants/interview/index.ts`
- `app/(app)/interviews/{page.tsx, _components/{BookingForm, SessionsList, StatusPill}.tsx}`
- `lib/api-client/generated/schema.d.ts` · `scripts/generate-types.ts`

**infra**
- `contracts/openapi.yaml` (v0.2.0)
