# Research Evidence Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Per the user's instruction ("implement"), this plan is executed natively in the authoring session, without a separate plan-review stop. Code lives in the repo, not duplicated here; this plan fixes the task order, files, interfaces and tests.

**Goal:** Make company research keep correct evidence, show conflicts and uncertain claims, survive partial failures, and report coverage. Juspay is the reference case.

**Architecture:** Extend the existing nodes (`profile`, `compensation`, `roles`) and move the deterministic rules into pure modules: `fields.py`, `normalize/sources.py`, `normalize/titles.py`, `normalize/merge.py`, `coverage.py`, `concurrency.py`. `ResearchIO` remains the only I/O boundary. The graph wrapper gets an optional-node degrade policy.

**Tech Stack:** Python 3.12, LangGraph 1.2, pydantic v2, pytest. OpenAPI 3 plus `scripts/generate-types.ts`. Next.js/React (2 small edits). Express/TS (1 passthrough).

**Spec:** `docs/superpowers/specs/2026-10-03-research-evidence-hardening-design.md`

## Global Constraints

- **No new runtime dependency** (Python or JS).
- **Nothing is committed.** The user commits.
- **Tests:** test files may be written and updated freely. Only the research pytest suite is run, and only for verification, which the user approved. No vitest, tsc or eslint runs.
- **User-facing copy** says "resume", never "résumé". It frames readiness, never endorsement.
- **Hard rule:** CTC, WLB and tier are never inferred. With no evidence they are `unavailable`.
- **Versions:** `PIPELINE_VERSION = "research-v3"`; research prompts are `PROMPT_VERSION = "v2-draft"`, marked DRAFT.
- **Contract:** new OpenAPI properties are optional, so stored drafts stay valid.
- **Python test helpers** default `research_followup_max_queries=0`. Tests that exercise follow-ups enable it explicitly.

## Review Focus

1. **A role is discovered only from a LinkedIn or interview-experience post title**, e.g. "My Juspay Interview Experience – …". It must not become a role. Discovery needs at least one non-community source, a title ≤ 80 chars, and no "interview experience" text. Test: `test_roles_v2.py::test_community_post_title_does_not_create_a_role`.
2. **A careers listing page with several roles:** a passage under role B must not be attributed to role A. Test: `test_titles.py::test_nearest_preceding_title_wins_on_multi_role_page`.
3. **Every source for a section is irrelevant or fails:** the section is cleanly `unavailable` with no LLM calls, or the node raises (all failed). It must never silently claim success. Test: `test_failure_isolation.py::test_all_sources_failing_raises_last_error`.
4. **Replay determinism under concurrency:** replaying a recorded run gives an identical snapshot. Test: the existing `test_expanded_record_replay_is_identical_free_and_extracts_cache_across_runs`, kept passing.
5. **A budget exhausted while extracting several sources in parallel:** the runner still auto-pauses (`BudgetExhausted`, not `ExceptionGroup`). Test: `test_concurrency.py::test_gather_ordered_reraises_budget_exhausted_unwrapped`.

---

### Task 1: Field shape, config, version, test defaults

**Files:**
- Modify: `apps/ai-service/app/research/models.py` (`field()`, `PIPELINE_VERSION`)
- Modify: `apps/ai-service/app/config.py` (3 knobs)
- Modify: `apps/ai-service/.env.example`
- Modify: `apps/ai-service/tests/research/helpers.py` (`research_settings` follow-up default 0)
- Modify: `apps/ai-service/tests/research/test_models.py`, `tests/research/test_nodes.py` (exact Field dicts)

**Interfaces:**
- Produces:
  - `field(value, *, confidence, provenance, source_urls=(), note=None, alternatives=None, as_of=None) -> dict`, which always has the keys `value, confidence, provenance, source_urls, note, alternatives, as_of`.
  - `Settings.research_exa_concurrency: int = 2` (`RESEARCH_EXA_CONCURRENCY`).
  - `Settings.research_llm_concurrency: int = 4` (`RESEARCH_LLM_CONCURRENCY`).
  - `Settings.research_followup_max_queries: int = 6` (`RESEARCH_FOLLOWUP_MAX_QUERIES`).

