# Task 16 report

Status: DONE_WITH_CONCERNS (one deviation, below). No commits (working tree).

## Implemented
Created in apps/web/app/(app)/intelligence/_components/research/: RunsTab, RunControlBar, BudgetMeters, TraceTree, GraphMiniMap, GraphMiniMapInner, SpanDetail, PayloadViewer, LiveConsole + 4 test files (verbatim from brief).
Page rewritten (URL-driven tabs, Suspense, TABS list; tab-bar classNames untouched, identical to working tree).
Deleted CompaniesPanel.tsx, RemoveCompanyButton.tsx. Removed company plumbing from features/intelligence/{api,hooks,index,types}.ts (also the now-unused `Jd` type) and lib/constants/intelligence (ADMIN_COMPANY_ENDPOINTS, queryKeys.companies).

## Deviations from the brief
BudgetMeters: brief's useEffect+setState tripped a NEW lint error (react-hooks/set-state-in-effect). Split the caps form into a `CapsForm` child keyed on `${exa_cap}-${llm_cap}` so inputs reset when server caps change, no effect. Behaviour same. Also removed unused `Jd` type.

## RED (impl files for the 4 components moved aside, tests run)
  File: /Users/salescode/Desktop/project/interviewiq/apps/web/app/(app)/intelligence/_components/research/TraceTree.test.tsx:11:38
  11 |  const __vi_import_5__ = await import('./TraceTree')
 Test Files  4 failed | 1 passed (5)
      Tests  7 passed (7)

## GREEN
`vitest run app/(app)/intelligence/_components/research`: Test Files 5 passed (5), Tests 23 passed (23) (RunControlBar 6, TraceTree 3, CompaniesTab 7, SpanDetail 4, LiveConsole 3)

## Full web checks (tails)
```
## TYPECHECK

> @interviewiq/web@0.1.0 typecheck /Users/salescode/Desktop/project/interviewiq/apps/web
> tsc --noEmit

## LINT

/Users/salescode/Desktop/project/interviewiq/apps/web/app/api/webhooks/github/route.ts
  3:28  warning  '_req' is defined but never used  @typescript-eslint/no-unused-vars

/Users/salescode/Desktop/project/interviewiq/apps/web/app/api/webhooks/razorpay/route.ts
  3:28  warning  '_req' is defined but never used  @typescript-eslint/no-unused-vars

/Users/salescode/Desktop/project/interviewiq/apps/web/features/interview-live/session/LiveSessionProvider.reconnect.test.tsx
  14:13  warning  '_cb' is defined but never used  @typescript-eslint/no-unused-vars

/Users/salescode/Desktop/project/interviewiq/apps/web/middleware.ts
  10:28  warning  '_req' is defined but never used  @typescript-eslint/no-unused-vars

/Users/salescode/Desktop/project/interviewiq/apps/web/tailwind.config.js
    1:16  error  A `require()` style import is forbidden  @typescript-eslint/no-require-imports
  114:5   error  A `require()` style import is forbidden  @typescript-eslint/no-require-imports

✖ 6 problems (2 errors, 4 warnings)

/Users/salescode/Desktop/project/interviewiq/apps/web:
 ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  @interviewiq/web@0.1.0 lint: `eslint`
Exit status 1
## TEST
 ✓ features/research/time.test.ts (5 tests) 13ms
 ✓ features/agent-diagnostics/__tests__/hooks.test.ts (2 tests) 1ms

 Test Files  107 passed (107)
      Tests  526 passed (526)
   Start at  17:44:32
   Duration  13.19s (transform 1.90s, setup 8.09s, collect 21.66s, tests 15.37s, environment 46.67s, prepare 7.17s)

```

Lint: 2 pre-existing errors (tailwind.config.js) + 4 warnings = baseline, none added.

## Leftover reference grep
`grep -rn -E "CompaniesPanel|RemoveCompanyButton|useCompanies|useAddCompany|ADMIN_COMPANY_ENDPOINTS|CompanyWithJds" apps/web --include=*.ts --include=*.tsx --exclude-dir=node_modules --exclude-dir=.next` -> no matches (exit 1).

