# Company Research — Evidence Hardening (amendment)

**Date:** 2026-10-03
**Status:** Design approved in chat, pending written-spec review
**Amends:** [2026-10-02-company-research-pipeline-design.md](2026-10-02-company-research-pipeline-design.md) (referred to below as "the main spec")
**Apps touched:** `apps/ai-service` (pipeline), `apps/api` (company-state passthrough), `apps/web` (coverage label), `packages/contracts/openapi.yaml`

---

## 1. Why

The 2026-10-02 Juspay run (`4fcdfec4`) found good sources: official careers pages, two first-hand LinkedIn interview write-ups, AmbitionBox and Tracxn. The LLM returned 71 claims, but grounding dropped 43, most of them correct. The draft ended with three roles and all 18 of their detail fields empty. The Frontend role vanished. Funding, business model and WLB were all empty.

A replay of the saved claims attributed the losses to:

| Cause | Drops |
|---|---|
| Role title required inside the same quote | 17 |
| India required from the LLM's own `geo` tag; "LPA" not accepted as an India signal | 9 |
| LLM shortened long passages, so quotes were no longer verbatim | 7 |
| Title variants: punctuation, dashes, job codes | 4 |
| Literal category matching ("Series D", "SaaS") | 3 |
| Numbers returned as strings | 1–3 |
| Title claim without `role_title` discarded | 1 |
| WLB required a literal "/5" | 1+ |

Search compounded this: a single query per section, and a per-role query that asked for salary, experience, JD and interview rounds at once, which returned unrelated LTIMindtree and Telegram pages.

Grounding also caught real LLM errors (WLB 3.9 and 3.6 reported where the sources say 3.7 and 3.3). The fix is to make the rules **correct**, not looser.

## 2. Goal and success criteria

Re-researching Juspay fills substantially more fields, and:
- every published value is still traceable to a verbatim quote;
- conflicting values are shown, never silently resolved;
- uncertain evidence is shown to the reviewer, never silently lost and never treated as verified;
- an LLM or Exa failure on one source or one optional section never loses the whole company;
- the draft says how complete it is.

## 3. Scope

**In:**
1. Source tiers and source types
2. Targeted multi-query search, plus a relevance filter
3. Per-claim validation with reason codes; uncertain claims routed to review
4. Weighted merge that keeps conflicting values (`alternatives`)
5. Pay observations
6. Official vs candidate-reported interview process
7. Partial-failure isolation
8. Bounded concurrency
9. Recency in confidence
10. New per-role fields: skills, tech stack, locations, employment type, job IDs
11. `funding_round`
12. Coverage check with targeted follow-up searches
13. The remaining Juspay grounding fixes

**Out:**
- Engineering-org research (Phase 2+).
- Promoting an `unverified` claim to verified. This needs the field-override editor (main spec §7), which isn't built.
- Levels for companies whose titles carry no level (Phase 3 `level_mappings`).
- Publishing roles to Postgres (unchanged: roles stay in the approved snapshot).
- An LLM-planned query set.
- pgvector.

**Decisions locked in chat (2026-10-03):**

| Topic | Decision |
|---|---|
| Structure | Extend the existing nodes. New deterministic rules live in pure modules (`normalize/sources.py`, `normalize/titles.py`, `normalize/merge.py`, `fields.py`). A later `reconcile` node can call the same functions. |
| A bare "20 LPA" | **Counts as total CTC.** Confidence is capped at `low`, with a note. |
| Conflicts | Kept in the snapshot as `alternatives` on the Field. |
| Extra grounding fixes | All in: category mapping, WLB adjacency, quote fragments. |
| Verification | Run the research pytest suite and an offline replay of the saved Juspay claims. |

## 4. Module map

