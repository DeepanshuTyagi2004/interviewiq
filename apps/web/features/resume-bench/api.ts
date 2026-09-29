import { apiFetch } from "@/lib/api-client/client";
import { RESUME_BENCH_ENDPOINTS } from "@/lib/constants/observability";
import type { RunSnapshot, RunSummary } from "@/features/observability";

/** POST a PDF (multipart) to start an instrumented parse run. Returns the run_id to poll. */
export function startResumeRun(file: File): Promise<{ run_id: string; status: string }> {
  const form = new FormData();
  form.append("file", file);
  return apiFetch(RESUME_BENCH_ENDPOINTS.startRun, { method: "POST", body: form });
}

/** GET one run snapshot; pass `after` = last_seq for incremental logs. */
export function getResumeRun(runId: string, after = 0): Promise<RunSnapshot> {
  return apiFetch<RunSnapshot>(`${RESUME_BENCH_ENDPOINTS.run(runId)}?after=${after}`);
}

/** GET recent résumé-parse runs (newest first). */
export function listResumeRuns(): Promise<{ runs: RunSummary[] }> {
  return apiFetch<{ runs: RunSummary[] }>(RESUME_BENCH_ENDPOINTS.runs);
}
