/**
 * Endpoints for the admin pipeline-observability consoles (résumé parse, interview-prep).
 * ADMIN-only backend proxies to the AI service; the browser never holds the internal key.
 */

export const RESUME_BENCH_ENDPOINTS = {
  startRun: "/api/v1/intelligence/resume/parse/run",
  runs: "/api/v1/intelligence/resume/parse/runs",
  run: (id: string) => `/api/v1/intelligence/resume/parse/runs/${encodeURIComponent(id)}`,
} as const;

export const INTERVIEW_PREP_BENCH_ENDPOINTS = {
  startRun: "/api/v1/intelligence/interview-prep/run",
  runs: "/api/v1/intelligence/interview-prep/runs",
  run: (id: string) => `/api/v1/intelligence/interview-prep/runs/${encodeURIComponent(id)}`,
  candidates: "/api/v1/intelligence/interview-prep/candidates",
} as const;
