# Module-Organized Constants Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the frontend one predictable home for constants — `lib/constants/<module>/index.ts` per module — and migrate scattered API paths, query keys, polling intervals, and status enums into it.

**Architecture:** Extend the existing `lib/constants/`. Each feature module (profile, interview, jobs, loops, billing, admin) gets one `index.ts` exporting grouped `as const` objects named `<MODULE>_<CATEGORY>`. A `shared/` subfolder holds app-global constants (`APP_CONFIG`, `ROUTES`, auth endpoints) behind a single barrel `@/lib/constants/shared`. Consumers import per module. Types derive from the constant objects (no duplicated literal unions).

**Tech Stack:** Next.js 16 / React 19 / TypeScript, path alias `@/* → ./*`, TanStack Query v5, Vitest, ESLint.

**Spec:** `docs/superpowers/specs/2026-06-14-frontend-constants-folder-design.md`

**Note on TDD for this work:** This is a pure refactor — it relocates values and changes no behavior. The regression net is the TypeScript compiler (`npx tsc --noEmit`, which flags every missed/renamed import) plus the existing Vitest suites that already assert the exact API paths (`features/profile/hooks/useProfile.test.tsx` asserts `/api/v1/profile/me`; `app/(app)/connections/_components/ConnectionButton.test.tsx` asserts `/api/v1/connections/github/authorize`). New "constant equals literal" tests would be tautological, so each task verifies via `tsc` + the relevant existing tests rather than new failing tests. Task ordering keeps the build green after every commit.

---

## File Structure

**Created:**
- `lib/constants/profile/index.ts` — `PROFILE_ENDPOINTS`, `PROFILE_QUERY_KEYS`, `PROFILE_POLLING`, `PROFILE_SYNC_STATUS`
- `lib/constants/interview/index.ts` — `INTERVIEW_ENDPOINTS`
- `lib/constants/jobs/index.ts` — `JOBS_ENDPOINTS`
- `lib/constants/loops/index.ts` — placeholder
- `lib/constants/billing/index.ts` — placeholder
- `lib/constants/admin/index.ts` — placeholder
- `lib/constants/shared/endpoints.ts` — `AUTH_ENDPOINTS`
- `lib/constants/shared/index.ts` — barrel
- `lib/constants/shared/config.ts` — moved `APP_CONFIG` (Task 5)
- `lib/constants/shared/routes.ts` — moved `ROUTES` (Task 5)
- `lib/constants/README.md` — convention doc

**Deleted (Task 5):**
- `lib/constants/config.ts`
- `lib/constants/routes.ts`

**Modified:** profile hooks/api/types, `ConnectionButton.tsx`, `LeetCodeCard.tsx`, `lib/api-client/endpoints/{interview,jobs}.ts`, `lib/auth/client.ts`, and the 13 `ROUTES`/`APP_CONFIG` importers.

---

## Task 1: Scaffold the constants folder (additive only)

Creates every constants file and the conventions README. Nothing imports these yet, so the build stays green. Does **not** touch `lib/constants/config.ts` / `routes.ts` (moved in Task 5).

**Files:**
- Create: `lib/constants/profile/index.ts`
- Create: `lib/constants/interview/index.ts`
- Create: `lib/constants/jobs/index.ts`
- Create: `lib/constants/loops/index.ts`
- Create: `lib/constants/billing/index.ts`
- Create: `lib/constants/admin/index.ts`
- Create: `lib/constants/shared/endpoints.ts`
- Create: `lib/constants/shared/index.ts`
- Create: `lib/constants/README.md`

- [ ] **Step 1: Create `lib/constants/profile/index.ts`**