```
app/research/
  fields.py               FIELD_SPECS: one table of field rules → prompt field docs + validation
  concurrency.py          gather_ordered(): TaskGroup fan-out, results in input order, real error re-raised
  coverage.py             tracked paths, coverage(snapshot), missing-field → follow-up query plan
  normalize/sources.py    classify_source(), is_relevant(), india signals, domain lists
  normalize/titles.py     title_key(), normalized text + role-section resolution, job IDs
  normalize/merge.py      weighted vote, alternatives, as_of, confidence, lists, pay observations
  nodes/evidence.py       research(): search → relevance → extract → ground → ResearchOutcome
  nodes/{profile,compensation,roles}.py   use the above; follow-up round; notes
  graph.py                optional-node degrade policy
  gateway.py              include_domains, semaphores, per-claim validation, one repair re-ask
app/prompts/research/     v2-draft templates; QUERIES lists; system prompt renders FIELD_SPECS
```

## 5. Sources: tiers, types, relevance

### 5.1 Classification (`normalize/sources.py`, pure)

`classify_source(url, company_domain, company_slug) -> {source_type, tier}`

| Tier | `source_type` | Rule |
|---|---|---|
| 1 | `official` | The host is the company's resolved domain or a subdomain of it. |
| 1 | `official_job_posting` | An applicant-tracking host (`lever.co`, `greenhouse.io`, `ashbyhq.com`, `myworkdayjobs.com`, `darwinbox.in`, `keka.com`, `smartrecruiters.com`) whose subdomain or path contains the company slug. |
| 2 | `business_database` | `tracxn.com`, `crunchbase.com`, `pitchbook.com`, `cbinsights.com`, `tofler.in`, `zaubacorp.com`, `multiples.vc` |
| 2 | `news` | `inc42.com`, `entrackr.com`, `economictimes.indiatimes.com`, `livemint.com`, `moneycontrol.com`, `business-standard.com`, `financialexpress.com`, `thehindubusinessline.com`, `yourstory.com`, `techcrunch.com`, `reuters.com`, `bloomberg.com` |
| 2 | `review_platform` | `ambitionbox.com`, `glassdoor.com`, `glassdoor.co.in`, `indeed.com` (incl. `in.indeed.com`), `teamblind.com` |
| 2 | `salary_platform` | `levels.fyi`, `6figr.com`, `naukri.com` |
| 3 | `community` | `linkedin.com`, `reddit.com`, `medium.com`, `geeksforgeeks.org`, `leetcode.com`, `quora.com`, `dev.to`, `hashnode.dev`, `substack.com`, `blogspot.com`, `t.me` |
| 3 | `job_repost` | `tnpofficer.com`, `jobdexo.com`, `freshersworld.com`, `desiqna.in`, `offcampusjobs4u.com`, `foundit.in` |
| 3 | `other` | Anything unlisted. |

The lists live in one module-level config, so they can be edited in one place. Matching is by host suffix, so subdomains match.

Each claim carries `tier`, `source_type` and `date`. `research_sources` also stores `source_type` and `tier` (as last classified).

### 5.2 India signals

A claim in an India-only field passes the geography check when the quote has no foreign signal (the existing `FOREIGN` regex: USD, EUR, GBP, $, €, £, foreign cities) and **any** of these holds:
1. The LLM tagged `geo=IN` and the geo quote, or the quote itself, names an Indian place. This is the current rule.
2. The quote contains an INR marker: `₹`, `INR`, `Rs.`, `LPA`, `lakh`, `lac`, `crore`.
3. The source is on an India platform: the host ends with `.in`, or is `ambitionbox.com`, `naukri.com`, `in.indeed.com`, `glassdoor.co.in`, `6figr.com`, or one of the Indian news hosts above.
4. The source is tier 1 and its text names an Indian city.

With none of these and no foreign signal, the claim is **uncertain** (`geo_unconfirmed`) and goes to `unverified` (§7.3). With a foreign signal it is dropped (`foreign_geo`).

### 5.3 Relevance filter (before any LLM call)

