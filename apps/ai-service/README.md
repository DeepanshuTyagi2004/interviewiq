# interviewiq-ai-service

Python FastAPI service — the home for **all LLM orchestration and inference** across
InterviewIQ. The backend (interviewiq-api) holds no LLM calls; everything LLM-shaped
lives here.

Currently implements the **interview-intelligence pipeline**: scrape interview
experiences → extract structured signals with a local LLM → synthesize per
company+role+level briefs → serve them to the backend. The voice interview agent and
profile synthesis are stubbed (`app/interview_agent/`, `app/profile_synthesis/`) so
the structure already reflects the service's full intended scope.

## Layout

```
app/
  config.py            Settings — all from env, required vars fail fast (no defaults)
  main.py              FastAPI app + lifespan (connect Mongo, build LLM, start scheduler)
  cli.py               `python -m app.cli` — run the full pipeline once
  llm/                 LLM client abstraction (swap models by changing one class)
  models/              Pydantic contracts: RawExperience, ExtractedSignals, InterviewBrief
  db/                  Motor (async Mongo) connection + repositories + indexes
  prompts/             extraction + synthesis prompt templates (versioned)
  jobs/                extraction, synthesis, pipeline orchestration, scheduler
  api/                 FastAPI routes + admin (run/status, submit experience) + key dep
  interview_agent/     STUB — future live voice interview agent
  profile_synthesis/   STUB — future candidate profile synthesis
tests/                 self-checks (run: python -m tests.test_json_parse)
```