```ts
/**
 * Constants for the Profile module. One grouped `as const` object per category;
 * import per group, e.g. `import { PROFILE_ENDPOINTS } from "@/lib/constants/profile";`
 */

export const PROFILE_ENDPOINTS = {
  me: "/api/v1/profile/me",
  leetcodeConnection: "/api/v1/connections/leetcode", // POST connect, DELETE disconnect
  githubConnection: "/api/v1/connections/github", // DELETE disconnect
  githubAuthorize: "/api/v1/connections/github/authorize",
} as const;

export const PROFILE_QUERY_KEYS = {
  profile: ["profile", "me"] as const,
} as const;

export const PROFILE_POLLING = {
  /** LeetCode card polls the shared profile query at this cadence while a sync is in flight. */
  syncIntervalMs: 5000,
} as const;

export const PROFILE_SYNC_STATUS = {
  syncing: "SYNCING",
  synced: "SYNCED",
  failed: "FAILED",
  degraded: "DEGRADED",
} as const;
```

- [ ] **Step 2: Create `lib/constants/interview/index.ts`**

```ts
/** Constants for the Interview module. */
export const INTERVIEW_ENDPOINTS = {
  list: "/interviews",
} as const;
```

- [ ] **Step 3: Create `lib/constants/jobs/index.ts`**

```ts
/** Constants for the Jobs module. */
export const JOBS_ENDPOINTS = {
  list: "/jobs",
} as const;
```

- [ ] **Step 4: Create the three placeholder modules**

`lib/constants/loops/index.ts`:

```ts
// Constants for the Loops module.
// Add grouped `as const` objects named LOOPS_<CATEGORY> as the module is built.
export {};
```

`lib/constants/billing/index.ts`:

```ts
// Constants for the Billing module.
// Add grouped `as const` objects named BILLING_<CATEGORY> as the module is built.
export {};
```

`lib/constants/admin/index.ts`:

```ts
// Constants for the Admin module.
// Add grouped `as const` objects named ADMIN_<CATEGORY> as the module is built.
export {};
```

- [ ] **Step 5: Create `lib/constants/shared/endpoints.ts`**

```ts
/** Auth / platform API paths (not owned by any single feature module). */
export const AUTH_ENDPOINTS = {
  refresh: "/api/v1/auth/refresh",
  logout: "/api/v1/auth/logout",
} as const;
```

- [ ] **Step 6: Create `lib/constants/shared/index.ts`**

Barrel. Only `endpoints` exists now; `config` and `routes` are added in Task 5.

```ts
export * from "./endpoints";
```

- [ ] **Step 7: Create `lib/constants/README.md`**

```markdown
# Constants

Constants live here, organized by module. One `index.ts` per module.

## Convention

- One file per module: `lib/constants/<module>/index.ts`.
- Export grouped objects, `as const`, named `<MODULE>_<CATEGORY>` (UPPER_SNAKE):
  `PROFILE_ENDPOINTS`, `PROFILE_QUERY_KEYS`, `PROFILE_POLLING`, `PROFILE_SYNC_STATUS`.
- Standard categories: `_ENDPOINTS`, `_QUERY_KEYS`, `_POLLING`, `_SYNC_STATUS`.
  Add others as needed; keep the `<MODULE>_<CATEGORY>` shape.
- Derive types from constants (`type T = (typeof X)[keyof typeof X]`) — never
  duplicate the literal union in a separate `type`.
- `shared/` holds app-global constants (`APP_CONFIG`, `ROUTES`, auth endpoints)
  behind one barrel: `import { ROUTES } from "@/lib/constants/shared";`.
- Import feature constants per module: `import { PROFILE_POLLING } from "@/lib/constants/profile";`.

## Known follow-up

API path prefixes are inconsistent: profile/auth use `/api/v1/...`, while
`interview`/`jobs` use bare `/interviews`, `/jobs`. Values were relocated
verbatim during the initial migration; normalizing the prefix is a separate task.
```

- [ ] **Step 8: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: exits 0, no errors (new files are valid; unused exports are fine).

- [ ] **Step 9: Commit**

```bash
git add lib/constants/profile lib/constants/interview lib/constants/jobs \
  lib/constants/loops lib/constants/billing lib/constants/admin \
  lib/constants/shared lib/constants/README.md
git commit -m "feat(constants): scaffold per-module constants folders"
```

---

