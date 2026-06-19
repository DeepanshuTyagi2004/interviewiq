# Design — Module-organized constants under `lib/constants/`

**Date:** 2026-06-14
**Repo:** `interviewiq-frontend` (`interviewIQ-frontend`)
**Branch context:** `feat/github-profile-builder-frontend`
**Status:** Approved — ready for implementation plan

---

## Goal

Establish a single, predictable home for constants, organized by module. Each
module gets one constants file; all hardcoded "magic" values for that module
(API paths, query keys, polling intervals, status enums) move out of components
and hooks into that file.

## Decisions (locked during brainstorming)

| Decision | Choice |
|----------|--------|
| Location | Extend the existing `lib/constants/` (not a new top-level `constants/`). |
| Scope | Scaffold the structure **and** migrate scattered constants, updating imports. |
| Modules | All 6 feature modules + `shared/`. |
| Categories to extract | Query keys, polling/timeouts, status enums, API paths. |
| File layout | **Approach A** — one `index.ts` per module, grouped `as const` objects. |

## Non-goals / out of scope (flagged, not done)

- **`EVENTS`** (`lib/analytics/events.ts`) — already centralized and tightly
  coupled to the analytics module and its `EventName` type. Left in place.
- **`PROVIDERS`** (`app/(app)/connections/_components/providers.ts`) and
  **`SOURCE_LABELS`** (`ConnectionButton.tsx`) — UI/display metadata, not in the
  selected categories. Left in place.
- **API path prefix inconsistency** (see below) — surfaced for a separate
  decision; this work relocates values verbatim and changes no behavior.

---

## Folder layout

```
lib/constants/
  shared/
    config.ts      # moved from lib/constants/config.ts  (APP_CONFIG)
    routes.ts      # moved from lib/constants/routes.ts   (ROUTES)
    endpoints.ts   # auth/platform paths (/api/v1/auth/refresh, /logout)
    index.ts       # barrel re-exporting config, routes, endpoints
  profile/index.ts   # endpoints, query keys, polling, status (real content)
  interview/index.ts # INTERVIEW_ENDPOINTS = { list: "/interviews" }
  jobs/index.ts      # JOBS_ENDPOINTS = { list: "/jobs" }
  loops/index.ts     # placeholder export (convention seed)
  billing/index.ts   # placeholder export
  admin/index.ts     # placeholder export
```

- **No root `lib/constants/index.ts` barrel.** Imports stay explicit per module
  (`@/lib/constants/profile`) for clarity and tree-shaking.
- One `index.ts` per module = the literal "one constants file per module" rule.
- `shared/` is the only subfolder with multiple files, because the existing
  global constants (`config`, `routes`) live there; a `shared/index.ts` barrel
  keeps importers on a single path (`@/lib/constants/shared`).

---

## Migration map (file by file)

### `shared/`
- Move `lib/constants/config.ts` → `lib/constants/shared/config.ts` (`APP_CONFIG`).
  - Importer to update: `lib/auth/client.ts` (1).
- Move `lib/constants/routes.ts` → `lib/constants/shared/routes.ts` (`ROUTES`).
  - Importers to update (~12): `app/(app)/dashboard/page.tsx`,
    `app/(app)/profile/connections/page.tsx`, `app/(app)/profile/page.tsx`,
    `app/(app)/onboarding/connections/page.tsx`, `app/(marketing)/layout.tsx`,
    `app/auth/callback/page.tsx`, `app/(marketing)/page.tsx`,
    `app/(auth)/layout.tsx`, `app/(auth)/login/page.tsx`,
    `components/nav-user.tsx`, `components/app-sidebar.tsx`,
    `components/auth/RequireAuth.tsx`.
- New `shared/endpoints.ts`:
  ```ts
  export const AUTH_ENDPOINTS = {
    refresh: "/api/v1/auth/refresh",
    logout: "/api/v1/auth/logout",
  } as const;
  ```
  - `lib/auth/client.ts` re-points its inline `/api/v1/auth/refresh` and
    `/api/v1/auth/logout` strings to `AUTH_ENDPOINTS`.
- `shared/index.ts` re-exports `config`, `routes`, `endpoints`.