- [ ] Update `field()` and the version. Add the settings and the `.env.example` lines.
- [ ] Update the exact-dict assertions in `test_models.py::test_field_shape` and `test_nodes.py` (resolve) to include `"alternatives": [], "as_of": None`.

### Task 2: `fields.py` (FIELD_SPECS) + prompts v2

**Files:**
- Create: `apps/ai-service/app/research/fields.py`
- Modify: `apps/ai-service/app/prompts/research/evidence.py`, `company_profile.py`, `company_compensation.py`, `company_roles.py`

**Interfaces:**
- Produces:
  - `FieldSpec(name, section, kind: "text"|"number"|"category"|"item", doc, india_only=False, allowed=frozenset(), max_len=None, time_sensitive=False)`
  - `FIELD_SPECS: dict[str, FieldSpec]`
  - `fields_for(section) -> tuple[str, ...]`
  - `NUMERIC: frozenset[str]`
  - `TIME_SENSITIVE: frozenset[str]`
  - `render_field_docs(names) -> str`
  - prompts: `evidence.system_for(fields) -> str`, `evidence.build_user(...)` (unchanged signature), `Query = tuple[str, str | tuple[str, ...] | None]`
  - Each module exports `PROMPT_NAME`, `PROMPT_VERSION = "v2-draft"`, `FIELDS`, `SYSTEM`, `QUERIES: tuple[Query, ...]`, `FOLLOWUPS: dict[str, Query]`.
  - `company_roles` additionally exports `DETAIL_QUERIES` (templates with `{title}`) and `ROLE_FOLLOWUPS`.

- [ ] Write `FIELD_SPECS` per spec §7.1. India-only: culture and roles sections. `time_sensitive` per §7.1.
- [ ] Rewrite the system prompt as base rules plus rendered field docs. Base rules must cover: quote fragments with ` … `; `role_title` from the heading/table; item fields one per claim; `funding_round` raw; bare LPA allowed, base/stipend/in-hand pay never. Keep the UNTRUSTED-DATA paragraph verbatim; a test asserts it.
- [ ] Write `QUERIES`, `DETAIL_QUERIES` and `FOLLOWUPS` per spec §6 and §12.

### Task 3: `normalize/sources.py`

**Files:**
- Create: `apps/ai-service/app/research/normalize/sources.py`
- Test: `apps/ai-service/tests/research/test_sources.py`

**Interfaces:**
- Produces:
  - `SourceClass(source_type: str, tier: int)` (frozen dataclass)
  - `classify_source(url, *, company_domain: str | None, company_slug: str | None) -> SourceClass`
  - `INDIA`, `FOREIGN` (regexes, moved from `nodes/evidence.py`)
  - `has_inr_marker(text) -> bool`
  - `is_india_platform(url) -> bool`
  - `india_signal(*, geo, geo_quote, quote, url, tier, text) -> "india"|"foreign"|"unknown"` (the caller has already verified the `geo_quote` text)
  - `canonical_city(text) -> str | None` (Bengaluru/Gurugram/Mumbai/…)
  - `is_relevant(source: dict, names: list[str], *, tier: int) -> bool`
  - `FIVE_POINT_TYPES = {"review_platform"}`

- [ ] Write tests:
  - the Juspay URL tiers (`juspay.io/careers/DEV-BE01` → 1 official; tracxn → 2 business_database; ambitionbox → 2 review_platform; linkedin → 3 community; jobdexo → 3 job_repost; unknown → 3 other);
  - the ATS slug rule;
  - INR markers;
  - India platform;
  - `india_signal` for: "(20 LPA)" → india; "3.7 Work Life Balance" on teamblind → unknown; "USD 120k" → foreign;
  - the relevance filter on the desiqna-like text (0 mentions in the head and a title without the name → False), on a tier-1 page → True, and with the name in the title → True;
  - `canonical_city("Bangalore, India") == "Bengaluru"`.