`is_relevant(source, names)`, where `names` = the admin-entered name, the resolved canonical name and the aliases. A source is extracted only if:
- it is tier 1; or
- a name appears in the page title (word-boundary, case-insensitive); or
- names appear at least 3 times in the first 2,000 characters of the text.

Otherwise it is skipped with reason `irrelevant_source`. The skip is counted in the node's validation summary and logged, but not added to `unverified`.

On the Juspay sources, this skips both LTIMindtree pages and the Telegram page and keeps every useful source.

## 6. Search

Each prompt module replaces `QUERY_TEMPLATE` with `QUERIES: tuple[Query, ...]`, where `Query = (template, include)` and `include` is `None`, `"company_domain"` or a tuple of domains.

`ResearchIO.search(..., include_domains=...)` passes the list to Exa. The fixture/request key includes `include_domains` **only when non-empty**, so existing fixtures keep their identity. A `"company_domain"` query is skipped when `identity.website` has no value.

| Section | Queries |
|---|---|
| profile | `{name} company overview products business model` · `{name} employees headcount revenue funding valuation` · `{name} about us` (company domain) |
| culture (the `compensation` node) | `{name} India employee reviews work life balance rating` · `{name} reviews work life balance` (`ambitionbox.com`, `glassdoor.co.in`, `in.indeed.com`) |
| role discovery | `{name} careers software engineer jobs` (company domain) · `{name} India software engineer jobs job description` |
| per role | `"{name}" "{title}" job description skills experience` · `"{name}" "{title}" salary CTC LPA India` · `"{name}" "{title}" interview experience rounds questions` |

- URLs are de-duplicated across one node's queries.
- In the per-role pass, a URL already extracted during discovery for this company is **not** extracted again; its discovery claims are reused through role-section assignment (§8.2).

## 7. Field rules, extraction and grounding

### 7.1 `FIELD_SPECS` (`app/research/fields.py`)

One table drives both the prompt's field documentation and validation, so they cannot drift apart. Per field, it records:
- `kind`: `text | number | category | item`
- `section`
- `india_only`
- `allowed` values (categories)
- `max_len`
- `time_sensitive`
- `doc`, the one-line instruction rendered into the prompt

| Section | Fields |
|---|---|
| profile | `sector`·cat, `business_model`·cat, `hq`·text≤255, `headcount_band`·text≤32, `revenue_band`·text≤32, `funding_stage`·cat, **`funding_round`**·text≤32 |
| culture | `wlb_rating`·num, `wlb_review_count`·num, `review_summary`·text, `review_quote`·text≤300 |
| roles | `title`·text, **`employment_type`**·cat(`full_time, intern, contract`), `level`·cat, `specialization`·text, `yoe_min`·num, `yoe_max`·num, **`required_skill`**·item≤64, **`preferred_skill`**·item≤64, **`tech_stack`**·item≤64, **`location`**·item, `ctc_min_lpa`·num, `ctc_max_lpa`·num, `jd`·text, `interview_process`·text |

`time_sensitive`: `headcount_band`, `revenue_band`, `funding_stage`, `funding_round`, `wlb_*`, `ctc_*`, `interview_process`.

### 7.2 Extraction (gateway)

- **Per-claim validation.** The response envelope is `{"claims": [...]}`. Each claim is validated on its own; an invalid claim is dropped with reason `schema_invalid`, and the rest are kept. Previously one bad claim invalidated the whole source.
- **One repair re-ask** when the envelope itself is invalid (not an object, or `claims` not a list). It follows the pattern in `app/llm/structured.py`. If it is still invalid, the source fails extraction with a pydantic `ValidationError` (§10). Only envelope-valid output is cached.
- **Safe number parsing** for `number` fields: `"20"` → 20.0. `"16+"` → 16.0, but only for `*_min` fields. A trailing `+` on `*_max`, and any other string, is `schema_invalid`.
- **Prompt v2** (`v2-draft`, DRAFT for human review):
  - The system prompt is the base rules plus field docs rendered from `FIELD_SPECS`.
  - `item` fields: one claim per skill, technology or city.
  - Quote fragments: a long passage may skip irrelevant sentences, marking each gap with ` … `, and every piece must be copied exactly.
  - `role_title`: the role the passage is about, as printed in the page title, heading or table, or null.
  - `funding_round`: the raw round as printed ("Series D").
  - `employment_type`: only when the source states it.

