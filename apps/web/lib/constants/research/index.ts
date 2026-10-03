/**
 * Company research pipeline: admin-only endpoints (interviewiq-api proxies; the browser never
 * reaches the AI service), query keys, polling cadence and console limits.
 */

export const RESEARCH_ENDPOINTS = {
  companies: "/api/v1/admin/companies",
  company: (id: string) => `/api/v1/admin/companies/${encodeURIComponent(id)}`,
  seed: "/api/v1/admin/companies/seed",
  draft: (id: string) => `/api/v1/admin/companies/${encodeURIComponent(id)}/draft`,
  draftDecision: (id: string, draftId: string, decision: "approve" | "reject") =>
    `/api/v1/admin/companies/${encodeURIComponent(id)}/draft/${encodeURIComponent(draftId)}/${decision}`,
  runs: "/api/v1/admin/research/runs",
  run: (runId: string) => `/api/v1/admin/research/runs/${runId}`,
  control: (runId: string, action: "pause" | "resume" | "stop") => `/api/v1/admin/research/runs/${runId}/${action}`,
  budget: (runId: string) => `/api/v1/admin/research/runs/${runId}/budget`,
  events: (runId: string) => `/api/v1/admin/research/runs/${runId}/events`,
  spans: (runId: string) => `/api/v1/admin/research/runs/${runId}/spans`,
  span: (spanId: string) => `/api/v1/admin/research/spans/${spanId}`,
} as const;

export const RESEARCH_QUERY_KEYS = {
  companies: ["research", "companies"] as const,
  draft: (companyId: string) => ["research", "draft", companyId] as const,
  runs: ["research", "runs"] as const,
  run: (runId: string) => ["research", "run", runId] as const,
  spans: (runId: string) => ["research", "spans", runId] as const,
  span: (spanId: string) => ["research", "span", spanId] as const,
  events: (runId: string) => ["research", "events", runId] as const,
};

export const RESEARCH_POLLING = {
  /** Run detail + console tail while a run is active, and a span that is still running. */
  liveMs: 1000,
  /** The trace tree while a run is active. */
  spansMs: 2000,
  /** Company list and run history. */
  listsMs: 5000,
} as const;

/** Newest console rows kept in the DOM; older ones load on demand ("Load older"). */
export const CONSOLE_MAX_ROWS = 2000;
export const EVENTS_PAGE_LIMIT = 500;
/** "Copy for Claude" bundles are trimmed to paste cleanly into a chat. */
export const COPY_BUNDLE_MAX_CHARS = 40_000;

/** Mirror of NODE_ORDER in apps/ai-service/app/research/models.py: keep in sync. */
export const NODE_ORDER = ["resolve", "profile", "write_draft"] as const;
export type NodeName = (typeof NODE_ORDER)[number];
