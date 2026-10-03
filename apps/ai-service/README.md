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

**Published company enrichment in prep.** The backend may supply optional `companyBrief` on
`GenerateInterviewPlanRequest`. It is validated and preferred over the legacy Mongo brief; absent/null
retains the existing lookup. Supplied company, role, level and non-null specialization must match the
session. Internal-key authentication still applies. This brief never supplies or changes the candidate
profile. Its overview and only matching-round topics, questions and guidance (`format`) enter grounding.
Backend round values (`dsa`, `system-design`, `lld`, `behavioural`, `hiring-manager`) match Python exactly.
The matching round's `duration_minutes` becomes `round.durationMinutes`; generated arc timings are
proportionally fitted to that duration. If several rounds share a type, their signals are unioned and
the first configured duration is used for the single session (never a sum across interviews).

The versioned prep cache key includes publication revision and validated brief content as well as the
existing inputs, so edits invalidate a cached plan even with an unchanged timestamp. Persona prompt
`v5-published-brief-draft` explicitly consumes guidance and duration and requires human review before
production use. Checks can isolate local dotenv settings without changing any files:

```sh
.venv/bin/python -c 'from app.config import Settings; Settings.model_config["env_file"] = None; import pytest; raise SystemExit(pytest.main(["-q"]))'
```

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
- Prompt templates in `app/prompts/` are **versioned drafts** pending human review (product IP).
  Bump `EXTRACTION_PROMPT_VERSION` / `BRIEF_PROMPT_VERSION` when you change them — the
  version is recorded on every processed document so old data can be re-processed.

## Company research pipeline

**What runs (`research-v5-overview`).** A research runner takes catalogue companies through
`resolve` -> `profile` -> `write_draft`. Searches and evidence-bound extraction produce company identity
and a sourced `profile.overview`; profile facts such as sector, headquarters or funding are retained
when present in the same evidence. There are no culture, pay, role/JD or interview searches in new runs.
Profile uses one general overview search and, when the company domain is known, one official about-page
search. At most one additional overview search runs if overview is missing (also bounded by
`RESEARCH_FOLLOWUP_MAX_QUERIES`); missing optional profile facts do not trigger extra searches.
`write_draft` persists **suggestions only** to `company_drafts`, with `scope: "overview"` and
`status: "pending_review"`. It never writes the API's manual enrichment store. Humans enrich and
submit culture, compensation, role/JD and structured interview content through the admin API.
Every run, company, node, Exa call and
LLM call is traced into the research trace collections (events + payloads, expiring after
`RESEARCH_TRACE_TTL_DAYS`), which the web app's Intelligence page (Companies / Runs tabs) reads. A weekly cron
(`RESEARCH_CRON`, only when `SCHEDULER_ENABLED=true`) starts a run for stale companies. All settings are
documented in `.env.example` (`RESEARCH_*`).

**Coverage and evidence.** New suggestion coverage tracks overview plus six existing profile facts;
intentionally omitted culture and roles never count as missing. Source quotations are validated against
returned text; unsupported data stays unavailable. Budget, cache, provider/model routing and record/replay
behavior are retained. `company_profile.py` is now **`v3-overview-draft`, requiring human review before
production use**. Offline tests do not imply live-provider evaluation or prompt approval.

**Upgrade / saved runs.** New runs pin both `pipeline_version` and `node_order`. Startup checks all
unfinished runs, including paused runs, before opening providers. Legacy, unversioned or incompatible
checkpoints are explicitly failed with `PipelineVersionMismatch` and an instruction to start a new
overview run. Manual resume performs the same check. Saved item state, node progress, completed items,
trace history and historical drafts remain available; a legacy `compensation` or `roles` checkpoint is
never resumed into the new graph. Current-version pauses still resume after their last completed node.

**History.** Existing full research snapshots remain readable with their original sections and coverage.
New drafts get the next version; earlier pending drafts may be marked superseded, but their contents
are retained. The new overview diff excludes culture/role sections, so their intentional omission does
not appear as a deletion suggestion against an old approved full snapshot. Legacy normalization and
grounding code/tests remain for historical data; those nodes are no longer in the running graph.

**Automatic jobs.** The old `brief-generation` interval job and startup missing-brief backfill are
disabled. `BRIEF_REFRESH_INTERVAL_DAYS` no longer schedules detailed company/role research. The
existing explicit admin brief-generation endpoint remains available; interview prep, question-bank
collection and live interview flows are independent. Only the overview runner is scheduled here.

**Modes** (`RESEARCH_MODE`, or per run):
- `live`: real Exa and LLM calls.
- `record`: live, and every response is saved to `RESEARCH_FIXTURES_DIR` (gitignored; the files are real web text).
- `replay`: serves the saved responses, so a run is free, deterministic and offline.

**Research LLM routing.** Set optional `GROQ_API_KEY` to a comma-separated list of Groq keys
(whitespace and duplicates are removed) to use Groq as the research runner/CLI's primary provider.
Each eligible key is attempted for `GROQ_MODEL_NAME`, then for each optional model in
`GROQ_FALLBACK_MODELS`, then optional Cloudflare Workers AI, before the existing Google AI Studio `LLM_*`
configuration. `GROQ_FALLBACK_MODELS` is comma-separated, trimmed and deduplicated in order;
unset or blank defaults to an empty list and preserves the primary model. Empty or unset
`GROQ_API_KEY` skips Groq; leaving Cloudflare unconfigured too preserves the existing provider behavior. This routing
is research-only; résumé parsing, prep, live interviews and other LLM callers keep their existing configuration.

