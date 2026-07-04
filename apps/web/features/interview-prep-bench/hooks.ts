"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useRunPolling } from "@/features/observability";
import { getPrepRun, listPrepCandidates, startPrepRun, type PrepCandidate, type StartPrepRunInput } from "./api";

/** Assemble + start an instrumented interview-prep run. */
export function useStartPrepRun() {
  return useMutation({ mutationFn: (input: StartPrepRunInput) => startPrepRun(input) });
}

/** Onboarded candidates for the bench dropdown. */
export function usePrepCandidates() {
  return useQuery<PrepCandidate[]>({
    queryKey: ["prep-bench", "candidates"],
    queryFn: listPrepCandidates,
  });
}

/** Poll an interview-prep run (accumulating logs) until it terminates. */
export function usePrepRun(runId: string | null) {
  return useRunPolling("prep-bench", runId, getPrepRun);
}