### 7.3 Grounding and reason codes

`_ground` returns `(claim | None, reason)`. Reasons are **hard** (dropped) or **soft** (routed to `unverified`).

| Hard (dropped) | Soft (→ `unverified`) |
|---|---|
| `schema_invalid`, `field_not_allowed`, `quote_not_verbatim`, `value_not_supported`, `category_invalid`, `category_signal_missing`, `foreign_geo`, `ctc_not_total`, `ctc_estimate`, `ctc_unit_missing`, `rating_scale_missing`, `rating_not_adjacent`, `count_not_wlb`, `out_of_range`, `too_long` | `geo_unconfirmed`, `role_not_in_context`, `role_mismatch` |

**Rules that change:**
- **Verbatim, fragment-aware.** `verbatim(passage, text)`: split on `…`, `...` or `[...]`. There may be at most 8 pieces, each at least 20 cleaned characters, and each must be found in the cleaned text at increasing positions. A passage without separators is the old substring check. This applies to quotes and to `text` values (a text value is checked against the source text, not only the quote).
- **Categories.** A deterministic mapping runs before the allowed-value check:
  - `funding_round` → `funding_stage`: `seed`, `pre-seed`, `angel`, `series a` → `early`; `series b`, `series c` → `growth`; `series d` and later, `pre-ipo` → `late-stage`.
  - Direct `funding_stage` signals: `ipo`, `listed`, `nse`, `bse`, `nasdaq`, `nyse` → `public`; `acquired`, `subsidiary of` → `subsidiary`; `bootstrapped` → `bootstrapped`.
  - `business_model` product signals add `saas`, `platform`, `software-as-a-service`.
  - A mapped stage gets provenance `derived` and the note `mapped from "<round>"`.
- **WLB rating:**
  - *Scale:* the quote states a 5-point scale ("/5", "out of 5", "5-point"), **or** the source is a `review_platform` (all use 5-point scales).
  - *Adjacency:* find each work-life-balance label in the quote. If a number directly follows a label (only whitespace, `#`, `*`, `:`, `|` or dashes between), the accepted numbers are those. Otherwise, the accepted numbers are those directly preceding a label. The value must be an accepted number. On the AmbitionBox text this accepts 3.3 and rejects 3.6.
- **CTC:**
  - *Evidence:* a quote with `CTC` or `total compensation` gives basis `total_ctc`. A quote with an `LPA` unit but neither phrase gives basis `lpa_unspecified`, which still counts as total CTC (decision), but is marked.
  - *Rejected:* `ctc_not_total` when the quote mentions base, fixed, stipend, in-hand or take-home pay and not CTC; `ctc_estimate` stays as today.
  - *Unit rules:* unchanged.
- **Role context** moves out of `_ground` and into role-section resolution (§8.2).

**Validation summary.** Each `research()` call emits one `log` event at info level: `"<kind>: kept N, unverified U, dropped D (reason counts…)"`, with the counts in `data`. Every dropped or unverified claim still emits its debug event, now with `reason`.

### 7.4 `unverified`

Each entry is `{field, value, quote (≤500 chars), url, source_name, date, tier, reason, role_title}`.
- Up to 20 per section (`profile.unverified`, `compensation.unverified`) and 10 per role (`roles[i].unverified`), keeping the highest tier first, then the newest.
- **Never** published, never counted in coverage or confidence, and excluded from `snapshot_diff`.
- They are only shown to the reviewer.

## 8. Roles

