# Question Set Collection — Design Spec

**Date:** 2026-06-23
**Status:** Approved (design), pending implementation plan
**Repos touched:** `interviewiq-ai-service` (primary), `interviewiq-backend` (BFF proxy for the trigger), `interviewIQ-frontend` (admin button)

---

## 1. Purpose & context

The interview-experience fetching pipeline is complete: it produces a per-`(company, role, level, specialization)` **brief** describing *which* rounds happen and *which* topics/problems show up. Briefs do **not** carry a bank of practice questions to actually ask a candidate.

This feature collects that bank. For the three interview rounds we run — **DSA**, **System Design**, **LLD** — it ingests questions from public sources, normalizes them into richly-tagged metadata records, and stores them in MongoDB. The live-interview module (later) will select from this bank using the brief's round/topic/company signals.

**Round types** reuse the existing `RoundType` values: `dsa`, `system-design`, `lld`.

### Sources

| Round | Sources |
|-------|---------|
| **DSA** | `snehasishroy/leetcode-companywise-interview-questions` (company-wise CSVs) + NeetCode 150 (curated list) + Kaggle LeetCode dataset (CSV) |
| **System Design** | `donnemartin/system-design-primer` + `karanpratapsingh/system-design` + `ashishps1/awesome-system-design-resources` + `InterviewReady/system-design-resources` |
| **LLD** | `prasadgujar/low-level-design-primer` + `prasadgujar/machine-coding-questions` + `tssovi/grokking-the-object-oriented-design-interview` |

---

## 2. Storage model — thin, copyright-safe

**Store metadata + a canonical URL only. The full problem statement is never stored** — it is fetched/linked live at interview time. This keeps the DB tiny and avoids storing copyrighted problem text (LeetCode etc.).

- Collection: `interview_questions` in the existing `interviewiq_intelligence` Mongo DB (Motor async, same as briefs).
- One flat `QuestionRecord` Pydantic model: shared core + optional per-round fields. Mongo is schemaless; no discriminated-union ceremony. `# ponytail: flat optionals over per-round subclasses; revisit only if validation pain is real.`

### Shared core fields

| Field | Type | Notes |
|-------|------|-------|
| `slug` | str | Canonical id. DSA = LeetCode slug; SD/LLD = `source-prefixed/slug` (e.g. `sdp/pastebin`, `lldp/bookmyshow`) |
| `round_type` | enum | `dsa` \| `system-design` \| `lld` |
| `title` | str | |
| `url` | str | Canonical source URL (leetcode.com for DSA, GitHub blob for SD/LLD) |
| `sources` | list[str] | A problem can come from several datasets; accumulates provenance (`snehasishroy`, `neetcode-150`, `kaggle-leetcode`, `system-design-primer`, `lld-primer`, …) |
| `difficulty` | enum | Normalized `easy` \| `medium` \| `hard` across all rounds (SD "junior/mid/senior" maps onto this) |
| `topic_tags` | list[str] | |
| `company_tags` | list[str] | Company slugs, matching backend `Company.slug` convention |
| `level_tags` | list[str] | `sde1`/`sde2`/… matching the level convention |
| `collection_version` | str | Mirrors `PIPELINE_VERSION`; bump forces re-collect/re-enrich |
| `last_synced` | datetime | |
| `enrichment_status` | enum | `raw` \| `enriched` \| `enrich_failed` |

### DSA extras
`acceptance_rate: float`, `frequency_score: float` (max across companies), `is_premium: bool`

### System-design extras
`category: str`, `components_tested: list[str]`, `estimated_duration_mins: int`, `is_classic: bool`, `solution_url: str`

### LLD extras
`domain: str`, `patterns_tested: list[str]`, `entities_involved: list[str]`, `is_machine_coding: bool`, `evaluation_mode: "working-code" | "discussion"`, `assess: list[str]` (rubric hints), `estimated_duration_mins: int`

**Upsert key:** `(round_type, slug)` → `replace_one(..., upsert=True)`, same pattern as `upsert_brief`. Bumping `collection_version` forces regeneration.

---

## 3. Ingestion architecture

New package `app/questions/`, mirroring `app/exa/` + `app/jobs/`:

```
app/questions/
  models.py                 # QuestionRecord Pydantic model
  collectors/
    dsa_snehasishroy.py     # company-folder CSV walk -> records
    dsa_neetcode.py         # NeetCode 150 list -> records
    dsa_kaggle.py           # Kaggle CSV -> records
    sd_repos.py             # system-design repos -> title/url/solution_url
    lld_repos.py            # LLD repos -> title/url (+ is_machine_coding)
  merge.py                  # DSA merge-by-slug across the 3 DSA sources
  enrich.py                 # LLM enrichment for SD/LLD
app/jobs/question_collection.py   # orchestrator (mirrors brief_generation.py)
app/questions_cli.py        # one-shot CLI (mirrors app/cli.py)
```

- `app/db/repositories.py` — add `upsert_question` + indexes on `(round_type, slug)` (unique) and `(round_type, company_tags)` (query).
- Each collector exposes `collect() -> list[QuestionRecord]` returning normalized, raw records.
- GitHub fetch via existing `httpx`: `raw.githubusercontent.com` for file bodies, GitHub contents API for directory listing (public, unauthenticated — fine at this volume).

### Orchestrator flow (`question_collection.py`)
1. Run DSA collectors → `merge.py` merges by slug (one record per problem, `sources` accumulates).
2. Run SD + LLD collectors → enumerate problems (title/url/solution_url, deterministic).
3. `enrich.py` runs one bounded-concurrency LLM pass per SD/LLD problem (fills tags/components/patterns/etc.).
4. `upsert_question` for every record; failures isolated per-record.

