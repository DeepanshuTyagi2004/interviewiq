/**
 * Endpoints for the admin pipeline-observability consoles (resume parse).
 * ADMIN-only backend proxies to the AI service; the browser never holds the internal key.
 */

export const RESUME_BENCH_ENDPOINTS = {
  startRun: "/api/v1/intelligence/resume/parse/run",
  runs: "/api/v1/intelligence/resume/parse/runs",
  run: (id: string) => `/api/v1/intelligence/resume/parse/runs/${encodeURIComponent(id)}`,
} as const;

