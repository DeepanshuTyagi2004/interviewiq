import { apiFetch } from "@/lib/api-client/client";
import { JOB_ENDPOINTS } from "@/lib/constants/jobs";
import type { JdDetail, JdFitBreakdown, JdFitList, JdSummary, JobCompany } from "./types";
import type { EngineeringLevel } from "@/lib/constants/engineering-levels";

/**
 * Simulated practice never supplies evidence or pay facts. Its experience range is the level's
 * typical one (shown as "typical for level"), not a company requirement.
 */
function honestTemplate<T extends JdSummary | JdDetail>(jd: T): T {
  return jd.practiceTemplate ? { ...jd, dataConfidence: null, dataAvailability: "none", ctcMinLpa: null, ctcMaxLpa: null } : jd;
}

type JdFilters = { company?: string; level?: EngineeringLevel; specialization?: string };

function filterQuery(filters: JdFilters): string {
  const qs = new URLSearchParams();
  if (filters.company) qs.set("company", filters.company);
  if (filters.level) qs.set("level", filters.level);
  if (filters.specialization) qs.set("specialization", filters.specialization);
  const q = qs.toString();
  return q ? `?${q}` : "";
}

export function listJds(filters: JdFilters = {}): Promise<JdSummary[]> {
  return apiFetch<JdSummary[]>(`${JOB_ENDPOINTS.list}${filterQuery(filters)}`).then((jds) => jds.map(honestTemplate));
}

/** The signed-in user's fit score per role, for the same filters as `listJds`. */
export function listJdFit(filters: JdFilters = {}): Promise<JdFitList> {
  return apiFetch<JdFitList>(`${JOB_ENDPOINTS.fit}${filterQuery(filters)}`);
}

export function getJdFit(id: string): Promise<JdFitBreakdown> {
  return apiFetch<JdFitBreakdown>(JOB_ENDPOINTS.fitById(id));
}

export function getJd(id: string): Promise<JdDetail> {
  return apiFetch<JdDetail>(JOB_ENDPOINTS.byId(id)).then(honestTemplate);
}

export function listJobCompanies(): Promise<JobCompany[]> {
  return apiFetch<JobCompany[]>(JOB_ENDPOINTS.companies);
}
