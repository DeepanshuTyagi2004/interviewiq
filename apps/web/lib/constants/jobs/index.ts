/** Constants for the Jobs (JD library) module. */
import type { EngineeringLevel } from "@/lib/constants/engineering-levels";
export const JOB_ENDPOINTS = {
  list: "/api/v1/jds",
  byId: (id: string) => `/api/v1/jds/${id}`,
  companies: "/api/v1/companies",
  fit: "/api/v1/jd-fit",
  fitById: (id: string) => `/api/v1/jd-fit/${id}`,
} as const;

export const JOB_QUERY_KEYS = {
  list: (filters: { company?: string; level?: EngineeringLevel; specialization?: string }) =>
    ["jobs", "list", filters] as const,
  detail: (id: string) => ["jobs", "detail", id] as const,
  companies: ["jobs", "companies"] as const,
  /** Under "jobs" so a catalogue refresh also refreshes fit. */
  fitList: (filters: { company?: string; level?: EngineeringLevel; specialization?: string }) =>
    ["jobs", "fit", "list", filters] as const,
  fitDetail: (id: string) => ["jobs", "fit", "detail", id] as const,
} as const;
