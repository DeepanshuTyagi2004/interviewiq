# Settings, account deletion & logout polish — design

**Date:** 2026-10-02 · **Status:** approved in chat, pending spec review · **Module:** 06 Platform Essentials

## Intent

- The profile page's "Log out" control is an underlined text link that doesn't match the app. Replace it with on-theme controls.
- Add a rich, Vercel-style **Settings** area: account basics, languages, display, interview, notifications, privacy, accessibility, billing (static), data export and **delete account with complete data removal**.
- Must match the InterviewIQ design tokens (warm-neutral paper palette, `brand` accent, Geist, hairlines), light + dark, phone → desktop.

**Decisions made (user, 2026-10-02):**

1. Language = **interview language** (English / Hinglish / Hindi) + **app UI language** preference. Only English UI is live; other UI languages show "coming soon". No i18n dependency.
2. Delete account = **immediate hard delete** across every store, typed-email confirmation (+ password for password accounts).
3. Storage = **server + device split.** Account-level prefs in MongoDB via the API; device-only prefs (theme, reduced motion, text size) in the browser.
4. Settings with no backend behaviour yet are **shown, saved, and marked** with a hint ("Applies once email delivery is live").
5. Security calls approved: Google-only accounts delete with typed email only (no fresh Google re-auth); "Log out of all devices" also ends the current session; deletion revokes the GitHub OAuth grant best-effort.

## Out of scope

- Real UI translation, a mail provider, billing/payment logic, leaderboards, wiring interview prefs into the live agent (prefs are stored; the agent reads them in a later change).
- Changing the "Applies once…" settings' downstream behaviour.

---

## 1. Logout polish (profile + shell)

- **Remove** `LogoutButton` (the underlined link) from `ProfileView`'s right column.
- **Add `AccountCard`** at the bottom of the profile's left column (after Connected sources), built on `ProfileCard`:
  - Body: "Signed in as **{email}**" and a mono pill for the method (`GOOGLE`, `EMAIL`, or both).
  - Footer actions: `Settings` (outline `Button`, `Settings` icon → `/settings/account`) and `Log out` (outline `Button`, `LogOut` icon, hover → `text-destructive border-destructive/40`, pending label "Logging out…").
- **Avatar menu.** `AppTopBar` avatar becomes a `DropdownMenu` trigger (same 34px brand circle):
  - Header: name + email (truncate).
  - Items: Profile, Settings, a theme row (Light / Dark / System segmented), separator, Log out.
  - Keyboard + screen-reader behaviour comes from Radix.
- **Nav:** add `{ label: "Settings", href: ROUTES.settings.root, icon: Settings, keywords: ["account", "language", "password", "delete", "notifications", "privacy", "theme", "export"] }` before Help in `APP_NAV`. `titleForPath` already returns "Settings".

## 2. Information architecture

`app/(app)/settings/layout.tsx` is a client shell:

- Page header (`iq-eyebrow` "Settings", h1 "Settings").
- Left **sticky sub-nav** at `lg+` (200px); a horizontally scrollable tab row below `lg`.
- Content column max-width ~760px.
- `/settings` (`page.tsx`) does `redirect("/settings/account")`.

| Route | Sub-nav label | Icon |
|---|---|---|
| `/settings/account` | Account | `UserRound` |
| `/settings/preferences` | Preferences | `SlidersHorizontal` |
| `/settings/interview` | Interview | `Mic` |
| `/settings/notifications` | Notifications | `Bell` |
| `/settings/privacy` | Privacy & data | `Shield` |
| `/settings/accessibility` | Accessibility | `Accessibility` |
| `/settings/billing` | Billing | `CreditCard` |

`ROUTES.settings` gains `root`, `preferences`, `interview`, `accessibility`. The existing keys stay.

### Save model

- Toggles, segmented controls, selects and radio tiles **autosave**: optimistic TanStack mutation, a "Saved" sonner toast, rollback + error toast on failure.
- Text inputs (display name) save via the card footer's **Save** button, which is disabled until the value is dirty and valid.

### Card pattern (`SettingsCard`)

- `rounded-[10px] border border-line-2 bg-card`. Header: title (15px, `tracking-[-0.01em]`) + description (`text-muted-foreground` 13.5px).
- Body: rows separated by `border-line` hairlines.
- Optional footer: `bg-panel/60 border-t border-line-2`, a hint on the left (13px muted, or a `NotLiveHint`) and actions on the right.
- **Danger variant:** `border-destructive/30`, and the footer gets a destructive tint.

`SettingRow`: label + description on the left, control on the right. Stacks below `sm`.

`NotLiveHint`: an `iq-pill`-style mono label (e.g. `APPLIES ONCE EMAIL IS LIVE`) plus an optional tooltip line.

### Page contents

**Account**

