### Task 7: Contract + generated web types

**Files:**
- Modify: `packages/contracts/openapi.yaml`
- Regenerate: `apps/web/lib/api-client/generated/schema.d.ts`

**Interfaces:**
- Produces generated schemas used by Task 8: `components["schemas"]["Preferences"]`, `PreferencesPatch`, `UpdateUserRequest`, `DeleteAccountRequest`, `AccountExport`, and `CurrentUser.hasGoogle`.

- [ ] **Step 1: Bump the version and describe the surface**

In `info`, set `version: 0.4.0` and append to `description`:

```yaml
    Settings (preferences, display name, sign out everywhere, data export, account deletion) and
    the internal account-deletion purge are the surface added in 0.4.0.
```

- [ ] **Step 2: Extend `/api/v1/users/me`** (add `patch` and `delete` next to the existing `get`)

```yaml
    patch:
      operationId: updateCurrentUser
      tags: [users]
      summary: Change the display name. Google sign-ins no longer overwrite it.
      security:
        - bearerAuth: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/UpdateUserRequest"
      responses:
        "200":
          description: The updated user.
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/CurrentUser"
        "400":
          description: "`invalid_name` — empty or longer than 80 characters."
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ApiError"
        "401":
          $ref: "#/components/responses/Unauthorized"
    delete:
      operationId: deleteCurrentUser
      tags: [users]
      summary: Permanently delete the account and everything stored about it.
      description: >
        Immediate hard delete. Checks the typed email (case-insensitive, trimmed) and, for
        accounts with a password, the password. Purges the ai-service first; if that fails,
        nothing is deleted (502). Then removes the API's documents and Postgres rows (user last)
        and clears the refresh cookie. Shares the login rate limit.
      security:
        - bearerAuth: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/DeleteAccountRequest"
      responses:
        "204":
          description: Deleted. The refresh cookie is cleared.
        "400":
          description: "`confirmation_mismatch` or `invalid_request`."
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ApiError"
        "401":
          $ref: "#/components/responses/Unauthorized"
        "403":
          description: "`invalid_password`."
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ApiError"
        "404":
          description: The user no longer exists (empty body).
        "409":
          description: "`interview_in_progress` — a session is live."
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ApiError"
        "429":
          $ref: "#/components/responses/RateLimited"
        "502":
          description: "`deletion_unavailable` — the ai-service purge failed; nothing was deleted."
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ApiError"
```

- [ ] **Step 3: Add the new user paths** (right after `/api/v1/users/me`)

```yaml
  /api/v1/users/me/preferences:
    get:
      operationId: getMyPreferences
      tags: [users]
      summary: Every account-level setting, defaults filled in.
      security:
        - bearerAuth: []
      responses:
        "200":
          description: The resolved preferences.
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Preferences"
        "401":
          $ref: "#/components/responses/Unauthorized"
    patch:
      operationId: updateMyPreferences
      tags: [users]
      summary: Change any subset of settings; returns the full resolved set.
      security:
        - bearerAuth: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/PreferencesPatch"
      responses:
        "200":
          description: The resolved preferences after the change.
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Preferences"
        "400":
          description: "`invalid_preferences` — unknown key or invalid value; `message` names the path."
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ApiError"
        "401":
          $ref: "#/components/responses/Unauthorized"

  /api/v1/users/me/sessions/revoke:
    post:
      operationId: revokeMySessions
      tags: [users]
      summary: Log out of all devices (this one included) and clear the refresh cookie.
      security:
        - bearerAuth: []
      responses:
        "204":
          description: Every refresh token revoked.
        "401":
          $ref: "#/components/responses/Unauthorized"

  /api/v1/users/me/export:
    get:
      operationId: exportMyData
      tags: [users]
      summary: A JSON attachment of everything the API stores about the user (no secrets).
      security:
        - bearerAuth: []
      responses:
        "200":
          description: The export (`Content-Disposition` attachment).
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/AccountExport"
        "401":
          $ref: "#/components/responses/Unauthorized"
        "404":
          description: The user no longer exists (empty body).
```

- [ ] **Step 4: Add the internal purge path** (next to `/interview-plans`, same server block style)

```yaml
  /users/purge:
    servers:
      - url: http://localhost:8000
        description: interviewiq-ai-service (internal, X-Internal-Api-Key)
    post:
      operationId: purgeUser
      tags: [internal-interview-prep]
      summary: Account deletion — drop everything stored for these sessions (their interview plans).
      security:
        - internalApiKey: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [session_ids]
              properties:
                session_ids:
                  type: array
                  maxItems: 1000
                  items:
                    type: string
      responses:
        "200":
          description: Purged (idempotent).
          content:
            application/json:
              schema:
                type: object
                required: [deleted_plans]
                properties:
                  deleted_plans:
                    type: integer
        "401":
          $ref: "#/components/responses/Unauthorized"
```

- [ ] **Step 5: Schemas** (`components.schemas`)

Add `hasGoogle` to `CurrentUser`. Add it to `required` too, and add the property:

```yaml
        hasGoogle:
          type: boolean
          description: A Google account is linked (can sign in with Google).
```

Then add:

```yaml
    UpdateUserRequest:
      type: object
      required: [name]
      properties:
        name:
          type: string
          minLength: 1
          maxLength: 80

    DeleteAccountRequest:
      type: object
      required: [confirmEmail]
      properties:
        confirmEmail:
          type: string
          description: The account's email, typed by the user (case-insensitive, trimmed).
        password:
          type: string
          description: Required when the account has a password (`CurrentUser.hasPassword`).

    NotificationChannel:
      type: object
      required: [interviewReminders, debriefReady, retakeAvailable, targetOpenings, weeklyDigest, productUpdates]
      properties:
        interviewReminders: { type: boolean }
        debriefReady: { type: boolean }
        retakeAvailable: { type: boolean }
        targetOpenings: { type: boolean }
        weeklyDigest: { type: boolean }
        productUpdates: { type: boolean }

    Preferences:
      type: object
      description: >
        Account-level settings, resolved over the defaults. Device-only settings (theme, reduced
        motion, text size) are not here — they live in the browser.
      required: [locale, interview, notifications, privacy, updatedAt]
      properties:
        locale:
          type: object
          required: [appLanguage, timezone, dateFormat, timeFormat, weekStart]
          properties:
            appLanguage: { type: string, enum: [en, hi, ta, te, bn, mr] }
            timezone:
              type: string
              nullable: true
              description: IANA zone; null = follow the browser.
            dateFormat: { type: string, enum: [DD/MM/YYYY, MM/DD/YYYY, YYYY-MM-DD] }
            timeFormat: { type: string, enum: [12h, 24h] }
            weekStart: { type: string, enum: [monday, sunday] }
        interview:
          type: object
          required: [language, voice, pace, captions, showTimer, deviceCheck, reminderLead]
          properties:
            language: { type: string, enum: [en, hinglish, hi] }
            voice: { type: string, enum: [warm, neutral, crisp] }
            pace: { type: string, enum: [slower, normal, faster] }
            captions: { type: boolean }
            showTimer: { type: boolean }
            deviceCheck: { type: boolean }
            reminderLead: { type: string, enum: [15m, 1h, 1d] }
        notifications:
          type: object
          required: [emailPaused, email, inApp]
          properties:
            emailPaused: { type: boolean }
            email: { $ref: "#/components/schemas/NotificationChannel" }
            inApp: { $ref: "#/components/schemas/NotificationChannel" }
        privacy:
          type: object
          required: [leaderboardVisibility, shareWithCollege, partnerDiscovery, improveWithMyData]
          properties:
            leaderboardVisibility: { type: string, enum: [name, anonymous, hidden] }
            shareWithCollege: { type: boolean }
            partnerDiscovery: { type: boolean }
            improveWithMyData: { type: boolean }
        updatedAt:
          type: string
          format: date-time
          nullable: true
          description: When the user last changed a setting; null = never.

    PreferencesPatch:
      type: object
      additionalProperties: false
      description: Any subset of `Preferences` leaves (no `updatedAt`). Unknown keys → 400.
      properties:
        locale:
          type: object
          additionalProperties: false
          properties:
            appLanguage: { type: string, enum: [en, hi, ta, te, bn, mr] }
            timezone: { type: string, nullable: true }
            dateFormat: { type: string, enum: [DD/MM/YYYY, MM/DD/YYYY, YYYY-MM-DD] }
            timeFormat: { type: string, enum: [12h, 24h] }
            weekStart: { type: string, enum: [monday, sunday] }
        interview:
          type: object
          additionalProperties: false
          properties:
            language: { type: string, enum: [en, hinglish, hi] }
            voice: { type: string, enum: [warm, neutral, crisp] }
            pace: { type: string, enum: [slower, normal, faster] }
            captions: { type: boolean }
            showTimer: { type: boolean }
            deviceCheck: { type: boolean }
            reminderLead: { type: string, enum: [15m, 1h, 1d] }
        notifications:
          type: object
          additionalProperties: false
          properties:
            emailPaused: { type: boolean }
            email: { $ref: "#/components/schemas/NotificationChannelPatch" }
            inApp: { $ref: "#/components/schemas/NotificationChannelPatch" }
        privacy:
          type: object
          additionalProperties: false
          properties:
            leaderboardVisibility: { type: string, enum: [name, anonymous, hidden] }
            shareWithCollege: { type: boolean }
            partnerDiscovery: { type: boolean }
            improveWithMyData: { type: boolean }

    NotificationChannelPatch:
      type: object
      additionalProperties: false
      properties:
        interviewReminders: { type: boolean }
        debriefReady: { type: boolean }
        retakeAvailable: { type: boolean }
        targetOpenings: { type: boolean }
        weeklyDigest: { type: boolean }
        productUpdates: { type: boolean }

    AccountExport:
      type: object
      description: Everything the API stores about the user, minus secrets. Opaque nested documents are passed through.
      required: [exportedAt, notes, user, preferences, candidateProfile, connections, profileFragments, interviewSessions, sessionOutcomes]
      properties:
        exportedAt: { type: string, format: date-time }
        notes:
          type: array
          items: { type: string }
        user:
          allOf:
            - $ref: "#/components/schemas/CurrentUser"
            - type: object
              required: [createdAt]
              properties:
                createdAt: { type: string, format: date-time }
        preferences: { $ref: "#/components/schemas/Preferences" }
        candidateProfile:
          type: object
          nullable: true
          additionalProperties: true
        connections:
          type: object
          required: [github, leetcode]
          properties:
            github:
              type: object
              nullable: true
              additionalProperties: true
            leetcode:
              type: object
              nullable: true
              additionalProperties: true
        profileFragments:
          type: array
          items: { type: object, additionalProperties: true }
        interviewSessions:
          type: array
          items: { type: object, additionalProperties: true }
        sessionOutcomes:
          type: array
          items: { type: object, additionalProperties: true }
```

- [ ] **Step 6: Regenerate and typecheck the web**

Run: `pnpm contracts:types && pnpm --filter @interviewiq/web typecheck`
Expected: `schema.d.ts` regenerates and contains `Preferences`, `PreferencesPatch`, `DeleteAccountRequest`, `AccountExport`, `hasGoogle`.

Typecheck passes. If a web test fixture builds a full `CurrentUser` literal typed against the schema, add `hasGoogle: false` to it.

---

