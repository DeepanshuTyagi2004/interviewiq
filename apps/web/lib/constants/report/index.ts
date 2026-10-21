/** Constants for the Module 04 post-interview report. */
const SESSIONS = "/api/v1/interviews/sessions";

export const REPORT_ENDPOINTS = {
  report: (id: string) => `${SESSIONS}/${id}/report`,
  disputes: (id: string) => `${SESSIONS}/${id}/report/disputes`,
} as const;

export const REPORT_QUERY_KEYS = {
  report: (id: string) => ["interviews", "session", id, "report"] as const,
} as const;

/** Poll while the report is being written or a dispute re-check is running. */
/** A failed grading keeps being retried on the server, so the page keeps asking, slowly. */
export const REPORT_POLLING = { intervalMs: 5000, failedIntervalMs: 30_000 } as const;
