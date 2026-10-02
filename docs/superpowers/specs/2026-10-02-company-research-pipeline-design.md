# Company Research Pipeline — Design

**Date:** 2026-10-02
**Status:** Approved in brainstorming, pending written-spec review
**Apps touched:** `apps/ai-service` (pipeline), `apps/api` (catalogue, approval, proxies), `apps/web` (admin Intelligence, student `/jobs`), `packages/contracts/openapi.yaml`

---

## 1. Goal

A weekly background job that researches every company an admin has added and produces, per company:

- **Company profile:** sector, product / service / hybrid, HQ, headcount, revenue, funding stage.
- **Compensation and culture:** CTC range per level, work-life-balance rating, review summary with quotes.
- **Placement tier:** derived deterministically from pay band plus selectivity.
- **Role profiles:** the engineering roles the company offers, under the company's own title (e.g. "Software Development Engineer I", "MTS-1", "TCS Digital"), with YoE range, specialization and a typical JD. Each is mapped to the normalized ladder (`intern | fresher | sde1 | sde2 | sde3 | staff | principal`). The UI shows both the company title and the normalized level. Role profiles are the list of roles a company offers; whether it is hiring for them right now is irrelevant.
- **Interview process per role:** rounds, difficulty, topics and named questions, gathered from real interview experiences.

Data from many partial sources is normalized and merged, and gaps are filled with explicit provenance labels. The job never publishes directly. Each run produces a **draft**, and an admin approves the **end result** (not intermediate steps) before students see anything.

Every step the job takes is traced at full verbosity and streamed live to the admin-only Intelligence tab for real-time debugging.

### Decisions locked in brainstorming

| Topic | Decision |
|---|---|
| Orchestration | **LangGraph** in `apps/ai-service` (already a dependency for the live interview). No Langflow. |
| Search | **Exa** (existing client). |
| Company intake | **Curated.** An admin adds companies in the UI; the next run picks them up. No autonomous discovery. |
| Run control | Admin can **start, pause, resume, stop** a run from the UI at any time. |
| Roles | The job **discovers role profiles**. No live openings. |
| Publishing | **Admin approves everything**, at the level of the end result per company. Students only see published data. |
| Tier | **Placement-style:** pay band plus selectivity. Bands in §6.4. |
| Salary / WLB sources | Any Exa result, **including review text**. Full text is stored internally; students see summaries and short attributed quotes with links. |
| Level ladder | Extended to `intern, fresher, sde1, sde2, sde3, staff, principal`. "Lead" is a title, not a level. The engineering-manager track is out of scope. |
| Data placement | **Approach A.** Research, evidence, drafts, events and durable graph state live in Mongo. Approved catalogue data lives in Postgres. Approval copies it across. |

### Out of scope

Autonomous company discovery, live job openings, the engineering-manager track, non-India data, partner/exclusive openings, and student-visible research progress.

---

## 2. What exists today (and what changes)

| Today | Change |
|---|---|
| `app/jobs/brief_generation.py` (v13): a per-JD brief pipeline using Exa, LLM extract and aggregate, on a weekly APScheduler job. | Its collect, extract and aggregate functions are **reused** inside the new `interview_process` node. The old scheduled `brief-generation` job is **retired** in Phase 4. |
| `app/jobs/run_store.py`: a single in-memory run slot, lost on restart. | Research runs move to Mongo (§5). Question-bank collection keeps using `run_store` (out of scope). |
| `catalogueSeeder.ts` hard-deletes every company except Meesho. | The delete is removed. The seed becomes an upsert. |
| `routes/admin.ts` "add company" inserts JD rows only, with no `companies` or `company_role_configs` row. | Replaced by real company CRUD (§8.1). |
| `experiences` collection (user submissions) is stored but never processed. | Pending submissions for a company become first-hand sources for `interview_process`. |
| `LEVELS = fresher, sde1, sde2, sde3`. | Extended to 7 levels. Round skeletons are added for `intern`, `staff` and `principal`. |
| Intelligence tab "Live ingestion" and "Companies & JDs". | Replaced by **Companies**, **Runs** (the debugger) and **Review queue** (§9). |
| Catalogue and intelligence endpoints are hand-typed in web and absent from OpenAPI. | All new endpoints go in `packages/contracts/openapi.yaml` with generated types. |

---

## 3. Architecture

```
  Admin UI (web, /intelligence)                 Student UI (web, /jobs)
        │  control, review, trace polling              │  published data only
        ▼                                              ▼
  apps/api  ── admin routes ──► proxy (X-Internal-Api-Key) ──► apps/ai-service
     │  Postgres: companies, job_descriptions,          │  app/research/
     │            company_role_configs (published)      │    runner.py   (queue, concurrency, control)
     │  /internal/research-targets ◄────────────────────┤    graph.py    (LangGraph per company)
     │  approve: Postgres txn ◄─ publish payload ───────┤    nodes/      (resolve … write_draft)
     │                                                  │    normalize/  (levels, ctc, merge, tier)
     │                                                  │    trace/      (spans, events, log handler)
     │                                                  │    store.py    (Mongo repositories)
     │                                                  │    fakes/      (record / replay harness)
     │                                                  ▼
     │                                         Mongo interviewiq_intelligence
```