- **Display name:** input (1–80 chars, trimmed) → `PATCH /users/me`.
- **Email:**
  - Read-only, with a `VERIFIED` / `UNVERIFIED` pill.
  - Unverified → "Resend verification" (existing endpoint).
  - Hint: "Email changes aren't supported yet."
- **Password:**
  - `hasPassword` → "Send reset link".
  - Google-only → "Set a password".
  - Both call the existing `POST /auth/forgot-password` with the user's email. Toast: "Check your inbox" (the link is logged to the API console until mail is live).
- **Sign-in methods:** rows for Google and Email & password, each with a Connected / Not set up state (from `hasPassword`; Google is shown as linked when `hasGoogle`, see §3.2).
- **Sessions:** "Log out" (this device) and "Log out of all devices" (confirm dialog → `POST /users/me/sessions/revoke` → local logout → `/login`).

**Preferences**

- **Appearance:** three preview tiles (Light / Dark / System), each a miniature of the app frame drawn with tokens → `next-themes` `setTheme`. `ThemeProvider` switches to `enableSystem` (default stays `light`).
- **App language:** radio list.
  - English ✓.
  - हिन्दी, தமிழ், తెలుగు, বাংলা, मराठी are disabled with `COMING SOON`.
  - Saved to `locale.appLanguage`, though only `en` is selectable today.
- **Timezone:** searchable combobox over `Intl.supportedValuesOf("timeZone")`.
  - First option "Automatic — {detected}" (`null`).
  - Saved to `locale.timezone`.
  - Hint: used as the default when scheduling.
- **Date format:** segmented control, `DD/MM/YYYY` · `MM/DD/YYYY` · `YYYY-MM-DD`, each with a live example of today's date.
- **Time format:** `12-hour` · `24-hour`.
- **Week starts on:** `Monday` · `Sunday`.

**Interview** (card hint: "Your AI interviewer will use these from its next update." Nothing here touches scoring, gating or thresholds.)

- **Interview language:** tiles English / Hinglish / Hindi, each with a one-line sample of what the interviewer sounds like.
- **Interviewer voice:** `Warm` · `Neutral` · `Crisp`.
- **Speaking pace:** `Slower` · `Normal` · `Faster`.
- **Live captions:** switch.
- **On-screen timer:** switch.
- **Device check before joining:** switch.
- **Reminder before interviews:** `15 min` · `1 hour` · `1 day`.

**Notifications**

- **Master:** "Pause all email" switch. When on, the email column disables visually.
- **Grid** with rows × columns `Email` / `In-app`:
  - Interview reminders
  - Debrief ready
  - Retake available (cooldown over)
  - New openings at my target companies
  - Weekly progress digest
  - Product updates & tips
- **Hints:** email column `APPLIES ONCE EMAIL IS LIVE`; in-app column `APPLIES ONCE NOTIFICATIONS SHIP`.
- **Phones:** the grid becomes stacked rows, each with two labelled switches.

**Privacy & data**

- **Leaderboard visibility:** `Show my name` · `Anonymous` · `Hidden` (`APPLIES ONCE LEADERBOARDS SHIP`).
- **Share my readiness with my college's placement team:** switch (hint).
- **Let partner companies discover my profile:** switch (hint).
- **Use my interview recordings and transcripts to improve InterviewIQ:** switch, default off.
- **Export my data** card: "Download a JSON copy of everything we hold about you" → `GET /users/me/export` → saves `interviewiq-export-YYYY-MM-DD.json` via a Blob.
- **Danger zone** card (danger variant): "Delete account" → `DeleteAccountDialog`.

**Accessibility** (device-only, card hint "Saved on this device")

- **Reduce motion:** `Match system` · `Reduce` · `Allow`. When reduced, `<html data-motion="reduce">`, and a global CSS rule zeroes transition/animation durations.
- **Text size:** `Default` · `Large`. `<html data-text="large">` sets the root font-size to 17px/112.5%.
- **Keyboard shortcuts:** read-only list (`⌘K` search, `M` menu, `Esc` close).

**Billing** (no billing logic)

- "Current plan: **Free**" card.
- A usage row with honest "—".
- "Paid plans are coming soon" with a link to `/pricing`.

### DeleteAccountDialog

- Built on `Dialog`. Title "Delete account". Body lists what is deleted:
  - profile & resume details
  - connected sources & their data
  - interview sessions, plans & debriefs
  - preferences
  - sign-in tokens
- Notes that anonymous shared interview experiences are kept, and that the action is irreversible.
- **Inputs:** "Type **{email}** to confirm" (case-insensitive match), plus "Current password" when `hasPassword`.
- **Delete button:** destructive. Disabled until the email matches and the password is non-empty (when required). Pending state "Deleting…".
- **Errors inline**, by code:
  - `confirmation_mismatch`
  - `invalid_password`
  - `interview_in_progress` ("Finish or leave your live interview first")
  - `deletion_unavailable` ("Couldn't reach every service — nothing was deleted. Try again.")
