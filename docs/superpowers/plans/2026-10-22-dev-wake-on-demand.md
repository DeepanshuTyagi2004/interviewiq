# Dev deploy: wake on demand (Render free + Vercel)

Decided 2026-10-22 for the **dev** deployment only. Render free web services sleep after ~15 min without inbound HTTP and wake
on the next request (~30-60 s). The voice worker has no inbound HTTP, so it runs inside the ai-service container, and the
live room keeps both services awake while it is open. On an always-on host the gate passes at once.

## Contract

- ai-service `GET /health` gains `"interviewer": "ready" | "down"`. `ready` = the worker in this container (or on this host,
  in local dev) has registered with LiveKit and its process is alive.
- API `GET /api/v1/interviews/live/readiness` (authenticated, any role) → `200 { "interviewer": "ready" | "waking" }`.
  It calls the ai-service `/health` with a short timeout (10 s); unreachable, timeout, error or anything but `ready` → `waking`.
  The call itself wakes a sleeping ai-service.
- Web polls readiness while the live page is open: every 3 s until `ready`, then every 4 min (keep-alive, keeps the API and
  through it the ai-service awake for the whole round). A failed poll counts as `waking`.

## Tasks

### 1. ai-service
- `app/interviewer/lifecycle.py`: `ready_path(agent_name)` (tempdir `interviewiq-worker-<safe>.ready`),
  `mark_ready(agent_name)` (writes this pid), `clear_ready(agent_name)`, `worker_ready(agent_name) -> bool` (file exists, pid
  alive via `os.kill(pid, 0)`; any error → False). Never touch the `.lock` file from the HTTP side (a probe could make a
  starting worker exit with AlreadyRunning).
- `app/interviewer/worker.py` `main()`: build `AgentServer.from_server_options(opts)`, `server.on("worker_registered", ...)`
  → `mark_ready`; `clear_ready` at start and via `atexit`; `cli.run_app(server)`.
- `build_worker_options`: pass `num_idle_processes` / `load_threshold` only when the new optional settings
  `INTERVIEWER_IDLE_PROCESSES` (int) / `INTERVIEWER_LOAD_THRESHOLD` (float) are set.
- `app/api/routes.py` `/health`: add `interviewer`.
- `start.sh` in `apps/ai-service/` + Dockerfile: uvicorn on `${PORT:-8000}`; when `INTERVIEWER_IN_CONTAINER=true` also
  `python -m app.interviewer.worker start`; exit when either exits (container restarts); forward TERM/INT.
- README "Live interviewer worker": container mode paragraph.

### 2. API
- `AiServiceClient.health()` → parsed JSON or null (lookup convention), timeout 10 s.
- `GET /interviews/live/readiness` in `routes/interviews.ts` (service method in `liveSessions.ts` or a tiny new service).
- `packages/contracts/openapi.yaml` path + schema `LiveReadinessResponse`; regenerate web types
  (`apps/web/scripts/generate-types.ts`).

### 3. Web
- `features/interview/api.ts` `getLiveReadiness()`; hook `features/interview-live/session/useInterviewerReadiness.ts`.
- `LiveInterview.tsx`: run the hook (not in mock mode, where it is always ready) for prejoin, checks and live; pass to
  `ChecksView`; `useWarmInterviewer` fires only once the interviewer is ready (during prejoin or checks).
- `ChecksView.tsx`: Enter disabled until ready; status line "Getting your interviewer ready… this can take up to a minute."
- `next.config.ts`: when `API_PROXY_TARGET` is set, rewrite `/api/v1/:path*` → `${API_PROXY_TARGET}/api/v1/:path*` (only
  `/api/v1`, Next owns `/api/webhooks`). On Vercel set `NEXT_PUBLIC_API_URL=""` so the refresh cookie is first-party.

### 4. render.yaml
- ai-service: `INTERVIEWER_IN_CONTAINER=true`, `LIVEKIT_*`, `DEEPGRAM_API_KEY`, `OPENROUTER_API_KEY`, `SARVAM_API_KEY`
  (`sync: false`), `INTERVIEWER_IDLE_PROCESSES=0`, `INTERVIEWER_LOAD_THRESHOLD=1.0` (512 MB, 0.1 CPU); comments on Vercel env.

## Known limits (dev only)
512 MB may not hold FastAPI + worker + a round; the reconcile and retry schedulers run only while awake; grading that outlives
15 min idle may be cut off.
