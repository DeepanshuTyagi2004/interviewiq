"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { INTERVIEW_POLLING, INTERVIEW_QUERY_KEYS } from "@/lib/constants/interview";
import { cancelSession, createSession, getLive, getSession, listMySessions, rescheduleSession, retryPrep } from "./api";
import type {
  CreateInterviewSessionRequest,
  GoLiveResponse,
  InterviewSession,
  InterviewSessionListResponse,
} from "./types";

/** A blueprint is being prepared (first prep or a refresh): worth polling. */
export function isPreparing(s: Pick<InterviewSession, "status" | "prep">): boolean {
  return s.status === "SCHEDULED" || s.status === "PREP_QUEUED" || s.prep?.refreshing === true;
}

/** The candidate's sessions. Auto-polls while any session is still preparing. */
export function useMySessions() {
  return useQuery<InterviewSessionListResponse>({
    queryKey: INTERVIEW_QUERY_KEYS.sessions,
    queryFn: listMySessions,
    refetchInterval: (query) =>
      query.state.data?.sessions?.some(isPreparing) ? INTERVIEW_POLLING.sessionsIntervalMs : false,
  });
}

export function useCreateSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateInterviewSessionRequest) => createSession(body),
    onSuccess: () => invalidateSessionsAndLoops(queryClient),
  });
}

/** Booking, moving or cancelling a round changes loops (node state, progress) as well as sessions. */
function invalidateSessionsAndLoops(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: INTERVIEW_QUERY_KEYS.sessions });
  void queryClient.invalidateQueries({ queryKey: ["loops"] });
}

export function useRescheduleSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; scheduledAt: string; timezone: string }) => rescheduleSession(id, body),
    onSuccess: () => invalidateSessionsAndLoops(queryClient),
  });
}

export function useCancelSession() {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: (id: string) => cancelSession(id), onSuccess: () => invalidateSessionsAndLoops(queryClient) });
}

/** Retry blueprint prep after PREP_FAILED. A 429 carries "try again in N min" in its message. */
export function useRetryPrep() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => retryPrep(id),
    onSuccess: (session) => {
      queryClient.setQueryData(INTERVIEW_QUERY_KEYS.session(session.id), session);
      void queryClient.invalidateQueries({ queryKey: INTERVIEW_QUERY_KEYS.sessions });
    },
  });
}

/** A single session; polls quickly while its blueprint is being prepared, so the steps move live. */
export function useSession(id: string) {
  return useQuery<InterviewSession>({
    queryKey: INTERVIEW_QUERY_KEYS.session(id),
    queryFn: () => getSession(id),
    enabled: !!id,
    refetchInterval: (query) =>
      query.state.data && isPreparing(query.state.data) ? INTERVIEW_POLLING.sessionIntervalMs : false,
  });
}

/** The session's live state (LiveKit URL/token/room). No polling — callers fetch on demand. */
export function useLiveState(id: string) {
  return useQuery<GoLiveResponse>({
    queryKey: INTERVIEW_QUERY_KEYS.live(id),
    queryFn: () => getLive(id),
  });
}
