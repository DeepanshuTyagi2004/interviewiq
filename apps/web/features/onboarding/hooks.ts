"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ONBOARDING_QUERY_KEYS,
  RESUME_PARSE_POLL_MS,
} from "@/lib/constants/onboarding";
import { PROFILE_QUERY_KEYS } from "@/lib/constants/profile";
import { SCORE_KEYS } from "@/features/profile-scoring/constants";
import {
  getCandidateProfile,
  getResumeParseRun,
  parseResume,
  saveCandidateProfile,
  startResumeParse,
} from "./api";
import type {
  CandidateProfileRequest,
  CandidateProfileResponse,
  ResumeParseRunResponse,
} from "./types";

/** Parse a resume PDF into a draft (synchronous). On error, catch ApiFetchError for the stable `code`. */
export function useParseResume() {
  return useMutation<CandidateProfileResponse, Error, File>({
    mutationFn: parseResume,
  });
}

/** Start an async resume parse (fire-and-poll) — returns the run id to poll. */
export function useStartResumeParse() {
  return useMutation<{ run_id: string; status: string }, Error, File>({
    mutationFn: startResumeParse,
  });
}

/** Poll an async parse run until it completes/fails. Idle (disabled) when runId is null. */
export function useResumeParseRun(runId: string | null) {
  return useQuery<ResumeParseRunResponse>({
    queryKey: ONBOARDING_QUERY_KEYS.resumeParseRun(runId ?? "idle"),
    queryFn: () => getResumeParseRun(runId as string),
    enabled: !!runId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "completed" || status === "failed" ? false : RESUME_PARSE_POLL_MS;
    },
  });
}

/** The saved candidate profile (null when none). Used by the profile page + wizard prefill. */
export function useCandidateProfile() {
  return useQuery<CandidateProfileResponse | null>({
    queryKey: ONBOARDING_QUERY_KEYS.candidateProfile,
    queryFn: getCandidateProfile,
    staleTime: 60_000,
  });
}

/** Upsert the candidate profile; refreshes the profile + current-user caches on success. */
export function useSaveCandidateProfile() {
  const queryClient = useQueryClient();
  return useMutation<CandidateProfileResponse, Error, CandidateProfileRequest>({
    mutationFn: saveCandidateProfile,
    onSuccess: (saved) => {
      // Show the saved profile straight away; the refetch below then confirms it.
      queryClient.setQueryData(ONBOARDING_QUERY_KEYS.candidateProfile, saved);
      queryClient.invalidateQueries({ queryKey: ONBOARDING_QUERY_KEYS.candidateProfile });
      queryClient.invalidateQueries({ queryKey: PROFILE_QUERY_KEYS.profile });
      queryClient.invalidateQueries({ queryKey: SCORE_KEYS.all });
      queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
    },
  });
}
