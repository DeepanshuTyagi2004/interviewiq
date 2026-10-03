/**
 * GENERATED FILE — do not edit by hand.
 * Source: packages/contracts/openapi.yaml
 * Regenerate: pnpm contracts:types
 */

export interface paths {
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
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
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
    "/api/v1/interviews/sessions/{sessionId}/regenerate": {
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
         * Re-queue prep generation for a session (retry after PREP_FAILED, or refresh).
         * @description Idempotent by design — the ai-service caches on the fused input hash, so a regenerate with unchanged inputs returns the existing plan with no LLM calls. Moves the session back to `PREP_QUEUED`; the backend then (re)generates. Only the owning candidate may call this.
         *
         */
        post: operations["regenerateInterviewSessionPrep"];
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
         * @description Moves a PREP_READY session to LIVE_IN_PROGRESS and mints a fresh LiveKit join token. Idempotent while already LIVE_IN_PROGRESS — returns a fresh token for the same room without altering session state. Only the owning candidate may call this.
         *
         */
        post: operations["goLiveInterviewSession"];
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
    "/interview-plans": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Build (or return the cached) InterviewPlan for a session.
         * @description The backend assembles the session context + JD + candidate profile and posts it here. Stage 1 (no LLM) gathers the brief and the question bank and computes a deterministic input hash. If a stored plan for this session already has the same input hash, it is returned unchanged (no LLM calls). Otherwise three schema-validated LLM calls (persona, ladders, probes) run concurrently, the plan is assembled, persisted (one per session), and returned.
         *
         */
        post: operations["generateInterviewPlan"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/interview-plans/start": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Start plan generation in the background (fire-and-poll variant).
         * @description Same request body and cache/persist semantics as POST /interview-plans, but returns a run_id immediately and runs the pipeline in the background. The caller polls GET /interview-plans/runs/{runId} until the run is terminal. Used by the prep trigger so a slow, concurrent Stage-2 LLM run can't trip the HTTP client read timeout (which would wrongly mark the session PREP_FAILED). Single-process: start and poll must hit the same worker.
         *
         */
        post: operations["startInterviewPlan"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/interview-plans/runs/{runId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Poll a run started by /interview-plans/start.
         * @description Returns the run's terminal state. While running, plan and error are null. On completed, plan carries the InterviewPlan. On failed, error carries {code, message} — code mirrors the synchronous route's failure modes (no_data ≈ 422, llm_error ≈ 502).
         *
         */
        get: operations["getInterviewPlanRun"];
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
        /** @enum {string} */
        Role: "USER" | "ADMIN";
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
            /** Format: uuid */
            jobDescriptionId: string;
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
        /** @description A booked interview session and its prep readiness. `planReady` (status == PREP_READY) is the only signal surfaced to the candidate — plan CONTENTS are the interviewer's material and are never returned here.
         *      */
        InterviewSession: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            candidateId: string;
            /** Format: uuid */
            jobDescriptionId: string;
            /** @description Company slug. */
            company: string;
            /** @description Human-readable company name, when known. */
            companyName?: string | null;
            role: string;
            level: string;
            specialization: string;
            roundType: components["schemas"]["RoundType"];
            /** Format: date-time */
            scheduledAt: string;
            timezone: string;
            status: components["schemas"]["SessionStatus"];
            /** @description True when status == PREP_READY (an InterviewPlan exists). */
            planReady: boolean;
            /** @description The plan_version recorded once prep succeeds. */
            planVersion?: string | null;
            /** @description The ai-service fused input hash of the generated plan. */
            inputHash?: string | null;
            /** @description Stable error code when status == PREP_FAILED. */
            prepError?: string | null;
            /**
             * Format: uuid
             * @description The loop this session is a round of; null for ad-hoc bookings.
             */
            loopId?: string | null;
            nodeId?: string | null;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
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
            position: components["schemas"]["ProcessPosition"];
        };
        /** @description A non-interview step (online test, take-home). Display only, never connected, scheduled, scored or counted. */
        ProcessInfoNode: {
            id: string;
            /** @enum {string} */
            kind: "info";
            name: string;
            note: string;
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
            title: string;
            company: string;
            companyName: string;
            role: string;
            level: string;
            specialization: string | null;
            techStack: string[];
        };
        InterviewProcess: {
            /** Format: uuid */
            id: string;
            name: string;
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
        /** @description Create (jdId + name, optional graph; defaults to a copy of the official process) or update (name and/or graph). */
        SaveProcessRequest: {
            /** Format: uuid */
            jdId?: string;
            name?: string;
            graph?: components["schemas"]["ProcessGraph"];
        };
        OfficialProcess: {
            graph: components["schemas"]["ProcessGraph"];
        };
        /** @enum {string} */
        LoopNodeState: "locked" | "available" | "booked" | "completed";
        /** @description A confirmed process for a JD. `graph` is a snapshot taken at confirm time. */
        Loop: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            jdId: string;
            jd: components["schemas"]["JdBrief"] | null;
            /** Format: uuid */
            processId: string | null;
            /** @enum {string} */
            kind: "official" | "standalone";
            /** @enum {string} */
            status: "active" | "paused" | "abandoned" | "completed";
            /** @description Only unedited, suggested processes count. */
            countsTowardReadiness: boolean;
            /** Format: date-time */
            confirmedAt: string;
            graph: components["schemas"]["ProcessGraph"];
            nodeStates: {
                [key: string]: components["schemas"]["LoopNodeState"];
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
            }[];
        };
        LoopList: {
            loops: components["schemas"]["Loop"][];
        };
        ConfirmLoopRequest: {
            /** Format: uuid */
            jdId: string;
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
        /** @description Result of starting or checking the live interview. `livekitUrl`/`token`/`roomName` are populated while status == LIVE_IN_PROGRESS and null otherwise (e.g. before prep is ready, or after the session has COMPLETED/ABORTED_TECHNICAL).
         *      */
        GoLiveResponse: {
            livekitUrl?: string | null;
            token?: string | null;
            roomName?: string | null;
            status: components["schemas"]["SessionStatus"];
        };
        /** @description Everything the ai-service needs to build a plan. Assembled by the backend. */
        GenerateInterviewPlanRequest: {
            session: components["schemas"]["PlanSessionContext"];
            jobDescription: components["schemas"]["PlanJobDescription"];
            candidateProfile: components["schemas"]["PlanCandidateProfile"];
            /** @description Optional backend-owned verified publication. When present, prep uses this instead of the AI research brief. Contains generated_at, published_revision and final_experience with ordered rounds (type, topics, problems, format, duration_minutes). */
            companyBrief?: {
                [key: string]: unknown;
            } | null;
        };
        PlanSessionContext: {
            /** Format: uuid */
            sessionId: string;
            /** Format: uuid */
            candidateId: string;
            company: string;
            role: string;
            level: string;
            specialization: string;
            roundType: components["schemas"]["RoundType"];
        };
        PlanJobDescription: {
            /** Format: uuid */
            id: string;
            title: string;
            description?: string | null;
            /** @description Comma-separated tech stack (as stored on the JD). */
            techStack?: string | null;
        };
        /** @description The candidate's descriptive profile, as the backend assembles it from CandidateProfile. Evidence-carrying, never scored. The ai-service hashes this to detect changes.
         *      */
        PlanCandidateProfile: {
            fullName?: string | null;
            headline?: string | null;
            targetRole?: string | null;
            education?: components["schemas"]["PlanEducation"][];
            experience?: components["schemas"]["PlanExperience"][];
            projects?: components["schemas"]["PlanProject"][];
            skills?: string[];
            achievements?: string[];
            links?: components["schemas"]["PlanLinks"];
            /** @description Curated GitHub + LeetCode signals from the Profile Builder, or null if not connected.
             *      */
            codingProfile?: components["schemas"]["PlanCodingProfile"] | null;
        };
        /** @description Compact, stable coding-platform signals the backend curates from the ProfileFragments — GitHub (languages, topRepos, contributionsLastYear) and LeetCode (solved, byTopic, contest). Free-form objects so the fragment shape can evolve without a contract change.
         *      */
        PlanCodingProfile: {
            github?: {
                [key: string]: unknown;
            } | null;
            leetcode?: {
                [key: string]: unknown;
            } | null;
        };
        PlanProject: {
            name?: string | null;
            description?: string | null;
            tech?: string[];
            bullets?: string[];
            link?: string | null;
        };
        PlanEducation: {
            institution?: string | null;
            degree?: string | null;
            field?: string | null;
            startYear?: string | null;
            endYear?: string | null;
            grade?: string | null;
        };
        PlanExperience: {
            company?: string | null;
            title?: string | null;
            startDate?: string | null;
            endDate?: string | null;
            location?: string | null;
            bullets?: string[];
        };
        PlanLinks: {
            github?: string | null;
            leetcode?: string | null;
            linkedin?: string | null;
        };
        /** @description The interviewer's prep material for one session. Descriptive and evidence-carrying throughout. The rubric on each question ladder lives ONLY here — never on any Profile Builder / ProfileSummary contract.
         *      */
        InterviewPlan: {
            /** Format: uuid */
            sessionId: string;
            /** Format: uuid */
            candidateId: string;
            company: string;
            role: string;
            level: string;
            specialization: string;
            roundType: components["schemas"]["RoundType"];
            provenance: components["schemas"]["PlanProvenance"];
            persona: components["schemas"]["InterviewerPersona"];
            /** @description Ordered, timed beats of the round. */
            roundArc: components["schemas"]["RoundBeat"][];
            questionLadders: components["schemas"]["QuestionLadder"][];
            candidateProbes: components["schemas"]["CandidateProbe"][];
            /** @description Behaviours/signals to watch for, carried from the brief. */
            redFlagWatchlist: string[];
        };
        /** @description Versioning + traceability for one plan. */
        PlanProvenance: {
            /** @description Overall plan-shape version. */
            planVersion: string;
            personaPromptVersion?: string | null;
            ladderPromptVersion?: string | null;
            probesPromptVersion?: string | null;
            /** @description Timestamp of the brief the plan was built from. */
            briefGeneratedAt?: string | null;
            profileHash?: string | null;
            /** @description sha256 of the fused inputs — the cache key. */
            inputHash: string;
            /** @description LLM model used (read from settings; never hardcoded). */
            model: string;
            /** Format: date-time */
            generatedAt: string;
        };
        InterviewerPersona: {
            name: string;
            /** @description e.g. "Senior Software Engineer". */
            seniority: string;
            /** @description e.g. "warm but rigorous". */
            disposition: string;
            styleNotes?: string | null;
            /** @description Opening script for the interviewer. */
            opening?: string | null;
            /** @description Closing script for the interviewer. */
            closing?: string | null;
            /** @description Evidence the persona is grounded in (brief/JD signals). */
            groundedIn?: string[];
        };
        RoundBeat: {
            /** @enum {string} */
            phase: "intro" | "warm-up" | "core" | "curveball" | "candidate-qs" | "wrap";
            title: string;
            description?: string | null;
            timeboxMins: number;
        };
        QuestionLadder: {
            /** @description Optional link to a QuestionRecord slug in the question bank. */
            questionSlug?: string | null;
            basePrompt: string;
            difficulty?: components["schemas"]["Difficulty"] | null;
            /** @description Escalating follow-ups, ordered easiest-to-hardest. */
            followUps: string[];
            /** @description Increasingly explicit hints, ordered subtle-to-explicit. */
            hints: string[];
            /** @description Weighted evaluation criteria (interviewer-only). */
            rubric: components["schemas"]["RubricCriterion"][];
            timeboxMins?: number | null;
        };
        RubricCriterion: {
            criterion: string;
            /** @description Relative weight (0..1 or arbitrary scale; interviewer-only). */
            weight: number;
            /** @description What a strong answer looks like. */
            strongDescriptor?: string | null;
            /** @description What a weak answer looks like. */
            weakDescriptor?: string | null;
        };
        CandidateProbe: {
            prompt: string;
            /** @description The profile/JD signal this probe is grounded in. */
            groundedIn?: string | null;
            whatItTests: string;
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
        JobDescriptionDetail: {
            /** Format: uuid */
            id: string;
            company: string;
            companyName: string;
            role: string;
            level: string;
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
            level: string;
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
    regenerateInterviewSessionPrep: {
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
            /** @description Regeneration accepted; session moved to PREP_QUEUED. */
            202: {
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
            404: components["responses"]["NotFound"];
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
    generateInterviewPlan: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["GenerateInterviewPlanRequest"];
            };
        };
        responses: {
            /** @description The generated or cached plan. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InterviewPlan"];
                };
            };
            401: components["responses"]["Unauthorized"];
            /** @description No brief/questions available for this (company, role, level). */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Plan generation failed (LLM never produced a valid plan). */
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
    startInterviewPlan: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["GenerateInterviewPlanRequest"];
            };
        };
        responses: {
            /** @description The run was started. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        run_id: string;
                        /** @enum {string} */
                        status: "running";
                    };
                };
            };
            401: components["responses"]["Unauthorized"];
        };
    };
    getInterviewPlanRun: {
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
            /** @description The run snapshot. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        run_id: string;
                        /** @enum {string} */
                        status: "running" | "completed" | "failed";
                        plan?: components["schemas"]["InterviewPlan"] | null;
                        error?: {
                            code?: string;
                            message?: string;
                        } | null;
                    };
                };
            };
            401: components["responses"]["Unauthorized"];
            404: components["responses"]["NotFound"];
        };
    };
}