---

## 4. Per-source ingestion detail

### DSA — deterministic, zero LLM
- **snehasishroy**: walk company folders; parse the "All"-window CSV per company (columns: Difficulty, Title, Frequency, Acceptance %, Link). Derive the LeetCode slug from the Link. `company_tags` = folder name (slugified), `frequency_score` from Frequency, `acceptance_rate` from Acceptance.
- **NeetCode 150**: pull the curated list → `topic_tags` from its grouping. (Vendored list / community JSON mirror — see flag below.)
- **Kaggle LeetCode dataset**: CSV → `topic_tags`, `acceptance_rate`, `is_premium`, `difficulty`.
- **Merge by slug**: one record per problem; `sources` lists all datasets it appeared in; `company_tags` from snehasishroy; `topic_tags` union of NeetCode + Kaggle; `frequency_score`/`acceptance_rate` from whichever source has them.

### System Design — enumerate + LLM enrich
- donnemartin: `solutions/system_design/*/README.md` (~8 solved: pastebin, mint, twitter, web_crawler, query_cache, sales_rank, scaling_aws, social_graph) + the README's "system design interview questions with solutions" list.
- karanpratapsingh / ashishps1 / InterviewReady: enumerate classic problems listed in their READMEs.
- Deterministic extract: `title`, `url`, `solution_url`. LLM enrich fills `company_tags`, `level_tags`, `components_tested`, `category`, `estimated_duration_mins`, `is_classic`. ~25–35 problems total.

### LLD — enumerate + LLM enrich
- prasadgujar/low-level-design-primer: `solutions/*.md` per problem (BookMyShow, ParkingLot, ATM, …).
- prasadgujar/machine-coding-questions: problems here set `is_machine_coding = true`.
- tssovi/grokking-the-object-oriented-design-interview: problem set.
- Deterministic extract: `title`, `url`. LLM enrich fills `patterns_tested`, `entities_involved`, `domain`, `company_tags`, `level_tags`, `evaluation_mode`, `assess`, `estimated_duration_mins`, and confirms `is_machine_coding`. ~15–25 problems.

---

## 5. Enrichment (SD/LLD only)

One LLM call per SD/LLD problem (title + solution text → enrichment JSON), validated against the model. Bounded concurrency reusing the existing `EXTRACT_CONCURRENCY` discipline (~40 calls total — trivial cost), via the existing `LLMClient`. Failures recorded as `enrichment_status = enrich_failed` (record still stored raw) — no run abort. Mirrors the brief pipeline's per-source disposition handling.

A new prompt template under `app/prompts/` (e.g. `enrich_question.py`), versioned like the existing prompts.

---

## 6. Triggering — UI button next to the ingestion button

The collection run is triggered from the **admin intelligence console, by a button placed next to the existing scrape/ingestion run button**. Same BFF pattern the scrape button already uses:

```
[Admin UI button] -> backend IntelligenceController -> AiServiceClient -> ai-service /admin endpoint
                  <- status polling (run_store) <-
```

### ai-service
- `POST /admin/questions/collect` — async background collection run; returns immediately.
- `GET /admin/questions/status?after={seq}` — live run state + incremental logs, **reusing the existing `run_store`** (same mechanism as the scrape console).
- `python -m app.questions_cli` — one-shot collect-all for local/manual runs.
- **No APScheduler initially** — these repos change monthly at most; manual/admin trigger is enough. `# ponytail: add cadence only if staleness becomes a real problem.`

### backend (`interviewiq-backend`) — BFF proxy
- `IntelligenceController`: `POST /api/v1/intelligence/questions/collect`, `GET /api/v1/intelligence/questions/status` (ADMIN-gated, like the existing scrape proxies).
- `AiServiceClient`: add `triggerQuestionCollection()` and `getQuestionCollectionStatus(after)` (forward with `X-Internal-Api-Key`; return `Optional<JsonNode>`, never throw — same contract as the scrape methods).

### frontend (`interviewIQ-frontend`) — admin button
- A "Collect Questions" button next to the existing ingestion/scrape run button in the intelligence admin surface, wired to the new backend endpoints with the same status-polling UX the scrape button uses.

---

## 7. Serving (thin, this step)

A minimal read endpoint so the collected data is usable and testable:
- ai-service `GET /questions?round_type=&company=&difficulty=&limit=` (internal-key gated, like `/briefs`).

Full student-facing serving (backend BFF for the student app, live-session selection logic) is **out of scope here** — later modules.

---

## 8. Testing

pytest in the venv (`python -m pytest`), no live network/LLM calls (mock at the HTTP layer), matching existing test style:
- DSA CSV parsers → records; LeetCode-slug derivation from links.
- DSA merge-by-slug (provenance accumulation, tag union, frequency/acceptance precedence).
- SD/LLD markdown/tree enumeration → records.
- Enrich prompt rendering + JSON validation; `enrich_failed` path keeps the raw record.
- `upsert_question` keying and `collection_version` regeneration.

---

## 9. Out of scope / follow-ups

- Live-session question selection from the bank.
- Full backend BFF + Postgres mirror for student-facing question serving.
- APScheduler refresh cadence.
- The actual evaluation engine (we only store `is_machine_coding` + the lightweight `evaluation_mode`/`assess` rubric hints).

---

## 10. Flagged judgment calls (lazy-by-default, confirmed)

- **Kaggle CSV + NeetCode 150 vendored into the repo** rather than wiring their APIs (Kaggle needs auth; NeetCode has no official API). Re-vendor on `collection_version` bump.
- **No scheduler initially** — manual/admin trigger only.