- **On success:** clear the in-memory token, `queryClient.clear()`, `router.replace("/?deleted=1")`. A toast confirms deletion.

## 3. Backend (apps/api)

### 3.1 Preferences

**Storage.** Mongo collection `user_preferences`, `_id = userId`. Add `UserPreferencesDoc` + `collections()` entry in `db/mongo/client.ts` and a repository `UserPreferencesRepository` (`get`, `upsertMerge`, `deleteByUserId`) in `repositories/mongo.ts`.

**Domain** (`domain/preferences.ts`): a zod schema with enums plus `DEFAULT_PREFERENCES`. Defaults are product calls, kept privacy-first:

```ts
locale:        { appLanguage: "en", timezone: null, dateFormat: "DD/MM/YYYY", timeFormat: "12h", weekStart: "monday" }
               // appLanguage ∈ en|hi|ta|te|bn|mr; timezone = IANA string validated with Intl or null (auto)
interview:     { language: "en", voice: "neutral", pace: "normal", captions: true, showTimer: true, deviceCheck: true, reminderLead: "1h" }
               // language ∈ en|hinglish|hi; voice ∈ warm|neutral|crisp; pace ∈ slower|normal|faster; reminderLead ∈ 15m|1h|1d
notifications: { emailPaused: false,
                 email: { interviewReminders: true, debriefReady: true, retakeAvailable: true, targetOpenings: true, weeklyDigest: true, productUpdates: false },
                 inApp: { interviewReminders: true, debriefReady: true, retakeAvailable: true, targetOpenings: true, weeklyDigest: false, productUpdates: false } }
privacy:       { leaderboardVisibility: "anonymous", shareWithCollege: false, partnerDiscovery: false, improveWithMyData: false }
               // leaderboardVisibility ∈ name|anonymous|hidden
```

**Service** `PreferencesService`:

