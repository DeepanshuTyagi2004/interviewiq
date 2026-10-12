# Task 14 report: Web research feature module

Status: DONE_WITH_CONCERNS (one small deviation, see below). No commits (working tree).

## Implemented
All files from the brief, transcribed verbatim: apps/web/lib/constants/research/index.ts and apps/web/features/research/{types,api,hooks,status,trace-tree,event-filters,copy-bundle,deep-link,time,clipboard,testing,index}.ts plus 6 test files.

## TDD evidence
RED (helper impls status/trace-tree/event-filters/copy-bundle/deep-link/time temporarily moved aside):
`pnpm --filter @interviewiq/web exec vitest run features/research` ->
FAIL x6: `Failed to resolve import "./trace-tree" from "features/research/trace-tree.test.ts"` (same for each helper). Test Files 6 failed, no tests.
GREEN (impls restored): Test Files 6 passed, Tests 39 passed.

## Final verification
- typecheck: clean.
- full web tests: 101 files / 499 tests passing (baseline 95/460 + the 6 new files/39 tests).
- lint: 2 errors (tailwind.config.js, pre-existing) + 4 warnings = baseline, nothing added.

## Deviations from the brief
useRunEvents in hooks.ts as written caused a NEW lint error (react-hooks/set-state-in-effect: `setEvents([])` in a reset effect). Fixed minimally, behavior unchanged:
- buffer state is `{runId, events}`; a runId change resets it during render (adjust-state-during-render pattern) instead of in an effect.
- cursor/keepAll refs merged into one `paging` ref keyed by runId, reset inside queryFn when runId differs.
- setEvents wrapped in useCallback([runId]) and added to loadOlder deps (avoids a new exhaustive-deps warning).
Public return shape `{events, error, loadOlder, canLoadOlder, loadingOlder}` unchanged. The hook has no unit test in the brief; typecheck and lint only.

## Concerns
- Hook (useRunEvents, newest-2000 / load-older) is not covered by tests in this task; the pure helpers behind it (initialAfterSeq, olderPageQuery, appendCapped) are.

## Fix round 1
1. hooks.ts: events useQuery now has staleTime 0, gcTime 0, refetchOnMount "always". The paging ref is fresh on every mount and is reset in queryFn whenever runId differs, so the cursor restarts at initialAfterSeq.
2. Added features/research/hooks.test.tsx (4 tests: tail from afterSeq 3000 + 500 paging ending at seq 5000 with 2000 rows; loadOlder {beforeSeq:3001,limit:500} prepends; runId change empties and restarts; remount within stale window refills). Test (d) fails with the three query options removed (verified), passes with them.
3. loadOlder captures `const state = paging.current` before the await and sets keepAll on it.
Commands: `pnpm --filter @interviewiq/web exec vitest run features/research` -> 7 files / 43 tests pass; typecheck clean; lint 2 errors + 4 warnings (baseline).
