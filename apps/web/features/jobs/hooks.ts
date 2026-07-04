"use client";

import { useQuery } from "@tanstack/react-query";
import { JOB_QUERY_KEYS } from "@/lib/constants/jobs";
import { getJd, listJds, listJobCompanies } from "./api";
import type { JdDetail, JdSummary, JobCompany } from "./types";

export function useJds(filters: { company?: string; level?: string; specialization?: string } = {}) {
  return useQuery<JdSummary[]>({
    queryKey: JOB_QUERY_KEYS.list(filters),
    queryFn: () => listJds(filters),
  });
}

export function useJd(id: string) {
  return useQuery<JdDetail>({
    queryKey: JOB_QUERY_KEYS.detail(id),
    queryFn: () => getJd(id),
    enabled: Boolean(id),
  });
}

export function useJobCompanies() {
  return useQuery<JobCompany[]>({
    queryKey: JOB_QUERY_KEYS.companies,
    queryFn: listJobCompanies,
  });
}