## Task 2: Migrate the Profile module to its constants

Re-point all profile query keys, polling interval, status literals, and API paths to `@/lib/constants/profile`, and derive `SyncStatus` from the constant.

**Files:**
- Modify: `features/profile/types/profile.ts:7-10`
- Modify: `features/profile/hooks/useProfile.ts`
- Modify: `features/profile/hooks/useConnectLeetCode.ts:5,16`
- Modify: `features/profile/hooks/useDisconnectLeetCode.ts:5,12`
- Modify: `features/profile/hooks/useDisconnectGithub.ts:5,12`
- Modify: `features/profile/index.ts:7`
- Modify: `features/profile/api/getMyProfile.ts`
- Modify: `features/profile/api/connectLeetCode.ts`
- Modify: `features/profile/api/disconnectLeetCode.ts`
- Modify: `features/profile/api/disconnectGithub.ts`
- Modify: `app/(app)/connections/_components/ConnectionButton.tsx:10-13`
- Modify: `app/(app)/connections/_components/LeetCodeCard.tsx:17-22,53-58,73,139-165`
- Test (existing): `features/profile/hooks/useProfile.test.tsx`, `app/(app)/connections/_components/ConnectionButton.test.tsx`

- [ ] **Step 1: Derive `SyncStatus` from the constant in `features/profile/types/profile.ts`**

Replace lines 7-10:

```ts
export type SourceKind = "GITHUB" | "RESUME" | "LEETCODE" | "LINKEDIN" | "X";

/** Background-collection lifecycle for sources that sync asynchronously (currently LeetCode). */
export type SyncStatus = "SYNCING" | "SYNCED" | "FAILED" | "DEGRADED";
```

with (note the new import — place it directly under the opening block comment, before `export type SourceKind`):

```ts
import { PROFILE_SYNC_STATUS } from "@/lib/constants/profile";

export type SourceKind = "GITHUB" | "RESUME" | "LEETCODE" | "LINKEDIN" | "X";

/** Background-collection lifecycle for sources that sync asynchronously (currently LeetCode). */
export type SyncStatus = (typeof PROFILE_SYNC_STATUS)[keyof typeof PROFILE_SYNC_STATUS];
```

- [ ] **Step 2: Rewrite `features/profile/hooks/useProfile.ts`**

Replace the whole file with:

```ts
"use client";

import { useQuery } from "@tanstack/react-query";
import { PROFILE_QUERY_KEYS } from "@/lib/constants/profile";
import { getMyProfile } from "../api/getMyProfile";
import type { ProfileResponse } from "../types/profile";

/**
 * @param options.refetchInterval poll the profile on this interval (ms). Used by the LeetCode card
 *   to watch an async sync flip to SYNCED/FAILED. The query is shared, so this only polls while a
 *   consumer requests it; pass `false` (default) for no polling.
 */
export function useProfile(options?: { refetchInterval?: number | false }) {
  return useQuery<ProfileResponse>({
    queryKey: PROFILE_QUERY_KEYS.profile,
    queryFn: getMyProfile,
    refetchInterval: options?.refetchInterval ?? false,
  });
}
```

(The local `export const PROFILE_QUERY_KEY` is removed — its only consumers are migrated in the next steps.)

- [ ] **Step 3: Update the three mutation hooks**

In each of `useConnectLeetCode.ts`, `useDisconnectLeetCode.ts`, `useDisconnectGithub.ts`:

Replace the import line:

```ts
import { PROFILE_QUERY_KEY } from "./useProfile";
```

with:

```ts
import { PROFILE_QUERY_KEYS } from "@/lib/constants/profile";
```

And replace the invalidation line:

```ts
      void queryClient.invalidateQueries({ queryKey: PROFILE_QUERY_KEY });
```

with:

```ts
      void queryClient.invalidateQueries({ queryKey: PROFILE_QUERY_KEYS.profile });
```

- [ ] **Step 4: Update the barrel `features/profile/index.ts:7`**

Replace:

```ts
export { useProfile, PROFILE_QUERY_KEY } from "./hooks/useProfile";
```

with:

```ts
export { useProfile } from "./hooks/useProfile";
```

- [ ] **Step 5: Update the four `features/profile/api/*.ts` files**

`getMyProfile.ts` — replace whole file:

```ts
import { apiFetch } from "@/lib/api-client/client";
import { PROFILE_ENDPOINTS } from "@/lib/constants/profile";
import type { ProfileResponse } from "../types/profile";

/** GET /api/v1/profile/me → consolidated, read-only profile. */
export function getMyProfile(): Promise<ProfileResponse> {
  return apiFetch<ProfileResponse>(PROFILE_ENDPOINTS.me);
}
```

`connectLeetCode.ts` — add the import and swap the path:

```ts
import { apiFetch } from "@/lib/api-client/client";
import { PROFILE_ENDPOINTS } from "@/lib/constants/profile";

export interface LeetCodeConnectResponse {
  username: string;
  status: string;
}

/**
 * POST /api/v1/connections/leetcode → 202 Accepted. Validates the username synchronously
 * (throws ApiFetchError with a `code` for not-found / private) and starts background collection.
 */
export function connectLeetCode(username: string): Promise<LeetCodeConnectResponse> {
  return apiFetch<LeetCodeConnectResponse>(PROFILE_ENDPOINTS.leetcodeConnection, {
    method: "POST",
    json: { username },
  });
}
```

`disconnectLeetCode.ts` — replace whole file:

```ts
import { apiFetch } from "@/lib/api-client/client";
import { PROFILE_ENDPOINTS } from "@/lib/constants/profile";

/** DELETE /api/v1/connections/leetcode → 204 (connection + LeetCode fragment removed). */
export function disconnectLeetCode(): Promise<void> {
  return apiFetch<void>(PROFILE_ENDPOINTS.leetcodeConnection, { method: "DELETE" });
}
```

`disconnectGithub.ts` — replace whole file:

```ts
import { apiFetch } from "@/lib/api-client/client";
import { PROFILE_ENDPOINTS } from "@/lib/constants/profile";

/** DELETE /api/v1/connections/github → 204 (token + GitHub fragment removed). */
export function disconnectGithub(): Promise<void> {
  return apiFetch<void>(PROFILE_ENDPOINTS.githubConnection, { method: "DELETE" });
}
```

- [ ] **Step 6: Update `app/(app)/connections/_components/ConnectionButton.tsx`**

Add the import after line 7 (`import type { SourceKind } ...`):

```ts
import { PROFILE_ENDPOINTS } from "@/lib/constants/profile";
```

Replace the `AUTHORIZE_PATH` literal (lines 10-13):

```ts
/** Maps a source to its backend authorize endpoint. Only GitHub is live. */
const AUTHORIZE_PATH: Partial<Record<SourceKind, string>> = {
  GITHUB: "/api/v1/connections/github/authorize",
};
```

with:

```ts
/** Maps a source to its backend authorize endpoint. Only GitHub is live. */
const AUTHORIZE_PATH: Partial<Record<SourceKind, string>> = {
  GITHUB: PROFILE_ENDPOINTS.githubAuthorize,
};
```

- [ ] **Step 7: Update `app/(app)/connections/_components/LeetCodeCard.tsx`**

7a. Extend the `@/features/profile` import block (lines 17-22) with the constants import directly after it:

```ts
import {
  useProfile,
  useConnectLeetCode,
  useDisconnectLeetCode,
  type SyncStatus,
} from "@/features/profile";
import { PROFILE_POLLING, PROFILE_SYNC_STATUS } from "@/lib/constants/profile";
```

7b. Replace the `SYNC_BADGE` map (lines 53-58) with computed keys:

```ts
const SYNC_BADGE: Record<SyncStatus, { label: string; variant: "secondary" | "destructive" | "outline" }> = {
  [PROFILE_SYNC_STATUS.syncing]: { label: "Syncing…", variant: "secondary" },
  [PROFILE_SYNC_STATUS.synced]: { label: "Synced", variant: "secondary" },
  [PROFILE_SYNC_STATUS.failed]: { label: "Sync failed", variant: "destructive" },
  [PROFILE_SYNC_STATUS.degraded]: { label: "Limited data", variant: "outline" },
};
```

7c. Replace the polling line (line 73):

```ts
  useProfile({ refetchInterval: status === "SYNCING" ? 5000 : false });
```

with:

```ts
  useProfile({ refetchInterval: status === PROFILE_SYNC_STATUS.syncing ? PROFILE_POLLING.syncIntervalMs : false });
```

7d. Replace the four remaining status comparisons (lines 139, 147, 152, 158, 165) — change each `status === "<LITERAL>"` to the constant:

- `status === "SYNCED"` → `status === PROFILE_SYNC_STATUS.synced`
- `status === "SYNCING"` → `status === PROFILE_SYNC_STATUS.syncing`
- `status === "DEGRADED"` → `status === PROFILE_SYNC_STATUS.degraded`
- `status === "FAILED"` → `status === PROFILE_SYNC_STATUS.failed` (both occurrences on lines 158 and 165)

- [ ] **Step 8: Verify types compile**

Run: `npx tsc --noEmit`
Expected: exits 0, no errors.

- [ ] **Step 9: Run the profile + connection tests**

Run: `npx vitest run features/profile/hooks/useProfile.test.tsx "app/(app)/connections/_components/ConnectionButton.test.tsx"`
Expected: PASS (these assert `/api/v1/profile/me` and `/api/v1/connections/github/authorize`, which now resolve through the constants).

- [ ] **Step 10: Confirm no profile literals remain outside the constants file**

Run: `grep -rnE "\"/api/v1/(profile|connections)|\bPROFILE_QUERY_KEY\b|=== \"(SYNCING|SYNCED|FAILED|DEGRADED)\"|refetchInterval: status .* 5000" features/profile app/\(app\)/connections`
Expected: no matches (every occurrence now goes through `@/lib/constants/profile`).

- [ ] **Step 11: Commit**

```bash
git add features/profile app/\(app\)/connections/_components/ConnectionButton.tsx \
  app/\(app\)/connections/_components/LeetCodeCard.tsx
git commit -m "refactor(profile): source constants from lib/constants/profile"
```

---

## Task 3: Migrate Interview + Jobs endpoint constants

**Files:**
- Modify: `lib/api-client/endpoints/interview.ts`
- Modify: `lib/api-client/endpoints/jobs.ts`

- [ ] **Step 1: Update `lib/api-client/endpoints/interview.ts`**

Replace whole file:

```ts
import { apiFetch } from "../client";
import { INTERVIEW_ENDPOINTS } from "@/lib/constants/interview";

export const interviewApi = {
  list: () => apiFetch(INTERVIEW_ENDPOINTS.list),
  // TODO: add interview endpoints
};
```

- [ ] **Step 2: Update `lib/api-client/endpoints/jobs.ts`**

Replace whole file:

