"use client";

import { useQuery } from "@tanstack/react-query";
import { ApiFetchError } from "@/lib/api-client/errors";
import { JOB_QUERY_KEYS } from "@/lib/constants/jobs";
import { getJd, listJds, listJobCompanies } from "./api";
import type { JdDetail, JdSummary, JobCompany } from "./types";

export function useJds(
  filters: { company?: string; level?: string; specialization?: string } = {},
  options: { enabled?: boolean } = {},
) {
  return useQuery<JdSummary[]>({
    queryKey: JOB_QUERY_KEYS.list(filters),
    queryFn: () => listJds(filters),
    enabled: options.enabled ?? true,
  });
}

/** Client errors (404 unknown JD, 400 bad id) won't change on retry — fail fast; retry the rest. */
export function shouldRetryJd(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiFetchError && error.status >= 400 && error.status < 500) return false;
  return failureCount < 3;
}

export function useJd(id: string) {
  return useQuery<JdDetail>({
    queryKey: JOB_QUERY_KEYS.detail(id),
    queryFn: () => getJd(id),
    enabled: Boolean(id),
    retry: shouldRetryJd,
  });
}

export function useJobCompanies() {
  return useQuery<JobCompany[]>({
    queryKey: JOB_QUERY_KEYS.companies,
    queryFn: listJobCompanies,
  });
}