- [ ] Implement the module.

### Task 4: `normalize/titles.py`

**Files:**
- Create: `apps/ai-service/app/research/normalize/titles.py`
- Test: `apps/ai-service/tests/research/test_titles.py`

**Interfaces:**
- Produces:
  - `norm_text(text) -> str`: ASCII fold, lowercase; non-alphanumerics → space; standalone `i/ii/iii/iv` → `1/2/3/4`; collapse spaces.
  - `title_key(title) -> str`: removes job codes in brackets, then `norm_text`.
  - `job_ids(urls, titles) -> list[str]`
  - `employment_from_title(title) -> str | None`
  - `contains_key(norm_haystack, key) -> bool` (word-boundary)
  - `role_in_context(key, *, quote, geo_quote, page_title, text, known_keys) -> bool`
  - `infer_role(*, quote, page_title, text, known_keys) -> str | None` (rule 2, else rule 3)

- [ ] Write tests:
  - "SDE- UI Frameworks" ≡ "SDE - UI Frameworks";
  - "Software Development Engineer – Backend (DEV-BE01)" ≡ "Software Development Engineer Backend";
  - "SDE II" ≡ "SDE 2";
  - "SDE" ≠ "Software Development Engineer";
  - "SDE Intern" ≠ "SDE";
  - `job_ids(["https://juspay.io/careers/DEV-BE01", "https://juspay.io/careers/sde-ui-frameworks"], [])` → `["DEV-BE01"]`;
  - the single-role page-title rule;
  - `test_nearest_preceding_title_wins_on_multi_role_page`;
  - an unknown section → None.
- [ ] Implement the module.

### Task 5: Grounding v2 (`nodes/evidence.py`)

**Files:**
- Modify: `apps/ai-service/app/research/nodes/evidence.py`
- Test: `apps/ai-service/tests/research/test_grounding_v2.py`; update `tests/research/test_expanded_nodes.py` grounding tests

**Interfaces:**
- Consumes: Tasks 2–3.
- Produces:
  - `Claim` (unchanged fields)
  - `parse_claim(raw: dict) -> tuple[Claim | None, str | None, bool]` (claim, reason, `open_ended`)
  - `verbatim(passage, text) -> bool`
  - `ground(claim: Claim, source: dict, src: SourceClass, *, open_ended=False) -> Grounded`, where `Grounded(claim: dict | None, reason: str | None, soft: bool)`
  - `HARD_REASONS`, `SOFT_REASONS`
  - `_ground(claim, source, *, india_only)`, kept as a thin compatibility wrapper for the existing tests. It classifies the source as tier 3 `other` and returns the claim dict or None. The legacy role-in-quote check is removed: role context is now the roles node's job (spec §8.2).
  - A grounded claim dict = `claim.model_dump()` + `value` (normalized), `url`, `source_name`, `date`, `tier`, `source_type`, optional `basis` (ctc), optional `derived_from` (category mapping), optional `open_ended`.

- [ ] Write tests:
  - every reason code;
  - fragments (2 pieces in order accepted; out of order rejected; a 10-char piece rejected; a trailing "..." on a single piece accepted);
  - `"20"` → 20.0;
  - `"16+"` accepted for `ctc_min_lpa` with `open_ended`, rejected for `ctc_max_lpa`;
  - Series D → late-stage with `derived_from`;
  - SaaS → product;
  - WLB: the AmbitionBox string accepts 3.3 and rejects 3.6; "3.7 Work Life Balance" accepted on a review_platform; the same on an `other` source without "/5" → `rating_scale_missing`;
  - bare "27 LPA" → `basis="lpa_unspecified"`;
  - "base salary 20 LPA" → `ctc_not_total`;
  - an unknown geo → soft `geo_unconfirmed`;
  - a location item normalized to Bengaluru.