### 8.1 Identity

- `title_key(title)`:
  - NFKD fold, casefold;
  - remove job codes in brackets, e.g. `(DEV-BE01)`;
  - turn dashes and punctuation into spaces;
  - map a trailing or standalone Roman numeral `i/ii/iii/iv` to `1/2/3/4`;
  - collapse whitespace.

  It never expands abbreviations ("SDE" ≠ "Software Development Engineer"), and different numbers stay different.
- **Role identity** is `(title_key, employment_type)`.
  - `employment_type` comes from an `employment_type` claim (signal-checked: `intern(ship)`, `full[- ]time`, `contract`), or `intern` when the title contains "intern".
  - Evidence with an unknown employment type attaches to the `full_time` variant if it exists, otherwise to the single variant.
- **Job IDs** are derived without an LLM, from:
  - a URL's last path segment matching letters, a dash, then alphanumerics that include a digit (e.g. `DEV-BE01`);
  - IDs in brackets in titles.

  They're stored as `job_ids` (a Field with a list value) and used as role aliases.
- **Title claims** with no `role_title` take their own value as the role title.
- **Display title:** the raw variant from the highest-tier, then newest, source.
- **`role_key`:** unchanged, except that `-intern` or `-contract` is appended for those employment types (full-time keys stay stable).
- **Rank and cap:** roles are ranked by tier-weighted domain support and capped at `RESEARCH_MAX_ROLES`; omitted roles go into notes as today. Manager, director and VP titles stay excluded.

### 8.2 Role-section resolution (replaces "title must be in the quote")

A claim with a role belongs to role R on source S when the first of these applies:
1. R's title key occurs in the normalized quote plus geo quote.
2. S's page title contains R's key and no other known title key. This is the single-role page case.
3. In S's normalized text, the nearest known title key **before** the quote's first piece is R's. This is the same-section case for pages listing several roles.

"Known titles" are the titles discovered for the company plus the title claims made on S. If none of these applies, the claim gets reason `role_not_in_context` and goes to `unverified`.

In the per-role pass, a claim naming a different known role gets `role_mismatch` and goes to that role's `unverified`.

### 8.3 Row fields

| Field | Built from |
|---|---|
| `title`, `level`, `specialization`, `yoe_min`, `yoe_max`, `employment_type` | `choose` (§9) |
| `job_ids` | derived (§8.1) |
| `required_skills`, `preferred_skills`, `tech_stack` | List merge (§9.3). |
| `locations` | List merge (§9.3), Indian cities only, normalized names (Bengaluru, Gurugram, Mumbai, …). |
| `ctc_observations` | One record per grounded quote: `{min_lpa, max_lpa, basis, source_url, source_name, tier, date}`. Min and max pair within the same quote; a lone figure fills both. |
| `ctc_min_lpa`, `ctc_max_lpa`, `ctc_source_count` | Median of observation mins and maxes. With 4 or more observations, IQR outliers are removed first. If any observation used is `lpa_unspecified`, confidence is capped at `low` with the note "includes LPA figures not explicitly labelled total CTC". Reversed ranges are rejected as today. |
| `jd` | Extractive: up to 3 distinct passages, tier 1 first. |
| `interview_process` | Extractive, **tier-1 sources only** (official). |
| `reported_interview_process` | Up to 5 passages from tier 2/3: `{text, evidence_type, source_url, source_name, date}`, newest first, undated last. `evidence_type` is `candidate_report` for `community` and `review_platform`, otherwise `secondhand`. |
| `unverified` | §7.4 |

## 9. Merge (`normalize/merge.py`, pure)

### 9.1 Weighted vote

- **Weight per claim:** tier weight (1 → 3, 2 → 2, 3 → 1), multiplied by 0.5 when the claim is dated more than `RECENCY_YEARS = 2` years before now. Undated claims are never down-weighted.
- **Vote key per field:**
  - `hq`: the first recognized Indian city, normalized (Bangalore ≡ Bengaluru, Gurgaon ≡ Gurugram, Bombay ≡ Mumbai), otherwise the cleaned value;
  - text: the cleaned value;
  - numbers: the value.
