# Admin Pipeline Observability — Substrate + Résumé-Parse Console (Spec #1)

**Date:** 2026-07-02
**Status:** Design — awaiting review
**Scope of this spec:** the shared observability **substrate** + the first pipeline mounted on it (**résumé parse**). A follow-up spec (#2) mounts the **interview-prep (Pipeline 1)** console on the same substrate.

---

## 1. Goal

Give an admin a live, full-transparency view of a pipeline **run**: its ordered **steps** (status + timing + per-step detail), a **log stream**, and the **final artifact** — mirroring the existing "interview briefs gathering" console (`LiveIngestionPanel`), which works by short-interval **HTTP polling** of a run-state snapshot endpoint.

This spec delivers an **admin test-bench** for the résumé-parse pipeline: the admin uploads a PDF, a run starts, and they watch each stage happen — `received → extract_text → llm_request → llm_response → validate → done` — including the exact LLM prompt, the raw LLM response, validation outcome, and the final structured JSON.

The run store is designed **keyed/multi-run** from day one so a later spec can (a) mount the interview-prep pipeline on it and (b) observe real user runs ("monitor later"). This spec does **not** build real-user monitoring and does **not** touch the synchronous onboarding parse path.

## 2. Non-goals (this spec)

- Real-user live monitoring of onboarding parses (later). The existing synchronous `POST /resumes/parse` used by the onboarding wizard is **left untouched**.
- Interview-prep console (spec #2).
- Migrating the existing briefs console onto the substrate (it keeps working as-is).
- Persisting run history to disk/DB. Runs are in-memory and ephemeral.

## 3. Existing pattern being mirrored

The briefs console (reference implementation):
- **AI-service**: singleton `RUN_STORE` (`app/jobs/run_store.py`), single run slot, `snapshot(after)` returning `{run_id, status, stage, stages, combos, logs, last_seq}`; a `RunLogHandler` on the root logger captures `logger.*` into a ring buffer **while a run is active**.
- **Backend**: `IntelligenceController` (`/api/v1/intelligence/**`, `hasRole("ADMIN")`) is a thin BFF proxy over `AiServiceClient` (adds `X-Internal-Api-Key`).
- **Frontend**: `app/(app)/intelligence/page.tsx` wrapped in `<RequireAdmin>`, `LiveIngestionPanel` + `LogStream`, polling via TanStack Query `refetchInterval` (1500 ms).

Two deltas we deliberately change for the substrate:
1. **Keyed multi-run** instead of a single slot (résumé parses are per-user and concurrent).
2. **Explicit per-step log recording** instead of the global root-logger `RunLogHandler` — that handler only supports one active run and does not survive the async/executor boundary reliably. Explicit recording is concurrency-safe and gives structured, per-step logs. (A run-scoped root handler may be added later as an enhancement; not required here.)

---

## 4. Architecture

Three layers, all pipeline-agnostic except the thin instrumentation per pipeline.

### 4.1 AI-service — generalized run store + tracked core

**`app/jobs/pipeline_runs.py`** (new) — a keyed, in-memory run store:

- `RUNS = PipelineRunStore()` module singleton.
- Backing: `OrderedDict[run_id, RunRecord]`, `threading.Lock`, LRU cap `MAX_RUNS = 25` (evict oldest completed). Ephemeral; lost on restart; explicitly not a history store.
- Data model:

```
RunRecord:
  run_id: str                # uuid4 hex
  pipeline: str              # "resume_parse" (future: "interview_prep")
  source: str                # "bench" (future: "onboarding" | "scheduler")
  label: str                 # e.g. "Deepanshu Tyagi.pdf"
  status: "running" | "completed" | "failed"
  current_step: str | None
  steps: list[Step]
  logs: deque[LogEntry]      # maxlen 2000, monotonic seq
  result: dict | None        # final artifact (ParsedResume dump)
  error: {step, type, message} | None
  started_at: iso, finished_at: iso | None
  last_seq: int

Step:
  name: str
  status: "pending" | "running" | "ok" | "failed" | "skipped"
  started_at, finished_at, duration_ms
  detail: dict               # per-step; see §5

LogEntry: { seq, ts, level, message }
```

- API used by tracked cores:
  `start_run(pipeline, source, label) -> run_id`,
  `begin_step(run_id, name)`, `end_step(run_id, name, status, detail)`,
  `log(run_id, level, message)`, `set_result(run_id, result)`,
  `finish(run_id, status, error=None)`.
- Read API: `snapshot(run_id, after=0) -> dict` (logs filtered to `seq > after`, includes `last_seq`); `list_runs(pipeline=None) -> [summary]` (run_id, pipeline, label, status, started_at, step count).

**`app/resume/tracked_parse.py`** (new) — the résumé tracked core. Reuses `extract_text`, `build_llm_client`, `RESUME_SYSTEM`/`build_parse_resume_prompt`, `ParsedResume`. Records each step (§5). Written as a reusable `async def run_resume_parse(pdf_bytes, filename, run_id)` so a later change can call it from the onboarding path too.

> The existing synchronous `POST /resumes/parse` is **not** modified. The tracked core duplicates the same sequence with instrumentation; if we later want real-user monitoring, the sync route can be refactored to call the tracked core.

**Endpoints** — `app/api/admin.py` (router prefix `/admin`, `Depends(require_internal_key)`), mirroring the scrape endpoints:
- `POST /admin/resume/parse/run` — body: raw PDF bytes (`Content-Type: application/pdf`, 6 MB cap, same contract as `/resumes/parse`). Calls `start_run(...)`, launches `asyncio.create_task(run_resume_parse(...))`, **returns immediately** `{run_id}`.
- `GET /admin/resume/parse/runs/{run_id}?after=<seq>` → `RUNS.snapshot(run_id, after)` (404 if unknown run_id).
- `GET /admin/resume/parse/runs` → `RUNS.list_runs("resume_parse")`.

### 4.2 Backend — BFF proxy

- **`AiServiceClient`** (new methods, using the **HTTP/1.1 RestClient** fixed earlier):
  `startResumeParseRun(byte[] pdfBytes) -> JsonNode` (POST bytes, `application/pdf`),
  `getResumeParseRun(String runId, long after) -> JsonNode`,
  `listResumeParseRuns() -> JsonNode`.
- **`AdminResumeParseController`** (new) — `@RequestMapping("/api/{version}/intelligence/resume", version="1")`:
  - `POST /parse/run` — `@RequestParam("file") MultipartFile` (admin uploads a PDF); validate + `getBytes()` exactly like `CandidateProfileController` (non-empty, ≤6 MB, looks-PDF), forward bytes → `{runId}`.
  - `GET /parse/runs/{runId}?after=<seq>` → proxy snapshot.
  - `GET /parse/runs` → proxy list.
  - `@ExceptionHandler(RestClientException)` → `502 ai_service_unreachable` (matches `IntelligenceController`).
- **Security**: already covered — `SecurityConfig` maps `/api/v1/intelligence/**` to `hasRole("ADMIN")`. No change needed.

### 4.3 Frontend — shared substrate + résumé page

- **`features/observability/`** (new, shared): `types.ts` (`RunSnapshot`, `Step`, `LogEntry`, `RunSummary`), `useRunPolling(pipeline, runId)` — TanStack Query with `refetchInterval` and **incremental `after=last_seq`** (accumulates logs client-side; the intelligence client omits this). Components: `RunTimeline` (ordered steps with status badge + duration), reused/adapted `LogStream`, `StepDetailPanels` (expandable: extracted text / exact prompt / raw response / final JSON).
- **`features/resume-bench/`** (new): `api.ts` (`startResumeRun(file)`, `getResumeRun(runId, after)`, `listResumeRuns()` → `/api/v1/intelligence/resume/*` via `apiFetch`), `hooks.ts` (mutation + polling), and the page wiring.
- **Route**: `app/(app)/intelligence/resume/page.tsx`, wrapped in `<RequireAdmin>`, with a link/entry from the Intelligence area (sidebar or an in-page link). Recommended over a tab so the two consoles stay independent.
- **UI flow**: drag-drop PDF uploader → `startResumeRun` returns `run_id` → `useRunPolling` (≈1000 ms) drives `RunTimeline` + `LogStream` + `StepDetailPanels` until `status` is `completed`/`failed`.

---

## 5. Full-transparency detail per step (résumé pipeline)

| Step | detail captured |
|------|-----------------|
| `received` | filename, size_bytes, content_type |
| `extract_text` | page_count (if available), char_count, text_preview (first ~1500 chars). On `ResumeExtractError`: step `failed`, run `failed`, error carries the reason ("empty file" / "no extractable text" / "not a readable PDF") |
| `llm_request` | model, system_prompt (full), user_prompt (full, incl. résumé text) |
| `llm_response` | model, latency_ms, raw_response (verbatim), token usage if returned, any key-rotation/cooldown notes |
| `validate` | validation_ok, repaired (bool), validation_errors (first few) |
| `done` | result = `ParsedResume` dump (final structured JSON) |

To capture the **raw** LLM response (not just the parsed dict), the tracked core calls the client so the raw text is available (e.g. `complete()` + explicit JSON parse, or a `complete_json` variant that also returns raw). Implementation detail deferred to the plan; requirement is: raw response is recorded.

## 6. Lifecycle, concurrency, error handling

- Runs execute in an `asyncio` background task; multiple runs coexist (keyed store). LRU cap 25; evict oldest completed/failed.
- A step exception → step `failed`, run `failed`, `error={step,type,message}`, remaining steps `skipped`. The run always reaches a terminal state.
- ai-service unreachable → backend returns `502 ai_service_unreachable`.
- Upload validation failures (missing/empty file, >6 MB, non-PDF) → `400` at the backend, same shape as `CandidateProfileController`.
- Polling stops client-side once `status ∈ {completed, failed}`.

## 7. Security & privacy

- All browser-facing endpoints are `hasRole("ADMIN")`; the ai-service endpoints require the internal API key (never reaches the browser).
- The run store holds résumé text + the prompt (PII) **in memory only**, ephemeral, LRU-capped, admin-visible. Nothing persisted to disk/DB. Acceptable for an admin bench. **Flag for spec #2 / real-user monitoring**: revisit PII exposure and retention before observing real users.

## 8. Testing

- **AI-service**: unit-test `PipelineRunStore` (start/begin/end step, log seq + `after` filtering, LRU eviction, snapshot shape); tracked-core test with a stubbed fast LLM → run reaches `completed` with the 6 expected steps and a result; failure path (monkeypatch `extract_text` to raise `ResumeExtractError`) → run `failed` at `extract_text`, later steps `skipped`.
- **Backend**: `AdminResumeParseController` test (mirror `CandidateProfileControllerTest`) — admin gate (403 for non-admin), multipart validation, bytes forwarded to a mocked `AiServiceClient`, snapshot/list proxied, `502` on `RestClientException`.
- **Frontend**: type-check; light smoke of `useRunPolling` accumulation + `RunTimeline` render (optional).

## 9. Open items (confirm at review)

1. Frontend placement — dedicated sub-route `/intelligence/resume` (recommended) vs a tab in the intelligence page.
2. Polling cadence — 1000 ms for the bench (parse ≈ 5–10 s) vs matching the briefs console's 1500 ms.
3. Whether to surface token usage when the Gemini OpenAI-compat response includes it (nice-to-have in `llm_response`).

## 10. Follow-up (spec #2, separate)

Interview-prep (Pipeline 1) on-demand bench mounted on this substrate: admin selects company/role/level/JD/candidate → triggers plan generation now → watches context-assembly → cache-gate → LLM stage(s) → validate-and-repair → final InterviewPlan. Stages to be pinned from the current-code map in progress.
