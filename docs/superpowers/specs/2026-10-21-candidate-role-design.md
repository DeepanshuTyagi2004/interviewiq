# Candidate role: who may give interviews

Date: 2026-10-21. Status: approved in chat by the owner ("implement"); no builder check run.

## Intent

New signups can onboard and use the dashboard, profile, jobs and loops, but cannot give mock interviews until an admin promotes them. The owner wants to open the dev deployment to a few trusted people without paying LLM cost for everyone.

## Decided by the owner

- Roles become `USER`, `CANDIDATE`, `ADMIN`. New signups are `USER`.
- A `USER` is blocked from booking, scheduling, rescheduling, retaking, preparing (retry prep) and entering the live room. `CANDIDATE` and `ADMIN` can do all of it.
- Admins promote and demote between `USER` and `CANDIDATE` (and `ADMIN`) in the Access Control panel.
- Existing accounts stay plain `USER` (no promotion migration).
- The server enforces it; the UI only reflects it.

## Calls made without the owner (check these)

1. `ADMIN` has every `CANDIDATE` right.
2. Role is read from the database on each interview-gated call, not from the access token, so a promotion works at once. Admin-path gating still uses the token claim (unchanged, out of scope).
3. Existing `ADMIN` rows are untouched. There is no data migration: `app_user.role` is a plain `varchar(16)` (no pg enum or CHECK), so `CANDIDATE` fits.
4. `LIVE_INTERVIEWER_AVAILABLE` stays as a global off switch. `LIVE_INTERVIEWER_ALLOWLIST` is removed everywhere (config, `.env.example`, `render.yaml`, tests), since the role replaces it. Live entry needs the switch on and a `CANDIDATE`/`ADMIN` role.
5. Sessions a `USER` booked earlier are left in place; they just cannot go live, retry prep or reschedule until promoted. Viewing and cancelling stay allowed.
6. Role change guards: the last remaining `ADMIN` cannot be demoted (409 `last_admin`). Bootstrap `ADMIN_EMAILS` behaviour is unchanged (promotes on sign-in, never demotes).
7. New error: HTTP 403, code `interview_access_required`, message "Interview access has not been granted to your account yet. Ask an admin."

## Non-goals

No change to scoring, gating, cooldowns, readiness, billing or the live interviewer logic. No new auth provider. No permissions framework beyond these three roles.

## API changes (`apps/api`)

- `src/domain/enums.ts`: `ROLES = ["USER","CANDIDATE","ADMIN"]`.
- `src/auth/jwt.ts:45`: accept `CANDIDATE` when reading the claim.
- New `src/services/interviewAccess.ts`: `assertCanInterview(userId)` loads the user row (users repo) and throws an `ApiError` (403, `interview_access_required`) unless role is `CANDIDATE` or `ADMIN`. Wired in `container.ts`.
- Call it first in `InterviewSessionService`: `createSession`, `reschedule`, `retryPrep`; and in `LiveSessionService`: `startLive`, `warm`. Not on list/get/cancel/report/dispute/end or internal worker routes.
- `src/services/liveAvailability.ts`: global flag only; drop the allowlist and its config/tests.
- `src/routes/admin.ts` role route: accept the three roles (`invalid_role` message updated), add the last-admin guard, return `UserResponse` as today.
- `/users/me` already returns `role`; `CurrentUser.role` gains `CANDIDATE`.
- `packages/contracts/openapi.yaml`: `Role` enum gains `CANDIDATE`; add `GET /api/v1/admin/users`, `PATCH /api/v1/admin/users/{id}/role` and an `AdminUser` schema; document 403 `interview_access_required` on the gated session routes and 409 `last_admin`.

## Web changes (`apps/web`)

- Regenerate types (`pnpm contracts:types`), delete the hand-written `AdminUser` in `features/intelligence/types.ts` in favour of the generated type.
- `lib/hooks/useCurrentUser.ts`: add `canInterview = role is CANDIDATE or ADMIN`.
- Gate the entry points (disable or replace with the note "Ask an admin for interview access"): `BookingForm`, `BookRoundDialog`/`RescheduleDialog` (`SlotDialog.tsx`), `RoundCard` and `ProcessTab` book links, `FlowNodes` "Book this round", `LoopCard` book buttons, `CalendarCard` "Book a round", retake CTAs in `ReportView`/`ReportUnscorable`, `RetryPrepButton`, live links (`SessionAction`, `SessionsList`, `UpNextCard`).
- `features/loops/errors.ts` `bookingError`: map `interview_access_required` to the note.
- `AccessControlPanel.tsx`: three roles; replace the promote/demote toggle with a role select (disabled for self), keep the error alert.

## Left to the builder

Component-level copy and placement of the note; the exact shape of the role select; test layout. Per owner memory: do not run vitest/tsc/eslint/pytest unless asked, and leave work uncommitted.
