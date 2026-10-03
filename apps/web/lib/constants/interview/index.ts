/** Constants for the Interview module (booking + prep status, Pipeline 1). */
import type { components } from "@/lib/api-client/generated/schema";

type RoundType = components["schemas"]["RoundType"];

const SESSIONS = "/api/v1/interviews/sessions";

export const INTERVIEW_ENDPOINTS = {
  sessions: SESSIONS,
  session: (id: string) => `${SESSIONS}/${id}`,
  regenerate: (id: string) => `${SESSIONS}/${id}/regenerate`,
  live: (id: string) => `${SESSIONS}/${id}/live`,
  reschedule: (id: string) => `${SESSIONS}/${id}/reschedule`,
  cancel: (id: string) => `${SESSIONS}/${id}/cancel`,
} as const;

export const INTERVIEW_QUERY_KEYS = {
  sessions: ["interviews", "sessions"] as const,
  session: (id: string) => ["interviews", "session", id] as const,
  live: (id: string) => ["interviews", "session", id, "live"] as const,
} as const;

/** Poll the sessions list while prep is in flight, so "Preparing → Ready" updates on its own. */
export const INTERVIEW_POLLING = {
  sessionsIntervalMs: 5000,
} as const;

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

/** How each prep status reads to the candidate. "Ready" = the interviewer's plan exists. */
export const SESSION_STATUS_META: Record<
  string,
  { label: string; tone: "neutral" | "pending" | "ready" | "failed" }
> = {
  SCHEDULED: { label: "Scheduled", tone: "neutral" },
  PREP_QUEUED: { label: "Preparing", tone: "pending" },
  PREP_READY: { label: "Ready", tone: "ready" },
  PREP_FAILED: { label: "Prep failed", tone: "failed" },
};