- **One vote per (domain, key),** at the maximum weight among that domain's claims.
- **Winner:** the highest total weight. Ties break deterministically: more domains, then newer `as_of`, then the lower key. The representative raw value comes from the winner's highest-tier, newest claim.
- **`alternatives`:** every other key, highest weight first, at most 5, each as `{value, source_urls, as_of}`.

### 9.2 Confidence, `as_of`, recency

- `as_of`: the newest date among the winner's claims (ISO date), or null.
- Confidence (main spec §6.2, with tiers):
  - `alternatives` non-empty → `low`, note "Sources disagree; highest-weighted value shown, alternatives listed";
  - otherwise, 3+ agreeing domains and `as_of` within 2 years → `high`;
  - otherwise, 2+ domains, or any tier-1 source → `medium`;
  - otherwise → `low`.
- **Outdated:** for a `time_sensitive` field whose supporting claims are all dated and the newest is more than 2 years old, confidence is `low` with the note "Newest evidence from YYYY".

Field status is then readable without a new key:

| Field state | Meaning |
|---|---|
| `evidence`, no alternatives | supported |
| alternatives present | contradicted |
| `unavailable` | insufficient |
| the "newest evidence" note | outdated |

### 9.3 Lists (skills, tech, locations)

- **Item key:** casefold, trimmed punctuation, plus a small alias map: `golang→go`, `k8s→kubernetes`, `postgres→postgresql`, `js→javascript`, `ts→typescript`, `reactjs/react.js→react`, `nodejs→node.js`.
- **Order:** by summed weight, highest first; at most 15 items.
- **Display value:** the most common raw spelling.
- **Confidence:** `medium` if any tier-1 source or 2+ domains, else `low`. No `alternatives` for lists.

### 9.4 Field shape

`field()` gains `alternatives` (default `[]`) and `as_of` (default `None`). Both are always emitted in new drafts.

`snapshot_diff` keeps comparing values only, and ignores `unverified`.

## 10. Failure isolation

**Inside `research()`:**
- An Exa query failing with `ExaError` (but not `ExaConfigError`) is skipped and recorded.
- A source failing extraction (an `LLMError`, or an envelope still invalid after the repair re-ask) is skipped and recorded.
- If **every** query failed, or **every** relevant source failed, the last error is raised.
- Otherwise the node adds a note: `"<section>: N of M sources could not be extracted (<ErrorType>)"`.

`research()` returns `ResearchOutcome(claims, unverified, failures, stats)`.

**Optional nodes (`profile`, `compensation`):**
- Their graph wrapper does its own retry: 3 attempts, backoff from `retry_initial_interval` doubling each time, for transient errors per `is_transient`. These nodes have no LangGraph `RetryPolicy`.
- If they still fail with a **degradable** error (`LLMError`, `ExaError` other than config, `httpx.TransportError`, pydantic `ValidationError`):
  - the node returns its section with every field `unavailable(note="Research failed: <Type>: <message ≤200>")`;
  - a note is appended;
  - the node's status is set to `error`;
  - the graph continues, and the item ends `done` with a draft.
- **Never degraded:** `BudgetExhausted` (auto-pause), `CancelledError` (pause/stop), `FixtureMissing` (replay must fail loudly), `ExaConfigError`, and any other exception (a bug).

**Required nodes** (`resolve`, `roles`, `write_draft`) are unchanged. Inside `roles`, a failure in one role's detail research marks only that role's detail fields `unavailable` with the error note.

Nodes append to `notes` by copying the existing list (no reducer), as `roles` already does.

## 11. Concurrency