> **Ingestion:** the automated scraping collectors were removed (the collection
> approach is being redesigned). The current source is **first-party paste-in**:
> users submit their own interview experiences (`POST /admin/experiences`, proxied by
> interviewiq-api's `POST /api/v1/experiences`), which land as `pending` and are
> processed by the same extract → synthesize pipeline.

## Configuration (all from environment)

Required — the service **fails fast at startup** if any is unset:

| Var | Purpose |
|---|---|
| `LLM_BASE_URL` | Base URL of the local llama.cpp (OpenAI-compatible) server. Never hardcoded. |
| `LLM_MODEL` | Model name to request. Never hardcoded. |
| `MONGODB_URI` | MongoDB connection string. |
| `INTERNAL_API_KEY` | Shared secret with interviewiq-api. |

Optional (defaults in `app/config.py`): `MONGODB_DB`, `API_BASE_URL`,
`SCRAPER_DELAY_SECONDS`, `SCRAPE_INTERVAL_DAYS`, `BRIEF_MIN_INTERVAL_HOURS`,
`BRIEF_MIN_EXPERIENCES`, `BRIEF_LOOKBACK_MONTHS`, `SCHEDULER_ENABLED`.

## Run

Usually via `interviewiq-infra` (`docker compose up`). Standalone:

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
# LLM_BASE_URL points at your host OpenAI-compatible server (LM Studio default 1234).
# Running on the host like this, use 127.0.0.1; inside Docker use host.docker.internal.
export LLM_BASE_URL=http://127.0.0.1:1234 LLM_MODEL=google/gemma-4-e4b \
       MONGODB_URI=mongodb://localhost:27017 INTERNAL_API_KEY=dev-key
uvicorn app.main:app --reload --port 8000
```

## Endpoints

- `GET /health` — public; reports MongoDB + LLM connectivity.
- `GET /briefs/{company}/{role}/{level}` — internal key; the pre-generated brief, or 404.
- `GET /experiences/{company}/{role}/{level}` — internal key; paginated raw experiences + signals.
- `POST /interview-plans` — internal key; build (or return the cached) `InterviewPlan` for a
  session (Interview Prep, Pipeline 1). Cache-gated on a fused input hash, so an identical
  re-request returns the stored plan with **no LLM calls**. Body + response shapes are the
  `GenerateInterviewPlanRequest` / `InterviewPlan` schemas in `interviewiq-infra`'s
  `contracts/openapi.yaml`.

Internal endpoints require the `X-Internal-Api-Key` header.

**Interview prep** lives in `app/interview_prep/` (context → generate → pipeline), with
`app/llm/structured.py` (an Instructor-style validate-and-repair wrapper over `LLMClient`, no new
dependency) and `app/obs/` (an **optional** Langfuse span helper — a no-op unless `LANGFUSE_ENABLED`
and keys are set; `langfuse` is intentionally NOT in `requirements.txt`). The three prompt modules
in `app/interview_prep/prompts/` are **scaffolds** — the real interviewer-voice text is product IP,
drafted by a human. Bump each `*_PROMPT_VERSION` (recorded on the stored plan) when they change.

## Swapping the LLM

Callers depend only on the abstract `LLMClient` (`app/llm/client.py`). To move off
llama.cpp, write a new concrete client and change the one `build_llm_client` factory —
no caller changes. `OpenAICompatibleClient` already works for llama.cpp, vLLM, Ollama,
and OpenAI.

## Caveats (honest)

- **Scraping was removed** — the automated collectors (Reddit / LeetCode Discuss /
  GeeksforGeeks / AmbitionBox) are gone while the collection approach is redesigned.
  Ingestion today is first-party paste-in. The `Source` enum keeps the old labels so a
  new collector can reuse them.
- Prompt templates in `app/prompts/` are **v1 drafts** pending human review (product IP).
  Bump `EXTRACTION_PROMPT_VERSION` / `BRIEF_PROMPT_VERSION` when you change them — the
  version is recorded on every processed document so old data can be re-processed.

## Company research pipeline (Phase 1)

**What runs.** A research runner takes a set of catalogue companies and runs a per-company LangGraph
(`resolve` -> `write_draft`): `resolve` searches the web (Exa) and normalises the company identity,
`write_draft` asks the LLM to write a draft brief into `company_drafts`. Every run, company, node, Exa call and
LLM call is traced into the research trace collections (events + payloads, expiring after
`RESEARCH_TRACE_TTL_DAYS`), which the web app's Intelligence page (Companies / Runs tabs) reads. A weekly cron
(`RESEARCH_CRON`, only when `SCHEDULER_ENABLED=true`) starts a run for stale companies. All settings are
documented in `.env.example` (`RESEARCH_*`).

**Modes** (`RESEARCH_MODE`, or per run):
- `live`: real Exa and LLM calls.
- `record`: live, and every response is saved to `RESEARCH_FIXTURES_DIR` (gitignored; the files are real web text).
- `replay`: serves the saved responses, so a run is free, deterministic and offline.

**CLI** (examples from `app/research/cli.py`):

```bash
# ad-hoc company, nothing else running: no API, no Mongo, free replay
python -m app.research.cli run --name "Meesho" --mode replay --memory --verbose

# record real responses once (costs Exa + LLM calls), then replay them for free
python -m app.research.cli run --name "Meesho" --mode record --memory

# catalogue companies by slug (needs interviewiq-api running); writes to MONGODB_DB
python -m app.research.cli run --company meesho --company razorpay --mode live
```

Exit code: 0 all companies done/skipped, 1 any failed, 2 bad arguments / nothing to run.

**Mongo contract tests.** The store contract tests run against the in-memory store always, and against a real
MongoDB when given a URL:

```bash
RESEARCH_TEST_MONGO_URL=… .venv/bin/python -m pytest tests/research/test_store_contract.py
```

**Local walkthrough** (host processes, no Docker). This uses the dev databases and spends a few Exa and LLM calls
in record mode: about 2 each per company in Phase 1.

1. In `apps/ai-service/.env`, set:
   - `SCHEDULER_ENABLED=false`
   - `MONGODB_DB=interviewiq_intelligence_dev`
   - `RESEARCH_MAX_EXA_CALLS=60`
   - `RESEARCH_MAX_LLM_CALLS=250`
2. Start the stack with `pnpm dev`. Check the API's startup log shows migration `0002_company_research` applied, and the ai-service log shows the research runner started.
3. Sign in as an admin and open `/intelligence?tab=companies`. Add **Meesho** (website `meesho.com`), **Razorpay** and **TCS**. Each row shows "Never researched".
4. Open the **Runs** tab. Choose mode `record`, then **Start selected…** with all three. Watch for:
   - the trace tree filling up (run → company → resolve → exa / llm → write_draft);
   - the minimap pulsing the active node;
   - console lines streaming;
   - the budget meters counting up.
5. Click an `llm` step and check the Prompt, Reply, Input, Output, Logs and Raw tabs. Click **Copy for Claude** and paste it somewhere. It should start with the context header and contain the fenced blocks.
6. Start another `record` run of all three. Press **Pause** while the first company is in `resolve`. That company finishes its current node and parks; the others stay queued; the run reads `paused`. Press **Resume**: in the trace, `resolve` does **not** run again for the parked company. Then start a run and press **Stop**: the companies end `cancelled`, and no draft appears in `company_drafts` for that run.
7. **Restart check.** Pause a run, restart the ai-service, then open the run. It is still `paused`, and Resume finishes it.
8. **Replay check.** Start a `replay` run of all three. It completes with the Exa and LLM meters at 0. The companies end `skipped`, since nothing changed since their drafts.
9. **Budget check.** Start a `live` run with the LLM cap set to 1 (Set caps right after starting). The run auto-pauses with "budget cap reached". Raise the cap and Resume, and it completes.
10. On the Companies tab, every researched company reads "Awaiting review". Archive TCS, then start an "all" run: TCS is not included.
11. As a non-admin student, `/jobs` lists only the published companies. Admin-added companies stay hidden until Phase 2 approval.
