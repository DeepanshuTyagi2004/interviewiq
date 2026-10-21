"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getEvaluationRun, listEvaluationRuns, rerunSessionEvaluation } from "./api";
import type { EvaluationFilters } from "./types";

const POLL_MS = 2500;

/** Runs, newest first; polls while any listed run is still running. */
export function useEvaluationRuns(filters: EvaluationFilters) {
  return useQuery({
    queryKey: ["evaluations", "runs", filters],
    queryFn: () => listEvaluationRuns(filters),
    refetchInterval: (q) => (q.state.data?.runs.some((r) => r.status === "running") ? POLL_MS : false),
  });
}

/** One run with raw grader outputs; polls until it finishes. */
export function useEvaluationRun(id: string | null) {
  return useQuery({
    queryKey: ["evaluations", "run", id ?? ""],
    queryFn: () => getEvaluationRun(id!),
    enabled: !!id,
    refetchInterval: (q) => (q.state.data?.status === "running" ? POLL_MS : false),
  });
}

export function useRerunEvaluation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) => rerunSessionEvaluation(sessionId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["evaluations"] }),
  });
}