The default `GROQ_MODEL_NAME=openai/gpt-oss-120b` is selected from
[Groq's official production models](https://console.groq.com/docs/models).
The optional local setup in `.env.example` sets `GROQ_FALLBACK_MODELS=openai/gpt-oss-20b`:
**Groq 120b keys → Groq 20b keys → Cloudflare GPT-OSS 120b → Google** when Cloudflare is configured
(subject to key/model availability and cooldowns).
`GROQ_BASE_URL` defaults to `https://api.groq.com/openai/v1`; `GROQ_TIMEOUT_SECONDS` defaults
to **30 seconds per Groq request** and must be positive. Research now uses the bounded policy below,
not the legacy `LLM_TIMEOUT_SECONDS`/retry loop for Google. Other workflows are unchanged.
No live speed or quality comparison is implied by this configuration.

**Optional Cloudflare fallback.** Set both `CLOUDFLARE_API_TOKEN` (with Workers AI access) and
`CLOUDFLARE_ACCOUNT_ID` in the ignored local `.env`; both blank disables it, and a partial pair
fails configuration validation. Account IDs must contain only ASCII letters and digits to keep
the API URL path safe. The default `CLOUDFLARE_MODEL_NAME` is
`@cf/openai/gpt-oss-120b`, with a **128K-token context window**.
`CLOUDFLARE_TIMEOUT_SECONDS` defaults to **30**, positive and finite;
`CLOUDFLARE_MAX_TOKENS` defaults to **4096**, conservatively bounded to an integer from 1 to 24,000. Input and output together
must fit the model context. Without Groq keys, Cloudflare is tried before Google.

**Bounded research requests.** Groq JSON mode and output caps apply to both Groq models. Invalid or
truncated output gets at most one format repair per model, then the next provider/model is tried.
Per-client key/model quota ledgers reserve estimated input plus capped output before dispatch;
actual usage and remaining/reset headers reconcile reservations. Exhausted keys are skipped rather
than probed repeatedly. Ledgers are local to one research client, not shared between service replicas;
provider organization quotas remain authoritative.

| Setting | Default | Scope |
|---|---|---|
| `RESEARCH_LLM_DEADLINE_SECONDS` | 75s | Entire routed call, including provider queue waits |
| `RESEARCH_GROQ_STAGE_SECONDS` | 25s | All Groq attempts combined |
| `RESEARCH_GOOGLE_TIMEOUT_SECONDS` | 12s | Per eligible Google key, once each; capped at 12s |
| `RESEARCH_OPERATION_TIMEOUT_SECONDS` | 90s | Source chunks/repairs and gateway queue-inclusive calls |
| `RESEARCH_MAX_OUTPUT_TOKENS` | 2048 | Research output cap; Cloudflare also respects its own lower cap |
| `RESEARCH_GROQ_TPM` / `RESEARCH_GROQ_RPM` | 8000 / 30 | Conservative local quota defaults |
| `RESEARCH_CHUNK_CHARS` / `RESEARCH_MAX_CHUNKS` | 4500 / 4 | Overlapping source windows; oversized input fails explicitly |

Cloudflare's 30s deadline includes its lock wait. Failures/cancellation release locks and maintain
shared cooldowns. Logs identify provider, model, key index, state and safe parse/finish categories.
Source windows preserve absolute evidence offsets. Partial window failures remain visible and get
the existing bounded saved-source retry; they are not treated as complete extraction. These caps are
per extraction operation, **not a deadline for the entire company run**. No production latency gain
is claimed from mocked timeout tests. Changed extraction prompts need new fixtures when using replay.

[Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/) provides
**10,000 neurons per day**, resetting at **00:00 UTC**. Free-plan requests beyond the allocation
are limited; **paid-account usage beyond the allocation is billed**. This is not unlimited free
inference and configuring the fallback does not enable a paid plan. The
[selected model](https://developers.cloudflare.com/workers-ai/models/gpt-oss-120b/)
is priced at **$0.35 per million input tokens** and **$0.75 per million output tokens** outside
the allocation. Check current account usage and provider pricing before increasing workloads.

[Groq's official rate-limit documentation](https://console.groq.com/docs/rate-limits) lists the
free plan for **both** `openai/gpt-oss-120b` and `openai/gpt-oss-20b` as **30 RPM, 8K TPM,
1K RPD and 200K TPD**. Limits are organization-scoped and may be shared; extra keys or models
do not guarantee additive throughput or bypass quotas. Check the organization's
[Limits page](https://console.groq.com/settings/limits) for its current effective limits.

LLM spans and newly recorded fixtures retain the provider/model that actually answered, including
fallback responses. Cache entries are separated by non-secret routing configuration and preserve
the original response's attribution on hits. Nonempty Groq fallback-model lists, including their
order, are part of cache and fixture identity; an empty list preserves existing identities.
Cloudflare-enabled routes include the ordered provider/model chain, excluding the account ID and
token; disabling Cloudflare preserves existing routing identities. Groq- or Cloudflare-enabled
fixtures use a distinct routing identity; Google-only fixtures retain the existing request format
for replay. Configured Groq keys and the Cloudflare token are redacted from research traces, and
routing identities omit URL credentials, query strings and fragments.

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
