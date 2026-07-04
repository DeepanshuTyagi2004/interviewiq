/** Constants for the Jobs (JD library) module. */
export const JOB_ENDPOINTS = {
  list: "/api/v1/jds",
  byId: (id: string) => `/api/v1/jds/${id}`,
  companies: "/api/v1/companies",
} as const;

export const JOB_QUERY_KEYS = {
  list: (filters: { company?: string; level?: string; specialization?: string }) =>
    ["jobs", "list", filters] as const,
  detail: (id: string) => ["jobs", "detail", id] as const,
  companies: ["jobs", "companies"] as const,
} as const;
