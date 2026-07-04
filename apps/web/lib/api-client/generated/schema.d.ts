/**
 * GENERATED FILE — do not edit by hand.
 * Source: interviewiq-infra/contracts/openapi.yaml
 * Regenerate: npm run generate:types
 */

export interface paths {
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
        /**
         * @description A live, human-conducted interview round InterviewIQ can mock. Online Assessment is intentionally excluded — it's an automated coding test, not a live round, so it isn't bookable/conductable here. (The ai-service brief pipeline still recognises OA when it describes companies' real hiring processes; that's a separate, internal vocabulary.)
         *
         * @enum {string}
         */
        RoundType: "dsa" | "system-design" | "lld" | "behavioural" | "hiring-manager";
        /** @enum {string} */
        Difficulty: "easy" | "medium" | "hard";
        /**
         * @description Interview session lifecycle. Prep-only today (SCHEDULED → PREP_QUEUED → PREP_READY, with PREP_FAILED). Deliberately left extensible for later live / debrief stages, which are NOT implemented in Pipeline 1.
         *
         * @enum {string}
         */
        SessionStatus: "SCHEDULED" | "PREP_QUEUED" | "PREP_READY" | "PREP_FAILED";
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
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
        };
        InterviewSessionListResponse: {
            sessions: components["schemas"]["InterviewSession"][];
        };
        /** @description Everything the ai-service needs to build a plan. Assembled by the backend. */
        GenerateInterviewPlanRequest: {
            session: components["schemas"]["PlanSessionContext"];
            jobDescription: components["schemas"]["PlanJobDescription"];
            candidateProfile: components["schemas"]["PlanCandidateProfile"];
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
    };
    responses: {
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
    };
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
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
}
