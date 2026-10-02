"use client";

import { useMutation } from "@tanstack/react-query";
import { useRunPolling } from "@/features/observability";
import { getResumeRun, startResumeRun } from "./api";

/** Upload a PDF and start an instrumented parse run. */
export function useStartResumeRun() {
  return useMutation({ mutationFn: (file: File) => startResumeRun(file) });
}

/** Poll a resume-parse run (accumulating logs) until it terminates. */
export function useResumeRun(runId: string | null) {
  return useRunPolling("resume-bench", runId, getResumeRun);
}
