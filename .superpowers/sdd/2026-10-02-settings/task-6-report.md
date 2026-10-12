# Task 6 report: Account deletion (DELETE /users/me)

Status: DONE. No commits, no git state touched (per user rule).

## Implemented
Followed the brief verbatim; no deviations needed.
- AiServiceClient.purgeUser -> POST /users/purge
- GitHubOAuthService.revokeGrant
- Mongo: CandidateProfileRepository.deleteByUserId, ProfileFragmentRepository.deleteByUserId, SessionOutcomeRepository.deleteBySessionIds
- UserRepository.deleteCascade (one transaction, user row last)
- AccountDeletionService: checks -> AI purge (abort before any local delete, batches of 1000) -> GitHub revoke (best effort) -> Mongo deletes -> Postgres tx
- DELETE /users/me route (loginPerIpEmail rate limit), rateLimitErrors + mapped routerErrors (400 confirmation_mismatch, 403 invalid_password, 409 interview_in_progress, 502 deletion_unavailable); container key accountDeletion

## Files changed
apps/api/src/integrations/aiService/client.ts, integrations/github/oauth.ts, repositories/mongo.ts, repositories/pg.ts, services/accountDeletion.ts (new), routes/account.ts, container.ts, test/routes/accountDeletion.test.ts (new)

## TDD evidence
- RED: `pnpm --filter @interviewiq/api exec vitest run test/routes/accountDeletion.test.ts` -> 12 failed, 1 passed; authenticated DELETEs got 404 (no route).
- GREEN: same command -> 13/13 passed (re-verified after interruption).

## Full suite
`vitest run` -> 47 files, 563 tests passed.

## Typecheck
`pnpm --filter @interviewiq/api typecheck` -> clean.

## Self-review
- Partial-wipe retry and other-users-untouched tests pass.
- AI failure test: nothing deleted, GitHub revoke not attempted.
- Only brief-listed files touched.

## Concerns
- Every delete attempt (including a successful one) counts against the shared login rate limiter.
- Mongo deletes run in Promise.all; all idempotent, so retry is safe.
