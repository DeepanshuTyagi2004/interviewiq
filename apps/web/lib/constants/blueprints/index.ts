/**
 * Interview blueprint diagnostics (admin): the API proxies under /api/v1/intelligence/blueprints.
 * Payloads are the AI service's snake_case JSON (spec docs/superpowers/specs/2026-10-07-interview-blueprint-design.md §10).
 */

const BASE = "/api/v1/intelligence/blueprints";

export const BLUEPRINT_ENDPOINTS = {
  candidates: `${BASE}/candidates`,
  runs: `${BASE}/runs`,
  run: (id: string) => `${BASE}/runs/${encodeURIComponent(id)}`,
  rerun: (id: string) => `${BASE}/runs/${encodeURIComponent(id)}/rerun`,
  bench: `${BASE}/bench`,
  versions: (sessionId: string) => `${BASE}/sessions/${encodeURIComponent(sessionId)}/versions`,
  diff: (sessionId: string, from: number, to: number) => `${BASE}/sessions/${encodeURIComponent(sessionId)}/diff?from=${from}&to=${to}`,
  answerKeys: (roundType: string, slug: string) =>
    `${BASE}/answer-keys/${encodeURIComponent(roundType)}/${slug.split("/").map(encodeURIComponent).join("/")}`,
} as const;

export const BLUEPRINT_QUERY_KEYS = {
  candidates: ["blueprints", "candidates"] as const,
  runs: (filters: Record<string, string | undefined>) => ["blueprints", "runs", filters] as const,
  run: (id: string) => ["blueprints", "run", id] as const,
  versions: (sessionId: string) => ["blueprints", "versions", sessionId] as const,
  diff: (sessionId: string, from: number, to: number) => ["blueprints", "diff", sessionId, from, to] as const,
} as const;

/** Poll the run list and an open run while anything is running. */
export const BLUEPRINT_POLLING = { runningIntervalMs: 2500 } as const;

export const BLUEPRINT_TRIGGERS = ["booking", "reconcile", "refresh", "retry", "bench"] as const;
export const BLUEPRINT_STATUSES = ["running", "completed", "failed", "cancelled"] as const;