```ts
import { apiFetch } from "../client";
import { JOBS_ENDPOINTS } from "@/lib/constants/jobs";

export const jobsApi = {
  list: () => apiFetch(JOBS_ENDPOINTS.list),
  // TODO: add jobs endpoints
};
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: exits 0, no errors.

- [ ] **Step 4: Commit**

```bash
git add lib/api-client/endpoints/interview.ts lib/api-client/endpoints/jobs.ts
git commit -m "refactor(api): source interview/jobs paths from lib/constants"
```

---

## Task 4: Migrate auth endpoints to `shared`

**Files:**
- Modify: `lib/auth/client.ts:40,61` (and add an import)

- [ ] **Step 1: Add the import to `lib/auth/client.ts`**

Directly under the existing `import { APP_CONFIG } from "@/lib/constants/config";` (line 16), add:

```ts
import { AUTH_ENDPOINTS } from "@/lib/constants/shared";
```

- [ ] **Step 2: Swap the refresh path (line 40)**

Replace:

```ts
    res = await fetch(`${API_URL}/api/v1/auth/refresh`, {
```

with:

```ts
    res = await fetch(`${API_URL}${AUTH_ENDPOINTS.refresh}`, {
```

- [ ] **Step 3: Swap the logout path (line 61)**

Replace:

```ts
    await fetch(`${API_URL}/api/v1/auth/logout`, {
```

with:

```ts
    await fetch(`${API_URL}${AUTH_ENDPOINTS.logout}`, {
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit`
Expected: exits 0, no errors.

- [ ] **Step 5: Commit**

```bash
git add lib/auth/client.ts
git commit -m "refactor(auth): source auth paths from lib/constants/shared"
```

---

## Task 5: Move `APP_CONFIG` + `ROUTES` into `shared/` (atomic)

Physically relocate the two existing global constants into `shared/`, update the barrel, delete the old files, and re-point all 13 importers in one commit so the build never breaks.

**Files:**
- Create: `lib/constants/shared/config.ts`
- Create: `lib/constants/shared/routes.ts`
- Modify: `lib/constants/shared/index.ts`
- Delete: `lib/constants/config.ts`
- Delete: `lib/constants/routes.ts`
- Modify (12 × `ROUTES`): `app/(app)/dashboard/page.tsx:5`, `app/(app)/profile/connections/page.tsx:2`, `app/(app)/profile/page.tsx:5`, `app/(app)/onboarding/connections/page.tsx:2`, `app/(marketing)/layout.tsx:2`, `app/auth/callback/page.tsx:6`, `app/(marketing)/page.tsx:2`, `app/(auth)/layout.tsx:2`, `app/(auth)/login/page.tsx:6`, `components/nav-user.tsx:23`, `components/app-sidebar.tsx:23`, `components/auth/RequireAuth.tsx:6`
- Modify (1 × `APP_CONFIG`): `lib/auth/client.ts:16`

- [ ] **Step 1: Create `lib/constants/shared/config.ts`**

```ts
export const APP_CONFIG = {
  name: "InterviewIQ",
  description: "Interview preparation platform",
  apiUrl: process.env.NEXT_PUBLIC_API_URL ?? "",
  posthogKey: process.env.NEXT_PUBLIC_POSTHOG_KEY ?? "",
} as const;
```

- [ ] **Step 2: Create `lib/constants/shared/routes.ts`**

```ts
export const ROUTES = {
  home: "/",
  pricing: "/pricing",
  forColleges: "/for-colleges",
  about: "/about",
  contact: "/contact",
  login: "/login",
  signup: "/signup",
  forgotPassword: "/forgot-password",
  verifyEmail: "/verify-email",
  dashboard: "/dashboard",
  practice: "/practice",
  leaderboard: "/leaderboard",
  help: "/help",
  onboarding: "/onboarding",
  profile: "/profile",
  connections: "/connections",
  jobs: "/jobs",
  loops: "/loops",
  settings: {
    account: "/settings/account",
    billing: "/settings/billing",
    notifications: "/settings/notifications",
    privacy: "/settings/privacy",
  },
  admin: {
    dashboard: "/admin/dashboard",
    batches: "/admin/batches",
    reports: "/admin/reports",
    settings: "/admin/settings",
    students: "/admin/students",
    drives: "/admin/drives",
  },
} as const;
```

- [ ] **Step 3: Update the barrel `lib/constants/shared/index.ts`**

Replace the whole file with:

```ts
export * from "./config";
export * from "./routes";
export * from "./endpoints";
```

- [ ] **Step 4: Delete the old files**

```bash
git rm lib/constants/config.ts lib/constants/routes.ts
```

- [ ] **Step 5: Re-point the 12 `ROUTES` importers**

In each of the 12 files listed above, replace:

```ts
import { ROUTES } from "@/lib/constants/routes";
```

with:

```ts
import { ROUTES } from "@/lib/constants/shared";
```

(Sweep command to do all 12 at once, then eyeball `git diff`:)

```bash
grep -rl 'from "@/lib/constants/routes"' app components \
  | xargs sed -i '' 's#from "@/lib/constants/routes"#from "@/lib/constants/shared"#g'
```

- [ ] **Step 6: Re-point the `APP_CONFIG` importer in `lib/auth/client.ts:16`**

Replace:

```ts
import { APP_CONFIG } from "@/lib/constants/config";
```

with:

```ts
import { APP_CONFIG } from "@/lib/constants/shared";
```

- [ ] **Step 7: Verify nothing still references the old paths**

Run: `grep -rnE "@/lib/constants/(routes|config)" app features components lib hooks`
Expected: no matches.

- [ ] **Step 8: Verify types compile**

Run: `npx tsc --noEmit`
Expected: exits 0, no errors.

- [ ] **Step 9: Commit**

```bash
git add lib/constants/shared lib/auth/client.ts app components
git commit -m "refactor(constants): move APP_CONFIG + ROUTES into shared/"
```

---

## Task 6: Full verification sweep

**Files:** none (verification only).

- [ ] **Step 1: Type-check the whole project**

Run: `npx tsc --noEmit`
Expected: exits 0, no errors.

- [ ] **Step 2: Run the full test suite**

Run: `npx vitest run`
Expected: all suites PASS (no regressions).

- [ ] **Step 3: Lint**

Run: `npx eslint .`
Expected: no new errors. (If the repo uses `npm run lint`, run that instead.)

- [ ] **Step 4: Confirm the final folder shape**

Run: `find lib/constants -type f | sort`
Expected:

```
lib/constants/README.md
lib/constants/admin/index.ts
lib/constants/billing/index.ts
lib/constants/interview/index.ts
lib/constants/jobs/index.ts
lib/constants/loops/index.ts
lib/constants/profile/index.ts
lib/constants/shared/config.ts
lib/constants/shared/endpoints.ts
lib/constants/shared/index.ts
lib/constants/shared/routes.ts
```

- [ ] **Step 5: Confirm no stray migrated literals remain**

Run: `grep -rnE "\"/api/v1/auth/(refresh|logout)\"|\"/interviews\"|\"/jobs\"" lib/api-client lib/auth | grep -v "lib/constants"`
Expected: no matches (auth/interview/jobs paths now come from constants).

---

## Self-Review

- **Spec coverage:** §"Folder layout" → Task 1 + Task 5. §"shared/" → Tasks 1, 4, 5. §"profile/index.ts" incl. SyncStatus single-source-of-truth → Task 2. §"interview/jobs" → Tasks 1, 3. §"loops/billing/admin placeholders" → Task 1. §"Conventions README" → Task 1 Step 7. §"Verification" (tsc, vitest, eslint, grep) → Task 6. Flagged prefix inconsistency → documented in README, not silently changed. All covered.
- **Placeholder scan:** No "TBD"/"implement later". The three placeholder module files are intentional `export {}` stubs (called out as such), not plan gaps.
- **Type consistency:** `PROFILE_ENDPOINTS` keys (`me`, `leetcodeConnection`, `githubConnection`, `githubAuthorize`), `PROFILE_QUERY_KEYS.profile`, `PROFILE_POLLING.syncIntervalMs`, `PROFILE_SYNC_STATUS.{syncing,synced,failed,degraded}`, `INTERVIEW_ENDPOINTS.list`, `JOBS_ENDPOINTS.list`, `AUTH_ENDPOINTS.{refresh,logout}` are referenced identically in every consuming task. `SyncStatus` derived once in Task 2 Step 1; consumers (`SYNC_BADGE`, comparisons) use `PROFILE_SYNC_STATUS.*`.
- **Build-green ordering:** Task 1 is additive; Tasks 2–4 re-point onto files that already exist from Task 1; Task 5's move is atomic (create + barrel + delete + re-point in one commit). `@/lib/constants/shared` is valid from Task 1 (barrel ships with `endpoints` first), so Task 4 can import from it before Task 5 adds config/routes.