- `ResearchIO` holds two run-wide semaphores: `RESEARCH_EXA_CONCURRENCY` (default 2) and `RESEARCH_LLM_CONCURRENCY` (default 4). They wrap only real external calls; cache hits and replay reads skip them. The budget is charged **inside** the semaphore, so a call cancelled while waiting is never charged.
- `gather_ordered(coros)` in `concurrency.py`:
  - runs the coroutines in an `asyncio.TaskGroup` and returns results in input order;
  - on failure, unwraps the `ExceptionGroup` and re-raises the first non-cancellation error unchanged, so the runner still sees `BudgetExhausted`;
  - sibling tasks are cancelled.
- Nodes fan out over sources and over roles with it. Drafts stay deterministic: inputs are ordered, merge is order-independent, and ties break deterministically.

## 12. Coverage and follow-up searches

**Tracked paths** (`coverage.py`):
- `profile.{sector, business_model, hq, headcount_band, revenue_band, funding_stage}`
- `compensation.{wlb_rating, review_summary}`
- per role: `yoe_min`, `jd`, `required_skills`, `ctc_min_lpa`, and `interview` (satisfied by `interview_process` **or** `reported_interview_process`)

That makes `total = 8 + 5 × roles`. A path is filled when its provenance is not `unavailable`.

**Follow-up round:** after its main pass, each node computes its missing tracked paths and runs **one** round of targeted queries, then rebuilds the section. The per-company cap is `RESEARCH_FOLLOWUP_MAX_QUERIES` (default 6), tracked in graph state as `followups_used`: profile may use up to 2, compensation up to 1, and roles the rest.

| Missing | Query |
|---|---|
| `headcount_band` | `{name} number of employees` |
| `revenue_band` | `{name} revenue FY crore` |
| `funding_stage` | `{name} funding round series valuation` |
| `sector`, `business_model` or `hq` | `{name} company profile` (one query) |
| `wlb_rating` or `review_summary` | `{name} work life balance rating` (`ambitionbox.com`, `glassdoor.co.in`) |
| role `yoe_min`, `jd` or `required_skills` | `"{name}" "{title}" job requirements experience` |
| role `ctc_min_lpa` | `"{name}" "{title}" salary` (`ambitionbox.com`, `glassdoor.co.in`, `levels.fyi`, `6figr.com`, `linkedin.com`) |
| role `interview` | `{name} {title} interview experience` (`geeksforgeeks.org`, `leetcode.com`, `glassdoor.co.in`, `ambitionbox.com`, `medium.com`, `linkedin.com`) |

Role follow-ups go in role-rank order. Follow-up results go through the same `research()` path, relevance filter and grounding.

**Reporting:**
- `write_draft` computes `coverage(snapshot) → {filled, total, missing[]}`.
- It stores `coverage` on the draft and on the item, and `{filled, total}` as `company_research_state.latest_draft_coverage`.
- A coverage of less than 100% is a **partial** result.

## 13. Contract and UI

**Snapshot (`company_drafts.snapshot`)**
- Every Field gains `alternatives` and `as_of`.
- `profile` gains `funding_round` and `unverified`.
- `compensation` gains `unverified`.
- Each role gains `employment_type`, `job_ids`, `required_skills`, `preferred_skills`, `tech_stack`, `locations`, `ctc_observations`, `reported_interview_process` and `unverified`.

**Draft:** gains `coverage`.

**OpenAPI** (`packages/contracts/openapi.yaml`)
- `DraftField`: optional `alternatives` (array of `{value, source_urls, as_of}`) and `as_of`.
- New `UnverifiedClaim` schema.
- `DraftProfile`: + `funding_round`, `unverified`.
- `DraftCompensation`: + `unverified`.
- `DraftRole`: + the new fields, **all optional**, so old drafts stay valid.
- `CompanyDraft`: + optional `coverage {filled, total, missing[]}`.
- `CompanyResearchState`: + optional `latestDraftCoverage {filled, total}`.
- Web types are regenerated with `scripts/generate-types.ts` (required by CLAUDE.md after a contract change).

