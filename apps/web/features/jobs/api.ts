import { apiFetch } from "@/lib/api-client/client";
import { JOB_ENDPOINTS } from "@/lib/constants/jobs";
import type { JdDetail, JdSummary, JobCompany } from "./types";

export function listJds(
  filters: { company?: string; level?: string; specialization?: string } = {},
): Promise<JdSummary[]> {
  const qs = new URLSearchParams();
  if (filters.company) qs.set("company", filters.company);
  if (filters.level) qs.set("level", filters.level);
  if (filters.specialization) qs.set("specialization", filters.specialization);
  const q = qs.toString();
  return apiFetch<JdSummary[]>(`${JOB_ENDPOINTS.list}${q ? `?${q}` : ""}`);
}

export function getJd(id: string): Promise<JdDetail> {
  return apiFetch<JdDetail>(JOB_ENDPOINTS.byId(id));
}

export function listJobCompanies(): Promise<JobCompany[]> {
  return apiFetch<JobCompany[]>(JOB_ENDPOINTS.companies);
}