### `profile/index.ts` (the real migration)
```ts
export const PROFILE_ENDPOINTS = {
  me: "/api/v1/profile/me",
  leetcodeConnection: "/api/v1/connections/leetcode",  // POST connect, DELETE disconnect
  githubConnection: "/api/v1/connections/github",      // DELETE disconnect
  githubAuthorize: "/api/v1/connections/github/authorize",
} as const;

export const PROFILE_QUERY_KEYS = {
  profile: ["profile", "me"] as const,
} as const;

export const PROFILE_POLLING = {
  syncIntervalMs: 5000,   // LeetCode card polls profile while status === SYNCING
} as const;

export const PROFILE_SYNC_STATUS = {
  syncing: "SYNCING",
  synced: "SYNCED",
  failed: "FAILED",
  degraded: "DEGRADED",
} as const;
```

Re-point existing usages:
- `features/profile/hooks/useProfile.ts` — `PROFILE_QUERY_KEY` → `PROFILE_QUERY_KEYS.profile`.
- `features/profile/hooks/{useConnectLeetCode,useDisconnectLeetCode,useDisconnectGithub}.ts` — same.
- `features/profile/index.ts` — update the re-export of the query key.
- `features/profile/api/{getMyProfile,connectLeetCode,disconnectLeetCode,disconnectGithub}.ts` — inline `/api/v1/...` → `PROFILE_ENDPOINTS.*`.
- `app/(app)/connections/_components/ConnectionButton.tsx` — `AUTHORIZE_PATH.GITHUB` literal → `PROFILE_ENDPOINTS.githubAuthorize`.
- `app/(app)/connections/_components/LeetCodeCard.tsx` — `5000` → `PROFILE_POLLING.syncIntervalMs`; `"SYNCING"`/`"FAILED"` comparisons → `PROFILE_SYNC_STATUS.*`.

Single source of truth for the status union:
- `features/profile/types/profile.ts` — change
  `export type SyncStatus = "SYNCING" | "SYNCED" | "FAILED" | "DEGRADED";`
  to
  `export type SyncStatus = (typeof PROFILE_SYNC_STATUS)[keyof typeof PROFILE_SYNC_STATUS];`
  (imported from `@/lib/constants/profile`). No drift between type and runtime values.

### `interview/index.ts` and `jobs/index.ts`
```ts
// interview
export const INTERVIEW_ENDPOINTS = { list: "/interviews" } as const;
// jobs
export const JOBS_ENDPOINTS = { list: "/jobs" } as const;
```
- `lib/api-client/endpoints/interview.ts` and `.../jobs.ts` import these instead
  of inlining the path strings.

### `loops/`, `billing/`, `admin/`
Placeholder to seed the convention (replaced as each module is built):
```ts
// lib/constants/<module>/index.ts
// Constants for the <module> module. Add grouped `as const` objects here
// following the <MODULE>_<CATEGORY> naming convention.
export {};
```

---

## ⚠️ Flagged inconsistency (separate decision)

`features/profile/api/*` use full `/api/v1/...` paths, but
`lib/api-client/endpoints/{interview,jobs}.ts` use bare `/interviews`, `/jobs`
(no `/api/v1` prefix). This migration **relocates values verbatim** — it does
not normalize the prefix, because doing so could change request URLs and break
calls. Whether to standardize on a single base prefix is a follow-up decision.

---

## Conventions (to document in `lib/constants/README.md`)

- One `index.ts` per module under `lib/constants/<module>/`.
- Export grouped objects, `as const`, named `<MODULE>_<CATEGORY>` in UPPER_SNAKE
  (e.g. `PROFILE_ENDPOINTS`, `PROFILE_QUERY_KEYS`, `PROFILE_POLLING`,
  `PROFILE_SYNC_STATUS`).
- Standard categories: `_ENDPOINTS`, `_QUERY_KEYS`, `_POLLING`, `_SYNC_STATUS`.
  Add new categories as needed; keep the `<MODULE>_<CATEGORY>` shape.
- Derive types from constants (`typeof X[keyof typeof X]`) — never duplicate the
  literal union in a separate `type`.
- Import per module: `import { PROFILE_POLLING } from "@/lib/constants/profile";`
  Shared globals: `import { ROUTES } from "@/lib/constants/shared";`

---

## Verification

All must pass before the work is considered complete:
- `npx tsc --noEmit` — catches any missed import path or type mismatch.
- `npx vitest run` — existing suites, notably:
  - `features/profile/hooks/useProfile.test.tsx` (asserts `/api/v1/profile/me`).
  - `app/(app)/connections/_components/ConnectionButton.test.tsx` (asserts
    `/api/v1/connections/github/authorize`).
- `npx eslint .` — no new lint errors.
- Manual grep confirms no remaining inline copies of the migrated literals
  (`5000` polling, the `/api/v1/...` paths, the status strings) outside the
  constants files.
