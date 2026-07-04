import { apiFetch } from "@/lib/api-client/client";
import { INTERVIEW_PREP_BENCH_ENDPOINTS } from "@/lib/constants/observability";
import type { RunSnapshot, RunSummary } from "@/features/observability";

export type StartPrepRunInput = {
  jobDescriptionId: string;
  /** Normally omitted — the backend assigns the round (first round), same as the real flow.
   *  Accepted if explicitly supplied. */
  roundType?: string;
  /** Optional — grounds the candidate probes in a real profile. */
  candidateId?: string;
};

/** POST — assemble the plan request (JD + round + optional candidate) and start an instrumented run. */
export function startPrepRun(input: StartPrepRunInput): Promise<{ run_id: string; status: string }> {
  return apiFetch(INTERVIEW_PREP_BENCH_ENDPOINTS.startRun, { method: "POST", json: input });
}

/** GET one run snapshot; pass `after` = last_seq for incremental logs. */
export function getPrepRun(runId: string, after = 0): Promise<RunSnapshot> {
  return apiFetch<RunSnapshot>(`${INTERVIEW_PREP_BENCH_ENDPOINTS.run(runId)}?after=${after}`);
}

/** GET recent interview-prep runs (newest first). */
export function listPrepRuns(): Promise<{ runs: RunSummary[] }> {
  return apiFetch<{ runs: RunSummary[] }>(INTERVIEW_PREP_BENCH_ENDPOINTS.runs);
}

/** An onboarded candidate (has a saved profile) the admin can run the pipeline against. */
export type PrepCandidate = { id: string; name: string; email: string | null };

/** GET onboarded candidates for the bench dropdown. */
export function listPrepCandidates(): Promise<PrepCandidate[]> {
  return apiFetch<PrepCandidate[]>(INTERVIEW_PREP_BENCH_ENDPOINTS.candidates);
}
