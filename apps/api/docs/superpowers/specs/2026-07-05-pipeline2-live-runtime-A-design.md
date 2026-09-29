# Pipeline 2 — Live Runtime & Transport (Sub-project A) Design

**Date:** 2026-07-05
**Status:** Design — awaiting review
**Depends on:** the built brain (B) + scoring/pacing (C) in `interviewiq-ai-service` (branch merged to `main`), the frontend live UI shell (merged to `main`), and Pipeline 1 prep (produces the `InterviewPlan`).
**Enables next:** Sub-project D (voice) plugs into A's worker; Sub-project E (post-interview analysis) reads A's persisted `SessionOutcome`.

---

## 1. Goal

Make the live mock interview run for real, end-to-end, with **nothing mocked**. A candidate joins a real LiveKit room, the existing LangGraph brain drives the interview through a real transport, the interview is scored/paced/steered live, and it ends with a persisted `SessionOutcome`. After A (+ D for voice), the **only** remaining work is E (post-interview analysis).

A is the transport + lifecycle plumbing. It is deliberately built and testable **before** D: during A the candidate's answer arrives as a real typed message over the real LiveKit data channel (real transport, real brain, real scoring — not a mock); D later swaps that input for real speech.

## 2. Locked decisions (from brainstorming)

- **Voice stack (D):** Deepgram STT + Deepgram Aura TTS, single vendor. The LangGraph brain (Gemini) stays the decision-maker; Deepgram is only ears + mouth. *(D is a separate spec; noted here only at the seam.)*
- **LiveKit hosting:** LiveKit Cloud (managed SFU + Agents + token helpers).
- **Sequencing:** A first (this spec), then D.
- **Live conversation model:** `INTERVIEW_LLM_MODEL=gemini-flash` (fast; already used for prep) instead of the slow `gemma-3-27b` default. Scorer may stay a separate/cheaper model.
- **Candidate media:** publishes **audio only** to the room. Camera stays a **local self-view** (never published — the brain grades transcript + timing, not video). No recording/egress in MVP.
- **Outcome persistence:** the worker calls a backend **internal** endpoint; the backend owns session state + persistence (not the worker writing session state to Mongo directly).

## 3. Architecture

```
Candidate browser (Next.js + livekit-client)
   │  mic audio ▲▼ interviewer audio        │ data channel: control / artifact / proctor
   ▼                                        ▼
        ┌──────────── LiveKit Cloud (SFU room "interview-{sessionId}") ────────────┐
        └──────────────────────────────────────────────────────────────────────────┘
   ▲ mints token / creates room /             ▲ joins as AI participant
   │ dispatches agent / owns live state       │ metadata {sessionId}
Backend (Spring)  ◀──── outcome callback ────  AI worker (Python, LiveKit Agents)
   │                    (X-Internal-Api-Key)      │ loads InterviewPlan (Mongo, existing repo)
   ▼                                              │ runs existing run_session (brain B+C, unchanged)
Postgres (session state + SessionOutcome jsonb)   │ A: typed answers → D: Deepgram STT ▶ brain ▶ Aura TTS
```

