/** Constants for the Interview module (booking + blueprint prep status). */
import type { components } from "@/lib/api-client/generated/schema";

type RoundType = components["schemas"]["RoundType"];

const SESSIONS = "/api/v1/interviews/sessions";

/**
 * A mock round is 30, 35, 40 or 45 minutes, drawn when it is booked (decided 2026-10-18), whatever the real company round lasts.
 * `MOCK_ROUND_MINUTES` mirrors the API's maximum, the length stored on saved nodes; a not-yet-booked round shows `ROUND_MINUTES_LABEL`.
 */
export const MOCK_ROUND_MINUTES = 45;
export const ROUND_MINUTES_LABEL = "30-45 min";

export const INTERVIEW_ENDPOINTS = {
  sessions: SESSIONS,
  session: (id: string) => `${SESSIONS}/${id}`,
  retryPrep: (id: string) => `${SESSIONS}/${id}/prep/retry`,
  live: (id: string) => `${SESSIONS}/${id}/live`,
  liveEnd: (id: string) => `${SESSIONS}/${id}/live/end`,
  liveReadiness: "/api/v1/interviews/live/readiness",
  liveWarm: (id: string) => `${SESSIONS}/${id}/live/warm`,
  reschedule: (id: string) => `${SESSIONS}/${id}/reschedule`,
  cancel: (id: string) => `${SESSIONS}/${id}/cancel`,
} as const;

export const INTERVIEW_QUERY_KEYS = {
  sessions: ["interviews", "sessions"] as const,
  session: (id: string) => ["interviews", "session", id] as const,
  live: (id: string) => ["interviews", "session", id, "live"] as const,
} as const;

/** Poll while prep is in flight, so "Preparing → Ready" (and the session page's steps) update on their own. */
export const INTERVIEW_POLLING = {
  sessionsIntervalMs: 5000,
  sessionIntervalMs: 3000,
} as const;

/**
 * Candidate-facing labels for the blueprint run's stages (spec §9.1). Friendly on purpose: they never
 * name topics, problems or difficulty. `policies` and `validate` share "Final checks".
 */
export const PREP_STEP_LABELS: { ids: string[]; label: string }[] = [
  { ids: ["context"], label: "Reading the job description" },
  { ids: ["selection"], label: "Choosing your questions" },
  { ids: ["answer_keys"], label: "Preparing the interviewer's notes" },
  { ids: ["persona"], label: "Meeting your interviewer" },
  { ids: ["personalization"], label: "Tailoring the interview to you" },
  { ids: ["playbooks"], label: "Planning the conversation" },
  { ids: ["policies", "validate"], label: "Final checks" },
];

/** The live, human-conducted interview rounds the platform supports. `value` is typed to the
 *  generated RoundType union, so a stale/typo'd round (drift from the contract) is a compile error.
 *  Online Assessment is intentionally excluded — it's an automated coding test, not a live
 *  interview round, so InterviewIQ doesn't run mock OAs. */
export const ROUND_OPTIONS: { value: RoundType; label: string }[] = [
  { value: "dsa", label: "DSA" },
  { value: "system-design", label: "System Design" },
  { value: "lld", label: "Low-Level Design" },
  { value: "behavioural", label: "Behavioural" },
  { value: "hiring-manager", label: "Hiring Manager" },
];

/** How each prep status reads to the candidate. "Ready" = the interviewer's blueprint exists. */
export const SESSION_STATUS_META: Record<
  string,
  { label: string; tone: "neutral" | "pending" | "ready" | "failed" }
> = {
  SCHEDULED: { label: "Scheduled", tone: "neutral" },
  PREP_QUEUED: { label: "Preparing", tone: "pending" },
  PREP_READY: { label: "Ready", tone: "ready" },
  PREP_FAILED: { label: "Prep failed", tone: "failed" },
};