- [ ] Implement it. Existing parametrized CTC tests keep their expectations, with these exceptions:
  - "India SDE base salary INR 20 LPA" stays None (`ctc_not_total`);
  - "Singapore … CTC 20 LPA" stays None (foreign);
  - "India SDE CTC INR 20 LPA" stays 20.

### Task 6: `normalize/merge.py`

**Files:**
- Create: `apps/ai-service/app/research/normalize/merge.py`
- Test: `apps/ai-service/tests/research/test_merge.py`; keep `test_reversed_salary_ranges_are_not_published` passing (`ctc_range` imported from `nodes.evidence` → re-exported)

**Interfaces:**
- Produces:
  - `TIER_WEIGHT`, `RECENCY_YEARS = 2`
  - `parse_date(s) -> date | None`
  - `evidence_field(value, claims, *, note=None, alternatives=(), provenance="evidence", time_sensitive=False, now=None) -> dict`
  - `choose(claims, name, *, now=None) -> dict`
  - `choose_list(claims, name, *, cap=15) -> dict`
  - `extractive_text(claims, name, *, limit=3, tiers=None) -> dict`
  - `ctc_observations(claims) -> list[dict]`
  - `ctc_range(claims) -> tuple[dict, dict, int]`
  - `reported_passages(claims, *, limit=5) -> dict`
  - `item_key(value) -> str`

- [ ] Write tests:
  - tier dominance (one tier-1 beats two tier-3 domains);
  - alternatives listed with urls and `as_of`;
  - a tie → low and deterministic;
  - one vote per domain;
  - stale down-weighting;
  - `high` needs 3 domains within 2 years;
  - the outdated note;
  - HQ Bangalore ≡ Bengaluru → no conflict;
  - derived provenance;
  - list order and cap, plus the alias (`ReactJS` ≡ `react`);
  - observations from a single figure, a pair, and open-ended `16+`;
  - median and IQR with 5 observations;
  - the `lpa_unspecified` cap;
  - the reported split: candidate_report vs secondhand, newest first.
- [ ] Implement it.

### Task 7: `concurrency.py` + gateway

**Files:**
- Create: `apps/ai-service/app/research/concurrency.py`
- Modify: `apps/ai-service/app/research/gateway.py`
- Test: `apps/ai-service/tests/research/test_concurrency.py`; `tests/research/test_gateway.py` (add include_domains / repair tests)

**Interfaces:**
- Produces:
  - `gather_ordered(coros) -> list`, using a TaskGroup. Results come back in order. The ExceptionGroup is unwrapped to its first non-cancellation error; a child's own CancelledError is re-raised.
  - `ResearchIO.search(query, *, company_slug, kind, include_domains=None, company_domain=None)`. The request includes `include_domains` only when non-empty; sources are stored with `source_type`/`tier` when `company_domain` is given.
  - `ResearchIO.extract_claims(*, prompt_name, prompt_version, system, user, company_slug, label) -> list` validates the envelope (`{"claims": list ≤ 100}`), then makes one repair re-ask (user + deterministic repair note, label `…#repair`). If still invalid, it raises pydantic `ValidationError`.
  - The run-wide `asyncio.Semaphore`s (`research_exa_concurrency`, `research_llm_concurrency`) wrap only real calls, with the budget charged inside.

- [ ] Write tests:
  - order preserved with staggered sleeps;
  - `test_gather_ordered_reraises_budget_exhausted_unwrapped`;
  - an LLM semaphore bound (count in-flight in a FakeLLM with sleeps; max ≤ the cap);
  - the include_domains request key (an empty list leaves the legacy key unchanged);
  - envelope repair success (first invalid, second valid → 2 LLM calls; only the valid one cached);
  - repair failure → ValidationError, nothing cached.
- [ ] Implement it.

