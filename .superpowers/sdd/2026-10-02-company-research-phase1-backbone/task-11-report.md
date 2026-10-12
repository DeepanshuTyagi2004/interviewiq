# Task 11 report

## Implemented
- AiServiceClient: companyResearchStates (null on UpstreamError), startResearchRun, listResearchRuns, getResearchRun, controlResearchRun, patchResearchBudget, listResearchEvents, listResearchSpans, getResearchSpan.
- admin.ts: adminCompaniesRouter rewritten (GET with research-state merge + researchAvailable, POST, PATCH, DELETE by id, seed unchanged); old helpers/imports removed.
- internal.ts: GET /research-targets (active companies).
- catalogue.ts jdsRouter (controller ruling): JDs of companies whose row exists and is unpublished or archived are filtered from GET /jds and 404 jd_not_found on GET /jds/:id; JDs with no company row stay visible.
- Tests: adminCompanyController.test.ts ("company CRUD" block replaces "catalogue CRUD"), internalResearchTargets.test.ts, new jdHiddenCompanies.test.ts.

## TDD evidence
RED: `pnpm --filter @interviewiq/api exec vitest run test/routes/adminCompanyController.test.ts test/routes/internalResearchTargets.test.ts test/routes/jdHiddenCompanies.test.ts` -> 9 failed | 5 passed (POST demanded jds, /research-targets 404, hidden JDs still listed).
GREEN: `pnpm --filter @interviewiq/api test` -> Test Files 42 passed (42), Tests 501 passed (501); `pnpm --filter @interviewiq/api typecheck` clean.

## Notes
- Count is 501 vs 505 baseline: the old "catalogue CRUD" block (more tests) was replaced by the brief's 7 tests, +2 hidden-JD tests, +2 research-target tests.
- Deviation: removed the now-unused `status` import from adminCompanyController.test.ts. Detail route in jdsRouter now loads the company before the brief (brief fetch skipped for 404).
- No commits; profile* files untouched.
