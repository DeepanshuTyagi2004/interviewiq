import { apiFetch } from "@/lib/api-client/client";
import {
  ADMIN_COMPANY_ENDPOINTS,
  ADMIN_USER_ENDPOINTS,
  INTELLIGENCE_ENDPOINTS,
} from "@/lib/constants/intelligence";
import type { Role } from "@/lib/hooks/useCurrentUser";
import type {
  AdminUser,
  BriefDoc,
  BriefSummary,
  CompanyWithJds,
  CreateCompanyInput,
  QuestionFilters,
  QuestionsResponse,
  ScrapeStatus,
  TriggerResponse,
} from "./types";

/** POST — trigger a Perplexity brief-generation run (returns immediately). */
export function triggerScrape(): Promise<TriggerResponse> {
  return apiFetch<TriggerResponse>(INTELLIGENCE_ENDPOINTS.scrapeRun, {
    method: "POST",
  });
}

/** POST — trigger a question-set collection run (returns immediately; watch via scrape status). */
export function triggerCollect(): Promise<TriggerResponse> {
  return apiFetch<TriggerResponse>(INTELLIGENCE_ENDPOINTS.collectRun, {
    method: "POST",
  });
}

/** POST — stop the active run (halts after the current JD). */
export function stopScrape(): Promise<{ stopping: boolean; status: string }> {
  return apiFetch<{ stopping: boolean; status: string }>(INTELLIGENCE_ENDPOINTS.scrapeStop, {
    method: "POST",
  });
}

/** GET — current run state + verbose logs. */
export function getScrapeStatus(after = 0): Promise<ScrapeStatus> {
  return apiFetch<ScrapeStatus>(
    `${INTELLIGENCE_ENDPOINTS.scrapeStatus}?after=${after}`,
  );
}

/** GET — summaries of every persisted brief (what's already been generated). */
export function listBriefs(): Promise<{ briefs: BriefSummary[] }> {
  return apiFetch<{ briefs: BriefSummary[] }>(INTELLIGENCE_ENDPOINTS.briefs);
}

/** POST — delete ALL generated briefs (destructive). Catalogue untouched. */
export function clearBriefs(): Promise<{ deleted: number }> {
  return apiFetch<{ deleted: number }>(INTELLIGENCE_ENDPOINTS.briefsClear, { method: "POST" });
}

/** GET — the full persisted brief for one JD (company/role/level/specialization). */
export function getBrief(
  company: string,
  role: string,
  level: string,
  specialization: string,
): Promise<BriefDoc> {
  const path = [company, role, level, specialization].map(encodeURIComponent).join("/");
  return apiFetch<BriefDoc>(`${INTELLIGENCE_ENDPOINTS.briefs}/${path}`);
}

/** GET — all users (admin only). */
export function listUsers(): Promise<AdminUser[]> {
  return apiFetch<AdminUser[]>(ADMIN_USER_ENDPOINTS.list);
}

/** PATCH — promote/demote a user (admin only). */
export function updateUserRole(id: string, role: Role): Promise<AdminUser> {
  return apiFetch<AdminUser>(ADMIN_USER_ENDPOINTS.role(id), {
    method: "PATCH",
    json: { role },
  });
}

/** GET — the company/JD catalogue (admin only). */
export function listCompanies(): Promise<CompanyWithJds[]> {
  return apiFetch<CompanyWithJds[]>(ADMIN_COMPANY_ENDPOINTS.list);
}

/** POST — add a company + its JDs; triggers Perplexity ingestion for them. */
export function createCompany(input: CreateCompanyInput): Promise<unknown> {
  return apiFetch(ADMIN_COMPANY_ENDPOINTS.create, { method: "POST", json: input });
}

/** DELETE — remove a company and all its JDs. */
export function deleteCompany(company: string): Promise<unknown> {
  return apiFetch(ADMIN_COMPANY_ENDPOINTS.byCompany(company), { method: "DELETE" });
}

/** POST — load the starter catalogue (6 companies × 3 JDs). Idempotent. */
export function seedCompanies(): Promise<{ inserted: number; backfilled: number; total: number }> {
  return apiFetch(ADMIN_COMPANY_ENDPOINTS.seed, { method: "POST" });
}

/** GET — paginated question bank with optional filters. */
export function listQuestions(f: QuestionFilters = {}): Promise<QuestionsResponse> {
  const q = new URLSearchParams();
  if (f.roundType) q.set("roundType", f.roundType);
  if (f.company) q.set("company", f.company);
  if (f.difficulty) q.set("difficulty", f.difficulty);
  q.set("limit", String(f.limit ?? 100));
  return apiFetch<QuestionsResponse>(`${INTELLIGENCE_ENDPOINTS.questions}?${q.toString()}`);
}
