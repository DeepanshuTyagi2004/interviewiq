/** Constants for the Loops module (confirmed per-JD processes, saved custom processes, targets). */
export const LOOP_ENDPOINTS = {
  loops: "/api/v1/loops",
  loop: (id: string) => `/api/v1/loops/${id}`,
  processes: "/api/v1/processes",
  process: (id: string) => `/api/v1/processes/${id}`,
  duplicate: (id: string) => `/api/v1/processes/${id}/duplicate`,
  official: (jdId: string) => `/api/v1/processes/official/${jdId}`,
  targets: "/api/v1/targets",
  target: (jdId: string) => `/api/v1/targets/${jdId}`,
  jdStatus: (jdId: string) => `/api/v1/targets/status/${jdId}`,
} as const;

export const LOOP_QUERY_KEYS = {
  loops: ["loops", "list"] as const,
  loop: (id: string) => ["loops", "detail", id] as const,
  processes: ["loops", "processes"] as const,
  process: (id: string) => ["loops", "process", id] as const,
  official: (jdId: string) => ["loops", "official", jdId] as const,
  targets: ["loops", "targets"] as const,
  jdStatus: (jdId: string) => ["loops", "jd-status", jdId] as const,
} as const;
