# Candidate role Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `CANDIDATE` role; only `CANDIDATE` and `ADMIN` may book, reschedule, retry prep or enter a live round.

**Architecture:** The role enum gains `CANDIDATE`. A small `InterviewAccess` service checks the user's role in the database and is called first in the gated session and live service methods. The web app reads the role from `/users/me`, hides or disables the same entry points, and the Access Control panel manages three roles.

**Tech Stack:** Express 5, Drizzle (no migration), zod config, Vitest (API), Next.js 16, TanStack Query, openapi-typescript.

**Spec:** `docs/superpowers/specs/2026-10-21-candidate-role-design.md`

## Global Constraints

- Roles are exactly `USER`, `CANDIDATE`, `ADMIN`. `app_user.role` is `varchar(16)`; add no migration.
- New error: HTTP 403, code `interview_access_required`, message `Interview access has not been granted to your account yet. Ask an admin.`
- Last-admin demotion: HTTP 409, code `last_admin`.
- Web copy for a blocked user: `Ask an admin for interview access`.
- Do not run vitest, tsc, eslint or pytest (owner rule); write the tests anyway. Do not commit (owner commits).
- `ADMIN_EMAILS` bootstrap behaviour is unchanged. Admin-path gating keeps using the token claim.
- Use the word "resume", never "résumé", in user-facing copy.
- A Read hook may truncate repeat reads to line 1; use offset+limit.

## Review Focus

- An `ADMIN` with a stale token that says `USER` (or the reverse): the database role decides interview access.
- A promoted user's next call succeeds without re-login (database read, not token).
- Demoting the only admin, and an admin changing their own role.
- A `USER` with a session booked earlier: list, get, cancel, report still work; reschedule, retry prep, go live, warm are 403.
- `LIVE_INTERVIEWER_AVAILABLE=false` blocks everyone, including admins, with the existing `live_unavailable`.

---

### Task 1: API role and interview-access gate

**Files:**
- Modify: `apps/api/src/domain/enums.ts:5`, `apps/api/src/auth/jwt.ts:45`, `apps/api/src/container.ts` (~147-213), `apps/api/src/services/interviewSessions.ts` (createSession :220, reschedule :317, retryPrep :355), `apps/api/src/services/liveSessions.ts` (startLive :75, warm :115), `apps/api/src/services/liveAvailability.ts`, `apps/api/src/config.ts:109-111,171-172`, `apps/api/.env.example`
- Create: `apps/api/src/services/interviewAccess.ts`
- Test: `apps/api/test/services/interviewAccess.test.ts`, `apps/api/test/services/liveAvailability.test.ts` (rewrite), extend `apps/api/test/support/harness.ts` `createUser` to accept `role: "CANDIDATE"`

**Interfaces:**
- Produces: `class InterviewAccess { constructor(users: UserRepository); assertCanInterview(userId: string): Promise<void> }` throwing `ApiError` (status 403, code `interview_access_required`). Produces `ROLES = ["USER","CANDIDATE","ADMIN"] as const`. `LiveAvailability` becomes `constructor(globalOn: boolean)` with `isAvailableFor(userId: string): boolean` returning `globalOn`.

- [ ] **Step 1: Write failing tests.** `interviewAccess.test.ts`: `USER` rejects with code `interview_access_required` and status 403; `CANDIDATE` and `ADMIN` resolve; an unknown user id rejects with the same code. Service-level: with a `USER`, `createSession`, `reschedule`, `retryPrep`, `startLive` and `warm` each reject with `interview_access_required`; `listSessions`, `getSession` and `cancel` still work; after `repos.users.updateRole(id, "CANDIDATE")` the very next `createSession` call is not rejected for access. `liveAvailability.test.ts`: flag false returns false for everyone; true returns true.
- [ ] **Step 2: Implement.** Add `CANDIDATE` to `ROLES`; accept it in `jwt.ts` role coercion. Write `InterviewAccess` reading the user via the existing users repository `findById`-style method (use the one that exists; name it in your report). Construct it in `container.ts`, inject into `InterviewSessionService` and `LiveSessionService`, call `await this.access.assertCanInterview(userId)` as the first statement of the five methods above. Remove the allowlist from `LiveAvailability`, `config.ts` (both lines) and `.env.example`; fix `container.ts:201` accordingly.
- [ ] **Step 3: Map the error.** Confirm `ApiError` subclasses already map to `{code,message}` in the interviews router; if routes map errors by type, add the new one there.

### Task 2: Admin role route, last-admin guard and contract

**Files:**
- Modify: `apps/api/src/routes/admin.ts:291-305`, `apps/api/src/services/userService.ts` (role update), `apps/api/src/repositories/pg.ts` (add `countByRole(role: Role): Promise<number>`), `packages/contracts/openapi.yaml` (Role :2607, CurrentUser, new admin users paths and `AdminUser` schema, 403/409 docs on gated routes :857, :976, :1107, :1006, :1565)
- Test: `apps/api/test/admin.test.ts` (create or extend the file that holds the existing admin-user tests)

