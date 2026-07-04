"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  INTELLIGENCE_POLLING,
  INTELLIGENCE_QUERY_KEYS,
} from "@/lib/constants/intelligence";
import type { Role } from "@/lib/hooks/useCurrentUser";
import {
  clearBriefs,
  createCompany,
  deleteCompany,
  getBrief,
  getScrapeStatus,
  listBriefs,
  listCompanies,
  listQuestions,
  listUsers,
  seedCompanies,
  stopScrape,
  triggerCollect,
  triggerScrape,
  updateUserRole,
} from "./api";
import type { AdminUser, BriefDoc, BriefSummary, CompanyWithJds, QuestionFilters, QuestionsResponse, ScrapeStatus } from "./types";

/** Poll the live run state + verbose logs while the console is open. */
export function useScrapeStatus(enabled = true) {
  return useQuery<ScrapeStatus>({
    queryKey: INTELLIGENCE_QUERY_KEYS.scrapeStatus,
    queryFn: () => getScrapeStatus(0),
    enabled,
    refetchInterval: INTELLIGENCE_POLLING.statusIntervalMs,
  });
}

export function useTriggerScrape() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: triggerScrape,
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: INTELLIGENCE_QUERY_KEYS.scrapeStatus,
      }),
  });
}

/** Trigger a question-bank collection run, then refresh the shared run status. */
export function useTriggerCollect() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: triggerCollect,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: INTELLIGENCE_QUERY_KEYS.scrapeStatus }),
  });
}

/** Stop the active run, then refresh run status. */
export function useStopScrape() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: stopScrape,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: INTELLIGENCE_QUERY_KEYS.scrapeStatus }),
  });
}

/** Delete all generated briefs, then refresh the brief list + run status. */
export function useClearBriefs() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: clearBriefs,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["intelligence", "briefs"] });
      queryClient.invalidateQueries({ queryKey: INTELLIGENCE_QUERY_KEYS.scrapeStatus });
    },
  });
}

/** Summaries of every persisted brief — what's already been generated. */
export function useBriefs(enabled = true) {
  return useQuery<{ briefs: BriefSummary[] }>({
    queryKey: ["intelligence", "briefs"],
    queryFn: listBriefs,
    enabled,
  });
}

/** The full persisted brief for one JD — lazily fetched when a card is expanded. */
export function useBrief(
  key: { company: string; role: string; level: string; specialization: string } | null,
  enabled: boolean,
) {
  return useQuery<BriefDoc>({
    queryKey: ["intelligence", "brief", key],
    queryFn: () => getBrief(key!.company, key!.role, key!.level, key!.specialization),
    enabled: enabled && !!key,
    staleTime: 60_000,
  });
}


export function useUsers() {
  return useQuery<AdminUser[]>({
    queryKey: INTELLIGENCE_QUERY_KEYS.users,
    queryFn: listUsers,
  });
}

export function useUpdateUserRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, role }: { id: string; role: Role }) =>
      updateUserRole(id, role),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: INTELLIGENCE_QUERY_KEYS.users,
      }),
  });
}

export function useCompanies() {
  return useQuery<CompanyWithJds[]>({
    queryKey: INTELLIGENCE_QUERY_KEYS.companies,
    queryFn: listCompanies,
  });
}

export function useAddCompany() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createCompany,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: INTELLIGENCE_QUERY_KEYS.companies });
      // ingestion was triggered server-side — refresh the live status too
      void queryClient.invalidateQueries({ queryKey: INTELLIGENCE_QUERY_KEYS.scrapeStatus });
    },
  });
}

export function useDeleteCompany() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteCompany,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: INTELLIGENCE_QUERY_KEYS.companies }),
  });
}

export function useSeedCompanies() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: seedCompanies,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: INTELLIGENCE_QUERY_KEYS.companies }),
  });
}

export function useQuestions(filters: QuestionFilters) {
  return useQuery<QuestionsResponse>({
    queryKey: [...INTELLIGENCE_QUERY_KEYS.questions, filters],
    queryFn: () => listQuestions(filters),
  });
}