**Topology choice:** the brain runs inside a **LiveKit Agents worker process** in `interviewiq-ai-service` (the spec's original assumption). Rejected alternatives: brain inside FastAPI + hand-rolled WebRTC bridge (more moving parts), brain as its own RPC service (premature — splits the brain from its only caller).

## 4. End-to-end flow (happy path)

1. **Join** (frontend, exists) — user clicks Join on a `PREP_READY` session; router enters `/interviews/{id}/live`.
2. **Gate** (frontend + backend, new) — `GET /interviews/sessions/{id}/live` reconciles: `PREP_READY` → allow prejoin flow; `LIVE_IN_PROGRESS` → resume; terminal → route to report.
3. **Go-live** (backend, new) — after prejoin+checks+fullscreen, frontend `POST /interviews/sessions/{id}/live`: validate owner + `PREP_READY`; create room `interview-{sessionId}` with metadata `{sessionId}`; dispatch the agent worker; set `LIVE_IN_PROGRESS` + `live_started_at` + `livekit_room`; return `{ livekitUrl, token, roomName }`.
4. **Connect** (frontend, new) — `LiveKitLiveSession` connects to the room, publishes mic audio, subscribes the interviewer audio track, opens the data channel.
5. **Worker starts** (ai-service, new) — worker's entrypoint reads `{sessionId}` from job/room metadata → `get_plan(sessionId)` from Mongo → builds `LiveKitTransport(room)` → runs `run_session(plan, transport, ...)`.
6. **Live loop** (brain exists; transport new):
   - Candidate answer → **A:** data-channel `answer` message; **D:** Deepgram STT final transcript → `transport.next_utterance()` → brain.
   - Brain scores (competency⊕behavioral), paces (rails + judge), steers (scope guard), derives (pivots) — all unchanged.
   - Brain line → `transport.say()` → **A:** data-channel `interviewer_utterance` + `speaking`; **D:** Aura TTS audio track.
   - Monaco/Excalidraw edits → data-channel `artifact` → `transport.current_artifact()`.
   - Proctor events → data-channel `proctor` → worker **pauses the brain server-side** (won't advance until restored) + records a negative event + optional spoken acknowledgment.
7. **End** — brain `finalize()` → `SessionOutcome` → worker `POST /internal/sessions/{id}/outcome` → backend persists outcome + `ended_reason` + `live_score_final` + `duration_s` + `live_ended_at` + status `COMPLETED` (or `ABORTED_TECHNICAL`) → worker publishes `ended{reason}` + disconnects → frontend lands on report.
8. **After this = E only.** The report page shows the persisted `ended_reason` now; the authoritative scorecard is E.

## 5. Components

### 5.1 Backend (`interviewiq-backend`)

- **`SessionStatus`** += `LIVE_IN_PROGRESS`, `COMPLETED`, `ABORTED_TECHNICAL` (append at end; `@Enumerated(EnumType.STRING)` — verify/set string mapping so additions are order-independent). Documented transitions: `PREP_READY → LIVE_IN_PROGRESS → COMPLETED`; `LIVE_IN_PROGRESS → ABORTED_TECHNICAL`.
- **`InterviewSession`** new **nullable** columns (ddl-auto safe — see the NOT-NULL-column gotcha): `live_started_at`, `live_ended_at` (timestamps), `ended_reason` (varchar), `livekit_room` (varchar), `live_score_final` (double), `duration_s` (int), `outcome` (jsonb, default `null`). One row already 1:1 with a session, so the outcome lives on the session (no separate table — YAGNI; matches `CandidateProfile` jsonb pattern).
- **`LiveKitService`** (`integrations/livekit/`) — wraps the LiveKit Kotlin/Java server SDK (`io.livekit:livekit-server`): `mintCandidateToken(sessionId, identity)` (room-join grant, short TTL), `createRoom(sessionId)` (metadata `{sessionId}`), `dispatchAgent(sessionId, roomName)` (explicit agent dispatch with job metadata). If the SDK's token minting is awkward, tokens may be minted as LiveKit-spec JWTs with the existing Nimbus setup; room-create + dispatch use the server API. Config: `livekit.url/api-key/api-secret` (`LIVEKIT_URL/API_KEY/API_SECRET`).
- **Endpoints** (on `InterviewSessionController`, base `/api/v1/interviews`):
  - `POST /sessions/{id}/live` (candidate, JWT, owner-scoped) — go-live; precondition `PREP_READY` (or `LIVE_IN_PROGRESS` → return fresh token for resume, do not re-dispatch). Returns `LiveSessionResponse { livekitUrl, token, roomName }`.
  - `GET /sessions/{id}/live` (candidate, JWT) — gate/resume: returns `{ status, livekitUrl?, token?, roomName? }`; fresh token iff `LIVE_IN_PROGRESS`.
  - `POST /internal/sessions/{id}/outcome` (internal, `X-Internal-Api-Key` — reuse the existing internal filter/pattern from `InternalScrapeTargetController`) — body = `SessionOutcome`; persist jsonb + promoted scalars; set `COMPLETED` unless `ended_reason == ABORTED_TECHNICAL`.
- **Service:** `InterviewSessionService` (or a new `LiveSessionService`) — `startLive`, `getLive`, `recordOutcome` with the transitions + LiveKit calls. Booking/prep untouched.
- **Security:** `/api/v1/interviews/**` already authenticated; `/api/v1/internal/**` already permitted + guarded by the internal-key filter. Additive only.

### 5.2 ai-service (`interviewiq-ai-service`)

- **`app/interview_agent/worker.py`** — LiveKit Agents entrypoint (`python -m app.interview_agent.worker`, separate long-running process). On job: read `{sessionId}` from metadata → `repositories.get_plan(sessionId)` → build `LiveKitTransport(room)` → run the brain → POST outcome → disconnect. Handles no-plan / load errors → abort cleanly.
- **`LiveKitTransport`** (replace the stub in `app/interview_agent/transport.py`, keep `ScriptedTransport` for tests):
  - `next_utterance()` — await next candidate turn: **A** from a data-channel `answer` queue; **D** from the STT final-transcript queue. Return text + `UtteranceTiming` (`t_start`, `t_end`, `time_to_first_word_s`; A derives from message timestamps, D from STT/VAD word timings).
  - `say(text)` — **A:** publish `interviewer_utterance` + `speaking on/off`; **D:** Aura TTS → publish audio + `speaking`.
  - `current_artifact()` — return the latest artifact snapshot held from data-channel `artifact` messages (bound to the current question per spec §3.1 of the brain design).
  - `end_session()` — publish `ended{reason}` + disconnect.
  - Data-channel subscriber routes: `answer` → utterance queue (A), `artifact` → artifact state, `proctor` → pause/resume + negative event.
- **Sync/async bridge (the key integration risk):** `run_session` is synchronous (tested via `ScriptedTransport`). The worker event loop is async. Run `run_session` in a worker **thread**; the `LiveKitTransport` sync methods marshal room I/O onto the loop via `asyncio.run_coroutine_threadsafe`. The 271-test brain stays **byte-for-byte unchanged**. (Alternative if this proves fragile: an async driver variant — decided in the plan, not here.)
- **Brain pause/violation input** — the brain currently has no violation input. Add a minimal, additive signal the transport exposes (e.g., a `threading.Event` + a queued negative event) that the driver checks at turn boundaries so a proctor violation holds the interview and records the event. No change to scoring/pacing logic.
- **Outcome POST** — worker `httpx` POST to backend `POST /internal/sessions/{id}/outcome` with `X-Internal-Api-Key`. Transcript stored to a Mongo `interview_transcripts` doc keyed by sessionId; `SessionOutcome.transcript_ref` = that key.
- Config: `LIVEKIT_URL/API_KEY/API_SECRET`, existing `MONGODB_URL`, `INTERNAL_API_KEY`, backend base URL, `INTERVIEW_LLM_MODEL=gemini-flash`.

### 5.3 Frontend (`interviewIQ-frontend`)

- **`LiveKitLiveSession.ts`** (real, via `livekit-client`) implementing the existing `LiveSession` interface:
  - `connect(sessionId)` → `POST /interviews/sessions/{id}/live` → `{ livekitUrl, token }` → `Room.connect` → enable mic (publish audio) → subscribe interviewer `RemoteAudioTrack` → attach to a hidden `<audio>` → open data channel.
  - Incoming data → `onControl(ControlSignal)`; `room` connection state → `onConnectionChange(ConnState)`.
  - `sendArtifact` / `sendProctorEvent` → `publishData`.
  - `getLocalStream()` → a **local** `getUserMedia` stream for the self-view (camera not published); the speaking-glow uses the local audio as today.
- **Provider default** flips `new MockLiveSession()` → `new LiveKitLiveSession()`; `MockLiveSession` stays injectable for tests only.
- **Machine:** add `reconnecting` state + `ConnState → machine` mapping; subscribe `onConnectionChange` (closes the audit's "never subscribes onConnectionChange" gap).
- **Live-route gating & resume:** on `/live` entry, `GET /sessions/{id}/live` → `PREP_READY` (prejoin flow) / `LIVE_IN_PROGRESS` (reconnect to room with fresh token, machine → `connecting → live`) / terminal (route to report) / else block. Fixes the "always starts at prejoin, no resume" audit gap.
- **Report placeholder** reads the persisted `ended_reason` from `GET /sessions/{id}` (now populated). Full scorecard = E.
- **Dep:** `livekit-client` (raw, to keep the seam thin — no `@livekit/components-react`). No LiveKit key on the client (tokens come from the backend).

### 5.4 Data-channel contract (JSON, reuses existing FE types verbatim)

Agent → candidate (existing `ControlSignal` union): `interviewer_utterance{text}`, `speaking{who,speaking}`, `pause{reason}`, `resume`, `acknowledge_violation{text?}`, `ended{reason}`.
Candidate → agent: `artifact{kind,content,language?}` (existing `ArtifactSnapshot`), `proctor{event}` (existing `ProctorEvent`), `answer{text,tStart,tEnd}` (A-phase typed; ignored once D provides speech — optionally retained as an accessibility fallback).

## 6. Error handling & reconnect (MVP scope)

- **LiveKit auto-reconnect** → frontend `reconnecting` state (non-blocking "reconnecting…" affordance); resumes to the same room.
- **Refresh mid-interview** → `GET /live` → fresh token → rejoin the same room; the worker (same process) still holds live state, so the interview resumes naturally.
- **Candidate gone beyond a grace period** → worker aborts → outcome `ABORTED_TECHNICAL`.
- **Brain/LLM/transport error** → `run_session` already resolves to `ABORTED_TECHNICAL` and tears down the transport → worker posts the abort outcome → backend `ABORTED_TECHNICAL` → frontend `ended{ABORTED_TECHNICAL}` → report.
- **Go-live failure (LiveKit down)** → backend 502; frontend surfaces an error, session stays `PREP_READY` (retryable).
- **Known limitation (documented, deferred):** cross-worker-restart resume (periodic live-state persistence to a store) is out of MVP — worker-memory + grace-period abort is the MVP behavior. Add later if needed.

## 7. Testing strategy

- **Backend:** unit tests for `startLive`/`getLive`/`recordOutcome` — status transitions, owner + precondition guards, `LiveSessionResponse` shape, outcome jsonb round-trip + status flip, enum additions. `LiveKitService` **mocked** (no LiveKit Cloud calls in CI).
- **ai-service:** `LiveKitTransport` data-channel mapping + the sync/async bridge tested against a **fake room** (fake data channel + track sink); the brain stays covered by the existing `ScriptedTransport` suite (unchanged). Outcome POST tested with a stub `httpx`. Worker entrypoint (metadata → plan load → run → post) tested with fakes.
- **Frontend:** `LiveKitLiveSession` against a **mocked** `livekit-client` `Room` — connect flow, data→`onControl` mapping, connection→machine, `sendArtifact`/`sendProctorEvent` publish. New `reconnecting`-state machine tests. Existing UI tests keep using `MockLiveSession`.
- **D (later):** Deepgram STT/Aura TTS + Silero VAD wired into the worker's audio pipeline; unit-tested with Deepgram mocks.
- **Out of CI (manual):** one full real interview against LiveKit Cloud + (for D) Deepgram — documented smoke checklist.

## 8. Config / env additions (build complete; keys user-provisioned to run live)

- Backend: `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`.
- ai-service: `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `INTERVIEW_LLM_MODEL=gemini-flash`; (D) `DEEPGRAM_API_KEY`.
- Frontend: none new (token + url come from the backend).
- New runtime deps: `io.livekit:livekit-server` (backend), `livekit-agents` + Deepgram plugin (ai-service), `livekit-client` (frontend).

## 9. Out of scope (this spec)

- **D (voice)** — separate spec; A defines the transport seam it plugs into.
- **E (post-interview analysis / authoritative scorecard / round gating)** — reads A's persisted `SessionOutcome`.
- Cross-worker-restart live-state persistence; recording/egress; candidate video to the room; mobile layout; code execution / test running (brain reads artifacts, never runs them).

## 10. Definition of done (A)

A real user can: Join a `PREP_READY` session → connect to a real LiveKit room → conduct a full interview driven by the real brain over the real transport (typed answers in A; speech after D) with live scoring/pacing/steering and server-side proctoring enforcement → the interview ends → a `SessionOutcome` is persisted and the session is `COMPLETED`/`ABORTED_TECHNICAL` → the report shows the real `ended_reason`. No `MockLiveSession`, no `ScriptedTransport`, no `NotImplementedError` on any live path. All CI tests green.