**API**
- `routes/admin.ts` passes `latest_draft_coverage` through as `latestDraftCoverage`.
- `companyDraftPublication.ts` is unchanged: zod strips unknown keys, and roles aren't published.

**Web**
- `DraftResearchReport` header: a `Coverage` readout, e.g. `18/34`, labelled "partial" when below 100%.
- Companies tab: when a draft is awaiting review and coverage is below 100%, the status label reads e.g. "Awaiting review · partial 18/34". This is a `companyStatusLabel()` helper in `features/research/status.ts`.
- Everything else renders through the existing generic snapshot renderer.

**Versions:** `PIPELINE_VERSION = "research-v3"`. Research prompts move to `v2-draft`. The new prompt versions cause a one-time re-extraction of every source.

## 14. Configuration (ai-service)

| Variable | Default | Purpose |
|---|---|---|
| `RESEARCH_EXA_CONCURRENCY` | 2 | Run-wide concurrent Exa calls. |
| `RESEARCH_LLM_CONCURRENCY` | 4 | Run-wide concurrent LLM calls. |
| `RESEARCH_FOLLOWUP_MAX_QUERIES` | 6 | Follow-up searches per company. |

Recency years, tier weights, domain lists, alias maps and follow-up templates are module constants, not env vars.

**Cost:** about 20 Exa and 100 LLM calls per Juspay-sized company, plus up to 6 Exa and about 30 LLM calls in follow-ups. The relevance filter saves part of that. Run caps (400 / 2000) are unchanged, which allows about 15 companies per run.

## 15. Testing and verification

**New pytest modules** under `tests/research/`:

| Module | Covers |
|---|---|
| `test_sources.py` | Tier/type classification, ATS slug rule, India signals, relevance filter on the Juspay URLs. |
| `test_titles.py` | `title_key` variants (Juspay dash and job-code cases; II ≡ 2; intern kept distinct; SDE ≠ Software Development Engineer), job-ID derivation, role-section resolution on single- and multi-role pages. |
| `test_grounding_v2.py` | Each reason code; fragments; number parsing; category mapping incl. Series D; WLB adjacency (3.3 kept, 3.6 rejected on the AmbitionBox text) and platform scale; bare LPA → `lpa_unspecified`; base/stipend rejection. |
| `test_merge.py` | Weighted vote and tier dominance; alternatives; recency down-weight; confidence rules; outdated note; HQ city equivalence; lists; pay observations, median and IQR; the `lpa_unspecified` cap. |
| `test_failure_isolation.py` | One source fails and the others survive; all fail and the node raises; optional node degrades to an `unavailable` section plus a note with the item still done; budget, cancellation and fixture-missing still propagate; required-node failure is unchanged. |
| `test_concurrency.py` | Semaphores bound in-flight calls; results stay in order; the ExceptionGroup is unwrapped. |
| `test_coverage.py` | Coverage counts; follow-up planning and caps; draft and state fields. |

Existing tests are updated for the new query templates (fake routing) and node outputs. `test_optional_node_does_not_turn_errors_or_cancellation_into_success` stays valid: node functions still raise, and only the graph wrapper degrades.

**Verification (approved):**
1. Run the research pytest suite.
2. Offline replay: run the saved Juspay LLM outputs from run `4fcdfec4` through the new grounding, role resolution and merge, and report kept / unverified / dropped versus before. The saved outputs came from the v1 prompt, so this does not exercise new queries, new fields or follow-ups. A live run is needed for those.

## 16. Open items for human decision

1. **Prompt templates v2-draft** (product IP): review before production use.
2. **Domain lists and tiers** (§5.1), the **alias maps** (§9.3) and the **follow-up templates** (§12): review.
3. **Promoting `unverified` claims** needs the override editor (main spec §7).
4. **Levels for companies whose titles carry no level** (Phase 3).
