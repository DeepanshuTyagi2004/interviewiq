/**
 * GENERATED FILE — do not edit by hand.
 * Source: packages/contracts/openapi.yaml
 * Regenerate: pnpm contracts:types
 */

export interface paths {
    "/api/v1/users/me/linkedin": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Read the owner's confirmed LinkedIn snapshot status. */
        get: operations["getLinkedInImportStatus"];
        put?: never;
        post?: never;
        /**
         * Remove LinkedIn source evidence and drafts.
         * @description Details explicitly merged into the editable profile remain editable there. Fences in-flight PDF extractions from silently reconnecting the source.
         */
        delete: operations["disconnectLinkedInImport"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/validation-controls": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read persisted LinkedIn import validation controls.
         * @description ADMIN only. Defaults are safe and enabled. Settings affect new validation operations and do not recalculate existing scores.
         */
        get: operations["getAdminValidationControls"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Update one or more LinkedIn import validation controls.
         * @description ADMIN only. Each supplied value is a boolean. Disabling LinkedIn import stops new PDF uploads before any extraction runs.
         */
        patch: operations["patchAdminValidationControls"];
        trace?: never;
    };
    "/api/v1/intelligence/profile-scoring/live": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Run one user's profile scoring live and stream every step (NDJSON).
         * @description ADMIN only. Runs what the weekly batch runs for one user, streaming one ProfileLiveTraceEvent per line: reading stored sources, the AI-service item assessments (new or edited items; every item with forceReassess) and company-context lookups, the snapshot write, and the deterministic engine with every intermediate step. The last line is a `result` event (data = ProfileLiveTraceResponse) or an `error` event (data = { name, message, stack }). Source collectors are never called. Full detail is kept for admin debugging (names, contacts, employers, the stored profile and raw source data); credential-looking strings are scrubbed and the password hash is never included.
         *
         */
        post: operations["inspectLiveProfileCalculation"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/users/me/linkedin/imports": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Import the owner's LinkedIn "Save to PDF" file for review.
         * @description Consent declares ownership but does not verify it. The PDF is read once by the AI service and never stored; nothing is fetched from LinkedIn. Only files shaped like LinkedIn's Save to PDF export are accepted. Every claim must quote the PDF text. Does not publish evidence or change the profile before confirmation.
         */
        post: operations["importLinkedInPdf"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/users/me/linkedin/imports/{id}/confirm": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Publish only reviewed sections, optionally merging into profile details.
         * @description Source-only by default. Optional merge fills blanks and appends deduplicated rows without changing existing human choices or engineering level. Uses draft profile revision to reject stale merges. Identical successful confirmations reuse their receipt.
         */
        post: operations["confirmLinkedInProfileSections"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/users/me/candidate-profile": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read saved profile details and the current engineering level.
         * @description Known legacy labels normalize on read; unknown labels return null with legacyLevel metadata. Does not infer the current level from a target JD or rewrite saved identities.
         */
        get: operations["getCandidateProfile"];
        /**
         * Save profile details and optional current engineering level.
         * @description Omitted level preserves the previous choice. A supplied non-null level must be canonical. Drafts may have null; completing onboarding requires a supplied or previously saved recognized level.
         */
        put: operations["saveCandidateProfile"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/users/me/profile-score": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read the current beta profile assessment and frozen history.
         * @description Lazily caches a frozen assessment when local inputs, settings, privacy, methodology or UTC Monday week change. No provider requests. Repeated unchanged reads do not create history. Current ranks are live decorations; historical ranks are finalized once by the weekly generation.
         *
         */
        get: operations["getProfileScore"];
        put?: never;
        /**
         * Recalculate the signed-in user's profile score from local evidence.
         * @description Idempotent for the same week, configuration and local input fingerprint. No interview result changes.
         */
        post: operations["recalculateProfileScore"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/users/me/profile-score/assess": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Refresh semantic sub-feature assessments for changed projects, internships and roles (v5).
         * @description Calls the AI service once per new or edited item, judged relative to the user's rubric level, which is derived server-side (the body must be empty). Unchanged items are reused. Results are bounded INFERRED sub-features with verbatim quoted evidence; the deterministic engine combines them on the next read. Never returns or stores an overall score. Rate-limited per user; the weekly batch runs it automatically.
         *
         */
        post: operations["assessProfileItems"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/connections/platforms": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** The user's coding-platform connections (Codeforces, CodeChef, AtCoder, takeUforward). */
        get: operations["listPlatformConnections"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/connections/platforms/{platform}": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                platform: components["schemas"]["CodingPlatform"];
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Connect a coding platform by public handle (or pasted profile URL).
         * @description Validates the handle against the platform's public data, then collects in the background (202, SYNCING; poll the profile). Re-connecting re-points the connection. A takeUforward import also connects the LeetCode/Codeforces/CodeChef/AtCoder profiles linked on TUF, only where the user has none.
         *
         */
        post: operations["connectPlatform"];
        /** Disconnect a coding platform and delete its fragment. Idempotent. */
        delete: operations["disconnectPlatform"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/users/me/profile-score/settings": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Update the profile's engineering level or opt into the profile leaderboard.
         * @description Legacy declaredLevel writes update CandidateProfile.level, not a separate scoring-only choice. Evidence assessment remains separate. Opt-in defaults false and privacy settings still apply.
         */
        patch: operations["updateProfileScoringSettings"];
        trace?: never;
    };
    "/api/v1/profile-leaderboard": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Same-level, current-week profile ranking with privacy-safe identities.
         * @description Includes only opted-in eligible users with unchanged current inputs and matching level, version and configuration hash. Ties share competition rank. Percentiles are null below the minimum cohort. No user IDs, emails, evidence or connected account handles are returned.
         *
         */
        get: operations["getProfileLeaderboard"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/intelligence/questions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Read the problem bank (ADMIN). Thin index rows by default; includeContent=true adds each problem's content. */
        get: operations["listQuestionBank"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/intelligence/questions/stats": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Counts per round type and content status (ADMIN). */
        get: operations["getQuestionBankStats"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/intelligence/questions/generate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Start content generation over the problem-bank index in the background (ADMIN). Progress via /intelligence/scrape/status. */
        post: operations["generateQuestionContent"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/intelligence/diagnostics": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * ADMIN read-only local storage, methodology, replay and job diagnostics.
         * @description Without userId checks system scoring state; with userId also checks that user's frozen snapshot, source freshness, numerical bounds, weighted formula and historical rank constraints. Live collectors, interview preparation and voice remain explicitly untested. Never recalculates on read.
         *
         */
        get: operations["getProfileScoringDiagnostics"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/register": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Create an email/password account and sign in.
         * @description Public. The email is trimmed and lowercased; the name is trimmed. The new account is role USER (ADMIN for bootstrap admin emails), `onboardingComplete=false` and unverified; a verification link (`{FRONTEND_URL}/verify-email?token=…`) is emailed immediately. Signs the user in: returns the access token and sets the `refresh_token` cookie. Rate limited per client IP (10/hour).
         *
         */
        post: operations["register"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/login": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Sign in with email + password.
         * @description Public. The email is matched case-insensitively. An unverified email may still sign in. Wrong email, wrong password, and an account with no password (Google-only) all return the same 401 `invalid_credentials`. Rate limited per IP + email (10/15 min) and per IP (50/15 min).
         *
         */
        post: operations["login"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/verify-email": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Confirm the email address with the token from the verification link.
         * @description Public. Tokens are single-use and expire after 24 hours; only the newest link sent works.
         */
        post: operations["verifyEmail"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/resend-verification": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Email a fresh verification link to the signed-in user.
         * @description Requires the Bearer access token. A 204 no-op when the email is already verified. Supersedes any earlier verification link. Rate limited per user (5/hour).
         *
         */
        post: operations["resendVerification"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/forgot-password": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Email a password-reset link.
         * @description Public. Always 204, whether or not an account exists (no account enumeration). If one does — password or Google-only (resetting then adds a password) — a link to `{FRONTEND_URL}/reset-password?token=…` is emailed; it expires after 1 hour and only the newest one works. Rate limited per IP + email (5/hour).
         *
         */
        post: operations["forgotPassword"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/reset-password": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Set a new password with the token from the reset link.
         * @description Public. Sets the new password, marks the email verified, consumes the token and signs the user out everywhere (every refresh token is revoked). Does NOT sign in — follow with `login`. A password that fails validation (400 `invalid_request`) does not use up the token.
         *
         */
        post: operations["resetPassword"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/refresh": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Rotate the refresh cookie and get a new access token.
         * @description Public; reads the `refresh_token` cookie. Every call rotates the cookie (the presented token stops working). A missing, expired, revoked or reused token is a bare 401 (no body) and clears the cookie.
         *
         */
        post: operations["refreshSession"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/logout": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Revoke the refresh cookie's token and clear it. */
        post: operations["logout"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/users/me": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** The signed-in user (role + onboarding + verification flags gate the UI). */
        get: operations["getCurrentUser"];
        put?: never;
        post?: never;
        /**
         * Delete the account and everything it holds, immediately.
         * @description The user types their email to confirm; password accounts also send the password. Refused while an interview is live (`interview_in_progress`), when the AI service cannot purge the account's interview data (`deletion_unavailable`), or when the confirmation does not match (`confirmation_mismatch`). Shares the login rate limit.
         *
         */
        delete: operations["deleteAccount"];
        options?: never;
        head?: never;
        /** Change the display name. */
        patch: operations["updateCurrentUser"];
        trace?: never;
    };
    "/api/v1/users/me/sessions/revoke": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Sign out of every device, this one included (all refresh tokens revoked). */
        post: operations["revokeAllSessions"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/users/me/export": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Everything the API holds about the account, as a JSON attachment. */
        get: operations["exportAccount"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/users/me/preferences": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Account-level settings, every value resolved (defaults overlaid with what the user changed). */
        get: operations["getPreferences"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Change any subset of settings; unknown keys are rejected (`invalid_preferences`). */
        patch: operations["updatePreferences"];
        trace?: never;
    };
    "/api/v1/interviews/sessions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List the authenticated candidate's interview sessions (newest first). */
        get: operations["listMyInterviewSessions"];
        put?: never;
        /**
         * Book an interview session for a JD + round + slot (status SCHEDULED).
         * @description Creates a session for the selected job description, round type, and slot. The JD must resolve to a real, enabled company/role/level (CompanyRoleConfig) and the round type must be a valid `RoundType`. Prep is scheduled automatically — the session starts as `SCHEDULED` and the backend generates the plan shortly before the slot.
         *
         */
        post: operations["createInterviewSession"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/interviews/sessions/{sessionId}": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                sessionId: components["parameters"]["SessionId"];
            };
            cookie?: never;
        };
        /** Get one interview session's status. Only the owning candidate may read it. */
        get: operations["getInterviewSession"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/interviews/sessions/{sessionId}/report": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                sessionId: components["parameters"]["SessionId"];
            };
            cookie?: never;
        };
        /**
         * The graded debrief of a completed round (only the owning candidate).
         * @description Poll while `status` is `evaluating`. `failed` retries automatically; `legacy` rounds have no report.
         */
        get: operations["getRoundReport"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/interviews/sessions/{sessionId}/report/disputes": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                sessionId: components["parameters"]["SessionId"];
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Dispute one question or area of the report; a re-check never lowers the score.
         * @description One per target, at most 3 per report, within 14 days of the first report.
         */
        post: operations["disputeRoundReport"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/interviews/sessions/{sessionId}/prep/retry": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                sessionId: components["parameters"]["SessionId"];
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Retry blueprint prep after PREP_FAILED.
         * @description Moves a PREP_FAILED session back to PREP_QUEUED and starts a new blueprint run. Limited to 3 retries per rolling hour per session (server-enforced). Only the owning candidate may call this.
         *
         */
        post: operations["retryInterviewSessionPrep"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/interviews/sessions/{sessionId}/live": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                sessionId: components["parameters"]["SessionId"];
            };
            cookie?: never;
        };
        /**
         * Current live state (fresh token if LIVE_IN_PROGRESS).
         * @description Read-only check of the session's live state. Returns a fresh LiveKit token when LIVE_IN_PROGRESS; livekitUrl/token/roomName are null for any other status. Only the owning candidate may call this.
         *
         */
        get: operations["getLiveInterviewSession"];
        put?: never;
        /**
         * Start (or resume) the live interview; mints a LiveKit join token.
         * @description Moves a PREP_READY session to LIVE_IN_PROGRESS and mints a fresh LiveKit join token. Idempotent while already LIVE_IN_PROGRESS — returns a fresh token for the same room without altering session state. Only the owning candidate may call this. Refused with 409 `live_unavailable` while the live interviewer is unavailable to this user (`InterviewSession.liveAvailable` is false), and 409 `session_not_ready` unless PREP_READY. Going live marks the blueprint's problems as seen, so later blueprints never repeat them, and dispatches the interviewer agent into the room.
         *
         */
        post: operations["goLiveInterviewSession"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/jds": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Published role summaries, including explicitly marked simulated practice templates. */
        get: operations["listJobDescriptions"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/jds/{jdId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Read a published JD with its current candidate-visible interview process. */
        get: operations["getJobDescription"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/jd-fit": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * The signed-in user's fit score for each role card (same JDs and filters as GET /api/v1/jds).
         * @description JD fit (jd-fit-v1) is how closely the user's resume, GitHub and coding profiles match one JD's listing: skills, domain, role, experience and round topics. Rules only, computed on request, never stored. It is a separate contract from the profile score and never affects interview results, gating, readiness or leaderboards.
         *
         */
        get: operations["listJdFit"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/jd-fit/{jdId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Why the signed-in user's fit score for one JD is what it is, part by part. */
        get: operations["getJdFit"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/interviews/sessions/{sessionId}/reschedule": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                sessionId: components["parameters"]["SessionId"];
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Move a not-yet-started interview to another slot (409 session_slot_taken if you already have one then). */
        post: operations["rescheduleInterviewSession"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/interviews/sessions/{sessionId}/cancel": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                sessionId: components["parameters"]["SessionId"];
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Cancel a not-yet-started interview. */
        post: operations["cancelInterviewSession"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/loops": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** The candidate's loops with per-round state and progress. */
        get: operations["listLoops"];
        put?: never;
        /** Confirm a process for a JD (official, or one of your saved processes → a standalone loop). */
        post: operations["confirmLoop"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/loops/{loopId}": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                loopId: string;
            };
            cookie?: never;
        };
        get: operations["getLoop"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Pause, resume or abandon a loop (abandoning cancels its upcoming interviews). */
        patch: operations["setLoopStatus"];
        trace?: never;
    };
    "/api/v1/processes": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** The candidate's saved custom processes. */
        get: operations["listProcesses"];
        put?: never;
        post: operations["createProcess"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/processes/official/{jdId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** A JD's suggested process as a read-only graph. */
        get: operations["getOfficialProcess"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/processes/{processId}": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                processId: string;
            };
            cookie?: never;
        };
        get: operations["getProcess"];
        put: operations["updateProcess"];
        post?: never;
        delete: operations["deleteProcess"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/processes/{processId}/duplicate": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                processId: string;
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["duplicateProcess"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/targets": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** JDs the candidate is watching. */
        get: operations["listTargets"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/targets/status/{jdId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getJdLoopStatus"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/targets/{jdId}": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                jdId: string;
            };
            cookie?: never;
        };
        get?: never;
        put: operations["addTarget"];
        post?: never;
        delete: operations["removeTarget"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/users": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Every user with their role. */
        get: operations["listAdminUsers"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/users/{userId}/role": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                userId: string;
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Set a user's role (USER, CANDIDATE or ADMIN). */
        patch: operations["updateAdminUserRole"];
        trace?: never;
    };
    "/api/v1/admin/companies": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Every company with its research state (research is null when the AI service is unreachable). */
        get: operations["listAdminCompanies"];
        put?: never;
        /** Add a company to research. It starts unpublished (students see it after an admin approves its first draft). */
        post: operations["createCompany"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/companies/seed": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Load the starter catalogue (upsert-only; never deletes). */
        post: operations["seedCompanies"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/companies/{companyId}": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                companyId: string;
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Delete the company with its JDs and role configs. */
        delete: operations["deleteCompany"];
        options?: never;
        head?: never;
        /** Edit identity fields or archive. The slug never changes. */
        patch: operations["updateCompany"];
        trace?: never;
    };
    "/api/v1/admin/companies/{companyId}/enrichment": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                companyId: string;
            };
            cookie?: never;
        };
        /** Read the enrichment draft, prefilling available research on first open (ADMIN only). */
        get: operations["getCompanyEnrichment"];
        /** Save an incomplete draft using optimistic revision (ADMIN only). */
        put: operations["saveCompanyEnrichment"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/companies/{companyId}/enrichment/prefill": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                companyId: string;
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Fill blank unverified fields from available research without replacing saved values (ADMIN only). */
        post: operations["prefillCompanyEnrichment"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/companies/{companyId}/enrichment/publish": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                companyId: string;
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Atomically publish verified company, roles and linear round sequences (ADMIN only).
         * @description Archived companies must first be restored. Existing JD role, level and specialization are immutable; add a new role to change identity.
         */
        post: operations["publishCompanyEnrichment"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/companies/{companyId}/draft": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                companyId: string;
            };
            cookie?: never;
        };
        /** The newest research draft (any status) with the company, for the review view. */
        get: operations["getCompanyDraft"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/companies/{companyId}/draft/{draftId}/approve": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                companyId: string;
                draftId: string;
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Approve a pending draft and publish its identity, profile and compensation onto the company.
         * @description Roles remain in the approved research snapshot; this does not publish JDs, booking configurations or interview briefs. Missing or unavailable profile and compensation values preserve existing published facts.
         */
        post: operations["approveCompanyDraft"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/companies/{companyId}/draft/{draftId}/reject": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                companyId: string;
                draftId: string;
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Reject a pending draft. The company stays as it was. */
        post: operations["rejectCompanyDraft"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/research/runs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["listResearchRuns"];
        put?: never;
        /** Start a run. Only one run may be active (queued, running, pausing, paused or stopping). */
        post: operations["startResearchRun"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/research/runs/{runId}": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                runId: components["parameters"]["ResearchRunId"];
            };
            cookie?: never;
        };
        get: operations["getResearchRun"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/research/runs/{runId}/pause": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                runId: components["parameters"]["ResearchRunId"];
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["pauseResearchRun"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/research/runs/{runId}/resume": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                runId: components["parameters"]["ResearchRunId"];
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["resumeResearchRun"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/research/runs/{runId}/stop": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                runId: components["parameters"]["ResearchRunId"];
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["stopResearchRun"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/research/runs/{runId}/budget": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                runId: components["parameters"]["ResearchRunId"];
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch: operations["updateResearchBudget"];
        trace?: never;
    };
    "/api/v1/admin/research/runs/{runId}/events": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                runId: components["parameters"]["ResearchRunId"];
            };
            cookie?: never;
        };
        /** Trace events, ascending by seq. With beforeSeq, the newest `limit` events before it (still ascending). */
        get: operations["listResearchEvents"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/research/runs/{runId}/spans": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                runId: components["parameters"]["ResearchRunId"];
            };
            cookie?: never;
        };
        /** The run's span tree, flat (parent_id links), without inputs/outputs. */
        get: operations["listResearchSpans"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/research/spans/{spanId}": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                spanId: string;
            };
            cookie?: never;
        };
        /** One span with its full input/output (offloaded payloads resolved) and its log events. */
        get: operations["getResearchSpan"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/internal/brief-problems": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Named problems from the admin-published briefs, for the AI service's problem-bank collector (internal key). */
        get: operations["listBriefProblems"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/internal/research-targets": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Every active company (published or not) for the research run. */
        get: operations["listResearchTargets"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/interviews/sessions/{sessionId}/live/warm": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                sessionId: components["parameters"]["SessionId"];
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Get the interviewer into the room while the candidate reads the instructions.
         * @description Best effort and idempotent. For a PREP_READY round the live interviewer is available for (or one that is already LIVE_IN_PROGRESS) it dispatches the interviewer into the room unless one is already there or on its way, so the interviewer is waiting when the candidate enters. It changes nothing else: no status change, no seen problems, no clock. Any other round answers `warming: false`. Only the owning candidate may call this.
         *
         */
        post: operations["warmLiveInterviewSession"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/interviews/live/readiness": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Whether the live interviewer is up.
         * @description Asks the AI service for its health (a short timeout, which also wakes a sleeping dev host). `ready` once the voice worker has registered; `waking` when the service is unreachable, slow or its worker is not up yet. Any signed-in role.
         *
         */
        get: operations["getLiveInterviewerReadiness"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/interviews/sessions/{sessionId}/live/end": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                sessionId: components["parameters"]["SessionId"];
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * End the live round from the candidate's side (the fallback when the interviewer doesn't answer End).
         * @description Idempotent; a round that already ended returns its stored result with alreadyEnded true.
         */
        post: operations["endLiveInterviewSession"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/internal/live/sessions/{sessionId}/context": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                sessionId: components["parameters"]["SessionId"];
            };
            cookie?: never;
        };
        /** The round and a minimal profile for the interviewer worker (while the round is PREP_READY or LIVE_IN_PROGRESS). */
        get: operations["getLiveContext"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/internal/live/sessions/{sessionId}/end": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                sessionId: components["parameters"]["SessionId"];
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** The interviewer worker ends the live round (idempotent). */
        post: operations["endLiveSessionInternal"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/intelligence/evaluations/runs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Evaluation runs, newest first. */
        get: operations["listEvaluationRuns"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/intelligence/evaluations/runs/{runId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** One run with raw grader outputs, disagreements, tiebreaks and timings. */
        get: operations["getEvaluationRun"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/intelligence/evaluations/sessions/{sessionId}/rerun": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Re-grade a completed session from scratch (a fresh `admin` run). */
        post: operations["rerunSessionEvaluation"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/intelligence/blueprints/candidates": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Onboarded candidates for the bench picker. */
        get: operations["listBlueprintBenchCandidates"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/intelligence/blueprints/runs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Blueprint runs, newest first. */
        get: operations["listBlueprintRuns"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/intelligence/blueprints/runs/{runId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** One run with its full trace, request and blueprint. */
        get: operations["getBlueprintRun"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/intelligence/blueprints/runs/{runId}/rerun": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Re-run a run's inputs as a bench run (never touches the session). */
        post: operations["rerunBlueprint"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/intelligence/blueprints/bench": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Prepare a blueprint for a candidate + JD (or practice loop round) without booking. */
        post: operations["startBlueprintBench"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/intelligence/blueprints/sessions/{sessionId}/versions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** A session's blueprint versions, newest first. */
        get: operations["listBlueprintVersions"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/intelligence/blueprints/sessions/{sessionId}/diff": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Structured diff between two versions of a session's blueprint. */
        get: operations["diffBlueprintVersions"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/intelligence/blueprints/answer-keys/{roundType}/{slug}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Cached answer keys for one problem (every key version and content hash). */
        get: operations["getBlueprintAnswerKeys"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/blueprints/runs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Start a session's blueprint run (one running run per session).
         * @description Returns at once; the run executes in the background (context → selection → answer keys → persona → personalization → playbooks → policies → validate). A second start while one is running returns the live run with `existing: true`.
         *
         */
        post: operations["startBlueprintRun"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/blueprints/runs/{runId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Compact run status for the reconcile job and the live stepper. */
        get: operations["getBlueprintRunStatus"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/blueprints/runs/{runId}/cancel": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Cancel a run. */
        post: operations["cancelBlueprintRun"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/blueprints/sessions/{sessionId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** A session's current blueprint (or `version`). Never sent to a browser. */
        get: operations["getSessionBlueprint"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        ValidationControlSettings: {
            linkedinImportEnabled: boolean;
            requireSectionReview: boolean;
        };
        ValidationControlsResponse: {
            settings: components["schemas"]["ValidationControlSettings"];
            /** Format: date-time */
            updatedAt: string | null;
            /**
             * Format: uuid
             * @description Admin user ID that last changed the settings.
             */
            updatedBy: string | null;
        };
        ProfileTraceStage: {
            id: string;
            /** @enum {string} */
            status: "completed" | "failed" | "skipped";
            /** Format: date-time */
            startedAt: string;
            /** Format: date-time */
            finishedAt: string;
            durationMs: number;
            detail: string;
        };
        ProfileTraceSource: {
            /** @description RESUME, GITHUB, LEETCODE, LINKEDIN or a coding platform (CODEFORCES, TUF, ...). */
            source: string;
            /** @enum {string} */
            status: "available" | "missing" | "unsupported" | "partial" | "excluded";
            /** Format: date-time */
            fetchedAt: string | null;
            ageDays: number | null;
            contentHash: string | null;
            extractedFieldCounts: {
                [key: string]: number;
            };
            safeSummary: {
                [key: string]: unknown;
            };
        };
        ProfileTraceProviderCheck: {
            provider: string;
            mode: string;
            configured: boolean;
            used: boolean;
            /** @enum {string} */
            status: "used" | "not_used" | "failed";
            /** Format: date-time */
            retrievedAt: string | null;
            reason: string;
        };
        ProfileTraceComponent: components["schemas"]["ProfileScoreComponent"] & {
            availableWeight: number;
            /** @description Sub-features (or items) that formed this component, with relative weight and share of the component score. status missing = no source produced it, so it was counted as 0. */
            subFeatures: {
                key: string;
                value: number;
                weight: number;
                share: number;
                /** @enum {string} */
                status?: "found" | "missing";
            }[];
            formulaInput: {
                score: number;
                weight: number;
            } | null;
        };
        ProfileLiveTraceResponse: {
            /** Format: uuid */
            traceId: string;
            /** Format: uuid */
            userId: string;
            /** Format: date-time */
            startedAt: string;
            /** Format: date-time */
            finishedAt: string;
            stages: components["schemas"]["ProfileTraceStage"][];
            sources: components["schemas"]["ProfileTraceSource"][];
            providerChecks: components["schemas"]["ProfileTraceProviderCheck"][];
            score: number | null;
            confidence: number;
            coverage: number;
            classification: components["schemas"]["ProfileScoreClassification"];
            algorithm: {
                version: string;
                configHash: string;
                inputHash: string;
            };
            components: components["schemas"]["ProfileTraceComponent"][];
            evidence: components["schemas"]["ProfileScoreEvidence"][];
            eligibility: {
                eligible: boolean;
                reasons: string[];
            };
            warnings: string[];
            formula: {
                expression: string;
                availableWeight: number;
                inputs: components["schemas"]["ProfileTraceComponent"][];
            };
            snapshot: components["schemas"]["ProfileScoreSnapshot"];
            llmCalls: components["schemas"]["ProfileTraceLlmCall"][];
            stackTrace: string;
            copyText: string;
        };
        ProfileTraceLlmCall: {
            callId: string;
            /** @enum {string} */
            call: "item-assessment" | "company-context";
            /** @enum {string} */
            status: "completed" | "failed" | "reused" | "skipped";
            /** @enum {string|null} */
            itemType: "project" | "experience" | "internship" | null;
            itemTitle: string | null;
            durationMs: number | null;
            detail: string;
            error: {
                name: string;
                message: string;
                stack: string | null;
            } | null;
        };
        /** @description One NDJSON line of the live trace. `data` is the step's structured detail; for `result` it is a ProfileLiveTraceResponse. */
        ProfileLiveTraceEvent: {
            seq: number;
            /** Format: date-time */
            ts: string;
            elapsedMs: number;
            /** @enum {string} */
            kind: "stage" | "log" | "llm" | "engine" | "result" | "error";
            stage: string;
            /** @enum {string} */
            level: "debug" | "info" | "warn" | "error";
            message: string;
            data?: unknown;
        };
        /** @enum {string} */
        LinkedInSectionKey: "headline" | "about" | "experience" | "education" | "projects" | "skills" | "achievements" | "certifications" | "publications" | "patents" | "courses" | "languages" | "volunteering";
        LinkedInImportSection: {
            key: components["schemas"]["LinkedInSectionKey"];
            label: string;
            entries: string[];
            /** @description Uploaded PDF filename (display only). Null for legacy URL snapshots. */
            sourceFile: string | null;
        };
        /** @description Confirmed snapshot receipt, never proof of account ownership or employment. New imports are PDFs; legacy URL snapshots stay readable until replaced. */
        LinkedInImportStatus: {
            connected: boolean;
            /** Format: date-time */
            importedAt: string | null;
            /** @enum {string|null} */
            method: "pdf" | "url" | null;
            sections: string[];
            warnings: string[];
            /**
             * Format: uri
             * @description Profile URL found in the PDF
             */
            sourceUrl: string | null;
            /**
             * @description Null for PDF imports; Firecrawl/Exa only on legacy URL snapshots.
             * @enum {string|null}
             */
            provider: "exa" | "firecrawl" | null;
            /** Format: date-time */
            retrievedAt: string | null;
        };
        /** @description Owner-bound derived preview expires after 24 hours. The uploaded PDF is not stored. Profile level is null and never inferred from imported career text. */
        LinkedInImportDraft: {
            /** Format: uuid */
            id: string;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            expiresAt: string;
            /** @enum {string} */
            method: "pdf" | "url";
            profileRevision: string | null;
            profile: components["schemas"]["CandidateProfileResponse"];
            sections: components["schemas"]["LinkedInImportSection"][];
            warnings: string[];
            /** Format: uri */
            sourceUrl: string | null;
            /** @enum {string|null} */
            provider: "exa" | "firecrawl" | null;
            /** Format: date-time */
            retrievedAt: string | null;
        };
        LinkedInImportConfirmation: {
            profile: components["schemas"]["CandidateProfileResponse"] | null;
            import: components["schemas"]["LinkedInImportStatus"];
        };
        CandidateProfileEducation: {
            institution: string | null;
            degree: string | null;
            field: string | null;
            startYear: string | null;
            endYear: string | null;
            grade: string | null;
        };
        CandidateProfileExperience: {
            company: string | null;
            title: string | null;
            startDate: string | null;
            endDate: string | null;
            location: string | null;
            bullets: string[] | null;
            /**
             * Format: uri
             * @description Explicitly supplied live/company URL.
             */
            link?: string | null;
        };
        CandidateProfileProject: {
            name: string | null;
            description: string | null;
            tech: string[] | null;
            bullets: string[] | null;
            link: string | null;
        };
        CandidateProfileLinks: {
            github: string | null;
            leetcode: string | null;
            linkedin: string | null;
            /** Format: uri */
            portfolioWebsite?: string | null;
        };
        CandidateProfileDetails: {
            fullName: string | null;
            email: string | null;
            phone: string | null;
            location: string | null;
            headline: string | null;
            /**
             * Format: uri
             * @description Personal or portfolio website explicitly supplied by the candidate or extracted from the resume.
             */
            portfolioWebsite?: string | null;
            targetRole: string | null;
            /** Format: uuid */
            targetJdId: string | null;
            education: components["schemas"]["CandidateProfileEducation"][];
            experience: components["schemas"]["CandidateProfileExperience"][];
            projects: components["schemas"]["CandidateProfileProject"][];
            skills: string[];
            achievements: string[];
            detectedLinks: components["schemas"]["CandidateProfileLinks"];
            resumeFilename: string | null;
        };
        CandidateProfileResponse: components["schemas"]["CandidateProfileDetails"] & {
            level: components["schemas"]["NullableEngineeringLevel"];
            legacyLevel?: string | null;
            /** Format: date-time */
            resumeParsedAt: string | null;
            onboardingComplete: boolean;
        };
        CandidateProfileRequest: components["schemas"]["CandidateProfileDetails"] & {
            level?: components["schemas"]["NullableEngineeringLevel"];
            complete: boolean;
        };
        ResumeParseRunResponse: {
            /** @enum {string} */
            status: "running" | "completed" | "failed";
            profile: components["schemas"]["CandidateProfileResponse"] | null;
            error: string | null;
        };
        /**
         * @description Canonical user-choice enum across profiles, company JDs, processes, experiences and scoring. Target job level and current profile level are distinct choices using the same enum.
         * @enum {string}
         */
        EngineeringLevel: "intern" | "fresher" | "sde1" | "sde2" | "sde3" | "staff" | "principal" | "distinguished";
        /**
         * @description Null only for unfinished profiles or unknown legacy records; never guess an engineering level.
         * @enum {string|null}
         */
        NullableEngineeringLevel: "intern" | "fresher" | "sde1" | "sde2" | "sde3" | "staff" | "principal" | "distinguished" | null;
        ProfileScoringSettings: {
            /** @description Effective CandidateProfile.level; compatibility fallback only for old field-absent profiles. */
            declaredLevel: components["schemas"]["NullableEngineeringLevel"];
            /** @default false */
            leaderboardOptIn: boolean;
        };
        ProfileScoreEvidence: {
            id: string;
            source: string;
            path: string;
            claim: string;
            value: string | number;
            confidence: number;
            /** Format: date-time */
            observedAt: string | null;
            /** @enum {string} */
            verification: "collector" | "self_reported";
            recencyFactor: number;
            /** @description V5 sub-feature key this evidence supports (e.g. codeforces_contest, technical_depth). */
            feature?: string;
            /** @description V5 raw observation before normalization (platform-native units or extracted structure). */
            rawValue?: unknown;
            /** @description V5 0-100 value after platform- or policy-specific normalization. */
            normalizedValue?: number | null;
            scoreContribution?: number | null;
            /** @enum {string} */
            evidenceType?: "DIRECT" | "DERIVED" | "INFERRED" | "SELF_REPORTED" | "UNAVAILABLE";
            algorithmVersion?: string;
            sourceUrl?: string | null;
            sourceTimestamp?: string | null;
            sourceMetadata?: {
                [key: string]: unknown;
            };
            /** @description V3 attribution paths; repeated claims do not accumulate scoring or confidence credit. */
            paths?: string[];
            provenance?: {
                section: string;
                path: string;
                file: string | null;
                quote: string;
            }[];
        };
        ProfileScoreComponent: {
            id: string;
            label: string;
            weight: number;
            score: number | null;
            contribution: number | null;
            evidenceIds: string[];
            /**
             * @description missing = no current evidence (a core part then counts as 0, including when its AI assessment failed or has not run). pending appears only on older v5 snapshots, which left an unassessed part out.
             * @enum {string}
             */
            status: "available" | "missing" | "pending";
            /**
             * @description core = expected at the level and nothing else stands in for it (a gap is warned about); bonus = extra credit (a gap is a quiet 0 of its weight). Every part counts in proportion to its weight; missing = 0.
             *
             * @enum {string}
             */
            role?: "core" | "bonus";
            /** @description v5: whether the part is in the score (missing core counts as 0; a bonus counts when present; pending is left out). */
            counted?: boolean;
        };
        ProfileScoreSource: {
            source: string;
            /** @enum {string} */
            status: "available" | "missing" | "unsupported" | "partial";
            /** Format: date-time */
            fetchedAt: string | null;
            ageDays: number | null;
            contentHash: string | null;
            /**
             * @description Historic methods remain replayable; new imports are uploaded LinkedIn PDFs.
             * @enum {string|null}
             */
            importMethod?: "archive" | "pdf" | "text" | "url" | null;
            /** Format: date-time */
            importedAt?: string | null;
            /** @enum {string|null} */
            provider?: "exa" | "firecrawl" | null;
            /**
             * Format: date-time
             * @description Retrieval time
             */
            retrievedAt?: string | null;
        };
        ProfileScoreClassification: {
            declaredLevel: components["schemas"]["NullableEngineeringLevel"];
            assessedLevel: components["schemas"]["EngineeringLevel"];
            confidence: number;
            reasons: string[];
            warnings: string[];
        };
        /** @description Provisional deterministic assessment. Score and coverage are 0–100; unknown evidence is null, not zero. From v5, source data is taken as correct (no confidence weighting): confidence is 100 when scored, else 0, and leaderboard eligibility depends only on the level's minimum coverage.
         *      */
        ProfileScoreEvaluation: {
            algorithmVersion: string;
            configHash: string;
            inputHash: string;
            /** Format: date-time */
            asOf: string;
            /** @enum {string} */
            status: "scored" | "insufficient_evidence";
            score: number | null;
            confidence: number;
            coverage: number;
            level: components["schemas"]["EngineeringLevel"];
            classification: components["schemas"]["ProfileScoreClassification"];
            components: components["schemas"]["ProfileScoreComponent"][];
            evidence: components["schemas"]["ProfileScoreEvidence"][];
            warnings: string[];
            eligibility: {
                eligible: boolean;
                reasons: string[];
            };
            sources: components["schemas"]["ProfileScoreSource"][];
        };
        ProfileScoreSnapshot: components["schemas"]["ProfileScoreEvaluation"] & {
            id: string;
            /** Format: date-time */
            calculatedAt: string;
            /**
             * Format: date
             * @description UTC Monday cohort week.
             */
            week: string;
            rank: number | null;
            percentile: number | null;
            cohortSize: number;
        };
        ProfileScoreResponse: {
            current: components["schemas"]["ProfileScoreSnapshot"] | null;
            history: components["schemas"]["ProfileScoreSnapshot"][];
            settings: components["schemas"]["ProfileScoringSettings"];
        };
        ProfileLeaderboardResponse: {
            level: components["schemas"]["EngineeringLevel"];
            algorithmVersion: string;
            /** Format: date */
            week: string;
            total: number;
            entries: {
                rank: number;
                displayName: string;
                score: number;
                confidence: number;
                percentile: number | null;
            }[];
        };
        ProfileScoringConfig: {
            version: string;
            beta: boolean;
            /** @description Current v2 configurations require all eight rubrics. intern/distinguished are optional only to describe immutable six-rubric v1 replay data. */
            weights: {
                intern?: {
                    [key: string]: number;
                };
                fresher: {
                    [key: string]: number;
                };
                sde1: {
                    [key: string]: number;
                };
                sde2: {
                    [key: string]: number;
                };
                sde3: {
                    [key: string]: number;
                };
                staff: {
                    [key: string]: number;
                };
                principal: {
                    [key: string]: number;
                };
                distinguished?: {
                    [key: string]: number;
                };
            };
            normalizers: {
                [key: string]: number;
            };
            thresholds: {
                minimumCoverage: number;
                minimumConfidence: number;
                minimumCohort: number;
            };
        };
        ProfileScoringJobStatus: {
            enabled: boolean;
            /** @enum {string} */
            status: "idle" | "running" | "completed" | "failed";
            /** Format: date-time */
            lastStartedAt: string | null;
            /** Format: date-time */
            lastCompletedAt: string | null;
            lastError: string | null;
            /** Format: date-time */
            nextDueAt: string | null;
            processed: number;
            failed: number;
        };
        ProfileDiagnosticCheck: {
            id: string;
            label: string;
            /** @enum {string} */
            status: "pass" | "fail" | "warning" | "untested";
            detail: string;
        };
        ProfileDiagnosticsResponse: {
            /** Format: date-time */
            checkedAt: string;
            checks: components["schemas"]["ProfileDiagnosticCheck"][];
            score: components["schemas"]["ProfileScoreResponse"] | null;
            jobs: components["schemas"]["ProfileScoringJobStatus"];
            methodology: components["schemas"]["ProfileScoringConfig"];
        };
        /** @enum {string} */
        CodingPlatform: "CODEFORCES" | "CODECHEF" | "ATCODER" | "TUF";
        PlatformConnection: {
            platform: components["schemas"]["CodingPlatform"];
            handle: string;
            /** @enum {string} */
            status: "SYNCING" | "SYNCED" | "FAILED" | "DEGRADED";
            /** Format: date-time */
            connectedAt: string;
            /** Format: date-time */
            lastRefreshedAt?: string;
            /** @description Set when the connection was made automatically from another profile's linked accounts (e.g. TUF). */
            discoveredFrom?: string;
        };
        /** @description The stable { code, message } error envelope used across the api. */
        ApiError: {
            /** @example session_jd_not_found */
            code: string;
            message: string;
        };
        RegisterRequest: {
            /** @description Trimmed; 1–100 characters after trimming. */
            name: string;
            /**
             * Format: email
             * @description Trimmed and lowercased before use.
             */
            email: string;
            /**
             * Format: password
             * @description 8–128 characters and not only whitespace. Not trimmed.
             */
            password: string;
        };
        LoginRequest: {
            /**
             * Format: email
             * @description Trimmed and lowercased; matched case-insensitively.
             */
            email: string;
            /**
             * Format: password
             * @description Only the length is checked here (so a later, stricter password policy never locks out existing accounts); a wrong password is 401 `invalid_credentials`.
             *
             */
            password: string;
        };
        TokenResponse: {
            /** @description HS256 JWT; send as `Authorization: Bearer <accessToken>`. */
            accessToken: string;
            /** @enum {string} */
            tokenType: "Bearer";
            /**
             * @description Access-token lifetime in seconds (900 by default).
             * @example 900
             */
            expiresIn: number;
        };
        VerifyEmailRequest: {
            /** @description The `token` query parameter of the verification link. */
            token: string;
        };
        ForgotPasswordRequest: {
            /** Format: email */
            email: string;
        };
        ResetPasswordRequest: {
            /** @description The `token` query parameter of the reset link. */
            token: string;
            /**
             * Format: password
             * @description The new password — same rules as `RegisterRequest.password`.
             */
            password: string;
        };
        /**
         * @description USER cannot run interviews; CANDIDATE can; ADMIN can and manages users.
         * @enum {string}
         */
        Role: "USER" | "CANDIDATE" | "ADMIN";
        AdminUser: {
            /** Format: uuid */
            id: string;
            /** Format: email */
            email: string;
            name: string;
            role: components["schemas"]["Role"];
            onboardingComplete: boolean;
            emailVerified: boolean;
            hasPassword: boolean;
            hasGoogle: boolean;
        };
        CurrentUser: {
            /** Format: uuid */
            id: string;
            /** Format: email */
            email: string;
            name: string;
            role: components["schemas"]["Role"];
            /** @description True once the onboarding wizard is finished. Gates app entry vs /onboarding. */
            onboardingComplete: boolean;
            /** @description The user proved control of `email` (verification link, reset link, or a Google sign-in where Google verified it).
             *      */
            emailVerified: boolean;
            /** @description The account can sign in with email + password (false = Google-only). */
            hasPassword: boolean;
        };
        UpdateUserRequest: {
            name: string;
        };
        DeleteAccountRequest: {
            /** @description Must equal the account's email (case-insensitive). */
            confirmEmail: string;
            /** @description Required for accounts that have a password. */
            password?: string;
        };
        /** @description Everything the API holds about the account. Shape follows the stores; only `exportedAt` is fixed. */
        AccountExport: {
            /** Format: date-time */
            exportedAt: string;
        } & {
            [key: string]: unknown;
        };
        NotificationChannel: {
            interviewReminders: boolean;
            debriefReady: boolean;
            retakeAvailable: boolean;
            targetOpenings: boolean;
            weeklyDigest: boolean;
            productUpdates: boolean;
        };
        /** @description Account-level settings (Settings → Account / Notifications / Privacy & data). Device-only settings (theme, reduced motion) never reach the server.
         *      */
        Preferences: {
            locale: {
                /** @enum {string} */
                appLanguage: "en" | "hi" | "ta" | "te" | "bn" | "mr";
                /** @description IANA zone; null follows the browser. */
                timezone: string | null;
                /** @enum {string} */
                dateFormat: "DD/MM/YYYY" | "MM/DD/YYYY" | "YYYY-MM-DD";
                /** @enum {string} */
                timeFormat: "12h" | "24h";
                /** @enum {string} */
                weekStart: "monday" | "sunday";
            };
            interview: {
                /** @enum {string} */
                language: "en" | "hinglish" | "hi";
                /** @enum {string} */
                voice: "warm" | "neutral" | "crisp";
                /** @enum {string} */
                pace: "slower" | "normal" | "faster";
                captions: boolean;
                showTimer: boolean;
                deviceCheck: boolean;
                /** @enum {string} */
                reminderLead: "15m" | "1h" | "1d";
            };
            notifications: {
                emailPaused: boolean;
                email: components["schemas"]["NotificationChannel"];
                inApp: components["schemas"]["NotificationChannel"];
            };
            privacy: {
                /**
                 * @description How an opted-in profile appears on the leaderboard.
                 * @enum {string}
                 */
                leaderboardVisibility: "name" | "anonymous" | "hidden";
                shareWithCollege: boolean;
                partnerDiscovery: boolean;
                improveWithMyData: boolean;
            };
            /**
             * Format: date-time
             * @description When the user last changed a setting; null = never.
             */
            updatedAt: string | null;
        };
        /** @description Any subset of `Preferences` leaves (same shape, every field optional). Unknown keys are rejected. */
        PreferencesPatch: {
            locale?: {
                [key: string]: unknown;
            };
            interview?: {
                [key: string]: unknown;
            };
            notifications?: {
                [key: string]: unknown;
            };
            privacy?: {
                [key: string]: unknown;
            };
        };
        /**
         * @description A live, human-conducted interview round InterviewIQ can mock. Online Assessment is intentionally excluded — it's an automated coding test, not a live round, so it isn't bookable/conductable here. (The ai-service brief pipeline still recognises OA when it describes companies' real hiring processes; that's a separate, internal vocabulary.)
         *
         * @enum {string}
         */
        RoundType: "dsa" | "system-design" | "lld" | "behavioural" | "hiring-manager";
        /** @enum {string} */
        Difficulty: "easy" | "medium" | "hard";
        /**
         * @description Interview session lifecycle. Prep (SCHEDULED → PREP_QUEUED → PREP_READY, with PREP_FAILED) is Pipeline 1. Live states (LIVE_IN_PROGRESS, COMPLETED, ABORTED_TECHNICAL) are Pipeline 2 — a PREP_READY session transitions to LIVE_IN_PROGRESS on go-live, then to COMPLETED or ABORTED_TECHNICAL.
         *
         * @enum {string}
         */
        SessionStatus: "SCHEDULED" | "PREP_QUEUED" | "PREP_READY" | "PREP_FAILED" | "LIVE_IN_PROGRESS" | "COMPLETED" | "ABORTED_TECHNICAL" | "CANCELLED";
        CreateInterviewSessionRequest: {
            /**
             * Format: uuid
             * @description Required for ad-hoc bookings; omitted for a loop round, including JD-independent custom practice.
             */
            jobDescriptionId?: string | null;
            /** @description Optional and normally omitted — the candidate does not pick the round. The backend assigns it (currently the first round; per-candidate round progression later). Accepted if sent (e.g. by the admin bench).
             *      */
            roundType?: components["schemas"]["RoundType"];
            /**
             * Format: date-time
             * @description The chosen slot, as an absolute instant (UTC ISO-8601).
             */
            scheduledAt: string;
            /**
             * @description IANA timezone the candidate booked in (e.g. Asia/Kolkata).
             * @example Asia/Kolkata
             */
            timezone: string;
            /**
             * Format: uuid
             * @description Book a round of this confirmed loop. Sent together with nodeId; the loop fixes the JD and the node fixes the round.
             */
            loopId?: string | null;
            /** @description The loop graph node (round) being booked. The round must be unlocked. */
            nodeId?: string | null;
        };
        /** @description A booked interview session and its blueprint prep. Only `prep` (progress) and `briefing` (interviewer, format, duration) reach the candidate: blueprint CONTENTS — problems, topics, difficulty, answer keys — are the interviewer's material and are never returned here.
         *      */
        InterviewSession: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            candidateId: string;
            /** Format: uuid */
            jobDescriptionId: string | null;
            /** @description Company slug. */
            company: string;
            /** @description Human-readable company name, when known. */
            companyName?: string | null;
            role: string;
            level: components["schemas"]["NullableEngineeringLevel"];
            /** @description Unknown historic label retained for display/repair; not a selectable level. */
            legacyLevel?: string | null;
            specialization: string;
            roundType: components["schemas"]["RoundType"];
            /** Format: date-time */
            scheduledAt: string;
            timezone: string;
            status: components["schemas"]["SessionStatus"];
            prep: components["schemas"]["SessionPrep"];
            /** @description Set once the blueprint is ready (and while it refreshes). */
            briefing: components["schemas"]["SessionBriefing"] | null;
            /** @description False until the live interviewer is available; a ready session can't be joined yet. */
            liveAvailable: boolean;
            /** @description How the live round ended; null before it ends. */
            endReason: components["schemas"]["LiveEndReason"] | null;
            /**
             * Format: uuid
             * @description The loop this session is a round of; null for ad-hoc bookings.
             */
            loopId?: string | null;
            nodeId?: string | null;
            /**
             * @description This round's length in minutes, drawn at booking and kept through reschedules; 45 for sessions booked before the draw.
             * @enum {integer}
             */
            roundMinutes: 30 | 35 | 40 | 45;
            /** @description The round's pass mark (1-10), snapshotted at booking; null for sessions booked before grading. */
            passMark: number | null;
            /** @description Overall round score (1.0-10.0, one decimal); null until graded or when the round could not be scored. */
            score: number | null;
            outcome: components["schemas"]["RoundOutcome"] | null;
            verdict: string | null;
            /**
             * Format: date-time
             * @description Earliest retake after a below-pass round (the cooldown); null otherwise.
             */
            retakeAfter: string | null;
            /**
             * @description Grading state of a completed round; null before the round completes. `legacy` rounds finished before grading existed.
             * @enum {string|null}
             */
            evaluationStatus: "evaluating" | "ready" | "failed" | "legacy" | null;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
        };
        /** @description The graded debrief of a completed round. `status` is `evaluating` / `failed` / `legacy` with no other fields, or `ready` with the report. A `ready` report whose `outcome` is `unscorable` carries only `outcome`, `unscorableReason`, `meta`, `transcript` and `disputes`; every scored section is empty or null. The transcript is spoken text only, never interviewer orders, tool calls or briefs.
         *      */
        RoundReport: {
            /** @enum {string} */
            status: "evaluating" | "failed" | "legacy" | "ready";
            /** @description Report version; a dispute re-check stores a new one. */
            version?: number;
            meta?: {
                company?: string | null;
                role?: string | null;
                level?: string | null;
                round?: string | null;
                roundMinutes?: number | null;
                minutesPlayed?: number | null;
                /** @enum {string|null} */
                codeStandard?: "runnable" | "near_runnable" | "pseudo_ok" | null;
                weightsVersion?: string | null;
                evalVersion?: string | null;
            };
            outcome?: components["schemas"]["RoundOutcome"] | null;
            unscorableReason?: string | null;
            score?: number | null;
            passMark?: number | null;
            verdict?: string | null;
            /** @description Reason the score was capped; null when it was not. */
            cap?: string | null;
            /** @description The weighted area score before adjustments (1-10, one decimal); null when not scored. */
            baseScore?: number | null;
            /** @description Sum of the positive adjustments after the +0.5 cap; null when not scored. */
            bonusTotal?: number | null;
            /** @description Sum of the negative adjustments (zero or below; no limit); null when not scored. */
            penaltyTotal?: number | null;
            practicalScore?: number | null;
            theoryScore?: number | null;
            /** Format: date-time */
            retakeAfter?: string | null;
            /** @description The round this pass unlocked. */
            nextRound?: {
                nodeId: string;
                name: string;
                type?: string | null;
            } | null;
            /** @description Readiness for the JD after this round; null when the loop does not count. */
            readiness?: components["schemas"]["ReadinessLevel"] | null;
            areas?: {
                key: string;
                label: string;
                /** @description Percent of the round this area is worth. */
                weight: number;
                score: number;
                reason: string;
                evidence: string[];
                /** @description The same area on the previous attempt of this round. */
                previousScore?: number | null;
            }[];
            adjustments?: {
                kind: string;
                label: string;
                delta: number;
                turnId?: number | null;
                at?: string | null;
                note: string;
            }[];
            questions?: {
                id: string;
                part: string;
                kind: string;
                title?: string | null;
                asked: string;
                answerQuotes: {
                    turnId: number;
                    text: string;
                }[];
                /** @enum {string} */
                verdict: "correct" | "mostly" | "partly" | "wrong" | "not_answered" | "not_reached";
                score: number | null;
                strongAnswer: string;
                gap: string;
                topics: {
                    subject: string;
                    topic: string;
                }[];
                /** @enum {string|null} */
                resumeConsistency?: "consistent" | "unsupported" | "contradicts" | "n/a" | null;
                resumeNote?: string | null;
                /** @enum {string} */
                origin?: "asked" | "candidate_led";
                intent?: string;
                code?: {
                    language?: string;
                    text?: string;
                    trace?: {
                        example?: string;
                        predicted?: string;
                        expected?: string;
                        matches?: boolean;
                    }[];
                    /** @enum {string} */
                    logicWorks?: "yes" | "syntax_only" | "partly" | "no";
                    syntaxSlips?: string[];
                };
                board?: {
                    summary?: string;
                    notes?: string[];
                    /** @description The final whiteboard scene (Excalidraw JSON). */
                    scene?: {
                        [key: string]: unknown;
                    } | null;
                };
            }[];
            delivery?: {
                observations?: {
                    text?: string;
                    /** @description Transcript turn ids. */
                    examples?: number[];
                }[];
                stats?: {
                    medianAnswerLatencyS?: number | null;
                    /** @description How many answers took 6 s or more to start. */
                    slowStarts?: number | null;
                    fillers?: {
                        [key: string]: number;
                    };
                    /** @description How many silences over 90 s while coding. */
                    longSilences?: number | null;
                    selfCorrections?: number | null;
                };
            };
            conduct?: components["schemas"]["RoundReportEvent"][];
            integrity?: components["schemas"]["RoundReportEvent"][];
            focus?: {
                title: string;
                why: string;
                /** @description The candidate's own words from this round */
                exampleQuote?: string;
                /** @description A coach's note on the quote. */
                exampleNote?: string;
                /** @description Transcript turn ids. */
                moments: number[];
            }[];
            topicGaps?: {
                subject: string;
                topics: {
                    topic: string;
                    why: string;
                    practice: {
                        slug: string;
                        title: string;
                        difficulty?: string | null;
                        retry?: boolean;
                    }[];
                }[];
            }[];
            strengths?: string[];
            summary?: string;
            endQuestions?: {
                /** @enum {string} */
                quality?: "none" | "basic" | "thoughtful";
                bonus?: number;
                note?: string;
            };
            transcript?: {
                turnId: number;
                speaker: string;
                text: string;
                at?: string | null;
                cutOff: boolean;
                markers: {
                    kind?: string;
                    note?: string;
                }[];
            }[];
            disputes?: {
                target?: {
                    /** @enum {string} */
                    type?: "question" | "area";
                    id?: string;
                };
                reason?: string;
                /** @enum {string} */
                decision?: "upheld" | "revised";
                oldScore?: number | null;
                newScore?: number | null;
                explanation?: string;
                reportVersion?: number | null;
                createdAt?: string | null;
            }[];
            /** @description A dispute re-check of this report is running; its decision appears in `disputes` when it completes. */
            recheckPending?: boolean;
            /** @description The question or area being re-checked, while `recheckPending`; null otherwise or when not known. */
            recheckTarget?: {
                /** @enum {string} */
                type: "question" | "area";
                id: string;
            } | null;
        };
        RoundReportEvent: {
            kind: string;
            at?: string | null;
            turnId?: number | null;
            /** @description A score change */
            effect: unknown;
        };
        CreateReportDisputeRequest: {
            target: {
                /** @enum {string} */
                type: "question" | "area";
                /** @description A question id or an area key from the report. */
                id: string;
            };
            reason: string;
        };
        ReportDisputeStarted: {
            /** @enum {string} */
            status: "rechecking";
        };
        EvaluationRunError: {
            code: string;
            message: string;
            transient?: boolean;
        };
        /** @description One evaluation run row (snake-case passthrough; the list leaves out request, raw and arithmetic). */
        EvaluationRunSummary: {
            run_id: string;
            session_id?: string | null;
            candidate_id?: string | null;
            trigger: string;
            /** @enum {string} */
            status: "running" | "completed" | "failed" | "cancelled";
            company?: string | null;
            role?: string | null;
            level?: string | null;
            round_type?: string | null;
            outcome?: string | null;
            duration_ms?: number | null;
            eval_version?: string | null;
            error?: components["schemas"]["EvaluationRunError"] | null;
            created_at: string;
            ended_at?: string | null;
        };
        EvaluationRunList: {
            runs: components["schemas"]["EvaluationRunSummary"][];
            next_cursor: string | null;
        };
        /** @description One grader's structured output for one part. Free-form beyond the fields the admin view reads. */
        EvaluationPartGrade: {
            part_id: string;
            must_have_met?: boolean;
            areas?: ({
                key: string;
                score: number;
                reason?: string;
                evidence?: string[];
            } & {
                [key: string]: unknown;
            })[];
            questions?: ({
                id: string;
                asked?: string;
                verdict?: string;
                score: number;
                gap?: string;
                resume_consistency?: string;
            } & {
                [key: string]: unknown;
            })[];
            code?: ({
                logic_works?: string;
                actual_complexity?: string;
                syntax_slips?: string[];
            } & {
                [key: string]: unknown;
            }) | null;
            moments?: {
                [key: string]: unknown;
            }[];
        } & {
            [key: string]: unknown;
        };
        /** @description A score gap or categorical disagreement between graders A and B; c is the tiebreak, merged the final value. */
        EvaluationDisagreement: {
            part_id: string;
            field: string;
            a?: unknown;
            b?: unknown;
            c?: unknown;
            merged?: unknown;
        };
        EvaluationRaw: {
            disagreements: components["schemas"]["EvaluationDisagreement"][];
            /** @description Part id to grader outputs (A, B, and C when it tiebroke). */
            graders: {
                [key: string]: {
                    A?: components["schemas"]["EvaluationPartGrade"];
                    B?: components["schemas"]["EvaluationPartGrade"];
                    C?: components["schemas"]["EvaluationPartGrade"];
                };
            };
        };
        /** @description The final score arithmetic of a run. */
        EvaluationArithmetic: {
            pass_mark?: number;
            main_family?: string | null;
            auto_fail?: boolean;
            auto_fail_reason?: string | null;
            parts?: {
                [key: string]: unknown;
            }[];
            adjustments?: {
                [key: string]: unknown;
            }[];
            base?: number;
            bonus_total?: number;
            penalty_total?: number;
            cap?: unknown;
            score?: number | null;
            verdict?: string | null;
        };
        /** @description One run with raw grader outputs, disagreements, tiebreaks and arithmetic (snake-case passthrough). */
        EvaluationRunDetail: components["schemas"]["EvaluationRunSummary"] & {
            request?: {
                [key: string]: unknown;
            } | null;
            result?: {
                version?: number;
                outcome?: string;
                score?: number | null;
                verdict?: string | null;
                pass_mark?: number;
            } | null;
            raw?: components["schemas"]["EvaluationRaw"] | null;
            arithmetic?: components["schemas"]["EvaluationArithmetic"] | null;
        };
        EvaluationRerunStarted: {
            runId: string;
        };
        RescheduleInterviewSessionRequest: {
            /** Format: date-time */
            scheduledAt: string;
            timezone: string;
        };
        ProcessRoundNode: {
            id: string;
            /** @enum {string} */
            kind: "round";
            type: components["schemas"]["RoundType"];
            name: string;
            durationMinutes: number;
            /** @enum {string} */
            difficulty: "easy" | "medium" | "hard";
            topics: string[];
            instructions?: string;
            position: components["schemas"]["ProcessPosition"];
        };
        /** @description A non-interview step (online test, take-home). Display only, never connected, scheduled, scored or counted. */
        ProcessInfoNode: {
            id: string;
            /** @enum {string} */
            kind: "info";
            name: string;
            note: string;
            topics?: string[];
            /** @enum {string} */
            difficulty?: "easy" | "medium" | "hard";
            instructions?: string;
            position: components["schemas"]["ProcessPosition"];
        };
        ProcessPosition: {
            x: number;
            y: number;
        };
        /** @description An interview process as a graph. Round nodes are ordered by edges (a round unlocks once every round feeding into it is completed). No cycles; round nodes form one connected graph.
         *      */
        ProcessGraph: {
            nodes: (components["schemas"]["ProcessRoundNode"] | components["schemas"]["ProcessInfoNode"])[];
            edges: {
                source: string;
                target: string;
            }[];
        };
        JdBrief: {
            /** Format: uuid */
            jdId: string;
            practiceTemplate: boolean;
            title: string;
            company: string;
            companyName: string;
            role: string;
            level: components["schemas"]["NullableEngineeringLevel"];
            legacyLevel?: string | null;
            specialization: string | null;
            techStack: string[];
        };
        InterviewProcess: {
            /** Format: uuid */
            id: string;
            name: string;
            level: components["schemas"]["NullableEngineeringLevel"];
            legacyLevel?: string | null;
            jd: components["schemas"]["JdBrief"] | null;
            graph: components["schemas"]["ProcessGraph"];
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
        };
        InterviewProcessList: {
            processes: components["schemas"]["InterviewProcess"][];
        };
        /** @description Create with name and canonical engineering level; optional jdId copies its suggested graph. Without jdId a coding round is supplied if graph is omitted. Update accepts name, level and/or graph. Unknown historic levels must be explicitly repaired before copying or confirming. Every saved process is custom. */
        SaveProcessRequest: {
            /** Format: uuid */
            jdId?: string | null;
            name?: string;
            level?: components["schemas"]["EngineeringLevel"];
            graph?: components["schemas"]["ProcessGraph"];
        };
        OfficialProcess: {
            graph: components["schemas"]["ProcessGraph"];
        };
        /**
         * @description locked: earlier rounds unpassed. available: can be booked. booked: an attempt is scheduled or live. evaluating: the last attempt is being graded. passed: cleared. cooldown: below pass, retake after `retakeAfter`. completed: a legacy round finished before grading (counts as passed).
         * @enum {string}
         */
        LoopNodeState: "locked" | "available" | "booked" | "evaluating" | "passed" | "cooldown" | "completed";
        /**
         * @description Mock-interview readiness for a JD, from the rounds of the unedited loop passed. Never a badge or an endorsement.
         * @enum {string}
         */
        ReadinessLevel: "getting_started" | "progressing" | "nearly_ready" | "interview_ready";
        /** @enum {string} */
        RoundOutcome: "passed" | "below_pass" | "auto_fail" | "unscorable";
        /** @description A confirmed process with optional JD. Graph, name and level are snapshots taken at confirm time. Custom and simulated template loops never count toward readiness. */
        Loop: {
            /** Format: uuid */
            id: string;
            name: string;
            level: components["schemas"]["NullableEngineeringLevel"];
            legacyLevel?: string | null;
            /** Format: uuid */
            jdId: string | null;
            jd: components["schemas"]["JdBrief"] | null;
            /** Format: uuid */
            processId: string | null;
            /** @enum {string} */
            kind: "official" | "standalone";
            /** @enum {string} */
            status: "active" | "paused" | "abandoned" | "completed";
            /** @description Only unedited, suggested processes count. */
            countsTowardReadiness: boolean;
            /** @description Null when the loop does not count toward readiness. */
            readiness: components["schemas"]["ReadinessLevel"] | null;
            /** Format: date-time */
            confirmedAt: string;
            graph: components["schemas"]["ProcessGraph"];
            nodeStates: {
                [key: string]: components["schemas"]["LoopNodeState"];
            };
            /** @description The latest finished attempt per round node. */
            nodeResults: {
                [key: string]: {
                    /** Format: uuid */
                    sessionId: string;
                    score: number | null;
                    passMark: number | null;
                    outcome: components["schemas"]["RoundOutcome"] | null;
                    /** Format: date-time */
                    retakeAfter: string | null;
                };
            };
            progress: {
                total: number;
                completed: number;
                nextNodeIds: string[];
            };
            sessions: {
                /** Format: uuid */
                id: string;
                nodeId: string | null;
                status: components["schemas"]["SessionStatus"];
                /** Format: date-time */
                scheduledAt: string;
                score: number | null;
                passMark: number | null;
                outcome: components["schemas"]["RoundOutcome"] | null;
                /** Format: date-time */
                retakeAfter: string | null;
                /** @enum {string|null} */
                evaluationStatus: "evaluating" | "ready" | "failed" | "legacy" | null;
            }[];
        };
        LoopList: {
            loops: components["schemas"]["Loop"][];
        };
        /** @description Provide jdId to confirm a suggested process, or processId to confirm a custom saved process. Explicit null jdId detaches a copied process from its source JD. Practice template JDs always produce standalone loops. */
        ConfirmLoopRequest: {
            /** Format: uuid */
            jdId?: string | null;
            /**
             * Format: uuid
             * @description Omit to confirm the official process.
             */
            processId?: string | null;
        };
        SetLoopStatusRequest: {
            /** @enum {string} */
            status: "active" | "paused" | "abandoned";
        };
        TargetList: {
            targets: {
                jd: components["schemas"]["JdBrief"];
                /** Format: date-time */
                addedAt: string;
                hasLiveLoop: boolean;
            }[];
        };
        JdLoopStatus: {
            targeted: boolean;
            /** Format: uuid */
            loopId: string | null;
        };
        InterviewSessionListResponse: {
            sessions: components["schemas"]["InterviewSession"][];
        };
        WarmLiveResponse: {
            /** @description True when an interviewer is in the room, on its way, or was just dispatched. */
            warming: boolean;
        };
        LiveReadinessResponse: {
            /**
             * @description `waking` while the AI service or its voice worker is not up yet.
             * @enum {string}
             */
            interviewer: "ready" | "waking";
        };
        /** @description Result of starting or checking the live interview. `livekitUrl`/`token`/`roomName` are populated while status == LIVE_IN_PROGRESS and null otherwise (e.g. before prep is ready, or after the session has COMPLETED/ABORTED_TECHNICAL).
         *      */
        GoLiveResponse: {
            livekitUrl?: string | null;
            token?: string | null;
            roomName?: string | null;
            status: components["schemas"]["SessionStatus"];
        };
        /** @description Blueprint prep progress. `steps` only while a run is active and readable. */
        SessionPrep: {
            /** @description The run's current stage id. */
            step: string | null;
            steps: components["schemas"]["PrepStep"][];
            /** @description A refresh run is active; the current blueprint stays live. */
            refreshing: boolean;
            /** Format: date-time */
            preparedAt: string | null;
            /** @description Set when status == PREP_FAILED: round_not_found | not_enough_problems | answer_key_failed | playbook_failed | llm_unavailable | validation_failed | timeout | cancelled | interrupted | internal_error. */
            errorCode: string | null;
        };
        PrepStep: {
            id: components["schemas"]["BlueprintStageId"];
            /** @enum {string} */
            state: "done" | "active" | "pending" | "failed";
            elapsedMs: number | null;
        };
        /** @enum {string} */
        LiveEndReason: "completed" | "ended_by_interviewer" | "candidate_ended" | "technical";
        LiveSummary: {
            tab_changes?: number;
            screen_changes_weighted?: number;
            full_violations?: number;
            conduct_incidents?: number;
            ended_at?: string;
            interviewer_note?: string;
        };
        LiveEndRequest: {
            reason: components["schemas"]["LiveEndReason"];
            live_summary?: components["schemas"]["LiveSummary"];
        };
        LiveEndResult: {
            status: components["schemas"]["SessionStatus"];
            ended_reason: string | null;
            already_ended: boolean;
        };
        CandidateLiveEndResult: {
            status: components["schemas"]["SessionStatus"];
            endReason: string | null;
            alreadyEnded: boolean;
        };
        /** @description What the interviewer worker needs at the start of a live round. No contact details. */
        LiveContext: {
            /** Format: uuid */
            session_id: string;
            /** Format: uuid */
            candidate_id: string;
            first_name: string | null;
            status: components["schemas"]["SessionStatus"];
            round: {
                company: string;
                company_name: string | null;
                role: string;
                level: string;
                round_type: components["schemas"]["RoundType"];
                duration_mins: number;
            };
            profile: {
                headline: string | null;
                skills: string[];
                projects: string[];
            };
        };
        /** @description The only candidate-visible part of a blueprint. Never topics, problems or difficulty. */
        SessionBriefing: {
            interviewerName: string;
            interviewerStyle: string;
            /** @description e.g. "45-minute coding interview with a shared editor" */
            format: string;
            durationMins: number;
        };
        /** @enum {string} */
        BlueprintStageId: "context" | "selection" | "answer_keys" | "persona" | "personalization" | "playbooks" | "policies" | "validate";
        /** @enum {string} */
        BlueprintTrigger: "booking" | "reconcile" | "refresh" | "retry" | "bench";
        /** @enum {string} */
        BlueprintRunStatus: "running" | "completed" | "failed" | "cancelled";
        /** @description Everything a run needs, assembled by interviewiq-api. The candidate profile is a minimal projection (no contact details). */
        BlueprintRunRequest: {
            session: {
                /** @description Null for bench runs. */
                session_id: string | null;
                candidate_id: string;
                candidate_label?: string | null;
                company: string;
                role: string;
                /** @description The booked JD level label (may be a legacy alias). */
                level: string;
                specialization?: string | null;
                round_type: components["schemas"]["RoundType"];
                scheduled_at?: string | null;
                loop_id?: string | null;
                node_id?: string | null;
            };
            job_description: {
                id?: string | null;
                title: string;
                description?: string | null;
                tech_stack?: string | null;
            };
            /** @description Null when the brief/snapshot has no such round (the run fails with round_not_found). */
            round: components["schemas"]["BlueprintRound"] | null;
            company_brief?: {
                dominant_topics?: string[];
                difficulty_calibration?: string | null;
                interviewer_style_notes?: string | null;
                company_specific_patterns?: string | null;
                red_flags?: string[];
            } | null;
            candidate_profile: {
                [key: string]: unknown;
            };
            /** @description Bank slugs this candidate must not get again. */
            exclusions: string[];
            trigger: components["schemas"]["BlueprintTrigger"];
            options: {
                bypass_blueprint_cache?: boolean;
                bypass_answer_key_cache?: boolean;
                ignore_exclusions?: boolean;
            };
            input_hash: string;
            input_parts: {
                [key: string]: string;
            };
        };
        BlueprintRound: {
            type: components["schemas"]["RoundType"];
            name?: string | null;
            duration_mins?: number | null;
            format?: string | null;
            topics: string[];
            problems: string[];
            /** @enum {string|null} */
            difficulty?: "easy" | "medium" | "hard" | null;
            /** @enum {string} */
            source: "brief" | "practice";
        };
        BlueprintRunStarted: {
            run_id: string;
            /** @enum {string} */
            status: "running";
            existing?: boolean;
        };
        BlueprintRunStatusView: {
            run_id: string;
            session_id?: string | null;
            status: components["schemas"]["BlueprintRunStatus"];
            stage?: components["schemas"]["BlueprintStageId"] | null;
            steps: {
                id: components["schemas"]["BlueprintStageId"];
                /** @enum {string} */
                state: "done" | "active" | "pending" | "failed";
                elapsed_ms?: number | null;
            }[];
            error?: components["schemas"]["BlueprintRunError"] | null;
            blueprint_version?: number | null;
            cached?: boolean;
            input_hash?: string | null;
            briefing?: components["schemas"]["BlueprintBriefing"] | null;
        };
        BlueprintRunError: {
            code: string;
            message: string;
            stage?: string | null;
        };
        BlueprintRunSummary: {
            run_id: string;
            session_id?: string | null;
            candidate_id?: string;
            candidate_label?: string | null;
            trigger: components["schemas"]["BlueprintTrigger"];
            status: components["schemas"]["BlueprintRunStatus"];
            stage?: string | null;
            steps?: {
                id?: string;
                state?: string;
                elapsed_ms?: number | null;
            }[];
            company: string;
            role: string;
            level: string;
            round_type: components["schemas"]["RoundType"];
            error?: components["schemas"]["BlueprintRunError"] | null;
            blueprint_version?: number | null;
            cached?: boolean;
            duration_ms?: number | null;
            rerun_of?: string | null;
            created_at: string;
            ended_at?: string | null;
        };
        BlueprintRunList: {
            runs: components["schemas"]["BlueprintRunSummary"][];
            next_cursor: string | null;
        };
        /** @description One LLM call (or sandbox check) recorded on a stage. */
        BlueprintLlmCall: {
            label?: string;
            attempt?: number;
            system?: string;
            user?: string;
            raw?: string;
            provider?: string | null;
            model?: string | null;
            latency_ms?: number | null;
            attempts?: number | null;
            tokens?: {
                prompt?: number | null;
                completion?: number | null;
            };
            valid?: boolean;
            validation_errors?: string[];
            sandbox?: boolean;
            error?: string;
        };
        BlueprintStage: {
            id: components["schemas"]["BlueprintStageId"];
            label: string;
            /** @enum {string} */
            status: "pending" | "running" | "done" | "skipped" | "failed";
            started_at?: string | null;
            ended_at?: string | null;
            duration_ms?: number | null;
            summary?: {
                [key: string]: unknown;
            };
            /** @description Stage-specific detail (selection slots */
            detail?: {
                [key: string]: unknown;
            };
            llm_calls?: components["schemas"]["BlueprintLlmCall"][];
            error?: components["schemas"]["BlueprintRunError"] | null;
        };
        BlueprintRunDetail: components["schemas"]["BlueprintRunSummary"] & {
            stages: components["schemas"]["BlueprintStage"][];
            request?: components["schemas"]["BlueprintRunRequest"];
            input_hash?: string;
            input_parts?: {
                [key: string]: string;
            };
            blueprint?: components["schemas"]["Blueprint"] | null;
            briefing?: components["schemas"]["BlueprintBriefing"] | null;
        };
        BlueprintBriefing: {
            interviewer_name: string;
            interviewer_style: string;
            format: string;
            duration_mins: number;
        };
        BlueprintBranch: {
            /** @description One of the fixed condition vocabulary (spec §8.1). */
            condition: string;
            /** @description One of the fixed action vocabulary (spec §8.2). */
            action: string;
            say: string;
            notes?: string;
        };
        BlueprintSlot: {
            slot_id: string;
            /** @enum {string} */
            kind: "core" | "reserve";
            order: number;
            purpose?: string;
            timebox_mins: number;
            /** @description A problem the round's minutes do not hold (a short round's second): given only if the first went well and time allows. */
            bonus?: boolean;
            problem: {
                round_type: string;
                slug: string;
                title: string;
                difficulty?: string | null;
                content_hash?: string | null;
                content: {
                    [key: string]: unknown;
                };
            };
            answer_key: {
                key?: {
                    [key: string]: unknown;
                };
                key_version?: string;
                cache_hit?: boolean;
            };
            ask: {
                opening: string;
                clarifications?: {
                    question?: string;
                    answer?: string;
                }[];
            };
            hint_ladder: {
                step?: number;
                hint?: string;
            }[];
            branches: components["schemas"]["BlueprintBranch"][];
            probes?: string[];
            follow_ups?: string[];
            expectations: {
                must_show?: string[];
                strong_signals?: string[];
                weak_signals?: string[];
            };
            evaluation_signals: {
                signal?: string;
                observe?: string;
            }[];
        };
        /** @description The interviewer's playbook for one session (spec §8). Admin/internal only; immutable per version. */
        Blueprint: {
            blueprint_id: string;
            session_id?: string | null;
            candidate_id: string;
            version: number;
            /** @enum {string} */
            status: "current" | "superseded" | "bench";
            input_hash: string;
            input_parts?: {
                [key: string]: string;
            };
            run_id: string;
            created_at: string;
            round: {
                [key: string]: unknown;
            };
            /** @description The round shape chosen at prep (app/blueprint/shapes.py); old blueprints are classic. */
            shape_id?: string;
            persona: {
                name?: string;
                seniority?: string;
                style?: string;
                disposition?: string;
                opening?: string;
                closing?: string;
                grounded_in?: string[];
            };
            arc: {
                /** @enum {string} */
                phase?: "greeting" | "small_talk" | "framing" | "candidate_intro" | "core" | "candidate_questions" | "wrap_up";
                timebox_mins?: number;
                scored?: boolean;
                /** @description The part's style within the shape (for example pointed_resume); empty for the classic style. */
                style?: string;
                guidance?: string;
            }[];
            personalization: {
                rapport_hooks?: {
                    line?: string;
                    source?: string;
                }[];
                resume_probes?: {
                    prompt?: string;
                    grounded_in?: string;
                    what_it_tests?: string;
                }[];
                level_expectations?: string;
                /** @description Hiring-manager rounds: questions the round's own topics or notes call for that no bank slot covers (CS fundamentals through the candidate's projects, HR checks such as relocation). Asked in the deep-dive time. */
                round_questions?: {
                    prompt?: string;
                    covers?: string;
                    what_it_tests?: string;
                    expected?: string;
                }[];
            };
            slots: components["schemas"]["BlueprintSlot"][];
            policies: {
                version?: string;
                requests?: {
                    kind?: string;
                    /** @enum {string} */
                    decision?: "comply" | "decline" | "partial";
                    how?: string;
                }[];
                off_topic?: string;
                time_management?: string;
                integrity?: string;
                fallback?: string;
            };
            evaluation: {
                global_signals?: {
                    signal?: string;
                    observe?: string;
                }[];
                note?: string;
            };
            briefing: components["schemas"]["BlueprintBriefing"];
            provenance: {
                [key: string]: unknown;
            };
        };
        BlueprintVersionList: {
            versions: {
                version?: number;
                status?: string;
                created_at?: string;
                run_id?: string;
                input_hash?: string;
                input_parts?: {
                    [key: string]: string;
                };
            }[];
        };
        BlueprintDiff: {
            from_version: number;
            to_version: number;
            inputs_changed: string[];
            problems_changed: {
                [key: string]: {
                    from?: string | null;
                    to?: string | null;
                };
            };
            persona_changed: boolean;
            changes: {
                path?: string;
                from?: unknown;
                to?: unknown;
            }[];
            truncated: boolean;
        };
        AnswerKeyList: {
            keys: {
                key_id?: string;
                round_type?: string;
                slug?: string;
                content_hash?: string | null;
                key_version?: string;
                key?: {
                    [key: string]: unknown;
                };
                created_at?: string;
            }[];
        };
        BlueprintBenchCandidate: {
            /** Format: uuid */
            id: string;
            name: string;
            email: string | null;
        };
        BlueprintBenchRequest: {
            /** Format: uuid */
            candidateId: string;
            /** Format: uuid */
            jobDescriptionId?: string | null;
            /** Format: uuid */
            loopId?: string | null;
            nodeId?: string | null;
            roundType?: components["schemas"]["RoundType"];
            options?: {
                bypassBlueprintCache?: boolean;
                bypassAnswerKeyCache?: boolean;
                ignoreExclusions?: boolean;
            };
        };
        CompanyResearchState: {
            lastRunId: string | null;
            /** Format: date-time */
            lastResearchedAt: string | null;
            /** @description The company's item status in its latest run (ResearchItemStatus). */
            lastStatus: string | null;
            latestDraftId: string | null;
            /** @description pending_review | approved | rejected | superseded */
            latestDraftStatus: string | null;
            /** @description How many tracked research fields the latest draft fills; below total means partial research. */
            latestDraftCoverage?: components["schemas"]["DraftCoverageSummary"] | null;
        };
        JobDescriptionSummary: {
            /** Format: uuid */
            id: string;
            practiceTemplate: boolean;
            company: string;
            companyName: string;
            role: string;
            level: components["schemas"]["NullableEngineeringLevel"];
            legacyLevel?: string | null;
            title: string;
            specialization: string | null;
            techStack: string[];
            yoeMin: number | null;
            yoeMax: number | null;
            ctcMinLpa: number | null;
            ctcMaxLpa: number | null;
            dataConfidence: string | null;
            /** @enum {string} */
            dataAvailability: "rich" | "available" | "limited" | "none";
        };
        /**
         * @description none = index only; generated = non-DSA content stored (no executable checks exist for these rounds); verified = DSA content built on a validated source's examples; failed = the last attempt did not pass its checks, so no content is stored. Content is never stored in any other state.
         * @enum {string}
         */
        QuestionContentStatus: "none" | "generated" | "verified" | "failed";
        QuestionRubricItem: {
            criterion: string;
            weight: number;
            strong: string;
            weak: string;
        };
        QuestionExample: {
            /** @description Named arguments for the reference solution's entry point. */
            args: {
                [key: string]: unknown;
            };
            /** @description The value the entry point returns for those arguments. */
            expected: unknown;
            explanation: string;
        };
        QuestionJudgeTest: {
            args: {
                [key: string]: unknown;
            };
            expected: unknown;
        };
        DsaContent: {
            statement: string;
            input_format: string;
            output_format: string;
            constraints: string[];
            examples: components["schemas"]["QuestionExample"][];
            judge_tests?: components["schemas"]["QuestionJudgeTest"][];
            /** @description Escalating */
            hints: string[];
            follow_ups: string[];
            approaches?: {
                name: string;
                idea: string;
                time_complexity: string;
                space_complexity: string;
            }[];
            /** @description Null for source-grounded problems; answers are built at round-preparation time and cached. */
            reference_solution?: {
                /** @enum {string} */
                language: "python";
                entry_point: string;
                code: string;
            } | null;
            answer_order_irrelevant?: boolean;
            edge_cases?: string[];
            common_mistakes?: string[];
            rubric?: components["schemas"]["QuestionRubricItem"][];
            patterns?: string[];
            what_it_tests: string;
            estimated_minutes: number;
        };
        SystemDesignContent: {
            prompt: string;
            clarifying_questions: string[];
            functional_requirements: string[];
            non_functional_requirements: string[];
            scale_assumptions: string[];
            expected_design: {
                components: {
                    name: string;
                    purpose: string;
                }[];
                data_model: string;
                api_sketch?: string[];
                data_flow: string;
            };
            deep_dives: string[];
            trade_offs: {
                decision: string;
                options: string[];
                recommendation: string;
            }[];
            follow_ups: string[];
            rubric: components["schemas"]["QuestionRubricItem"][];
            red_flags?: string[];
            strong_answer_summary: string;
            what_it_tests: string;
            estimated_minutes: number;
        };
        LldContent: {
            prompt: string;
            requirements: string[];
            entities: string[];
            expected_design: {
                classes: {
                    name: string;
                    responsibilities: string;
                    key_methods?: string[];
                }[];
                relationships?: string[];
                patterns?: string[];
            };
            sample_api?: string[];
            /** @enum {string} */
            evaluation_mode: "discussion" | "working-code";
            follow_ups: string[];
            rubric: components["schemas"]["QuestionRubricItem"][];
            red_flags?: string[];
            strong_answer_summary: string;
            what_it_tests: string;
            estimated_minutes: number;
        };
        BehaviouralContent: {
            question: string;
            competency: string;
            what_it_tests: string;
            star_guide: {
                situation: string;
                task: string;
                action: string;
                result: string;
            };
            strong_answer_summary: string;
            weak_answer_summary: string;
            follow_up_probes: string[];
            red_flags?: string[];
            principle?: string | null;
            /** @description Hiring-manager rounds only. */
            deep_dive_guidance?: string | null;
            estimated_minutes: number;
        };
        /** @description One problem-bank entry. The index fields come from the datasets and research briefs; `content` is our own text, generated from the index facts. */
        QuestionRecord: {
            slug: string;
            /** @enum {string} */
            round_type: "dsa" | "online-assessment" | "system-design" | "lld" | "behavioural" | "hiring-manager";
            title: string;
            /** @description Provenance only; empty for problems named in our research briefs. */
            url: string;
            sources: string[];
            /** @enum {string|null} */
            difficulty: "easy" | "medium" | "hard" | null;
            topic_tags: string[];
            company_tags: string[];
            /** @description Per company tag: reported by a dataset or brief, or inferred by the model. */
            company_evidence?: {
                [key: string]: "reported" | "inferred";
            };
            level_tags: components["schemas"]["EngineeringLevel"][];
            /** @enum {string} */
            enrichment_status: "raw" | "enriched" | "enrich_failed";
            content_status: components["schemas"]["QuestionContentStatus"];
            content_version?: string | null;
            content_generated_at?: string | null;
            content_model?: string | null;
            content_error?: string | null;
            /** @description Present with includeContent=true. Shape depends on round_type. */
            content?: components["schemas"]["DsaContent"] | components["schemas"]["SystemDesignContent"] | components["schemas"]["LldContent"] | components["schemas"]["BehaviouralContent"];
            acceptance_rate?: number | null;
            frequency_score?: number | null;
            is_premium?: boolean | null;
            category?: string | null;
            estimated_duration_mins?: number | null;
        };
        QuestionBankPage: {
            questions: components["schemas"]["QuestionRecord"][];
            /** @description Total matching */
            count: number;
            returned?: number;
        };
        QuestionBankStats: {
            /** @description round_type -> content_status -> count */
            rounds: {
                [key: string]: {
                    [key: string]: number;
                };
            };
            total: number;
        };
        QuestionGenerateResponse: {
            run_id: string;
            status: string;
            already_running: boolean;
        };
        /**
         * @description JD level vs the user's level. stretch = 2+ above (score capped), below = 2+ below, unknown = either level unset.
         * @enum {string}
         */
        JdFitLevelGap: "none" | "stretch" | "below" | "unknown";
        JdFitResult: {
            /** Format: uuid */
            jdId: string;
            /** @description Null when the JD has nothing to match against. */
            score: number | null;
            levelGap: components["schemas"]["JdFitLevelGap"];
            /** @description The stretch-role cap when levelGap is stretch. */
            cap: number | null;
            /** @description Multiplier applied for a role below the user's level (0.85 one level below, 0.7 two or more); null otherwise. */
            levelFactor: number | null;
        };
        JdFitList: {
            configVersion: string;
            userLevel: components["schemas"]["NullableEngineeringLevel"];
            results: components["schemas"]["JdFitResult"][];
        };
        JdFitEvidence: {
            /** @enum {string} */
            source: "resume" | "github" | "leetcode" | "codeforces" | "tuf";
            /** @description The project, role, repo or platform topic that matched. */
            item: string;
            /** @description The word, entry or count that matched. */
            matched: string;
            /** @description What it matched in the JD: a skill, domain, role, topic or experience range. */
            tag: string;
        };
        JdFitPart: {
            /** @enum {string} */
            key: "skills" | "domain" | "role" | "experience" | "round_topics";
            /** @description Configured weight; dropped parts are left out and the rest rescale. */
            weight: number;
            value: number;
            /**
             * @description missing = the user has no source for it (counts 0); dropped = the JD has nothing to match against.
             * @enum {string}
             */
            status: "scored" | "missing" | "dropped";
            evidence: components["schemas"]["JdFitEvidence"][];
            /** @description What the JD asks for that the profile doesn't show. */
            uncovered: string[];
            /** @description Set when missing. */
            hint: string | null;
            /** @description Set when dropped. */
            reason: string | null;
        };
        JdFitBreakdown: {
            /** Format: uuid */
            jdId: string;
            score: number | null;
            levelGap: components["schemas"]["JdFitLevelGap"];
            /** @description The stretch-role cap when levelGap is stretch. */
            cap: number | null;
            /** @description Multiplier applied for a role below the user's level (0.85 one level below, 0.7 two or more); null otherwise. */
            levelFactor: number | null;
            userLevel: components["schemas"]["NullableEngineeringLevel"];
            jdLevel: components["schemas"]["NullableEngineeringLevel"];
            configVersion: string;
            parts: components["schemas"]["JdFitPart"][];
        };
        JobDescriptionDetail: {
            /** Format: uuid */
            id: string;
            /** @description Simulated practice template */
            practiceTemplate: boolean;
            company: string;
            companyName: string;
            role: string;
            level: components["schemas"]["NullableEngineeringLevel"];
            legacyLevel?: string | null;
            title: string;
            specialization: string | null;
            description: string | null;
            techStack: string[];
            sourceUrl: string | null;
            yoeMin: number | null;
            yoeMax: number | null;
            ctcMinLpa: number | null;
            ctcMaxLpa: number | null;
            dataConfidence: string | null;
            /** @enum {string} */
            dataAvailability: "rich" | "available" | "limited" | "none";
            sources: string[];
            companyOverview?: components["schemas"]["EnrichmentCompany"];
            /** @description Candidate-safe process. Verified manual rounds retain their explicit array order and source evidence. */
            interviewProcess: ({
                rounds?: ({
                    /** Format: uuid */
                    id?: string;
                    name?: string;
                    round_number?: number;
                    type?: string;
                    duration_minutes?: number;
                    difficulty?: string;
                    topics?: string[];
                    problems?: string[];
                    format?: string;
                    source_urls?: string[];
                } & {
                    [key: string]: unknown;
                })[];
            } & {
                [key: string]: unknown;
            }) | null;
        };
        EnrichmentCompany: {
            overview: string;
            culture: string;
            benefits: string;
            sourceUrls: string[];
            verified: boolean;
        };
        EnrichmentRound: {
            /** Format: uuid */
            id: string;
            name: string;
            /** @enum {string} */
            type: "dsa" | "system-design" | "lld" | "behavioural" | "hiring-manager";
            durationMinutes: number;
            /** @enum {string} */
            difficulty: "easy" | "medium" | "hard";
            topics: string[];
            questions: string[];
            guidance: string;
            sourceUrls: string[];
            verified: boolean;
        };
        EnrichmentRole: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            jdId?: string | null;
            title: string;
            role: string;
            /** @description Null on reads for unknown historic labels only; saves and publication require a canonical selected level. */
            level: components["schemas"]["NullableEngineeringLevel"];
            legacyLevel?: string | null;
            specialization: string | null;
            description: string;
            techStack: string[];
            yoeMin: number | null;
            yoeMax: number | null;
            ctcMinLpa: number | null;
            ctcMaxLpa: number | null;
            sourceUrls: string[];
            verified: boolean;
            /** @description Array order defines the connected linear interview sequence. Publication requires at least one verified round. */
            rounds: components["schemas"]["EnrichmentRound"][];
        };
        EnrichmentDocument: {
            company: components["schemas"]["EnrichmentCompany"];
            roles: components["schemas"]["EnrichmentRole"][];
        };
        EnrichmentPrefillRequest: {
            revision: number;
        };
        EnrichmentWriteRequest: {
            revision: number;
            document: components["schemas"]["EnrichmentDocument"];
        };
        EnrichmentResponse: {
            revision: number;
            publishedRevision: number | null;
            /** Format: date-time */
            publishedAt: string | null;
            /** Format: uuid */
            verifiedBy: string | null;
            document: components["schemas"]["EnrichmentDocument"];
        };
        AdminCompany: {
            /** Format: uuid */
            id: string;
            name: string;
            slug: string;
            website: string | null;
            aliases: string[];
            /** @enum {string} */
            status: "active" | "archived";
            /** @enum {string} */
            origin: "seed" | "admin";
            tier: number | null;
            publishedVersion: number | null;
            /** Format: date-time */
            publishedAt: string | null;
            /** Format: date-time */
            createdAt: string;
            research: components["schemas"]["CompanyResearchState"] | null;
        };
        DraftField: {
            /** @description Arbitrary JSON: a string, number, boolean, object, array or null (unavailable). Includes structured JD/interview-process objects and arrays of attributed review quotes. */
            value: unknown;
            /** @enum {string} */
            confidence: "high" | "medium" | "low";
            /** @description evidence | derived | inferred_from_similar | template | admin_override | unavailable */
            provenance: string;
            source_urls: string[];
            note: string | null;
            /** @description Values other sources reported, highest-weighted first. Empty when the sources agree; never silently dropped. */
            alternatives?: components["schemas"]["DraftAlternative"][];
            /** @description Date (YYYY-MM-DD) of the newest supporting source, when known. */
            as_of?: string | null;
        };
        DraftAlternative: {
            /** @description Arbitrary JSON, same shape as the field's value. */
            value: unknown;
            source_urls: string[];
            as_of: string | null;
        };
        /** @description Evidence the pipeline could not confirm (its geography or role is not established by the page). Shown to reviewers only; never published. */
        UnverifiedClaim: {
            field: string;
            value: unknown;
            quote: string;
            url: string;
            source_name?: string | null;
            date?: string | null;
            /** @description 1 official · 2 established secondary · 3 community */
            tier?: number | null;
            /** @enum {string} */
            reason: "geo_unconfirmed" | "role_not_in_context" | "role_mismatch";
            role_title?: string | null;
        };
        DraftCoverageSummary: {
            filled: number;
            total: number;
        };
        DraftCoverage: components["schemas"]["DraftCoverageSummary"] & {
            /** @description Tracked paths still unavailable, e.g. roles[<role_key>].jd. Reported pay (ctc_observations) and supported total CTC (ctc_min_lpa) are separate slots; reported pay alone does not fill total-CTC coverage. */
            missing: string[];
        };
        DraftChange: {
            path: string;
            /** @enum {string} */
            change: "added" | "removed" | "changed";
            before: unknown;
            after: unknown;
        };
        DraftConflict: {
            /** @description not_a_company | possible_duplicate */
            type: string;
            message: string;
        } & {
            [key: string]: unknown;
        };
        /** @description Optional company profile facts. Each field's value may be null when unavailable. */
        DraftProfile: {
            sector?: components["schemas"]["DraftField"];
            business_model?: components["schemas"]["DraftField"];
            hq?: components["schemas"]["DraftField"];
            headcount_band?: components["schemas"]["DraftField"];
            revenue_band?: components["schemas"]["DraftField"];
            funding_stage?: components["schemas"]["DraftField"];
            funding_round?: components["schemas"]["DraftField"];
            unverified?: components["schemas"]["UnverifiedClaim"][];
        };
        /** @description Optional work-life-balance and review facts. Rating values are numbers from 0 to 5; counts are nonnegative integers. review_quotes.value is an array of at most five {text, sourceUrl, sourceName, date} objects, with text up to 300 characters and absolute http(s) source URLs without credentials. */
        DraftCompensation: {
            wlb_rating?: components["schemas"]["DraftField"];
            wlb_review_count?: components["schemas"]["DraftField"];
            review_summary?: components["schemas"]["DraftField"];
            review_quotes?: components["schemas"]["DraftField"];
            unverified?: components["schemas"]["UnverifiedClaim"][];
        };
        /** @description Research-only role facts retained in the approved snapshot; not yet published to booking JDs or interview briefs. */
        DraftRole: {
            role_key: string;
            title: components["schemas"]["DraftField"];
            /** @description Unavailable when the sources do not support a level; unknown levels remain unknown. */
            level: components["schemas"]["DraftField"];
            specialization: components["schemas"]["DraftField"];
            yoe_min: components["schemas"]["DraftField"];
            /** @description Unavailable when no upper experience bound is supported; never capped by an invented maximum. */
            yoe_max: components["schemas"]["DraftField"];
            /** @description Derived median lower bound using only observations explicitly labelled total_ctc, after outlier removal. Unspecified LPA pay is excluded. INR annual LPA. */
            ctc_min_lpa: components["schemas"]["DraftField"];
            /** @description Derived median of reported upper bounds from total_ctc observations only. Open-ended observations do not support this field; unavailable if no upper bound is reported. INR annual LPA. */
            ctc_max_lpa: components["schemas"]["DraftField"];
            /** @description Distinct source URLs contributing explicit total_ctc observations to the derived range after outlier removal; excludes unspecified pay. Zero when no supported range can be derived. */
            ctc_source_count: number;
            jd: components["schemas"]["DraftField"];
            /** @description Official (company-published) process passages only. */
            interview_process: components["schemas"]["DraftField"];
            /** @description full_time | intern | contract */
            employment_type?: components["schemas"]["DraftField"];
            /** @description Job codes from official posting URLs and role titles. */
            job_ids?: components["schemas"]["DraftField"];
            required_skills?: components["schemas"]["DraftField"];
            preferred_skills?: components["schemas"]["DraftField"];
            tech_stack?: components["schemas"]["DraftField"];
            /** @description Indian cities, normalized names. */
            locations?: components["schemas"]["DraftField"];
            /** @description Source-reported pay, including observations excluded from the derived total-CTC range. Array of {min_lpa, max_lpa, basis: total_ctc | lpa_unspecified, source_url, source_name, tier, date}. lpa_unspecified means the source reports annual INR LPA but does not establish total CTC; do not label it verified CTC. A null max_lpa is open-ended, not a capped range. */
            ctc_observations?: components["schemas"]["DraftField"];
            /** @description Array of {text, evidence_type: candidate_report | secondhand, source_url, source_name, date}; not official policy. */
            reported_interview_process?: components["schemas"]["DraftField"];
            unverified?: components["schemas"]["UnverifiedClaim"][];
        };
        CompanyDraft: {
            draft_id: string;
            company_id: string;
            version: number;
            run_id: string;
            /** @enum {string} */
            status: "pending_review" | "approved" | "rejected" | "superseded";
            /** Format: date-time */
            created_at: string;
            /** Format: date-time */
            decided_at?: string | null;
            decided_by?: string | null;
            decision_note?: string | null;
            /** @description Research limitations such as roles omitted by the run cap. */
            notes?: string[];
            snapshot: {
                identity: {
                    name: components["schemas"]["DraftField"];
                    website: components["schemas"]["DraftField"];
                    aliases: components["schemas"]["DraftField"];
                };
                profile?: components["schemas"]["DraftProfile"];
                compensation?: components["schemas"]["DraftCompensation"];
                roles?: components["schemas"]["DraftRole"][];
            };
            conflicts: components["schemas"]["DraftConflict"][];
            /** @description Changes against the last approved draft. */
            diff: components["schemas"]["DraftChange"][];
            coverage?: components["schemas"]["DraftCoverage"];
        };
        CompanyDraftResponse: {
            company: components["schemas"]["AdminCompany"];
            draft: components["schemas"]["CompanyDraft"];
        };
        DraftDecisionRequest: {
            note?: string;
        };
        AdminCompanyList: {
            companies: components["schemas"]["AdminCompany"][];
            /** @description false when the AI service could not be reached (research is null on every row). */
            researchAvailable: boolean;
        };
        CreateCompanyRequest: {
            name: string;
            /** @description http(s) URL; a bare domain gets https://. */
            website?: string | null;
            aliases?: string[];
        };
        UpdateCompanyRequest: {
            name?: string;
            website?: string | null;
            aliases?: string[];
            /** @enum {string} */
            status?: "active" | "archived";
        };
        SeedResult: {
            companies: number;
            inserted: number;
            backfilled: number;
            total: number;
        };
        ResearchTarget: {
            /** Format: uuid */
            id: string;
            name: string;
            slug: string;
            website: string | null;
            aliases: string[];
        };
        /** @enum {string} */
        ResearchMode: "live" | "record" | "replay";
        /** @enum {string} */
        ResearchLevel: "trace" | "debug" | "info" | "warn" | "error";
        /** @enum {string} */
        ResearchRunStatus: "queued" | "running" | "pausing" | "paused" | "stopping" | "stopped" | "completed" | "failed";
        /** @enum {string} */
        ResearchItemStatus: "queued" | "running" | "paused" | "done" | "failed" | "skipped" | "cancelled";
        ResearchRunCounters: {
            total: number;
            queued: number;
            running: number;
            paused: number;
            done: number;
            failed: number;
            skipped: number;
            cancelled: number;
        };
        ResearchBudget: {
            exa_used: number;
            exa_cap: number;
            llm_used: number;
            llm_cap: number;
            tokens_in: number;
            tokens_out: number;
        };
        ResearchRun: {
            run_id: string;
            /** @enum {string} */
            trigger: "admin" | "cron" | "cli";
            mode: components["schemas"]["ResearchMode"];
            /** @enum {string} */
            scope: "all" | "selected";
            company_ids: string[];
            status: components["schemas"]["ResearchRunStatus"];
            /** @enum {string} */
            control: "none" | "pause" | "stop";
            /** @description admin | budget_exhausted */
            pause_reason: string | null;
            requested_by?: string | null;
            counters: components["schemas"]["ResearchRunCounters"];
            budget: components["schemas"]["ResearchBudget"];
            last_seq: number;
            /** Format: date-time */
            created_at: string;
            /** Format: date-time */
            started_at: string | null;
            /** Format: date-time */
            finished_at: string | null;
            error: string | null;
            pipeline_version?: string;
        };
        ResearchRunList: {
            runs: components["schemas"]["ResearchRun"][];
        };
        ResearchError: {
            type: string;
            message: string;
            traceback?: string;
            /** @description Innermost pipeline frame, e.g. app/research/nodes/resolve.py:resolve. */
            code_ref?: string | null;
        };
        ResearchNodeProgress: {
            /** @enum {string} */
            status?: "running" | "ok" | "error";
            /** Format: date-time */
            started_at?: string;
            /** Format: date-time */
            finished_at?: string;
            exa_calls?: number;
            llm_calls?: number;
            error?: string;
        };
        ResearchItem: {
            run_id: string;
            company_id: string;
            company_name: string;
            company_slug: string;
            position: number;
            status: components["schemas"]["ResearchItemStatus"];
            attempts: number;
            current_node: string | null;
            last_node: string | null;
            nodes: {
                [key: string]: components["schemas"]["ResearchNodeProgress"];
            };
            draft_id: string | null;
            error: components["schemas"]["ResearchError"] | null;
            /** Format: date-time */
            started_at?: string | null;
            /** Format: date-time */
            finished_at?: string | null;
        };
        ResearchRunDetail: {
            run: components["schemas"]["ResearchRun"];
            items: components["schemas"]["ResearchItem"][];
        };
        StartResearchRunRequest: {
            /**
             * @description all = every company not researched in RESEARCH_STALE_AFTER_DAYS.
             * @default all
             * @enum {string}
             */
            scope: "all" | "selected";
            companyIds?: string[];
            mode?: components["schemas"]["ResearchMode"];
        };
        ResearchBudgetUpdate: {
            exaCap?: number;
            llmCap?: number;
        };
        ResearchEvent: {
            run_id: string;
            seq: number;
            /** Format: date-time */
            ts: string;
            level: components["schemas"]["ResearchLevel"];
            level_rank: number;
            /** @description run.* | item.* | span.start | span.end | log | cache.hit | conflict.detected | budget.* | draft.created | control.* */
            type: string;
            message: string;
            span_id: string | null;
            company_id: string | null;
            node: string | null;
            /** @description Structured detail (any JSON). */
            data?: unknown;
            /** @description Payload id when data exceeded 32 KB. */
            data_ref?: string | null;
        };
        ResearchEventPage: {
            events: components["schemas"]["ResearchEvent"][];
            last_seq: number;
        };
        ResearchSpan: {
            span_id: string;
            parent_id: string | null;
            run_id: string;
            company_id: string | null;
            node: string | null;
            /** @enum {string} */
            kind: "run" | "company" | "node" | "exa" | "llm" | "cache" | "merge" | "normalize" | "db";
            name: string;
            /** @enum {string} */
            status: "running" | "ok" | "error" | "cancelled";
            /** Format: date-time */
            started_at: string;
            /** Format: date-time */
            ended_at: string | null;
            duration_ms: number | null;
            attrs: {
                [key: string]: unknown;
            };
            input_ref?: string | null;
            output_ref?: string | null;
            error: components["schemas"]["ResearchError"] | null;
        };
        ResearchSpanList: {
            spans: components["schemas"]["ResearchSpan"][];
        };
        ResearchSpanDetail: components["schemas"]["ResearchSpan"] & {
            /** @description Full input (any JSON). */
            input?: unknown;
            /** @description Full output (any JSON). */
            output?: unknown;
        };
        ResearchSpanDetailResponse: {
            span: components["schemas"]["ResearchSpanDetail"];
            logs: components["schemas"]["ResearchEvent"][];
        };
    };
    responses: {
        /** @description `invalid_request` — the body failed validation; `message` is human-readable. */
        InvalidRequest: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                /** @example {
                 *       "code": "invalid_request",
                 *       "message": "Password must be at least 8 characters."
                 *     } */
                "application/json": components["schemas"]["ApiError"];
            };
        };
        /** @description `invalid_token` — the link's token is unknown, expired or already used (ask for a new link). `invalid_request` — the body failed validation.
         *      */
        InvalidTokenOrRequest: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["ApiError"];
            };
        };
        /** @description `rate_limited` — too many attempts; retry after `Retry-After` seconds. */
        RateLimited: {
            headers: {
                /** @description Seconds until the limit resets. */
                "Retry-After"?: number;
                [name: string]: unknown;
            };
            content: {
                /** @example {
                 *       "code": "rate_limited",
                 *       "message": "Too many attempts. Please wait a few minutes and try again."
                 *     } */
                "application/json": components["schemas"]["ApiError"];
            };
        };
        /** @description Malformed request. */
        BadRequest: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["ApiError"];
            };
        };
        /** @description Missing or invalid credentials. */
        Unauthorized: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["ApiError"];
            };
        };
        /** @description Resource not found (or not owned by the caller). */
        NotFound: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["ApiError"];
            };
        };
    };
    parameters: {
        SessionId: string;
        ResearchRunId: string;
    };
    requestBodies: never;
    headers: {
        /** @description `refresh_token=<opaque>; Path=/api/v1/auth; HttpOnly; SameSite=<Lax|Strict|None>` (+ `Secure` in production). Never readable by JavaScript.
         *      */
        RefreshTokenCookie: string;
    };
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    getLinkedInImportStatus: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Imported snapshot or disconnected status; not live sync or verified employment. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LinkedInImportStatus"];
                };
            };
            401: components["responses"]["Unauthorized"];
        };
    };
    disconnectLinkedInImport: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Source and drafts removed. */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            401: components["responses"]["Unauthorized"];
            /** @description Another import action is in progress. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    getAdminValidationControls: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Current validation controls and audit metadata. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ValidationControlsResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            /** @description Admin role required. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    patchAdminValidationControls: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    linkedinImportEnabled?: boolean;
                    requireSectionReview?: boolean;
                };
            };
        };
        responses: {
            /** @description Persisted controls. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ValidationControlsResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            /** @description Admin role required. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description JSON is required. */
            415: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    inspectLiveProfileCalculation: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** Format: uuid */
                    userId: string;
                    /** @description Re-send every resume item to the LLM even when unchanged. */
                    forceReassess?: boolean;
                };
            };
        };
        responses: {
            /** @description NDJSON stream of trace events; a stage failure arrives as an `error` event, not an HTTP error. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/x-ndjson": components["schemas"]["ProfileLiveTraceEvent"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            /** @description Admin role required. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description User not found. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    importLinkedInPdf: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "multipart/form-data": {
                    /**
                     * Format: binary
                     * @description The PDF from LinkedIn's Save to PDF (up to 5 MB).
                     */
                    file: string;
                    /** @enum {string} */
                    consent: "true";
                };
            };
        };
        responses: {
            /** @description Private derived draft; review and confirm available sections. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LinkedInImportDraft"];
                };
            };
            /** @description File missing (linkedin_pdf_missing), consent absent (linkedin_consent_required) or malformed multipart (linkedin_import_invalid). */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            401: components["responses"]["Unauthorized"];
            /** @description User not found. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description The import was cancelled by disconnecting LinkedIn */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description The PDF is larger than 5 MB (linkedin_pdf_too_large). */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Not multipart/form-data */
            415: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Not LinkedIn's Save to PDF file (linkedin_pdf_unrecognized), no readable text (linkedin_pdf_unreadable) or no evidenced career claims (linkedin_pdf_no_claims). */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Owner already has three unexpired drafts. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description LinkedIn import disabled (linkedin_import_disabled), extractor unavailable (linkedin_extractor_unavailable) or storage unavailable. */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    confirmLinkedInProfileSections: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    sections: components["schemas"]["LinkedInSectionKey"][];
                    /** @default false */
                    mergeProfile?: boolean;
                };
            };
        };
        responses: {
            /** @description Confirmed source receipt and optional merged profile. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LinkedInImportConfirmation"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            /** @description Draft does not exist or belongs to another owner. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Profile changed */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Draft expired. Retrieve a new preview. */
            410: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Only JSON confirmation is supported. */
            415: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Storage could not save the confirmation. */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    getCandidateProfile: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Saved candidate profile. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CandidateProfileResponse"];
                };
            };
            /** @description No saved profile yet. */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            401: components["responses"]["Unauthorized"];
        };
    };
    saveCandidateProfile: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CandidateProfileRequest"];
            };
        };
        responses: {
            /** @description Saved profile; current level is separate from target JD level. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CandidateProfileResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
        };
    };
    getProfileScore: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Current assessment, history and private scoring settings. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProfileScoreResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            404: components["responses"]["NotFound"];
        };
    };
    recalculateProfileScore: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": Record<string, never>;
            };
        };
        responses: {
            /** @description Refreshed assessment. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProfileScoreResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
        };
    };
    assessProfileItems: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": Record<string, never>;
            };
        };
        responses: {
            /** @description Refresh counts. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        assessed: number;
                        reused: number;
                        skipped: number;
                        failed: number;
                        budgetExhausted: boolean;
                    };
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            /** @description Too many refreshes; retry later. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Semantic assessment is not enabled (v5 policy and AI service required). */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    listPlatformConnections: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Supported platforms and current connections. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        supported: components["schemas"]["CodingPlatform"][];
                        connections: components["schemas"]["PlatformConnection"][];
                    };
                };
            };
            401: components["responses"]["Unauthorized"];
        };
    };
    connectPlatform: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                platform: components["schemas"]["CodingPlatform"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    handle: string;
                };
            };
        };
        responses: {
            /** @description Connection accepted; collection runs in the background. */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PlatformConnection"];
                };
            };
            /** @description platform_handle_invalid or platform_bad_request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            401: components["responses"]["Unauthorized"];
            /** @description platform_user_not_found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description platform_unreachable */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    disconnectPlatform: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                platform: components["schemas"]["CodingPlatform"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Disconnected. */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description platform_bad_request (unknown platform) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            401: components["responses"]["Unauthorized"];
        };
    };
    updateProfileScoringSettings: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    declaredLevel?: components["schemas"]["NullableEngineeringLevel"];
                    leaderboardOptIn?: boolean;
                };
            };
        };
        responses: {
            /** @description Updated settings and assessment. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProfileScoreResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
        };
    };
    getProfileLeaderboard: {
        parameters: {
            query?: {
                level?: "intern" | "fresher" | "sde1" | "sde2" | "sde3" | "staff" | "principal" | "distinguished";
                limit?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Eligible same-level cohort, possibly empty. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProfileLeaderboardResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
        };
    };
    listQuestionBank: {
        parameters: {
            query?: {
                roundType?: "dsa" | "online-assessment" | "system-design" | "lld" | "behavioural" | "hiring-manager";
                company?: string;
                difficulty?: "easy" | "medium" | "hard";
                contentStatus?: components["schemas"]["QuestionContentStatus"];
                /** @description Case-insensitive substring of a topic tag. */
                topic?: string;
                includeContent?: boolean;
                limit?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Matching problems. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["QuestionBankPage"];
                };
            };
        };
    };
    getQuestionBankStats: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Counts. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["QuestionBankStats"];
                };
            };
        };
    };
    generateQuestionContent: {
        parameters: {
            query?: {
                roundType?: string;
                /** @description Generate at most this many records (runs are resumable). */
                limit?: number;
                /** @description Regenerate records whose content is current. */
                force?: boolean;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Run accepted (or the run already in progress). */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["QuestionGenerateResponse"];
                };
            };
        };
    };
    getProfileScoringDiagnostics: {
        parameters: {
            query?: {
                userId?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Bounded checks and the current methodology. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProfileDiagnosticsResponse"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            /** @description ADMIN role required. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            404: components["responses"]["NotFound"];
        };
    };
    register: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RegisterRequest"];
            };
        };
        responses: {
            /** @description Account created and signed in. */
            201: {
                headers: {
                    "Set-Cookie": components["headers"]["RefreshTokenCookie"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TokenResponse"];
                };
            };
            400: components["responses"]["InvalidRequest"];
            /** @description The email is already registered. `email_taken` — an email/password account exists (log in instead). `use_google` — the email belongs to a Google account ("This email signs in with Google. Continue with Google instead.").
             *      */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            429: components["responses"]["RateLimited"];
        };
    };
    login: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["LoginRequest"];
            };
        };
        responses: {
            /** @description Signed in. */
            200: {
                headers: {
                    "Set-Cookie": components["headers"]["RefreshTokenCookie"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TokenResponse"];
                };
            };
            400: components["responses"]["InvalidRequest"];
            /** @description `invalid_credentials` — Incorrect email or password. */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    /** @example {
                     *       "code": "invalid_credentials",
                     *       "message": "Incorrect email or password."
                     *     } */
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            429: components["responses"]["RateLimited"];
        };
    };
    verifyEmail: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["VerifyEmailRequest"];
            };
        };
        responses: {
            /** @description Email verified. */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            400: components["responses"]["InvalidTokenOrRequest"];
        };
    };
    resendVerification: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Link sent (or nothing to do). */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            401: components["responses"]["Unauthorized"];
            429: components["responses"]["RateLimited"];
        };
    };
    forgotPassword: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ForgotPasswordRequest"];
            };
        };
        responses: {
            /** @description Accepted. */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            400: components["responses"]["InvalidRequest"];
            429: components["responses"]["RateLimited"];
        };
    };
    resetPassword: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ResetPasswordRequest"];
            };
        };
        responses: {
            /** @description Password changed. */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            400: components["responses"]["InvalidTokenOrRequest"];
        };
    };
    refreshSession: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description New access token; the rotated refresh cookie is set. */
            200: {
                headers: {
                    "Set-Cookie": components["headers"]["RefreshTokenCookie"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TokenResponse"];
                };
            };
            /** @description No session (the request carried no refresh cookie); empty body. The visitor is signed out. */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description No valid refresh token (empty body; the cookie is cleared). */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    logout: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Signed out. */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    getCurrentUser: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The current user. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CurrentUser"];
                };
            };
            401: components["responses"]["Unauthorized"];
            /** @description The token's user no longer exists (empty body). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    deleteAccount: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["DeleteAccountRequest"];
            };
        };
        responses: {
            /** @description Deleted; the refresh cookie is cleared. */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description `invalid_request`, `confirmation_mismatch`. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            401: components["responses"]["Unauthorized"];
            /** @description `interview_in_progress`. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description `deletion_unavailable`. */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    updateCurrentUser: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateUserRequest"];
            };
        };
        responses: {
            /** @description The updated user. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CurrentUser"];
                };
            };
            /** @description `invalid_name`. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            401: components["responses"]["Unauthorized"];
        };
    };
    revokeAllSessions: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Revoked; the refresh cookie is cleared. */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            401: components["responses"]["Unauthorized"];
        };
    };
    exportAccount: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The export (`Content-Disposition: attachment`). */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AccountExport"];
                };
            };
            401: components["responses"]["Unauthorized"];
        };
    };
    getPreferences: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The preferences. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Preferences"];
                };
            };
            401: components["responses"]["Unauthorized"];
        };
    };
    updatePreferences: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PreferencesPatch"];
            };
        };
        responses: {
            /** @description The full preferences after the change. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Preferences"];
                };
            };
            /** @description `invalid_preferences`. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            401: components["responses"]["Unauthorized"];
        };
    };
    listMyInterviewSessions: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The candidate's sessions. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InterviewSessionListResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
        };
    };
    createInterviewSession: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateInterviewSessionRequest"];
            };
        };
        responses: {
            /** @description The created session. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InterviewSession"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            /** @description `interview_access_required` — the account has the USER role and cannot run interviews. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    getInterviewSession: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                sessionId: components["parameters"]["SessionId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The session. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InterviewSession"];
                };
            };
            401: components["responses"]["Unauthorized"];
            404: components["responses"]["NotFound"];
        };
    };
    getRoundReport: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                sessionId: components["parameters"]["SessionId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The report, or just its status. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RoundReport"];
                };
            };
            401: components["responses"]["Unauthorized"];
            404: components["responses"]["NotFound"];
        };
    };
    disputeRoundReport: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                sessionId: components["parameters"]["SessionId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateReportDisputeRequest"];
            };
        };
        responses: {
            /** @description The re-check started; poll the report. */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ReportDisputeStarted"];
                };
            };
            /** @description `invalid_dispute` */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            401: components["responses"]["Unauthorized"];
            404: components["responses"]["NotFound"];
            /** @description `report_not_ready`, `dispute_window_closed`, `dispute_exists` or `dispute_limit` */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    retryInterviewSessionPrep: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                sessionId: components["parameters"]["SessionId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Retry accepted; the session is PREP_QUEUED. */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InterviewSession"];
                };
            };
            401: components["responses"]["Unauthorized"];
            /** @description `interview_access_required` — the account has the USER role and cannot run interviews. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            404: components["responses"]["NotFound"];
            /** @description `prep_not_failed`: the session is not in PREP_FAILED. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description `prep_retry_limited`: too many retries this hour; the message says when to try again. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    getLiveInterviewSession: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                sessionId: components["parameters"]["SessionId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The live session state. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GoLiveResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            404: components["responses"]["NotFound"];
        };
    };
    goLiveInterviewSession: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                sessionId: components["parameters"]["SessionId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The live session state, with a LiveKit join token. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GoLiveResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            /** @description `interview_access_required` — the account has the USER role and cannot run interviews. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            404: components["responses"]["NotFound"];
            /** @description `live_unavailable` or `session_not_ready`. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    listJobDescriptions: {
        parameters: {
            query?: {
                company?: string;
                level?: string;
                specialization?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Published roles. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["JobDescriptionSummary"][];
                };
            };
        };
    };
    getJobDescription: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                jdId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description JD and verified manual process when available. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["JobDescriptionDetail"];
                };
            };
            /** @description JD is unavailable. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    listJdFit: {
        parameters: {
            query?: {
                company?: string;
                level?: components["schemas"]["EngineeringLevel"];
                specialization?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description One score per listed JD. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["JdFitList"];
                };
            };
            /** @description Invalid level. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    getJdFit: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                jdId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Score breakdown. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["JdFitBreakdown"];
                };
            };
            /** @description JD is unavailable. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    rescheduleInterviewSession: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                sessionId: components["parameters"]["SessionId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RescheduleInterviewSessionRequest"];
            };
        };
        responses: {
            /** @description Rescheduled. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InterviewSession"];
                };
            };
            /** @description `interview_access_required` — the account has the USER role and cannot run interviews. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Slot taken or session can no longer be moved. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    cancelInterviewSession: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                sessionId: components["parameters"]["SessionId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Cancelled. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InterviewSession"];
                };
            };
            /** @description Session can no longer be cancelled. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    listLoops: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Loops. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LoopList"];
                };
            };
        };
    };
    confirmLoop: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ConfirmLoopRequest"];
            };
        };
        responses: {
            /** @description Loop created. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Loop"];
                };
            };
            /** @description A live loop already exists for this JD */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    getLoop: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                loopId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The loop. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Loop"];
                };
            };
            /** @description Not found. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    setLoopStatus: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                loopId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SetLoopStatusRequest"];
            };
        };
        responses: {
            /** @description Updated loop. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Loop"];
                };
            };
        };
    };
    listProcesses: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Processes. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InterviewProcessList"];
                };
            };
        };
    };
    createProcess: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SaveProcessRequest"];
            };
        };
        responses: {
            /** @description Created. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InterviewProcess"];
                };
            };
        };
    };
    getOfficialProcess: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                jdId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Graph. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OfficialProcess"];
                };
            };
        };
    };
    getProcess: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                processId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The process. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InterviewProcess"];
                };
            };
        };
    };
    updateProcess: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                processId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SaveProcessRequest"];
            };
        };
        responses: {
            /** @description Updated. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InterviewProcess"];
                };
            };
        };
    };
    deleteProcess: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                processId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Deleted. */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    duplicateProcess: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                processId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The copy. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InterviewProcess"];
                };
            };
        };
    };
    listTargets: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Targets. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TargetList"];
                };
            };
        };
    };
    getJdLoopStatus: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                jdId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Status. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["JdLoopStatus"];
                };
            };
        };
    };
    addTarget: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                jdId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Added. */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    removeTarget: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                jdId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Removed. */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    listAdminUsers: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Users. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminUser"][];
                };
            };
            401: components["responses"]["Unauthorized"];
            /** @description Not an admin. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    updateAdminUserRole: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                userId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    role: components["schemas"]["Role"];
                };
            };
        };
        responses: {
            /** @description Updated user. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminUser"];
                };
            };
            /** @description `invalid_role` — role must be USER, CANDIDATE or ADMIN. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            401: components["responses"]["Unauthorized"];
            /** @description Not an admin. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description `user_not_found`. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description `last_admin` — the change would remove the last ADMIN. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    listAdminCompanies: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Companies. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminCompanyList"];
                };
            };
            401: components["responses"]["Unauthorized"];
        };
    };
    createCompany: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateCompanyRequest"];
            };
        };
        responses: {
            /** @description Created. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminCompany"];
                };
            };
            /** @description `invalid_company` | `invalid_website` | `invalid_aliases`. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description `company_exists` — the slug is taken. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    seedCompanies: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Seed result. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SeedResult"];
                };
            };
        };
    };
    deleteCompany: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                companyId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Deleted. */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            404: components["responses"]["NotFound"];
        };
    };
    updateCompany: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                companyId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateCompanyRequest"];
            };
        };
        responses: {
            /** @description Updated. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminCompany"];
                };
            };
            /** @description `invalid_company` | `invalid_website` | `invalid_aliases` | `invalid_status`. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            404: components["responses"]["NotFound"];
        };
    };
    getCompanyEnrichment: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                companyId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Current draft and publication metadata. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnrichmentResponse"];
                };
            };
        };
    };
    saveCompanyEnrichment: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                companyId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["EnrichmentWriteRequest"];
            };
        };
        responses: {
            /** @description Saved draft. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnrichmentResponse"];
                };
            };
            /** @description Stale revision; reload before saving. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    prefillCompanyEnrichment: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                companyId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["EnrichmentPrefillRequest"];
            };
        };
        responses: {
            /** @description Current draft; revision advances only when values change. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnrichmentResponse"];
                };
            };
            /** @description Stale revision. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Research service unavailable; draft unchanged. */
            502: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    publishCompanyEnrichment: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                companyId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["EnrichmentWriteRequest"];
            };
        };
        responses: {
            /** @description Immediately published. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnrichmentResponse"];
                };
            };
            /** @description Invalid or unverified content. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Stale revision */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    getCompanyDraft: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                companyId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Draft. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CompanyDraftResponse"];
                };
            };
            /** @description `company_not_found` | `draft_not_found` (no research has produced a draft yet). */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    approveCompanyDraft: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                companyId: string;
                draftId: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["DraftDecisionRequest"];
            };
        };
        responses: {
            /** @description The published company. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminCompany"];
                };
            };
            /** @description Invalid draft values; the company is not changed. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description `draft_stale` | `draft_not_pending` | `draft_not_approvable` (research says it is not a company). */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    rejectCompanyDraft: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                companyId: string;
                draftId: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["DraftDecisionRequest"];
            };
        };
        responses: {
            /** @description Rejected. */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description `draft_stale` | `draft_not_pending`. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    listResearchRuns: {
        parameters: {
            query?: {
                limit?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Newest first. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ResearchRunList"];
                };
            };
            /** @description `ai_service_unreachable`. */
            502: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    startResearchRun: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["StartResearchRunRequest"];
            };
        };
        responses: {
            /** @description The new run. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ResearchRun"];
                };
            };
            /** @description `no_companies` | `invalid_mode`. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description `run_active`. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description `targets_unavailable` | `research_disabled`. */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    getResearchRun: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                runId: components["parameters"]["ResearchRunId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Run with its items. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ResearchRunDetail"];
                };
            };
            404: components["responses"]["NotFound"];
        };
    };
    pauseResearchRun: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                runId: components["parameters"]["ResearchRunId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Pausing. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ResearchRun"];
                };
            };
            /** @description `invalid_transition`. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    resumeResearchRun: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                runId: components["parameters"]["ResearchRunId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Resumed. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ResearchRun"];
                };
            };
            /** @description `invalid_transition`. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    stopResearchRun: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                runId: components["parameters"]["ResearchRunId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Stopping or stopped. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ResearchRun"];
                };
            };
            /** @description `invalid_transition`. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    updateResearchBudget: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                runId: components["parameters"]["ResearchRunId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ResearchBudgetUpdate"];
            };
        };
        responses: {
            /** @description Updated run. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ResearchRun"];
                };
            };
            /** @description `invalid_budget` — negative, or below calls already made. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    listResearchEvents: {
        parameters: {
            query?: {
                afterSeq?: number;
                beforeSeq?: number;
                limit?: number;
                level?: components["schemas"]["ResearchLevel"];
                companyId?: string;
                node?: string;
                /** @description Event type prefix */
                type?: string;
                spanId?: string;
                /** @description Case-insensitive substring of the message. */
                q?: string;
            };
            header?: never;
            path: {
                runId: components["parameters"]["ResearchRunId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of events. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ResearchEventPage"];
                };
            };
        };
    };
    listResearchSpans: {
        parameters: {
            query?: {
                companyId?: string;
            };
            header?: never;
            path: {
                runId: components["parameters"]["ResearchRunId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Spans by start time. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ResearchSpanList"];
                };
            };
        };
    };
    getResearchSpan: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                spanId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The span. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ResearchSpanDetailResponse"];
                };
            };
            404: components["responses"]["NotFound"];
        };
    };
    listBriefProblems: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description One entry per brief with at least one round that carries problems. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        briefs: {
                            company: string;
                            final_experience: {
                                rounds: {
                                    type: string;
                                    /** @enum {string} */
                                    difficulty: "easy" | "medium" | "hard";
                                    topics: string[];
                                    problems: string[];
                                }[];
                            };
                        }[];
                    };
                };
            };
        };
    };
    listResearchTargets: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Targets. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ResearchTarget"][];
                };
            };
            401: components["responses"]["Unauthorized"];
        };
    };
    warmLiveInterviewSession: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                sessionId: components["parameters"]["SessionId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Whether an interviewer is in the room or on its way. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WarmLiveResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
            /** @description `interview_access_required` — the account has the USER role and cannot run interviews. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            404: components["responses"]["NotFound"];
        };
    };
    getLiveInterviewerReadiness: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The interviewer's readiness. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LiveReadinessResponse"];
                };
            };
            401: components["responses"]["Unauthorized"];
        };
    };
    endLiveInterviewSession: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                sessionId: components["parameters"]["SessionId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The end result. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CandidateLiveEndResult"];
                };
            };
            401: components["responses"]["Unauthorized"];
            404: components["responses"]["NotFound"];
            /** @description `session_not_live`. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    getLiveContext: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                sessionId: components["parameters"]["SessionId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The context. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LiveContext"];
                };
            };
            401: components["responses"]["Unauthorized"];
            404: components["responses"]["NotFound"];
            /** @description `session_not_live`: the session is neither PREP_READY nor LIVE_IN_PROGRESS. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    endLiveSessionInternal: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                sessionId: components["parameters"]["SessionId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["LiveEndRequest"];
            };
        };
        responses: {
            /** @description The end result. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LiveEndResult"];
                };
            };
            /** @description `live_end_bad_request`. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            401: components["responses"]["Unauthorized"];
            404: components["responses"]["NotFound"];
            /** @description `session_not_live`. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    listEvaluationRuns: {
        parameters: {
            query?: {
                status?: string;
                company?: string;
                round_type?: components["schemas"]["RoundType"];
                trigger?: string;
                outcome?: string;
                candidate_id?: string;
                session_id?: string;
                from?: string;
                to?: string;
                limit?: number;
                /** @description The previous page's next_cursor. */
                cursor?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of runs. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EvaluationRunList"];
                };
            };
            401: components["responses"]["Unauthorized"];
            /** @description Admin role required. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    getEvaluationRun: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                runId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The run. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EvaluationRunDetail"];
                };
            };
            401: components["responses"]["Unauthorized"];
            /** @description Admin role required. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description `run_not_found` */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    rerunSessionEvaluation: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                sessionId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The new run. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EvaluationRerunStarted"];
                };
            };
            401: components["responses"]["Unauthorized"];
            /** @description Admin role required. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            404: components["responses"]["NotFound"];
            /** @description `session_not_completed` */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    listBlueprintBenchCandidates: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Candidates sorted by name. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BlueprintBenchCandidate"][];
                };
            };
            401: components["responses"]["Unauthorized"];
            /** @description Admin role required. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    listBlueprintRuns: {
        parameters: {
            query?: {
                status?: components["schemas"]["BlueprintRunStatus"];
                company?: string;
                round_type?: components["schemas"]["RoundType"];
                trigger?: components["schemas"]["BlueprintTrigger"];
                candidate_id?: string;
                session_id?: string;
                from?: string;
                to?: string;
                limit?: number;
                /** @description The previous page's next_cursor. */
                cursor?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of runs. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BlueprintRunList"];
                };
            };
            401: components["responses"]["Unauthorized"];
            /** @description Admin role required. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    getBlueprintRun: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                runId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The run. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BlueprintRunDetail"];
                };
            };
            401: components["responses"]["Unauthorized"];
            /** @description Admin role required. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description `run_not_found` */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    rerunBlueprint: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                runId: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": {
                    bypassAnswerKeyCache?: boolean;
                    ignoreExclusions?: boolean;
                };
            };
        };
        responses: {
            /** @description The new run. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BlueprintRunStarted"];
                };
            };
            401: components["responses"]["Unauthorized"];
            /** @description Admin role required. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description `run_not_found` */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    startBlueprintBench: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["BlueprintBenchRequest"];
            };
        };
        responses: {
            /** @description The bench run. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BlueprintRunStarted"];
                };
            };
            /** @description `blueprint_bad_request` */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            401: components["responses"]["Unauthorized"];
            /** @description Admin role required. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    listBlueprintVersions: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                sessionId: components["parameters"]["SessionId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Versions. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BlueprintVersionList"];
                };
            };
            401: components["responses"]["Unauthorized"];
            /** @description Admin role required. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    diffBlueprintVersions: {
        parameters: {
            query: {
                from: number;
                to: number;
            };
            header?: never;
            path: {
                sessionId: components["parameters"]["SessionId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The diff. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BlueprintDiff"];
                };
            };
            401: components["responses"]["Unauthorized"];
            /** @description Admin role required. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description `run_not_found`: unknown version. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    getBlueprintAnswerKeys: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                roundType: components["schemas"]["RoundType"];
                /** @description The bank slug (may contain "/"). */
                slug: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Keys. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AnswerKeyList"];
                };
            };
            401: components["responses"]["Unauthorized"];
            /** @description Admin role required. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    startBlueprintRun: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["BlueprintRunRequest"];
            };
        };
        responses: {
            /** @description Started (or the live run). */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BlueprintRunStarted"];
                };
            };
            /** @description Session runs need a session_id. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            401: components["responses"]["Unauthorized"];
        };
    };
    getBlueprintRunStatus: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                runId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Status. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BlueprintRunStatusView"];
                };
            };
            401: components["responses"]["Unauthorized"];
            404: components["responses"]["NotFound"];
        };
    };
    cancelBlueprintRun: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                runId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Whether a running run was cancelled. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        cancelled: boolean;
                    };
                };
            };
            401: components["responses"]["Unauthorized"];
        };
    };
    getSessionBlueprint: {
        parameters: {
            query?: {
                version?: number;
            };
            header?: never;
            path: {
                sessionId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The blueprint. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Blueprint"];
                };
            };
            401: components["responses"]["Unauthorized"];
            404: components["responses"]["NotFound"];
        };
    };
}
