"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { INTERVIEW_POLLING, INTERVIEW_QUERY_KEYS } from "@/lib/constants/interview";
import { createSession, listMySessions, regenerateSession } from "./api";
import type { CreateInterviewSessionRequest, InterviewSessionListResponse } from "./types";

/** The candidate's sessions. Auto-polls while any session is still preparing (Scheduled/Queued). */
export function useMySessions() {
  return useQuery<InterviewSessionListResponse>({
    queryKey: INTERVIEW_QUERY_KEYS.sessions,
    queryFn: listMySessions,
    refetchInterval: (query) => {
      const preparing = query.state.data?.sessions?.some(
        (s) => s.status === "SCHEDULED" || s.status === "PREP_QUEUED",
      );
      return preparing ? INTERVIEW_POLLING.sessionsIntervalMs : false;
    },
  });
}

export function useCreateSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateInterviewSessionRequest) => createSession(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: INTERVIEW_QUERY_KEYS.sessions });
    },
  });
}

export function useRegenerateSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => regenerateSession(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: INTERVIEW_QUERY_KEYS.sessions });
    },
  });
}