### Task 8: `research()` v2: multi-query, relevance, isolation, unverified

**Files:**
- Modify: `apps/ai-service/app/research/nodes/evidence.py`
- Create: `apps/ai-service/app/research/failures.py` (`is_transient`, `is_degradable`; `graph.py` re-exports `is_transient`)
- Test: `apps/ai-service/tests/research/test_failure_isolation.py`

**Interfaces:**
- Produces:
  - `ResearchOutcome(claims: list[dict], unverified: list[dict], failures: list[dict], stats: Counter, sources: dict[str, dict])`, plus `.notes(section) -> list[str]` and `.merge(other)`.
  - `async research(state, deps, prompt, *, kind, queries, role_title=None, skip_urls=frozenset()) -> ResearchOutcome`.
  - `company_domain(state) -> str | None` (identity website value, else the company website).
  - `company_names(state) -> list[str]`.
  - `render_queries(queries, *, name, title=None, domain=None) -> list[tuple[str, list[str]]]`.
  - `unverified_entry(claim_dict_or_Claim, source, src, reason) -> dict`.
  - `cap_unverified(entries, n) -> list` (tier asc, newest first).

- [ ] Write tests:
  - one source raising LLMError while the others are kept, with a note "1 of 3 sources could not be extracted (LLMError)";
  - `test_all_sources_failing_raises_last_error`;
  - one Exa query failing (ExaError) while the others are used;
  - all queries failing → raise;
  - ExaConfigError propagating immediately;
  - irrelevant sources making no LLM call (`stats["irrelevant_source"]`);
  - geo-unconfirmed claims landing in `unverified` with the quote and reason;
  - the validation summary event emitted.
- [ ] Implement it.

### Task 9: profile + compensation nodes

**Files:**
- Modify: `apps/ai-service/app/research/nodes/profile.py`, `nodes/compensation.py`
- Create: `apps/ai-service/app/research/coverage.py` (profile/culture/role path lists, `section_missing`, `role_missing`, `plan_followups`, `coverage`)
- Test: `apps/ai-service/tests/research/test_coverage.py`; update `test_expanded_nodes.py`

**Interfaces:**
- Consumes: Tasks 5–8.
- Produces:
  - `profile.OUTPUT_FIELDS` (FIELDS incl. `funding_round`)
  - `compensation.OUTPUT_FIELDS = ("wlb_rating", "wlb_review_count", "review_summary", "review_quotes")`
  - Node outputs: `{"profile"|"compensation": {...fields, "unverified": [...]}, "notes": [...], "followups_used": int}`
  - `coverage.coverage(snapshot) -> {"filled", "total", "missing"}`
  - `coverage.plan_followups(missing, templates, limit) -> list[Query]` (de-duplicated, ordered)
  - `PROFILE_FOLLOWUP_CAP = 2`, `CULTURE_FOLLOWUP_CAP = 1`

- [ ] Tests:
  - coverage counts on a hand-built snapshot (8 + 5 × roles; interview satisfied by reported);
  - the follow-up plan de-duplicates the shared profile query and respects the caps;
  - a profile follow-up runs only when enabled and fields are missing, and fills `headcount_band`;
  - `funding_round` "Series D" → `funding_stage` late-stage, derived.
- [ ] Implement it.

### Task 10: roles node v2

**Files:**
- Modify: `apps/ai-service/app/research/nodes/roles.py`
- Test: `apps/ai-service/tests/research/test_roles_v2.py`; update `test_expanded_nodes.py` (capped-roles test, full-graph test)

**Interfaces:**
- Consumes: Tasks 3–9.
- Produces: row keys
  - `role_key, title, employment_type, job_ids, level, specialization, yoe_min, yoe_max`
  - `required_skills, preferred_skills, tech_stack, locations`
  - `ctc_observations, ctc_min_lpa, ctc_max_lpa, ctc_source_count`
  - `jd, interview_process, reported_interview_process, unverified`

  `role_key(level, specialization, title, employment_type=None)`: appends `-intern`/`-contract`.