### 3.1 Runner (`app/research/runner.py`)

- Builds the run's queue from `/internal/research-targets`: active companies that are new or were last researched more than `RESEARCH_STALE_AFTER_DAYS` (default 7) ago, or the admin-selected subset.
- Processes `RESEARCH_CONCURRENCY` companies at a time (default 2, bounded by Gemma rate limits).
- Runs each company's graph with `graph.astream(..., stream_mode="updates")`. **After every node update** it reads `research_runs.control` and the budget counters, and acts on pause or stop (§5.3).
- Only one research run is active at a time.

### 3.2 Per-company graph (`app/research/graph.py`)

- Durable state: after every node, the runner saves the accumulated graph state and the last completed node into `research_items` (`state`, `last_node`). Each graph run uses an in-process `InMemorySaver`. To resume (after a pause or a crash) the runner builds a fresh thread, seeds it with `aupdate_state(state, as_node=last_node)`, and calls `astream(None)`, so execution continues at the next node and completed nodes never re-run. This was verified against langgraph 1.2.12, and it avoids `langgraph-checkpoint-mongodb`, which pulls in langchain, langchain-mongodb and SQLAlchemy.
- `thread_id = "{run_id}:{company_id}"`.

| # | Node | Required? | Does |
|---|---|---|---|
| 1 | `resolve` | yes | Canonical name, website and aliases. Matches against existing companies to avoid duplicates ("Amazon India" vs "Amazon"). A likely duplicate does not stop the run: it is recorded as a `possible_duplicate` conflict naming the other company, and the admin decides in review (reject, or archive one). |
| 2 | `profile` | no | Sector, business model (product/service/hybrid), HQ, headcount band, revenue band, funding stage. |
| 3 | `compensation` | no | CTC per level, WLB rating and review count, review text, review summary and quotes. |
| 4 | `roles` | yes | Role profiles: company title, YoE, specialization, JD. Normalized to the ladder (§6.1). Capped at `RESEARCH_MAX_ROLES` per company, keeping the roles with the most source support. Roles dropped by the cap are listed in the draft's notes. |
| 5 | `interview_process` | no | One branch per role via LangGraph `Send`. Reuses the brief collect/extract/aggregate code. Includes pending user-submitted `experiences` as first-hand sources. Outputs rounds, difficulty, topics and named questions. |
| 6 | `reconcile` | yes | Cross-source merge per field (§6.2), gap filling with provenance (§6.3), conflict detection. |
| 7 | `tier` | yes | Deterministic tier from pay band plus selectivity (§6.4). Empty when there is no CTC data. |
| 8 | `write_draft` | yes | Writes the `company_drafts` snapshot plus a diff against the published version, and enqueues it for review. |