- `get(userId)` returns a deep merge of defaults + the stored doc. Unknown stored keys are dropped.
- `update(userId, patch)` validates the patch with a `.strict()` deep-partial schema. Unknown keys or invalid values → `400 invalid_preferences` with the zod path. It persists via dotted `$set` paths (so concurrent section edits don't clobber each other), stamps `updatedAt`, and returns the full prefs.

**Routes** (in `usersRouter`):

- `GET /api/v1/users/me/preferences` → `200 Preferences`.
- `PATCH /api/v1/users/me/preferences` → `200 Preferences`.

### 3.2 Account

- `PATCH /api/v1/users/me` `{ name }` (trimmed, 1–80) → `200 UserResponse`. Invalid → `400 invalid_name`.
- `UserResponse` gains `hasGoogle: boolean` (`googleSub !== null`). This is additive and non-breaking.
- `POST /api/v1/users/me/sessions/revoke` → revokes every unrevoked refresh token for the user (`RefreshTokenRepository.revokeAllForUser`), clears the `refresh_token` cookie (path `/api/v1/auth`), returns `204`.

### 3.3 Export

`GET /api/v1/users/me/export` → `200 application/json`, `Content-Disposition: attachment; filename="interviewiq-export-YYYY-MM-DD.json"`:

```
{ exportedAt, user (toUserResponse + createdAt), preferences, candidateProfile | null,
  connections: { github: {login, scope, connectedAt, lastRefreshedAt, status} | null, leetcode: {username, status, connectedAt, lastRefreshedAt} | null },
  profileFragments: [{source, data, version, fetchedAt}], interviewSessions: [...rows], sessionOutcomes: [...outcome docs] }
```

**Never included:** `passwordHash`, `accessTokenEnc`, refresh/auth token rows or hashes. AI-service interview plans are not included in v1 (documented in the response as `notes`).

### 3.4 Delete account

`DELETE /api/v1/users/me` with body `{ confirmEmail: string, password?: string }` → `204`.

`AccountDeletionService.delete(userId, input)`:

1. Load the user (missing → 404).
2. Validate the input:
   - `confirmEmail.trim().toLowerCase() !== user.email.toLowerCase()` → `400 confirmation_mismatch`.
   - The user has a password and the given password is missing or doesn't verify (`lib/password.ts`) → `403 invalid_password`. The route reuses the existing auth `login` rate limiter.
3. Any session in `LIVE_IN_PROGRESS` → `409 interview_in_progress`.
4. Collect the user's session ids. Call the AI service `POST /users/purge { session_ids }`. Any failure → `502 deletion_unavailable`, **nothing deleted yet**.
5. Best effort: if a GitHub connection exists, decrypt the token and call `DELETE https://api.github.com/applications/{client_id}/grant` (basic auth `client_id:client_secret`, body `{access_token}`). Failure is logged and doesn't block deletion.
6. Mongo (in this order; each delete is idempotent):
   - `candidate_profiles` (`_id`)
   - `profile_fragments` (`userId`)
   - `session_outcomes` (`_id ∈ sessionIds`)
   - `user_preferences` (`_id`)
7. One Postgres transaction:
   - `refresh_token`, `auth_token`
   - `github_connection`, `leetcode_connection`
   - `interview_sessions` (`candidate_id`)
   - `app_user` last
8. Clear the refresh cookie and log `account deleted userId=…` (no PII beyond the id).

**Retry safety.** Steps 4–7 are idempotent and the user row goes last, so a partial failure (e.g. Mongo ok, PG fails) leaves the user able to sign in and retry.

**Concurrency.** The in-process jobs (GitHub/LeetCode refresh, interview prep) read rows that disappear. They already treat missing rows as no-ops; tests confirm prep skips a deleted session.

### 3.5 AI service (apps/ai-service)

- `POST /users/purge` with internal key and body `{ session_ids: list[str] }` (max 1000) → `{ deleted_plans: int }`. It deletes `interview_plans` where `sessionId ∈ session_ids`.
- In-memory run stores (resume parse / plan runs) are ephemeral and evict on their own. They aren't touched.
- `AiServiceClient.purgeUser(sessionIds)` on the API side.

### 3.6 Contract

`packages/contracts/openapi.yaml` gets:

- **Paths:**
  - `PATCH /api/v1/users/me`
  - `DELETE /api/v1/users/me`
  - `GET|PATCH /api/v1/users/me/preferences`
  - `POST /api/v1/users/me/sessions/revoke`
  - `GET /api/v1/users/me/export`
  - the AI-service `POST /users/purge`
- **Schemas:** `Preferences` (+ section schemas), `PreferencesPatch`, `UpdateUserRequest`, `DeleteAccountRequest`, `AccountExport`, and `UserResponse.hasGoogle`.

The web regenerates `lib/api-client/generated/schema.d.ts`.

## 4. Frontend (apps/web)

- **`features/settings/`:**
  - `api.ts`: `getPreferences`, `updatePreferences`, `updateName`, `revokeSessions`, `exportData`, `deleteAccount`, typed from the generated schema.
  - `hooks.ts`: `usePreferences`, `useUpdatePreferences` (optimistic deep-merge into the cache, rollback), `useUpdateName` (invalidates `users/me`), `useRevokeSessions`, `useExportData`, `useDeleteAccount`.
  - `device-prefs.ts`: localStorage key `iq-device-prefs`, `{ reducedMotion, textSize }`, try/catch.
  - `index.ts`.
- **`components/layout/DevicePrefs.tsx`:** client, mounted in the root providers. It applies `data-motion` / `data-text` on `<html>` and listens for changes. CSS rules go in `globals.css`.
- **`app/(app)/settings/_components/`:**
  - `SettingsNav`, `SettingsCard`, `SettingRow`, `Segmented` (on `toggle-group`), `ThemeTiles`, `TimezoneCombobox` (`popover` + filtered list), `NotLiveHint`
  - `DeleteAccountDialog`, `NotificationGrid`, `LanguageTiles`
- **No new dependencies.**
- **Tokens only:** no raw hex. `font-mono` for numerals, pills and dates.
- **Motion:** `ease-iq` 150–200ms on hover/focus. The tiles' selected ring is `ring-1 ring-foreground`, with the brand dot for the active option.

## 5. Testing

- **API** (Vitest + supertest, PGlite + mongodb-memory-server):
  - preferences: GET returns defaults; PATCH merges one field without touching siblings; unknown key / bad enum / bad timezone → 400
  - name: PATCH validates and persists
  - sessions: revoke makes the old refresh cookie fail `/auth/refresh`
  - export: has no `passwordHash` / `accessTokenEnc` / token fields
  - delete: wrong email → 400; wrong or missing password → 403; Google-only without password → 204; live session → 409; AI-service 5xx → 502 and every row is still present
  - delete success: every PG table and Mongo collection is empty for that user, the AI service is called with the right session ids, GitHub revoke is attempted, and the cookie is cleared
- **AI service** (pytest): purge deletes only the matching plans, needs the internal key, rejects more than 1000 ids.
- **Web** (Vitest + RTL):
  - `DeleteAccountDialog` gating (button disabled until match; password field only when `hasPassword`; error copy per code)
  - `Segmented` / `NotificationGrid` call `updatePreferences` with the right patch
  - `APP_NAV` has Settings
  - device-prefs apply attributes
- **Visual:** Playwright screenshots (mocked API) of every settings page in light/dark at 1440 and 390 widths, plus the profile account card and avatar menu.