**Interfaces:**
- Consumes: `ROLES` from Task 1.
- Produces: `PATCH /api/v1/admin/users/{id}/role` accepting `USER|CANDIDATE|ADMIN`; `UserService.updateRole(id, role)` throws `ApiError` 409 `last_admin` when it would remove the last `ADMIN`.

- [ ] **Step 1: Write failing tests:** admin sets `CANDIDATE` (200, response role `CANDIDATE`); unknown role 400 `invalid_role` with message `role must be USER, CANDIDATE or ADMIN`; demoting the only admin 409 `last_admin`; demoting one of two admins 200; a non-admin gets 403 `forbidden`; `GET /api/v1/admin/users` includes the new role.
- [ ] **Step 2: Implement** the guard (check `countByRole("ADMIN")` when the target is currently `ADMIN` and the new role is not) and update validation text.
- [ ] **Step 3: Contract:** `Role` enum adds `CANDIDATE`; add the two admin paths with `AdminUser {id,email,name,role,onboardingComplete,emailVerified,hasPassword,hasGoogle}`; document `interview_access_required` and `last_admin`.

### Task 3: Web gate on interview entry points

**Files:**
- Modify: `apps/web/lib/hooks/useCurrentUser.ts` (add `canInterview`), regenerated `apps/web/lib/api-client/generated/schema.d.ts` (run `pnpm contracts:types` after Task 2), `features/loops/errors.ts:4-18`, and the entry points: `app/(app)/interviews/_components/BookingForm.tsx` (:148-174, :358-366), `features/loops/components/SlotDialog.tsx` (:51-107), `app/(app)/jobs/[jobId]/_components/RoundCard.tsx:108` and `ProcessTab.tsx:24`, `features/loops/components/FlowNodes.tsx:129-136`, `app/(app)/loops/_components/LoopCard.tsx:72`, `app/(app)/dashboard/_components/CalendarCard.tsx:253`, `app/(app)/interviews/[sessionId]/report/_components/ReportView.tsx:52-74` and `ReportUnscorable.tsx:26`, `app/(app)/interviews/_components/RetryPrepButton.tsx`, `interviews/[sessionId]/_components/SessionAction.tsx:21-40`, `interviews/_components/SessionsList.tsx:28-43`, `dashboard/_components/UpNextCard.tsx:110-117`
- Create: `apps/web/components/auth/InterviewAccessNote.tsx` (small inline note component, text `Ask an admin for interview access`)
- Test: `apps/web/tests/` unit test for `canInterview` (USER false, CANDIDATE true, ADMIN true, loading false) and for `bookingError('interview_access_required')`

**Interfaces:**
- Consumes: `Role` generated type including `CANDIDATE`.
- Produces: `useCurrentUser()` returns `canInterview: boolean`; `<InterviewAccessNote />`.

- [ ] **Step 1: Write the failing tests** named above.
- [ ] **Step 2: Implement** `canInterview = role === "CANDIDATE" || role === "ADMIN"`; at each entry point, when `!canInterview`, render the note (or a disabled control with the same text as its title) instead of the action. Keep links that only view (`/interviews/{id}`, cancel) working. Map the new error code in `bookingError` and in `RetryPrepButton`'s error toast.
- [ ] **Step 3: Remove the hand-written `AdminUser`** in `features/intelligence/types.ts:163-168` in favour of the generated schema type; fix imports.

### Task 4: Access Control panel and deploy config

**Files:**
- Modify: `apps/web/app/(app)/intelligence/_components/AccessControlPanel.tsx` (:18-31, :72-93), `features/intelligence/api.ts:75-80` and `hooks.ts:111-121` only if types change, `render.yaml` (`LIVE_INTERVIEWER_AVAILABLE` to `"true"`, delete `LIVE_INTERVIEWER_ALLOWLIST`), `infra/.env.example` and `apps/ai-service` docs only where they mention the allowlist (search `LIVE_INTERVIEWER_ALLOWLIST` repo-wide, excluding node_modules and the specs/plans folders)
- Test: `apps/web/tests/` component test for the panel: three roles shown, change fires `PATCH` with the chosen role, the self row is disabled, a `last_admin` error shows the alert

- [ ] **Step 1: Write the failing panel test.**
- [ ] **Step 2: Implement** a role `<select>` per row (options Candidate, User, Admin), disabled for the signed-in user, calling `useUpdateUserRole`; show a pill with the role; surface `last_admin` as `Cannot remove the last admin`.
- [ ] **Step 3: Update `render.yaml` and the allowlist references;** report each file touched.
- [ ] **Step 4: Update `CLAUDE.md` mentions** of the allowlist or two-role model in `apps/api/CLAUDE.md` (one line each).
