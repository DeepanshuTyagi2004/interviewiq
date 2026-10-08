"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BLUEPRINT_POLLING, BLUEPRINT_QUERY_KEYS } from "@/lib/constants/blueprints";
import {
  diffBlueprintVersions,
  getBlueprintRun,
  listBenchCandidates,
  listBlueprintRuns,
  listBlueprintVersions,
  rerunBlueprint,
  startBlueprintBench,
} from "./api";
import type { BlueprintBenchRequest, BlueprintRunFilters } from "./types";

/** Runs, newest first; polls while any listed run is still running. */
export function useBlueprintRuns(filters: BlueprintRunFilters) {
  return useQuery({
    queryKey: BLUEPRINT_QUERY_KEYS.runs(filters as Record<string, string | undefined>),
    queryFn: () => listBlueprintRuns(filters),
    refetchInterval: (q) => (q.state.data?.runs.some((r) => r.status === "running") ? BLUEPRINT_POLLING.runningIntervalMs : false),
  });
}

/** One run with its trace; polls until it finishes. */
export function useBlueprintRun(id: string | null) {
  return useQuery({
    queryKey: BLUEPRINT_QUERY_KEYS.run(id ?? ""),
    queryFn: () => getBlueprintRun(id!),
    enabled: !!id,
    refetchInterval: (q) => (q.state.data?.status === "running" ? BLUEPRINT_POLLING.runningIntervalMs : false),
  });
}

export function useBenchCandidates(enabled: boolean) {
  return useQuery({ queryKey: BLUEPRINT_QUERY_KEYS.candidates, queryFn: listBenchCandidates, enabled, staleTime: 60_000 });
}

export function useStartBench() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: BlueprintBenchRequest) => startBlueprintBench(body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["blueprints", "runs"] }),
  });
}

export function useRerunBlueprint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; bypassAnswerKeyCache?: boolean }) => rerunBlueprint(id, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["blueprints", "runs"] }),
  });
}

export function useBlueprintVersions(sessionId: string | null) {
  return useQuery({
    queryKey: BLUEPRINT_QUERY_KEYS.versions(sessionId ?? ""),
    queryFn: () => listBlueprintVersions(sessionId!),
    enabled: !!sessionId,
  });
}

export function useBlueprintDiff(sessionId: string | null, from: number | null, to: number | null) {
  return useQuery({
    queryKey: BLUEPRINT_QUERY_KEYS.diff(sessionId ?? "", from ?? 0, to ?? 0),
    queryFn: () => diffBlueprintVersions(sessionId!, from!, to!),
    enabled: !!sessionId && !!from && !!to && from !== to,
  });
}
