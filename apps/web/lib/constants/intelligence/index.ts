/**
 * Constants for the Interview Intelligence (scraping/ingestion) admin module.
 * Import per group, e.g. `import { INTELLIGENCE_ENDPOINTS } from "@/lib/constants/intelligence";`
 *
 * These are ADMIN-only surfaces on the backend; the browser reaches the AI service
 * only through these interviewiq-api proxy endpoints.
 */

export const INTELLIGENCE_ENDPOINTS = {
  scrapeRun: "/api/v1/intelligence/scrape/run",
  scrapeStop: "/api/v1/intelligence/scrape/stop",
  scrapeStatus: "/api/v1/intelligence/scrape/status",
  briefs: "/api/v1/intelligence/briefs",
  briefsClear: "/api/v1/intelligence/briefs/clear",
  collectRun: "/api/v1/intelligence/questions/collect",
  questions: "/api/v1/intelligence/questions",
} as const;

/** Admin user-management endpoints (promote/demote). */
export const ADMIN_USER_ENDPOINTS = {
  list: "/api/v1/admin/users",
  role: (id: string) => `/api/v1/admin/users/${id}/role`,
} as const;

/** Admin company/JD catalogue endpoints (the ingestion targets). */
export const ADMIN_COMPANY_ENDPOINTS = {
  list: "/api/v1/admin/companies",
  create: "/api/v1/admin/companies",
  seed: "/api/v1/admin/companies/seed",
  byCompany: (company: string) => `/api/v1/admin/companies/${encodeURIComponent(company)}`,
} as const;

export const INTELLIGENCE_QUERY_KEYS = {
  scrapeStatus: ["intelligence", "scrape-status"] as const,
  users: ["intelligence", "users"] as const,
  companies: ["intelligence", "companies"] as const,
  questions: ["intelligence", "questions"] as const,
} as const;

export const INTELLIGENCE_POLLING = {
  /** Live ingestion view polls run status + logs at this cadence while mounted. */
  statusIntervalMs: 1500,
} as const;