# Fix round 1
Changes:
1. RunsTab: ref of previous `live`; on true->false calls spans.refetch() and events.refetch() once. features/research/hooks.ts useRunEvents now also returns `refetch`.
2. RunsTab `navigate` always includes `run: runId` (resolved id).
3. RunsTab: loading line while runs pending / run detail pending; role=alert for runs, detail (404 -> "That run was not found." + "Back to latest run" button clearing ?run), spans and events errors; loadOlder wrapped in try/catch with toast.error at call site.
4. GraphMiniMapInner: useId id, nodesFocusable/edgesFocusable false, sr-only state summary.
5. TraceTree: plain list; aria-expanded on toggle; aria-current on selected select button.
6. LiveConsole copy button: opacity-0 / group-hover:opacity-100 / focus-visible:opacity-100.
7. BudgetMeters CapsForm key includes run_id.
8. RunControlBar: Stop two-step (Confirm stop / Cancel) + test.
New tests: RunsTab.test.tsx (pin run in URL, refetch once on live->done, loading, runs error alert, run-not-found + back), RunControlBar stop-confirm test.
Results (typecheck clean; lint 2 errors + 4 warnings = baseline; web tests 108 files / 532 passed):
```
## TYPECHECK

> @interviewiq/web@0.1.0 typecheck /Users/salescode/Desktop/project/interviewiq/apps/web
> tsc --noEmit

## LINT

/Users/salescode/Desktop/project/interviewiq/apps/web/app/api/webhooks/github/route.ts
  3:28  warning  '_req' is defined but never used  @typescript-eslint/no-unused-vars

/Users/salescode/Desktop/project/interviewiq/apps/web/app/api/webhooks/razorpay/route.ts
  3:28  warning  '_req' is defined but never used  @typescript-eslint/no-unused-vars

/Users/salescode/Desktop/project/interviewiq/apps/web/features/interview-live/session/LiveSessionProvider.reconnect.test.tsx
  14:13  warning  '_cb' is defined but never used  @typescript-eslint/no-unused-vars

/Users/salescode/Desktop/project/interviewiq/apps/web/middleware.ts
  10:28  warning  '_req' is defined but never used  @typescript-eslint/no-unused-vars

/Users/salescode/Desktop/project/interviewiq/apps/web/tailwind.config.js
    1:16  error  A `require()` style import is forbidden  @typescript-eslint/no-require-imports
  114:5   error  A `require()` style import is forbidden  @typescript-eslint/no-require-imports

✖ 6 problems (2 errors, 4 warnings)

/Users/salescode/Desktop/project/interviewiq/apps/web:
 ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  @interviewiq/web@0.1.0 lint: `eslint`
Exit status 1
## FULL TEST
 ✓ features/agent-diagnostics/__tests__/hooks.test.ts (2 tests) 1ms

 Test Files  108 passed (108)
      Tests  532 passed (532)
   Start at  17:55:29
   Duration  12.98s (transform 1.80s, setup 7.87s, collect 21.52s, tests 14.98s, environment 45.87s, prepare 7.14s)

```

# Fix round 2
Changes: RunsTab ref stores {runId, live}; refetch only for same run live->done with last_seq defined. useRunEvents queryFn returns 0 early when lastSeq undefined. (a) runs error: early return only when !runs.data, else inline alert above debugger. (b) Stop: autoFocus on Confirm stop, focus returned to Stop via ref+effect. (c) useResearchRun retry skips 404s. New tests: RunsTab run-switch (no refetch for pending B), inline runs-poll alert; RunControlBar focus test.
```
## research component + features/research
 ✓ features/research/status.test.ts (18 tests) 6ms
 ✓ features/research/copy-bundle.test.ts (5 tests) 4ms
 ✓ features/research/trace-tree.test.ts (4 tests) 11ms
 ✓ app/(app)/intelligence/_components/research/RunsTab.test.tsx (7 tests) 123ms
 ✓ features/research/hooks.test.tsx (4 tests) 350ms
 ✓ app/(app)/intelligence/_components/research/SpanDetail.test.tsx (4 tests) 200ms
 ✓ app/(app)/intelligence/_components/research/LiveConsole.test.tsx (3 tests) 236ms
 ✓ app/(app)/intelligence/_components/research/RunControlBar.test.tsx (8 tests) 297ms
 ✓ app/(app)/intelligence/_components/research/CompaniesTab.test.tsx (7 tests) 325ms
 ✓ features/research/deep-link.test.ts (2 tests) 5ms
 ✓ features/research/event-filters.test.ts (5 tests) 3ms
 ✓ features/research/time.test.ts (5 tests) 11ms
 ✓ app/(app)/intelligence/_components/research/TraceTree.test.tsx (3 tests) 99ms
 Test Files  13 passed (13)
      Tests  75 passed (75)
## TYPECHECK
> @interviewiq/web@0.1.0 typecheck /Users/salescode/Desktop/project/interviewiq/apps/web
> tsc --noEmit

## LINT
    1:16  error  A `require()` style import is forbidden  @typescript-eslint/no-require-imports
  114:5   error  A `require()` style import is forbidden  @typescript-eslint/no-require-imports
✖ 6 problems (2 errors, 4 warnings)
## FULL
 Test Files  108 passed (108)
      Tests  535 passed (535)
```
