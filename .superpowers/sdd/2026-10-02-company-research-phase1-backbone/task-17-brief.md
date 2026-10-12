## Task 17: Local setup, docs and end-to-end verification

**Files:**
- Modify: `apps/ai-service/.env.example`, `infra/.env.example`, `.gitignore`, `apps/ai-service/README.md`

- [ ] **Step 1: Document the settings**

Append to `apps/ai-service/.env.example`. Mirror the same block under the ai-service section of `infra/.env.example`.

```bash
# --- Company research pipeline (Intelligence → Companies / Runs) ---
RESEARCH_ENABLED=true
# Weekly run (APScheduler crontab, Asia/Kolkata; use day NAMES). Only when SCHEDULER_ENABLED=true.
RESEARCH_CRON=0 2 * * mon
# live | record | replay. Local dev: record once, then replay for free, deterministic, offline runs.
RESEARCH_MODE=live
RESEARCH_FIXTURES_DIR=.research-fixtures
RESEARCH_CONCURRENCY=2
RESEARCH_RESULTS_PER_QUERY=5
RESEARCH_STALE_AFTER_DAYS=7
RESEARCH_MAX_ROLES=8
# Per-run caps; reaching one auto-pauses the run (raise in the UI, then Resume). Dev: 60 / 250.
RESEARCH_MAX_EXA_CALLS=400
RESEARCH_MAX_LLM_CALLS=2000
RESEARCH_MAX_ATTEMPTS=2
# Full-verbosity trace retention (events + payloads). The Atlas free tier (512 MB) fills past ~50 companies.
RESEARCH_TRACE_TTL_DAYS=14
```

Add `apps/ai-service/.research-fixtures/` to the repo `.gitignore`. Recorded fixtures are real web text and must never land in git.

- [ ] **Step 2: Add the README section**

Add a section `## Company research pipeline (Phase 1)` to `apps/ai-service/README.md` with:
- **What runs:** the runner and the per-company LangGraph (`resolve` → `write_draft`), the trace collections, and the weekly cron.
- **The modes:** `live`, `record` and `replay`.
- **The CLI:** the three CLI examples from `app/research/cli.py`'s docstring.
- **The Mongo contract tests:** `RESEARCH_TEST_MONGO_URL=… .venv/bin/python -m pytest tests/research/test_store_contract.py`.
- **The local walkthrough** in Step 4 below, verbatim.

- [ ] **Step 3: Run every automated check**

Run:

```bash
cd apps/ai-service && .venv/bin/python -m pytest -q && cd ../..
pnpm --filter @interviewiq/api typecheck && pnpm --filter @interviewiq/api test
pnpm --filter @interviewiq/web typecheck && pnpm --filter @interviewiq/web lint && pnpm --filter @interviewiq/web test
```

Expected: everything passes. Paste the tail of each run into the task report. Do not claim green without that output.

- [ ] **Step 4: Local walkthrough (host processes, no Docker)**

This uses the dev databases and spends a few Exa and LLM calls in record mode: about 2 each per company in Phase 1. **Ask the user before running it.**

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

Record the outcome of each numbered check in the task report, including anything that misbehaved.

- [ ] **Step 5: Checkpoint**

Run `git status` and hand over to the user to review and commit.
