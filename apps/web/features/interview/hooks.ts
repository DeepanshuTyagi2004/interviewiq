"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { INTERVIEW_POLLING, INTERVIEW_QUERY_KEYS } from "@/lib/constants/interview";
import { createSession, getLive, getSession, listMySessions, regenerateSession } from "./api";
import type {
  CreateInterviewSessionRequest,
  GoLiveResponse,
  InterviewSession,
  InterviewSessionListResponse,
} from "./types";

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

/** A single session, auto-polls while status is SCHEDULED/PREP_QUEUED. */
export function useSession(id: string) {
  return useQuery<InterviewSession>({
    queryKey: INTERVIEW_QUERY_KEYS.session(id),
    queryFn: () => getSession(id),
    enabled: !!id,
    refetchInterval: (query) => {
      const st = query.state.data?.status;
      return st === "SCHEDULED" || st === "PREP_QUEUED"
        ? INTERVIEW_POLLING.sessionsIntervalMs
        : false;
    },
  });
}

/** The session's live state (LiveKit URL/token/room). No polling — callers fetch on demand. */
export function useLiveState(id: string) {
  return useQuery<GoLiveResponse>({
    queryKey: INTERVIEW_QUERY_KEYS.live(id),
    queryFn: () => getLive(id),
  });
}
