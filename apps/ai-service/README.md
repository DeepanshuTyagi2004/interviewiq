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

Internal endpoints require the `X-Internal-Api-Key` header.

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
