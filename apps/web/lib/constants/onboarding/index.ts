/**
 * Constants for the Onboarding module (resume parse + candidate profile).
 * Import per group, e.g. `import { ONBOARDING_ENDPOINTS } from "@/lib/constants/onboarding";`
 */

export const ONBOARDING_ENDPOINTS = {
  /** POST multipart {file} → parsed draft profile (synchronous; blocks on the LLM). */
  resumeParse: "/api/v1/users/me/resume/parse",
  /** POST multipart {file} → {run_id} — start an async parse (fire-and-poll). */
  resumeParseStart: "/api/v1/users/me/resume/parse/start",
  /** GET → {status, profile?, error?} — poll an async parse run. */
  resumeParseRun: (runId: string) => `/api/v1/users/me/resume/parse/runs/${encodeURIComponent(runId)}`,
  /** GET (204 when none) / PUT the editable candidate profile. */
  candidateProfile: "/api/v1/users/me/candidate-profile",
} as const;

export const ONBOARDING_QUERY_KEYS = {
  candidateProfile: ["candidate-profile", "me"] as const,
  resumeParseRun: (runId: string) => ["resume-parse-run", runId] as const,
} as const;

/** How often the client polls an in-flight async parse run. */
export const RESUME_PARSE_POLL_MS = 2000;

/** Client-side resume size cap; mirrors the backend's authoritative 6 MB check. */
export const RESUME_MAX_BYTES = 6 * 1024 * 1024;
