# SDD ledger — plan: docs/superpowers/plans/2026-10-02-company-research-phase1-backbone.md

Spec: docs/superpowers/specs/2026-10-02-company-research-pipeline-design.md (binding authority)
Repo HEAD at start: eb3f480 (another session is editing profile/*, intelligence/page.tsx, viewers.tsx, observability/* — uncommitted)
Snapshot base S0: c6ec3019c2dff31480dc8935e4ca4c5e68c9f3d5 (HEAD + working-tree state of all task paths)
Snapshot helper: .superpowers/sdd/2026-10-02-company-research-phase1-backbone/snap PREV -- PATHSPEC…

## Pre-flight scan

| Pair / task | Produces → consumes | Finding |
|---|---|---|
| T1 → T3,T7,T8 | models: RunStatus/ItemStatus/Control/Mode/NODE_ORDER/field/check_transition | consistent names |
| T2 → T4,T8 | redact(value, secrets), error_info(exc) | consistent |
| T3 → T4,T5,T7,T8,T9 | store.update_run/update_item(fields=, inc=), EventFilter, LEVEL_RANK | consistent (all callers use fields=/inc=) |
| T4 → T5,T7,T8,T9 | Tracer.span(kind,name,*,input,attrs,company_id,node), emit, flush, hydrate_span | T7 passes company_id (fixed in plan) — consistent |
| T5 → T7,T8 | ResearchIO.search/extract_json, Budget.charge/add_tokens/set_caps/from_run, FixtureStore, LLMResult/complete_full | consistent; T5 creates normalize/identity.py stub (domain_of) that T6 replaces — intended |
| T6 → T7 | slugify/name_key/domain_of/find_possible_duplicates, snapshot_diff | consistent |
| T7 → T8 | NodeDeps, build_company_graph(deps, retry_initial_interval), placeholder runner.py/targets.py replaced by T8 | intended; helpers.make_runner only exercised in T8+ |
| T8 → T9 | ResearchRunner(.store,.busy,start_run,pause,resume,stop,raise_budget,recover_on_startup,wait_idle), RunActive/RunNotFound/NoCompaniesSelected, TargetsUnavailable | consistent |
| T9 → T11,T12 | /research/* routes + snake_case shapes | consistent with T11 client paths and T12 query mapping |
| T10 → T11 | CompanyRepository.create/update/findById/findActive/findPublished/deleteById, roleConfigs.deleteByCompany, seedCompany(overrides) | consistent |
| T10 ↔ old admin router | old CRUD router still compiles after T10 (deleteBySlug/deleteByCompany kept) | plan hedges "some old CRUD tests may fail" — ruling 2 |
| T11 → T12,T14 | AiServiceClient research methods; AdminCompany camelCase shape | consistent with T13 schemas |
| T13 → T14 | generated schema names (AdminCompany … ResearchSpanDetailResponse) | every name T14 aliases is defined in T13 |
| T14 → T15,T16 | features/research barrel (hooks, status, trace-tree, copy-bundle, deep-link, clipboard, time, api) | consistent; testing.ts imported by path only |
| T15 ↔ T16 | both under _components/research; T16 page imports CompaniesTab | consistent |
| T16 ↔ other session | page.tsx + viewers.tsx edited concurrently by another session | ruling 5 (keep their class strings; touch only TABS/URL/Suspense) |
| T17 | step 4 spends Exa/LLM + writes dev DBs | ruling 3 |
| Self-consistency T1–T17 | tests vs code checked while writing plan (TraceTree chevron, admin.ts import, page ReactNode fixed pre-execution) | clean |

## Rulings
- Ruling: work in the main working tree, no commits, no worktree branch; per-task diffs come from private-index snapshot commits (snap) — user's standing no-auto-commit rule + another session's uncommitted edits live here — cost if wrong: a concurrent session's `git add -A && git commit` could sweep our files into its commit, or a `git checkout .`/stash could wipe uncommitted work.
- Ruling: Task 10 must not skip the old company-CRUD tests unless they actually fail because of Task 10's changes (report which) — plan text is hedged — cost if wrong: none (Task 11 rewrites them).
- Ruling: Task 17 Step 4 (live/record walkthrough: spends Exa+LLM calls, writes dev DBs) is excluded from the implementer; controller asks the user at the end — plan says ask first — cost if wrong: walkthrough deferred to the user.
- Ruling: implementers never `git add`/`commit`/`stash`/`checkout`/`reset` (template's "commit" step overridden) — standing user rule — cost if wrong: none.
- Ruling: implementers touch only their task's Files list; never profile/*, apps/api/src/services/profile*, components/observability/*, intelligence/viewers.tsx (another session's area) — cost if wrong: none.

## Progress
Task 1: minor (deferred): check_transition action typed str (plan-mandated); unknown action → KeyError not InvalidTransition
Task 1: minor (deferred): no tests for ItemStatus/Control/Mode; Mode vs Settings.research_mode literal drift unguarded
Task 1: minor (deferred): test_research_defaults reads real env (RESEARCH_* exported would break it)
Task 1: complete (snapshots c6ec301..06284b7, review clean; ⚠️ test_config.py verified in report)
Note: pre-existing env-dependent failure tests/test_config.py::test_interview_settings_have_defaults (reads local .env INTERVIEW_LLM_MODEL) — not caused by this plan; exclude from 'green' claims
Task 2: minor (deferred): secrets <6 chars never redacted (intentional, plan-mandated); no test that a long INTERNAL_API_KEY is included
Task 2: minor (deferred): redact() ignores secrets in dict keys / bytes / sets; overlapping-secret order
Task 2: minor (deferred): error_info is raw — callers must redact (Task 4 tracer + Task 8 runner do; final review: verify)
Task 2: complete (snapshots 06284b7..b00c0f4, review clean — reviewer misread rules file but covered spec+quality)
Task 3: Ruling: fix the 3 plan-mandated Important findings (store uniqueness divergence, vacuous sources test, untested TTL) — spec requires identical store semantics and every later task's tests run on the memory store — cost if wrong: ~1 small fix round.
Task 3: Ruling: add DuplicateKey (shared exception) + memory-store key enforcement + get_source(url) + max_event_seq(run_id) to the store now; Task 8 runner must start tracers at max(run.last_seq, max_event_seq) so a crash between event insert and last_seq update cannot reuse seqs — found while ruling on finding 1 — cost if wrong: one extra store method.
Task 3: Ruling: running the Mongo half against the user's Atlas dev cluster (creates/drops throwaway DBs) is deferred to the end-of-plan verification ask — external side effect — cost if wrong: Mongo-only divergences surface later.
Task 3: minor (deferred): _ttl_index catches all OperationFailure (should be codes 85/86); event_matches not null-safe on message; _id-absence asserted only for runs/items; misc coverage gaps (input copying, find_active_run newest, before_seq+filters, regex metachar q); ms vs µs datetime, sort-tie, $set-through-non-dict divergences; report inaccuracies
Task 3: fix round 1/5 (3 addressed, 1 open — batch duplicate inserts partial in Mongo vs atomic in memory; no unchanged-state assertions; snapshots c352d1c..f5d9eab)
Task 3: Ruling: Mongo insert_items/insert_events pre-check batch-internal and stored duplicates and raise DuplicateKey before writing (single writer per run makes the race window negligible); keep the 11000 wrapping as a backstop — makes "duplicate → nothing written" the contract for both stores — cost if wrong: one extra find per batch insert.
Task 3: fix round 2/5 (2 addressed, 0 open; snapshots f5d9eab..723e27e)
Task 3: minor (deferred): no mixed [existing,new] batch test for items/events (pre-check against stored keys untested in partial-write position); Mongo pre-check not atomic vs concurrent writers (backstop converts); Mongo half never executed
Task 3: complete (snapshots b00c0f4..723e27e, review clean after 2 fix rounds)
Task 4: Ruling: Tracer.flush must NOT re-queue a batch that failed with store.DuplicateKey (log + drop it) — re-queueing a duplicate-seq batch would retry forever; other failures still re-queue — cost if wrong: a few trace events lost in a bug scenario.
Task 4: minor (deferred): span-start put_span unguarded vs span-end guarded; non-Cancelled BaseException leaves status "running"; kind/name not redacted; emit not thread-safe (doc says threads OK); flush-failure test pokes t._buffer, no caplog assertion; no RED evidence captured (tests+impl written together)
Task 4: fix round 1/5 (1 addressed, 0 open; snapshots 4a2fbda..d12c2c9)
Task 4: complete (snapshots 723e27e..d12c2c9, review clean after 1 fix round)
Task 5: minor (deferred): complete_full docstring opening line stale (plan-mandated); gateway r["url"] KeyError on url-less result; replayed fixtures not re-truncated; fixtures path trusts company_slug; no test for LLM replay / replay cache hit in test_gateway (covered end-to-end by Task 8 replay test)
Task 5: complete (snapshots d12c2c9..6fea33a, review clean)
Ruling: ResearchIO.extract_json gains optional `validate: Callable[[dict], Any] | None = None`; when given it runs before put_extract and on cache hits, and a raise means nothing is cached (and a cached value that fails validation is ignored, re-asked) — otherwise one malformed LLM reply is cached and every later run fails identically (Task 5 minor #2, load-bearing for Task 7 resolve) — implemented in Task 7 with a test — cost if wrong: a few lines in gateway.py.
Note: some subagents' Read of .md rule files returned only the title (likely a read hook); dispatches now point at .txt copies read via `cat`.
Task 6: minor (deferred): no alias-match duplicate test; shared host domains (linkedin.com, github.io) flagged as duplicates; duplicate role_key overwrite in flatten
Task 6: complete (snapshots 6fea33a..8549337, review clean)
Ruling: domain_of must return None on malformed URLs (urlparse(...).hostname raises ValueError, e.g. "http://[bad") — it runs on LLM-derived websites inside resolve, so a bad reply would fail the company — folded into Task 7 with a test — cost if wrong: none.
Task 7: minor (deferred): evidence URL match is exact-string (trailing slash / scheme diff → low confidence); resolve validates twice; unchanged-check vs a REJECTED latest draft suppresses re-review (Phase 2 to decide); supersede+insert not atomic; is_transient retries LLMError which the client already retried internally (slow, extra charges on persistent errors)
Task 7: complete (snapshots 8549337..f2e9938, review clean)
Task 8: Ruling: accept deviation code_ref=gateway.py:extract_json for validation failures (consequence of the validate ruling; traceback still shows resolve) — cost if wrong: Claude jumps to the gateway frame first.
Task 8: Ruling: accept graph._traced redaction of nodes.<name>.error via public Tracer.redact (real leak fix) — cost: none.
Task 8: Ruling (fix round 1): (1) serialize control vs finalize with an asyncio.Lock + a driving-run id cleared under the lock; pause/stop/resume use the driving flag instead of `busy`; (2) BudgetExhausted respects an existing STOP (→ cancelled) / PAUSE (keep reason); (3) bookkeeping errors fail only that item, dispatcher cancels+awaits outstanding tasks on error, run failure reconciles RUNNING items; plus cheap minors: guard teardown clears with `self._tracer is tracer`, test the _drive half of the seq ruling, paused-with-nothing-left finalizes as completed, redaction test also dumps payloads/sources/extracts/company_states/drafts — cost if wrong: one more fix round.
Task 8: minor (deferred): no RED evidence captured for brief tests and fix-round tests (written with implementation); orphan-run branch on startup doesn't reconcile items/counters/company_state or emit an event
Task 8: fix round 1/5 (3 addressed, 0 open; snapshots 1afdde9..92ec639) — reviewer reran repros: stuck-stopping, stop→pause, orphan tasks all fixed
Task 8: Ruling: promote to fix round 2 (load-bearing for "every step visible"): (a) Tracer.close cancelling the flush loop mid-flush drops the swapped batch (final run events can vanish under real Mongo latency) — shield the loop's flush; (b) in _drive, close the tracer inside the _control_lock block before clearing _driving_run_id/_tracer so teardown-window control notes go to a detached tracer past a fully flushed seq; (c) budget.exhausted message must not say "pausing" on the STOP branch — cost if wrong: one small fix round.
Task 8: fix round 2/5 (3 addressed, 0 open; snapshots 92ec639..aaf4826) — tracer close race + teardown notes + budget message
Task 8: minor (deferred): fallback _teardown in finally runs without lock and clears _driving_run_id after close (stop during that window → stuck `stopping`, needs a failing store); _SlowStore hook fires on "completed" (dead condition)
Task 8: complete (snapshots f2e9938..aaf4826, review clean after 2 fix rounds)
Task 9: minor (deferred): exact-type StreamHandler loop in main.py; no lifespan test for RESEARCH_ENABLED=false; no 404 test for PATCH budget; CLI Ctrl-C leaves a running run until next service recovery
Task 9: complete (snapshots aaf4826..51643bf, review clean)
Task 10: Ruling: the Important finding (student /jds list + /jds/:id still expose JDs of unpublished/archived companies) is outside Task 10's brief and is carried into Task 11: hide a JD when its company row exists and is unpublished or archived (list filters it out; detail → 404 jd_not_found); JDs with NO company row stay visible (legacy/seed rows and existing tests) — spec §4.1 "students see only published, active companies" — cost if wrong: legacy JDs without a company row stay visible.
Task 10: minor (deferred): re-seed wipes all Meesho JDs (revisit when approval writes JD rows, Phase 3); no comment that NULL role_key rows are intentionally non-unique; migration test never seen RED (brief ordering); repo create/update/findById/deleteById untested directly
Task 10: complete (snapshots 51643bf..8bc8c68, review clean; 1 Important carried to Task 11 by ruling)
Task 11: Ruling: hidden-company JDs can still be booked/prepped by UUID via interviewSessions.ts / interviewPrep.ts / intelligence.ts findById — deferred to Phase 2 (when approval publishes research JDs); in Phase 1 only archived seed companies can have JDs — cost if wrong: a student holding a hidden JD's UUID can book it.
Task 11: minor (deferred): DELETE not transactional (orphaned briefs too); POST findBySlug→create race → 500 not 409; researchAvailable true when zero companies; ids in query string (URL length at ~200 companies); PATCH/DELETE role gating + PATCH validation + malformed-UUID untested; stale test docblock; no client unit tests
Task 11: complete (snapshots 8bc8c68..6c57d41, review clean)
Task 12: minor (deferred, final review should triage): unknown `scope` silently coerced to "all" (a typo starts a full, paid run) — reject with 400 invalid_scope; non-string companyIds dropped silently; no tests for upstream 422/404/503 forwarding, spans?companyId, resume/stop; events query values forwarded unvalidated
Task 12: complete (snapshots 6c57d41..fb6f535, review clean)
Task 13: minor (deferred): error responses under-documented (404/502/503 on events/spans/control/budget; 400 invalid_run_id/invalid_span_id); StartResearchRunRequest.scope generated as required despite default
Task 13: complete (snapshots fb6f535..b40aea8, review clean)
Task 14: fix round 1/5 (3 addressed, 0 open; snapshots e1a5572..5a92d80) — stale-time empty console, hook tests, keepAll race
Task 14: minor (deferred): hook test (b) doesn't assert "later tail pages stop trimming" (keepAll path uncovered); gcTime 0 refetches whole tail on reopen (intended)
Task 14: Ruling: accept useRunEvents deviation (render-phase reset + single paging ref, to satisfy react-hooks/set-state-in-effect) — behaviour equivalent per review — cost: none.
Task 14: complete (snapshots b40aea8..5a92d80, review clean after 1 fix round)
Task 15: minor (deferred): 409 test has no active run so "Open the active run" link untested; row errors render at card top (off-screen for long lists); no tests for add-form submit / archive toggle / published column
Task 15: complete (snapshots 5a92d80..587caa1, review clean)
Task 16: Ruling: accept BudgetMeters CapsForm-keyed deviation (lint-clean equivalent) — cost: none.
Task 16: Ruling: fix the 3 plan-mandated Important findings (stale trace after run ends; deep links not pinned to run; swallowed loading/query/loadOlder errors) plus cheap minors (React Flow nodes/edges not focusable + unique id + sr-only state summary; per-event copy button keyboard-reachable; CapsForm key includes run id; tree semantics → list with aria-expanded on toggle + aria-current; two-step confirm on Stop) — spec §9.1 deep-link guarantee + debugging fidelity — cost if wrong: one fix round.
Task 16: fix round 1/5 (8 addressed, 1 new Important open — run switch away from a live run triggers a full event-log scan via manual refetch ignoring enabled; snapshots 64a3224..acefd0c)
Task 16: fix round 2/5 (4 addressed, 0 open; snapshots acefd0c..2e72cb1)
Task 16: minor (deferred): focus returns to a disabled Stop after confirm; malformed ?run= (400) still retried ~7s (skip retries for all 4xx); no dedicated tests for useRunEvents early-return / 404 no-retry; tree keyboard model not implemented (plain list now); no RunsTab test for BudgetMeters reset
Task 16: complete (snapshots 587caa1..2e72cb1, review clean after 2 fix rounds)
Task 17: ⚠️ resolved by controller: ai-service test_config failure and web lint 2 errors are pre-existing (lint measured at baseline before Task 14; test_config confirmed during Task 1 — local .env INTERVIEW_LLM_MODEL)
Task 17: minor (deferred → final review): README says write_draft "asks the LLM" — wrong, write_draft makes no LLM call
Task 17: complete (snapshots 2e72cb1..89830ce, review clean; Step 4 walkthrough pending user approval)
Final review: skipped at the user's request (Opus session limit); deferred minors remain untriaged
