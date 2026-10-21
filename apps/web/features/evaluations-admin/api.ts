import { apiFetch } from "@/lib/api-client/client";
import type { EvaluationFilters, EvaluationRerunStarted, EvaluationRunDetail, EvaluationRunList } from "./types";

const BASE = "/api/v1/intelligence/evaluations";

export const EVALUATION_ENDPOINTS = {
  runs: `${BASE}/runs`,
  run: (id: string) => `${BASE}/runs/${encodeURIComponent(id)}`,
  rerun: (sessionId: string) => `${BASE}/sessions/${encodeURIComponent(sessionId)}/rerun`,
} as const;

export function listEvaluationRuns(filters: EvaluationFilters = {}): Promise<EvaluationRunList> {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
  const qs = q.toString();
  return apiFetch<EvaluationRunList>(qs ? `${EVALUATION_ENDPOINTS.runs}?${qs}` : EVALUATION_ENDPOINTS.runs);
}

export function getEvaluationRun(id: string): Promise<EvaluationRunDetail> {
  return apiFetch<EvaluationRunDetail>(EVALUATION_ENDPOINTS.run(id));
}

/** Re-grade a completed session from scratch (a fresh `admin` run). */
export function rerunSessionEvaluation(sessionId: string): Promise<EvaluationRerunStarted> {
  return apiFetch<EvaluationRerunStarted>(EVALUATION_ENDPOINTS.rerun(sessionId), { method: "POST" });
}