**Failure policy:**
- A failure in a required node fails the company's item. Other companies continue.
- A failure in an optional node (or in one role's `interview_process` branch) still produces a draft, with the affected fields set to `unavailable` and the error attached.

**Retries:** each node has a LangGraph `RetryPolicy` for transient Exa and LLM errors (timeouts, 429s, 5xx), with exponential backoff and at most 3 attempts.

### 3.3 Research node pattern

Every research node (2–5) follows the same steps:

1. Build queries from a versioned query template, for example `"{company} software engineer salary CTC India {level}"`.
2. Exa `/search` with `userLocation=IN` and the existing exclude-domain list, keeping the top `RESEARCH_RESULTS_PER_QUERY` results (default 5).
3. Upsert each result into `research_sources`, keyed by URL with a `content_hash`. **If the hash is unchanged and the extract's prompt version is unchanged, reuse the stored extract** with no LLM call. This is recorded as a `cache.hit` span.
4. Run an LLM extract per new or changed source, producing structured claims `{field, value, unit, date, first_hand, geo, quote?}`.
5. Drop claims whose `geo` is not India.
6. Return the claims to the graph state. Merging happens in `reconcile`.

Prompts are new, versioned files under `app/prompts/research/`. **Prompt drafts go to the human for review before production use** (they are product IP).

---

## 4. Data model

### 4.1 Postgres (published data, owned by `apps/api`)

**`companies`: new columns**

| Column | Type | Notes |
|---|---|---|
| `website` | varchar(255) null | |
| `aliases` | text[] not null default `{}` | For `resolve` matching. |
| `sector` | varchar(64) null | Controlled vocabulary in `domain/enums.ts` (`fintech, e-commerce, saas, it-services, consumer-internet, enterprise-software, semiconductors, telecom, edtech, healthtech, gaming, logistics, other`). |
| `business_model` | varchar(16) null | `product \| service \| hybrid` |
| `headcount_band` | varchar(32) null | e.g. `1k-5k` |
| `revenue_band` | varchar(32) null | e.g. `₹1k-5k Cr` |
| `funding_stage` | varchar(32) null | `public, late-stage, growth, early, bootstrapped, subsidiary` |
| `tier` | integer null | **Repurposed** to placement tier 1–4 (was "1–5"). |
| `tier_rationale` | text null | |
| `wlb_rating` | numeric(2,1) null | 0.0–5.0 |
| `wlb_review_count` | integer null | |
| `review_summary` | text null | |
| `review_quotes` | jsonb not null default `[]` | `[{text, sourceUrl, sourceName, date}]`, at most 5 quotes of at most 300 characters each. |
| `status` | varchar(16) not null default `active` | `active \| archived`. Archived companies are skipped by runs and hidden from students. |
| `origin` | varchar(16) not null default `admin` | `seed \| admin` |
| `published_version` | integer null | The draft version last approved. |
| `published_at` | timestamptz null | Students see only companies where this is not null. **Migration:** existing rows get `published_at = created_at`, so nothing disappears. |

**`job_descriptions`: reused as the role list** (briefs, booking and the catalogue keep working)

| Column | Change |
|---|---|
| `title` | Now holds the **company's own title**. |
| `level` | The normalized ladder value. |
| `yoe_min`, `yoe_max` | New. numeric(3,1) null. |
| `ctc_min_lpa`, `ctc_max_lpa` | New. numeric(6,2) null. |
| `ctc_source_count` | New. integer null. |
| `role_key` | New. varchar(128) null. A stable identity across runs: `slug(level + specialization + title)`. Unique per company when not null. |
| `source` | Gains the value `research`. |

**`company_role_configs`:** upserted on approval for every published role, with `enabled = true` and `round_count` taken from the brief, so every published role can be booked.

**`LEVELS`** in `apps/api/src/domain/enums.ts` becomes `["intern","fresher","sde1","sde2","sde3","staff","principal"]`. The web `LEVEL_LABEL` map and the ai-service level helpers are updated to match. `app/templates/skeletons.py` gains skeletons for `intern`, `staff` and `principal`.

Interview sessions copy company, role, level and specialization at booking time, so deactivating a JD row never breaks an existing session.

### 4.2 Mongo `interviewiq_intelligence` (research and state, owned by ai-service)

| Collection | Key / indexes | Shape |
|---|---|---|
| `research_runs` | `run_id` unique; `started_at` desc | `{run_id, trigger: cron\|admin, mode: live\|record\|replay, scope: all\|selected, company_ids[], status, control: none\|pause\|stop, pause_reason?, requested_by?, counters{total, queued, running, done, failed, skipped, paused, cancelled}, budget{exa_used, exa_cap, llm_used, llm_cap, tokens_in, tokens_out}, last_seq, started_at, finished_at?, error?}` |
| `research_items` | (`run_id`, `company_id`) unique | `{run_id, company_id, company_name, thread_id, status, attempts, current_node?, nodes{<name>: {status, started_at, finished_at, exa_calls, llm_calls, cache_hits, error?}}, draft_id?, error?}` |
| `research_spans` | `span_id` unique; (`run_id`, `parent_id`); (`run_id`, `company_id`) | `{span_id, parent_id?, run_id, company_id?, node?, kind: run\|company\|node\|exa\|llm\|cache\|merge\|normalize\|db, name, status: running\|ok\|error\|cancelled, started_at, ended_at?, duration_ms?, input?\|input_ref?, output?\|output_ref?, attrs{model?, prompt_name?, prompt_version?, tokens_in?, tokens_out?, key_index?, retries?, query?, url?, rule?}, error?{type, message, traceback, code_ref}}` |
| `research_events` | (`run_id`, `seq`) unique; TTL on `ts` | `{run_id, seq, ts, span_id?, company_id?, node?, level: trace\|debug\|info\|warn\|error, type, message, data?\|data_ref?}`. `type` is one of `run.*`, `item.*`, `span.start`, `span.end`, `log`, `cache.hit`, `conflict.detected`, `budget.*`, `draft.created`, `control.*`. |
| `research_payloads` | `_id`; TTL on `created_at` | `{_id, run_id, span_id, content_type, size_bytes, body}`, for any input, output or data over 32 KB. |
| `research_sources` | `url` unique; `content_hash` | `{url, domain, title, published_date?, fetched_at, content_hash, text, kinds[], extracts{<node>: {prompt_version, source_hash, claims[], extracted_at}}}`. Never TTL'd, because it backs hash caching. |
| `company_research_state` | `company_id` unique | `{company_id, last_run_id, last_researched_at, last_status, latest_draft_id?, published_version?}`. The source of the Companies tab status. |
| `company_drafts` | (`company_id`, `version`) unique; `status` | `{draft_id, company_id, version, run_id, status: pending_review\|approved\|rejected\|superseded, created_at, snapshot, conflicts[], diff, reviewed_by?, reviewed_at?, review_note?, excluded_role_keys[]}`. A new draft for a company supersedes any older `pending_review` draft. |
| `company_overrides` | (`company_id`, `field_path`) unique | `{company_id, field_path, value, set_by, set_at}`. Applied to every later draft during `reconcile`. Where research disagrees, it is shown as a note and never overwrites. |
| `level_mappings` | (`company_slug`, `title_pattern`) unique | `{company_slug, title_pattern, level, origin: seed\|approved, approved_by?, approved_at?}` |
| `research_extracts` | `key` unique | `{key, prompt_name, prompt_version, output, created_at}`, an LLM-extract cache keyed by `sha256(prompt name + version + system + user)`. A hit skips the LLM call. It is bypassed in `record` mode, so every call gets a fixture. |

**Snapshot shape (`company_drafts.snapshot`).** Every leaf field is a `Field`:

```json
{ "value": "...", "confidence": "high|medium|low", "provenance": "evidence|derived|inferred_from_similar|template|unavailable|admin_override",
  "source_urls": ["..."], "note": "optional, e.g. merge rule or conflict" }
```

```
snapshot = {
  identity:     { name, website, aliases[] },
  profile:      { sector, business_model, hq, headcount_band, revenue_band, funding_stage }   // all Field
  compensation: { wlb_rating, wlb_review_count, review_summary, review_quotes[] }           // all Field
  tier:         { value: Field, rationale, inputs{ctc_median_lpa, selectivity_signals[]} },
  roles: [{ role_key, title: Field, level: Field, specialization: Field, yoe_min: Field, yoe_max: Field,
            ctc_min_lpa: Field, ctc_max_lpa: Field, ctc_source_count, jd: Field,
            interview_process: FinalExperience (the existing brief model) | null }]
}
```

`diff` lists `{path, change: added|changed|removed, before, after}` against the snapshot of the currently published version.

**Briefs stay published-only.** `interview_briefs` is written only on approval (§7), so existing readers (interview prep, `/jds/:id`) are unchanged.

### 4.3 Storage budget (risk)

Full-I/O tracing is heavy. A rough estimate is ~0.5–1 MB of new trace data per company per run, after source texts are de-duplicated. To keep it bounded:

- LLM-call spans store the **prompt template name and version plus references to `research_sources` content hashes**, not the full rendered prompt. The UI re-renders the full prompt on demand. The rendered prompt is stored in full only when it differs from the template plus sources (for example, a truncation was applied).
- `RESEARCH_TRACE_TTL_DAYS` (default 14) sets the TTL on `research_events` and `research_payloads`.
- **The Atlas free tier (M0, 512 MB) is not enough past roughly 50 companies.** Dev uses a separate database. Prod tier sizing is flagged for human decision.

---

## 5. Runs, control and ingestion state

### 5.1 State machines

```
run:   queued → running ⇄ pausing → paused
                   │                  │ resume → running
                   ├→ stopping → stopped
                   ├→ completed
                   └→ failed            (runner crash loop or unrecoverable setup error)

item:  queued → running → done | failed | skipped
                   ├→ paused  → running (resume)
                   └→ cancelled (stop)
```

`skipped` means the run finished the company but **nothing changed**: the reconciled snapshot equals the latest draft (or the published snapshot) and no override changed since. No new draft is written, which keeps the review queue free of no-op versions. A company archived after the run was queued is also `skipped`.

### 5.2 Triggers

- **Weekly cron:** APScheduler `CronTrigger` on `RESEARCH_CRON` (default `0 2 * * MON`, Asia/Kolkata). It is skipped (with a `run.skipped` event) if a run is active.
- **Admin start:** scope is `all` or `selected` (a list of company IDs). The Companies tab's "research now" starts a selected run for one company. **Only one run can be active.** A start while one is active returns `409 run_active` with the active `run_id`, and the UI offers "stop current and start new".

### 5.3 Control semantics

| Action | Effect |
|---|---|
| **Pause** | Sets `control=pause` and run status `pausing`. The runner stops dispatching queued items. Each in-flight item finishes its current node; its state is already saved on the item; the runner breaks out of `astream` and sets the item to `paused`. When no item is running, the run becomes `paused`. |
| **Resume** | Clears `control` and sets the run to `running`. Paused items restart with `graph.astream(None, {"configurable": {"thread_id": ...}})` and continue from the next node, so completed nodes are not re-run. Then queued items are dispatched. |
| **Stop** | Sets `control=stop` and status `stopping`. In-flight items stop after their current node and become `cancelled`. Their saved `state` is cleared and no draft is written. Queued items become `cancelled`. Cached `research_sources` are kept. The run becomes `stopped`. |
| **Budget cap** | When `exa_used ≥ exa_cap` or `llm_used ≥ llm_cap`, the run auto-pauses with `pause_reason=budget_exhausted`. An admin can raise the caps (`PATCH` run budget) and resume. |

### 5.4 Crash recovery

On ai-service startup, any run in `running` or `pausing` is resumed:
- Each in-flight item's `attempts` is incremented, and the item restarts from its saved `state` and `last_node`.
- An item whose `attempts > RESEARCH_MAX_ATTEMPTS` (default 2) is marked `failed` with `error=crash_loop`.

---

## 6. Normalization and gap filling (`app/research/normalize/`)

All functions here are pure and deterministic. They are built test-first.

### 6.1 Level normalization

1. **Rule lookup:** match `level_mappings` on (company slug, title pattern). The seed list (drafted for human review in Phase 3) covers common ladders, for example:
   - Amazon SDE I/II/III
   - Microsoft SDE / SDE II / Senior (59–64)
   - Google L3–L6
   - Atlassian P30–P60
   - Flipkart SDE-1/2/3
   - "MTS / SMTS / LMTS" (Salesforce, Adobe, VMware)
   - TCS Ninja / Digital / Prime, Infosys SE / DSE / SP, Wipro Elite / Turbo
2. **LLM fallback** (structured output): `{level, reasoning, confidence}`.
3. **YoE cross-check bands:**

   | Level | YoE |
   |---|---|
   | intern | student |
   | fresher | 0, campus |
   | sde1 | 0–2 |
   | sde2 | 2–5 |
   | sde3 | 5–8 |
   | staff | 8–12 |
   | principal | 12+ |

   If the rule or LLM level disagrees with the YoE band by more than one step, the role gets a `level_conflict` and confidence `low`.
4. **Learning:** on approval, each published role's (company, title) → level mapping is upserted into `level_mappings` with `origin=approved`. Later runs map that title with no LLM call.

Service-company hiring tracks (TCS Ninja / Digital / Prime) are separate roles, all at `fresher`, each with its own title and CTC.

### 6.2 Cross-source merge (per field)

| Field type | Rule |
|---|---|
| Categorical (sector, business model, funding stage) | A vote weighted by source quality (first-party > established aggregator > community) and recency. A tie produces a conflict and confidence `low`. |
| Numeric range (CTC, YoE, headcount, revenue) | Normalize units first: LPA; monthly × 12; base vs total CTC, with total = base + variable + annualized stock and fixed vs total recorded in the note; ₹ only, non-INR dropped. Then drop IQR outliers and take the median of the range lower and upper bounds. Record the `source_count`. |
| Text (JD, review summary) | An LLM synthesis over the top sources. **Every sentence must cite** a source in `source_urls`. A synthesis with uncited claims is rejected and retried once, then the field becomes `unavailable`. |
| Interview process | The existing aggregate logic, unchanged (round provenance, near-duplicate collapse, recency). |

**Confidence:**
- `high`: 3 or more independent agreeing sources, at least one within 2 years.
- `medium`: 2 sources, or 1 first-party source (the company's careers page).
- `low`: 1 third-party source, or any conflict.

### 6.3 Gap filling

| Provenance | When |
|---|---|
| `evidence` | Taken directly from sources. |
| `derived` | Computed from other fields, e.g. YoE from the level band when the JD is silent, or tier from CTC. |
| `inferred_from_similar` | Rounds or topics borrowed from another level at the same company, or from same-sector, same-tier companies. |
| `template` | The standard round skeleton (existing behaviour). |
| `unavailable` | No data. The field is left empty. |
| `admin_override` | Set by an admin in review (§7). |

**Hard rule:** CTC, WLB and tier are **never** `inferred_from_similar` or `template`. With no evidence they are `unavailable`, and the UI shows "not enough data".

### 6.4 Tier (deterministic)

- Input: the median CTC (LPA) of `fresher` roles, falling back to `sde1` roles.

  | Tier | Median CTC |
  |---|---|
  | **T1** | ≥ ₹20 LPA |
  | **T2** | ₹10–20 LPA |
  | **T3** | ₹6–10 LPA |
  | **T4** | < ₹6 LPA |

- **Selectivity tie-break:** applies only when the median is within ±10% of a boundary. The signals are rounds ≥ 4 including ≥ 2 DSA (rounds up), OA difficulty `hard` (rounds up), and a mass-recruiter signal for companies hiring thousands of freshers a year (rounds down).
- **Rationale string:** e.g. "SDE I median ₹24 LPA (4 sources); 4 rounds incl. 2 DSA".
- No CTC evidence means `tier = unavailable`.
- Bands and tie-break rules live in one config module so they can be changed in one place.

---

## 7. Review and approval

The admin approves the **end result** per company: profile, compensation, tier, roles and each role's interview process. They do not approve pipeline steps. Sources are shown as evidence.

**Review actions** (on a `pending_review` draft):
- **Edit field:** writes `company_overrides` and re-renders the draft with `provenance=admin_override`.
- **Exclude role:** adds its `role_key` to `excluded_role_keys`.
- **Reject:** sets status `rejected` with a note. Nothing is published.
- **Approve:** publishes, as below.

**Approve flow** (orchestrated by the API, idempotent by draft version):

1. The API calls ai-service `GET /research/drafts/{id}/publish-payload`, which returns the snapshot with overrides applied and excluded roles removed, as clean catalogue rows.
2. The API runs **one Postgres transaction**:
   - Upsert `companies`, setting `published_version` and `published_at`.
   - Upsert `job_descriptions` by (`company`, `role_key`) with `source=research`, `active=true`.
   - Set `active=false` on any other active JD for that company. The admin saw these as "removed roles" in the diff.
   - Upsert `company_role_configs`.
   - If `companies.published_version ≥ draft.version`, the transaction is a no-op (retry-safe).
3. The API calls ai-service `POST /research/drafts/{id}/commit`, which:
   - upserts `interview_briefs` per published role (keyed as today);
   - upserts the named questions into `interview_questions` with `company_tags`, `level_tags` and source `research`;
   - upserts the approved `level_mappings`;
   - marks the draft `approved` and updates `company_research_state.published_version`.
   
   This step is idempotent.
4. If step 3 fails, the approve call returns `502 commit_pending`. A retry skips step 2 (version check) and re-runs step 3. Until then, students may briefly see a JD with its previous brief, or none. This is acceptable, and the review queue shows the draft as "commit pending".

---

## 8. HTTP surface

All new routes are defined in `packages/contracts/openapi.yaml`, and web types are generated from it.

### 8.1 API (`apps/api`), admin only unless noted

| Method & path | Purpose |
|---|---|
| `GET/POST /api/v1/admin/companies` | List (with research status from ai-service `company_research_state`); create `{name, website?, aliases?}`. |
| `PATCH/DELETE /api/v1/admin/companies/:id` | Edit identity fields or archive (`status=archived`). Delete is kept for mistakes. |
| `POST /api/v1/admin/research/runs` | Start `{scope, companyIds?, mode?}`. Returns `409 run_active` if a run is already active. |
| `GET /api/v1/admin/research/runs`, `GET …/runs/:runId` | History; one run with its items. |
| `POST …/runs/:runId/pause \| resume \| stop` | Control. |
| `PATCH …/runs/:runId/budget` | Raise caps. |
| `GET …/runs/:runId/events?afterSeq&limit&level&companyId&node&type&q` | The live stream (polled). `limit` is at most 500. |
| `GET …/runs/:runId/spans?companyId` | The span tree (no payloads). |
| `GET /api/v1/admin/research/spans/:spanId` | One span with full input and output, resolving payload refs. |
| `GET /api/v1/admin/research/drafts?status`, `GET …/drafts/:draftId` | Review queue; one draft with snapshot, diff, conflicts and sources. |
| `PUT …/drafts/:draftId/overrides`, `PUT …/drafts/:draftId/excluded-roles` | Review edits. |
| `POST …/drafts/:draftId/approve \| reject` | §7. |
| `GET /api/v1/internal/research-targets` (internal key) | Active companies `{id, name, slug, website, aliases}` for the runner. |
| `GET /api/v1/companies`, `GET /api/v1/jds`, `GET /api/v1/jds/:id` (student) | Extended with the new published fields. Filtered to `published_at not null`, `status=active` and `active` JDs. |

The old add-company route (`POST /admin/companies` with `{company, jds}`) and its grouped `GET` are **replaced in Phase 1**, because the new CRUD uses the same paths. The `/admin/scrape/*` routes are removed in Phase 4. `/admin/companies/seed` is kept, but from Phase 1 it only upserts and never deletes.

### 8.2 ai-service (`/research/*`, internal key only)

These mirror the API proxies: runs CRUD and control, events, spans, payloads, drafts, publish-payload, commit, reject, overrides and excluded roles. Redaction (§10.3) is applied before anything is written, so no endpoint ever returns secrets.

---

## 9. UI

### 9.1 Admin: `/intelligence` (admin only)

These tabs replace "Live ingestion" and "Companies & JDs". Access, Question bank, Resume bench, Interview prep and Agent diagnostics are unchanged.

**Companies**
- An add form: name, plus optional website and aliases.
- A table with a status chip per company: *never researched · queued · researching · awaiting review · published · published, update pending review · failed*. It also shows the last researched date and published version.
- Row actions: research now, archive, open draft, open last run.

**Runs (the debugger)**
- **Control bar:** Start all, Start selected, Pause, Resume, Stop, with states driven by the run status. Shows the run status, `pause_reason` and counters. Budget meters show Exa and LLM used vs cap (with "raise cap"), plus tokens in and out.
- **Left pane, trace tree:** run → company → node → step spans, with live status icons, durations, retry counts and error markers that bubble up to ancestors. Each company has a **React Flow mini-map** (`@xyflow/react`, already installed) of its graph with the active node pulsing.
- **Right pane, span detail:** tabs for **Input · Output · Logs · Raw**. Payloads open in **Monaco** (`@monaco-editor/react`, already installed) as read-only JSON with folding and search. LLM spans show model, prompt name and version, tokens, latency and key index, with a "render full prompt" toggle. Errors show the traceback and `code_ref`.
- **Bottom, live console:** every event, polled every 1 s by `afterSeq`. Filters cover level (trace and up), company, node, type and free text. Follow-tail can be paused, the newest 2,000 rows are kept in the DOM, and older rows are fetched by seq range.
- **Copy everywhere** (with a sonner toast confirming each copy):
  - **Copy JSON** on any span or event.
  - **Copy for Claude** on any span: a markdown bundle with
    - a context header: run ID, mode, company, node, pipeline version, prompt name and version, model, `code_ref`;
    - fenced blocks for input, output, error with traceback, and the span's logs;
    - long texts trimmed to `head … [N chars trimmed] … tail`, keeping the bundle under ~40 KB.
  - **Copy failure report** on a failed item: the failing span, the outputs of its predecessor nodes, the error, the logs and the item's node timeline.
  - **Export run JSON:** a download of the run, items, spans and events (payload refs inlined when they total under 5 MB).
- **Deep links:** `?run=&company=&span=` opens the exact step after a reload or when shared.

**Review queue**
- A list of `pending_review` drafts (company, version, created, conflict count, changed-field count).
- A draft view:
  - The end result rendered like the student page.
  - A diff toggle (added, changed, removed per field).
  - Confidence and provenance chips on every field, with expandable sources.
  - Conflicts pinned at the top.
  - Per-field edit (creates an override).
  - Per-role exclude.
  - Approve and Reject with a note.

### 9.2 Students: `/jobs` (published data only, no research progress)

**Company cards**
- Tier, shown as "Tier 1 · placement tier". It is never worded as an endorsement.
- Sector and product/service.
- CTC range with source count.
- WLB as "3.9/5 · as reported by AmbitionBox, 2.1k reviews", with a link.
- The existing `DepthMeter`.

**Role rows:** the company title with the normalized level label beside it, e.g. "Software Development Engineer I · SDE-1", plus the YoE range and CTC range.

**`/jobs/[jobId]`**
- A freshness line, "Updated 3 days ago · 14 sources".
- Provenance chips in the Process tab ("inferred", "template").
- "Not enough data" for `unavailable` fields.
- The review summary with linked, attributed quotes.

---

## 10. Observability (full-verbosity trace)

### 10.1 Spans

The tracer (`app/research/trace/`) opens a span for:
- the run, each company and each node;
- every Exa call (input: query and params; output: every result with URL, title, date and text by `research_sources` ref);
- every LLM call (input: prompt name and version, model, params, messages by template plus source refs; output: raw text, thoughts if captured, parsed JSON, parse or validation errors; attrs: tokens, latency, key index, retries);
- every cache check, merge or normalize rule (input: claims; output: value plus the rule applied and why, e.g. "dropped ₹45 LPA as an IQR outlier", "title 'MTS-1' → sde1 via level_mappings");
- every DB write.

Spans emit `span.start` and `span.end` events.

### 10.2 Console logs

A `logging.Handler` attached to the `app.research` logger tree forwards every record, at `DEBUG` and above, to `research_events` as `type=log`. Context variables (`run_id`, `company_id`, `node`, `span_id`) attribute each record to the current span. The handler is buffered: an in-process monotonic `seq` (restored from `research_runs.last_seq` on resume) and `insert_many` every 250 ms or 200 events.

### 10.3 Redaction

Before persisting, `trace/redact.py`:
- removes `Authorization`, `x-api-key` and `X-Internal-Api-Key` headers;
- replaces any value matching a configured secret (`EXA_API_KEY`, `LLM_API_KEY` list, `INTERNAL_API_KEY`) with `«redacted:<name>»`.

LLM keys are identified only by rotation index.

### 10.4 Errors

Every error span stores `{type, message, traceback, code_ref}`, where `code_ref = "<relative path>:<function>"` comes from the innermost `app/research` frame.

---

## 11. Configuration (ai-service)

| Variable | Default | Purpose |
|---|---|---|
| `RESEARCH_ENABLED` | `true` | Register the cron and the endpoints. |
| `RESEARCH_CRON` | `0 2 * * MON` (Asia/Kolkata) | Weekly schedule. Honoured only when `SCHEDULER_ENABLED=true`. |
| `RESEARCH_MODE` | `live` | `live \| record \| replay` (§12.2). A run can override it. |
| `RESEARCH_FIXTURES_DIR` | `.research-fixtures` | Record and replay store (gitignored; recorded real data never lands in git). Unit tests use hand-written fixtures in `tests/research/fixtures/`. |
| `RESEARCH_CONCURRENCY` | `2` | Companies processed in parallel. |
| `RESEARCH_RESULTS_PER_QUERY` | `5` | Exa results kept per query. |
| `RESEARCH_STALE_AFTER_DAYS` | `7` | Re-research window. |
| `RESEARCH_MAX_ROLES` | `8` | Roles kept per company. This bounds the `interview_process` fan-out. |
| `RESEARCH_MAX_EXA_CALLS` | `400` | Per-run cap; auto-pauses when reached. |
| `RESEARCH_MAX_LLM_CALLS` | `2000` | Per-run cap; auto-pauses when reached. |
| `RESEARCH_MAX_ATTEMPTS` | `2` | Crash-loop guard. |
| `RESEARCH_TRACE_TTL_DAYS` | `14` | TTL for events and payloads. |

**No new Python dependency.** LangGraph is already installed (1.2.12), and durable state lives in `research_items` (§3.2).

---

## 12. Testing and local development

### 12.1 Automated tests (existing tooling only)

| Layer | Tool | Covers |
|---|---|---|
| `normalize/` | pytest, TDD | Title → level rules; YoE cross-check and conflict; CTC unit conversion (monthly, base vs total, non-INR dropped); IQR outlier drop and median range; categorical vote and tie conflict; confidence rules; tier bands and ±10% tie-break; **never infer CTC/WLB/tier**. |
| Nodes | pytest with `FakeExa` and `FakeLLM` (hand-written fixtures in `tests/research/fixtures/`) | Each node's output claims; spans and events emitted; cache hit skips the LLM; redaction leaves no secrets in any persisted document. |
| Graph and runner | pytest with `InMemorySaver` and an in-memory `ResearchStore` (same Protocol as the Mongo store) | Pause after node N then resume, asserting **node N runs exactly once** via call counters; stop writes no draft and clears saved state; the budget cap auto-pauses and resume continues after a raise; a crash mid-node resumes, and a second crash marks the item failed; a required-node failure fails only that item; an optional-node failure produces a draft with `unavailable`. |
| API | Vitest + supertest + PGlite + mongodb-memory-server (existing) | Approve writes the expected rows; a repeated approve is a no-op; `commit_pending` retry; overrides persist into the next draft; an excluded role is not published; JDs not in the draft are deactivated; 409 on concurrent start; the seeder no longer deletes companies; student endpoints hide unpublished and archived companies. |
| Web | Vitest + React Testing Library (existing) | Diff rendering; control-bar enablement per run status; the copy-for-Claude formatter (header, fences, trimming); deep-link parsing; console filters. |

### 12.2 Local run (host processes, no Docker)

1. **Modes:**
   - `RESEARCH_MODE=record` runs live and writes every Exa response and LLM response to `.research-fixtures/<company-slug>/<kind>-<request-hash>.json`, keyed by the hash of the canonical request.
   - `replay` serves only from those files and fails loudly on a miss. This makes runs free, deterministic and offline, so one failure can be re-run any number of times.
2. **Dev env** (`apps/ai-service/.env`):
   - `SCHEDULER_ENABLED=false`
   - `MONGODB_DB=interviewiq_intelligence_dev` (a separate Atlas database)
   - `RESEARCH_MAX_EXA_CALLS=60`
   - `RESEARCH_MAX_LLM_CALLS=250`
   
   Three companies need roughly 50 searches and 180 extracts.
3. **Walkthrough:**
   1. Run `pnpm dev` and sign in as an admin.
   2. In Intelligence → Companies, add **Meesho** (product), **Razorpay** (fintech) and **TCS** (service, which exercises the Ninja/Digital/Prime tracks).
   3. In Runs, use Start selected with all three in `record` mode, and watch the trace tree and console.
   4. **Pause** mid-run, **resume**, and confirm in the trace that no completed node re-ran. Start another run and **stop** it.
   5. In the review queue, **approve** Meesho, **edit a field** then approve Razorpay, and **reject** TCS.
   6. As a student, `/jobs` shows Meesho and Razorpay with the new fields, and not TCS.
4. **Replay check:** re-run the same three in `replay`. The drafts are identical, and the Exa and LLM budget meters stay at 0.
5. **CLI:** `python -m app.research.cli run --company meesho --mode replay --verbose` runs one company and streams the same events to the terminal.

---

## 13. Build phases (one implementation plan each)

| Phase | Delivers | Exit check |
|---|---|---|
| **1. Backbone** | Postgres migration (company columns, JD columns, `published_at` backfill); seeder fix; company CRUD; `research_*` collections; runner plus LangGraph graph with `resolve` and `write_draft` only; control (start, pause, resume, stop, budget); crash recovery; tracer, log handler and redaction; record/replay harness; CLI; API proxies and OpenAPI; Companies tab and **Runs debugger UI**. | A resolve-only run for 3 companies can be paused, resumed and stopped, and the full trace is visible and copyable. |
| **2. Profile, compensation and tier** | `profile`, `compensation`, `reconcile` (categorical, numeric and text merge), `tier`; drafts with diff; **review queue** with approve/reject/override for company fields; Postgres publish; student company cards. | Meesho approved, with its fields visible on `/jobs`. |
| **3. Roles and levels** | `LEVELS` extension across the three apps; new skeletons; `level_mappings` seed (human-reviewed); `roles` node; role publishing to `job_descriptions` and `company_role_configs`; exclude-role; student role rows with both titles. | TCS tracks appear as separate fresher roles; an Amazon-style ladder maps correctly. |
| **4. Interview process** | `interview_process` reusing the brief code plus user submissions; brief and question publishing on commit; retire the old `brief-generation` job, `/admin/scrape/*` and the LiveIngestion panel. | A booked session for a researched role gets its prep from the approved brief. |

---

## 14. Open items for human decision

1. **Prompt templates** (`app/prompts/research/*`): drafted in each phase for human review before production use.
2. **`level_mappings` seed list:** drafted in Phase 3 for review.
3. **Production Atlas tier:** the M0 free tier will not hold full-verbosity traces past about 50 companies (§4.3).
4. **Sector vocabulary** (§4.1): a proposed list, to be confirmed in Phase 2.
5. **Exa spend per run in production:** set `RESEARCH_MAX_EXA_CALLS` once Phase 2 shows real per-company call counts.
