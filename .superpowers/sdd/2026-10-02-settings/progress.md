# SDD ledger — plan: docs/superpowers/plans/2026-10-02-settings.md

Spec: docs/superpowers/specs/2026-10-02-settings-design.md (reachable; binding authority).
Execution: subagent-driven (user choice, 2026-10-02). Phase B gate cleared by interviewiq-50 (HUD Tasks 8+12 done).
Tooling: no commits in the real repo. Review diffs come from a shadow git at <workspace>/shadow.git (`snap` / `pkg` scripts). BASE/HEAD below are shadow SHAs.

## Setup rulings

- Ruling: work in the main working tree on `main`, no worktree — Phase B depends on uncommitted HUD files (components/hud/**) a worktree from HEAD would lack, and the user's standing rule + plan Global Constraints say "do not commit, leave changes in the working tree" — cost if wrong: the user's other uncommitted work shares the tree; mitigated by per-task scoped diffs and never touching git index/HEAD.
- Ruling: implementers do NOT commit (overrides the template's "commit your work") — user rule `feedback_no_auto_commit` + plan Global Constraints — cost if wrong: none; shadow snapshots stand in for commits.
- Ruling: review packages are built from shadow-git snapshots scoped to the task's paths instead of scripts/review-package — there are no real commits to diff — cost if wrong: a concurrent HUD-session edit inside a task's paths could appear in its diff; reviewers are told the tree is shared.

## Preflight scan

| Pair / task | Produces → consumes | Finding |
| --- | --- | --- |
| T1 → T2 | `parsePreferencesPatch`, `resolvePreferences`, `toSetPaths`, `DEFAULT_PREFERENCES` → PreferencesService + tests | names/signatures match |
| T2 → T3 | `accountRouter` in routes/account.ts, `auth()` test helper → T3 appends routes + tests | match; T3 adds imports to same files |
| T2 → T4 | `PreferencesService.get` → AccountExportService | match; container order "after preferences" OK |
| T2 → T6 | `UserPreferencesRepository.deleteByUserId`, `mongo.userPreferences` → deletion service + test | match |
| T3 → T6 | `clearRefreshTokenCookie`, local `parse(schema, value, code)` → DELETE route | match |
| T2/T3/T4/T6 | all edit routes/account.ts + container.ts | sequential edits; T6 replaces T2's `r.use(routerErrors(() => undefined))` — consistent |
| T4 → T6 | `SessionOutcomeRepository.findBySessionIds` (T4), `deleteBySessionIds` (T6) | no clash |
| T5 → T6 | AI `POST /users/purge {session_ids}` → `{deleted_plans}`; client `purgeUser` | wire shape matches both sides |
| T3 → T7 → T8 | `hasGoogle` in UserResponse → contract → generated `CurrentUser` → web | match |
| T7 → T8 | `Preferences`, `PreferencesPatch`, `DeleteAccountRequest`, `AccountExport` schemas → features/settings/types.ts | match |
| T8 → T9–T15 | hooks, `applyPatch`, device prefs, `__fixtures__/preferences.ts`, ROUTES.settings | names match across tasks |
| T9 → T10–T14 | SettingsCard/SettingRow/SwitchRow/Segmented/ChoiceTiles/ConfirmDialog/WithPreferences/HINTS | signatures match usages |
| T8 ↔ HUD | ROUTES.settings keys used by AccountMenu (account/notifications/privacy/billing) | preserved by T8's new group |
| T14 ↔ HUD | globals.css append; useReducedMotion edit | HUD finished its sweeps; low risk |
| T15 ↔ HUD | ProfileView / ProfileCard after HUD Task 8 | HUD reports ProfileCard same props; brief says re-read first |
| T1 self | tests ↔ code | consistent (zod 4 unrecognized_keys path = parent) |
| T2 self | tests ↔ code | consistent |
| T3 self | tests ↔ code; exact-shape user assertions elsewhere | brief covers app.test + passwordAuth + grep for others |
| T4 self | tests ↔ code | consistent |
| T5 self | tests ↔ code | consistent |
| T6 self | tests ↔ code | consistent; `json`/`status` both used |
| T7 self | contract ↔ API shapes | consistent (Preferences incl. updatedAt) |
| T8 self | tests ↔ code; hooks test relies on TanStack v5 counting a pending mutation during onSuccess | consistent; brief has fallback note |
| T9–T15 self | tests ↔ code | consistent (T14 sr label fixed during plan self-review) |
| T16 self | script ↔ routes mocked | consistent |
| Rubric vs plan | T3 `parse()` in account.ts near-duplicates auth.ts `parse()` (adds a `code` param) | Ruling below |
| Rubric vs plan | T8 identical onError toast lambdas in useSendPasswordLink + useResendVerification | Ruling below |

- Ruling: T3's local `parse(schema, value, code)` in routes/account.ts stays local (not shared with auth.ts) — different signature (code param), touching auth.ts's parse is outside the plan — cost if wrong: ~6 near-duplicate lines.
- Ruling: T8 extracts the duplicated "rate_limited vs generic" link-error toast into one local helper in features/settings/hooks.ts — removes verbatim duplication at zero scope cost — cost if wrong: none.

## Tasks
- Task 1: dispatched (implementer haiku, agent a13353ac459738493, BASE 3cc995d)
- Task 1: ⚠️ resolved — controller re-ran test/domain/preferences.test.ts: 12/12 pass.
- Task 1: minor (deferred): isTimeZone accepts case-variant zones (e.g. asia/kolkata) and stores them verbatim; could normalise via resolvedOptions().timeZone.
- Task 1: minor (deferred): no test for a whole stored section being null/array, or an empty patch section `{ locale: {} }` (code handles both).
- Task 1: complete (shadow 3cc995d..37782f0, review clean)
- Task 2: dispatched (implementer sonnet, BASE 37782f0)
- Task 2: ⚠️ resolved — controller re-ran accountController + candidateProfileController: 45/45 pass; mongodb driver ^7 (findOneAndUpdate returns the doc).
- Task 2: minor (deferred): no test of concurrent PATCHes to different leaves, nor that unsent leaves stay unstored in the raw doc.
- Task 2: minor (deferred): missing-body PATCH test asserts status only (plan-mandated).
- Task 2: complete (shadow 37782f0..e5ef36e, review clean)
- Task 3: dispatched (implementer sonnet, BASE e5ef36e)
- Task 3: implementer DONE_WITH_CONCERNS — linkGoogle still overwrites name on first Google link.
- Ruling: linkGoogle keeps the existing name when the account's email was already verified (clearPassword=false); it takes Google's name only in the anti-pre-hijacking case (clearPassword=true, a never-verified squatter's name must not survive) — spec/contract say "Google sign-ins no longer overwrite it" — cost if wrong: a verified password user linking Google keeps their typed name instead of Google's (arguably desired).
- Task 3: fix round 0 (pre-review, from implementer concern): linkGoogle name preserved unless clearPassword; 2 tests added.
- Task 3: ⚠️ resolved — only two exact user-shape toEqual assertions exist (both updated); controller re-ran accountController + googleAccountLinking + app.test: 44/44; upsertFromGoogle passes clearPassword = neverVerified (read earlier in userService.ts).
- Task 3: minor (deferred): revoke test checks `refresh_token=;` only — should also assert `Path=/api/v1/auth` and a past `Expires`.
- Task 3: minor (deferred): exported clearRefreshTokenCookie sits between REFRESH_* and OAUTH_* constants in auth.ts (split constant block).
- Task 3: minor (deferred): PATCH /users/me 404 branch (deleted user, valid token) untested.
- Task 3: complete (shadow e5ef36e..d63c2fc, review clean)
- Task 4: dispatched (implementer sonnet, BASE d63c2fc)
- Task 5: dispatched (implementer haiku, BASE 5bfe79e; runs while Task 4 is in review — disjoint paths apps/ai-service vs apps/api)
- Task 4: ⚠️ resolved — router mounted under /users/me since Task 2; 401 test covers gating.
- Task 4: minor (dismissed): "no Cache-Control: no-store on export" — app.ts already sets `Cache-Control: no-cache, no-store, max-age=0, must-revalidate` on every response.
- Task 4: minor (deferred): no-secrets test uses only a password user (googleSub exclusion checked by regex only); one seeded session (no multi-session / outcome-less case).
- Task 4: minor (deferred): AccountExport types connectedAt/lastRefreshedAt as Date while user.createdAt is ISO string (wire is string either way).
- Task 4: minor (deferred): container.ts import order for AccountExportService.
- Task 4: complete (shadow d63c2fc..5bfe79e, review clean)
- Task 6: dispatched (implementer sonnet, BASE 37a7cca; parallel with Task 5 review — disjoint paths)
- Task 5: ⚠️ resolved — plans keyed `sessionId` (repositories.get_plan/_plan_key); main.py `app.include_router(router)` has no prefix; the 1 full-suite failure is the known pre-existing config test (seen before this work).
- Task 5: minor (deferred): PurgeUserRequest.session_ids defaults to [] (a wrong body key silently purges nothing); route tested by direct call, not TestClient.
- Task 5: complete (shadow 5bfe79e..37a7cca, review clean)
- Task 6: STOPPED by user request ("kill all agents") after RED — partial state in shadow 3aec7b3 (test + most implementation files written across 8 files, NOT verified — tests not run green). Resume: re-dispatch Task 6 from BASE 37a7cca.
- Task 6: resumed per user ("finish the 6th part and no review"). Ruling: user waived the task review for Task 6 — cost if wrong: deletion code ships to the working tree with only the implementer's own tests as evidence.
- Task 6: complete (shadow 37a7cca..7fc9b19, review waived by user; implementer: 13/13 deletion tests, full API suite 563/563, typecheck clean; controller re-ran accountDeletion.test.ts)
