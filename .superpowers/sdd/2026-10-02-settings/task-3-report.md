# Task 3 report

Status: DONE. No commits/staging (per user rule).

## Implemented
- pg.ts: UserRepository.updateName; upsertByGoogleSub no longer overwrites `name` (comment added).
- userService.ts: UserResponse.hasGoogle (+toUserResponse), UserService.rename.
- refreshTokens.ts: RefreshTokenService.revokeAll.
- routes/auth.ts: exported clearRefreshTokenCookie (+Config type import); local clearRefreshCookie delegates to it.
- routes/account.ts: PATCH / (invalid_name, local parse helper kept per ruling), POST /sessions/revoke (204 + cookie cleared).
- Tests: appended to test/routes/accountController.test.ts (+imports); added hasGoogle to test/app.test.ts (true) and test/routes/passwordAuthController.test.ts (false). Other `hasPassword:` hits were toMatchObject, not exact-shape; no other change needed.
- No existing test asserted that a later Google login refreshes name; none changed.

## TDD
RED: `pnpm --filter @interviewiq/api exec vitest run test/routes/accountController.test.ts` -> 9 failed | 13 passed (404s, hasGoogle undefined, name not kept).
GREEN: same command -> 22 passed.

## Full suite / typecheck
vitest run: 45 files, 544 tests passed. `typecheck` (tsc --noEmit): clean.

## Concerns
- `UserRepository.linkGoogle` (existing password account linked by a first Google login) still sets `name: input.name`, overwriting the name once at link time. Brief only covered upsertByGoogleSub, so left as is; arguably should also preserve the existing name.

## Fix round 0 (pre-review concern)
Change: UserRepository.linkGoogle (apps/api/src/repositories/pg.ts) now sets `name` only when `input.clearPassword` is true (unverified account, possible squatter); otherwise name is untouched. One-line comment added.
Tests (accountController.test.ts, describe "linking Google to a password account"): (a) verified account keeps chosen name after Google link; (b) never-verified account takes "Google Name".
Command: `pnpm --filter @interviewiq/api exec vitest run test/routes/accountController.test.ts test/services/googleAccountLinking.test.ts` -> 2 files, 32 tests passed (accountController now 24).
Full suite and typecheck re-run after the fix: see final results below.
Final: full suite 45 files / 546 tests passed; typecheck clean.