- [ ] Tests, on Juspay-shaped fixtures:
  - a single-role careers page with JD/YoE/skills not repeating the title → kept;
  - title variants merge;
  - the Frontend title claim with `role_title=None` → a role;
  - DEV-BE01 full-time vs DEV-BE02 intern → two roles;
  - `test_community_post_title_does_not_create_a_role`;
  - a LinkedIn "27 LPA" post → a `ctc_observations` entry with `lpa_unspecified` and confidence low;
  - official vs reported interview split;
  - a per-role detail failure → that role's detail fields unavailable with a note, while the other role is complete;
  - a role follow-up fills `interview` when enabled.
- [ ] Implement it.

### Task 11: write_draft coverage, runner, diff

**Files:**
- Modify: `apps/ai-service/app/research/nodes/write_draft.py`, `app/research/runner.py` (`_finish_item`), `app/research/drafts.py` (ignore `unverified`)
- Test: `tests/research/test_drafts.py` (unverified ignored), `tests/research/test_coverage.py` (draft + company state carry coverage via the full graph)

**Interfaces:**
- Produces:
  - `draft["coverage"]`;
  - the `write_draft` output `{"draft": {status, draft_id, version, coverage: {filled, total}}}`;
  - `item.coverage`;
  - `company_research_state.latest_draft_coverage = {filled, total}`.

- [ ] Write the tests, then implement.

### Task 12: Optional-node degrade policy (graph)

**Files:**
- Modify: `apps/ai-service/app/research/graph.py`
- Test: `apps/ai-service/tests/research/test_graph.py`

**Interfaces:**
- Produces: `OPTIONAL_NODES = frozenset({"profile", "compensation"})`.
  - Optional nodes run without a `RetryPolicy`; the wrapper retries transient errors 3 times with backoff from `retry_initial_interval`.
  - A degradable error then yields the section with every `OUTPUT_FIELD` set to `unavailable(note="Research failed: …")`, plus a note. The node status is `error`, and the graph continues.

- [ ] Tests:
  - compensation LLMError on every call → the item ends `done`, the draft has the compensation fields unavailable with "Research failed", and `nodes.compensation.status == "error"`;
  - BudgetExhausted in profile still auto-pauses (the existing test);
  - a programming error (KeyError) in an optional node fails the item;
  - a transient error that succeeds on attempt 2 → ok.
- [ ] Implement it.

### Task 13: Contract, API passthrough, web

**Files:**
- Modify: `packages/contracts/openapi.yaml` (`DraftField`, `UnverifiedClaim`, `DraftProfile`, `DraftCompensation`, `DraftRole`, `CompanyDraft.coverage`, `CompanyResearchState.latestDraftCoverage`)
- Regenerate: `apps/web/lib/api-client/generated/schema.d.ts` via `scripts/generate-types.ts`
- Modify: `apps/api/src/routes/admin.ts` (map `latest_draft_coverage`)
- Modify: `apps/web/features/research/status.ts` (`companyStatusLabel`), the Companies tab usage, `DraftResearchReport.tsx` (Coverage readout)
- Test: `apps/web/features/research/status.test.ts` (label cases); `DraftResearchReport.test.tsx` (coverage readout). Written, not run.

- [ ] Implement, then regenerate types.

### Task 14: Existing-test updates, verification

- [ ] Update the existing research tests for the new query templates, relevance (fixture titles name the company), tiered interview split, call counts and `research-v3`.
- [ ] Run: `cd apps/ai-service && .venv/bin/python -m pytest tests/research -q` (user approved). Fix any failures.
- [ ] Offline replay: a scratch script runs the saved run-`4fcdfec4` LLM outputs through `parse_claim` → `ground` → role resolution → merge, and reports kept/unverified/dropped vs before.
- [ ] Update `apps/ai-service/README.md`: research section knobs and a tier/coverage note.
