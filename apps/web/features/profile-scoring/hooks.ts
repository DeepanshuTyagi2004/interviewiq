"use client";

import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PROFILE_QUERY_KEYS } from "@/lib/constants/profile";
import { getProfileDiagnostics, getProfileLeaderboard, getProfileScore, recalculateProfileScore, updateScoringSettings } from "./api";
import { SCORE_KEYS } from "./constants";
import type { EngineeringLevel } from "./types";
import type { ProfileResponse } from "@/features/profile";

export function useProfileScore() {
  const client = useQueryClient();
  const lastSourceState = useRef<string | null>(null);
  // Source refreshes/poll completion invalidate the read-only assessment cache. Recalculation
  // stays explicit; a successful source read never triggers a scoring mutation.
  useEffect(() => client.getQueryCache().subscribe((event) => {
    if (event.type === "updated" && event.action.type === "success" &&
      event.query.queryHash === JSON.stringify(PROFILE_QUERY_KEYS.profile)) {
      const profile = event.query.state.data as ProfileResponse | undefined;
      const sourceState = JSON.stringify({ sources: profile?.sources, provenance: profile?.provenance });
      if (sourceState !== lastSourceState.current) {
        lastSourceState.current = sourceState;
        void client.invalidateQueries({ queryKey: SCORE_KEYS.all });
      }
    }
  }), [client]);
  // While the AI assessment runs in the background, poll until it clears and the new snapshot is there.
  return useQuery({ queryKey: SCORE_KEYS.me, queryFn: getProfileScore, refetchInterval: (q) => q.state.data?.assessment?.inProgress ? 4000 : false });
}

export function useScoringSettings() {
  const client = useQueryClient();
  return useMutation({ mutationFn: updateScoringSettings, onSuccess: (data) => {
    client.setQueryData(SCORE_KEYS.me, data);
    void client.invalidateQueries({ queryKey: SCORE_KEYS.all });
  } });
}

export function useRecalculateProfileScore() {
  const client = useQueryClient();
  return useMutation({ mutationFn: recalculateProfileScore, onSuccess: (data) => {
    client.setQueryData(SCORE_KEYS.me, data);
    void client.invalidateQueries({ queryKey: SCORE_KEYS.all });
  }, onError: () => void client.invalidateQueries({ queryKey: SCORE_KEYS.all }) });
}

export function useProfileLeaderboard(level: EngineeringLevel, enabled = true) {
  return useQuery({ queryKey: SCORE_KEYS.leaderboard(level), queryFn: () => getProfileLeaderboard(level), enabled });
}

export function useProfileDiagnostics(userId?: string) {
  return useQuery({ queryKey: SCORE_KEYS.diagnostics(userId), queryFn: () => getProfileDiagnostics(userId),
    refetchInterval: (query) => query.state.data?.jobs.status === "running" ? 3000 : false });
}

