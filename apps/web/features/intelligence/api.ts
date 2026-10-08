import { apiFetch } from "@/lib/api-client/client";
import {
  ADMIN_USER_ENDPOINTS,
  INTELLIGENCE_ENDPOINTS,
} from "@/lib/constants/intelligence";
import type { Role } from "@/lib/hooks/useCurrentUser";
import type {
  AdminUser,
  BriefDoc,
  BriefSummary,
  QuestionFilters,
  QuestionsResponse,
  ScrapeStatus,
  TriggerResponse,
  QuestionBankPage,
  QuestionBankStats,
  QuestionGenerateResponse,
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

function questionQuery(f: QuestionFilters): string {
  const q = new URLSearchParams();
  if (f.roundType) q.set("roundType", f.roundType);
  if (f.company) q.set("company", f.company);
  if (f.difficulty) q.set("difficulty", f.difficulty);
  if (f.contentStatus) q.set("contentStatus", f.contentStatus);
  if (f.topic) q.set("topic", f.topic);
  if (f.includeContent) q.set("includeContent", "true");
  q.set("limit", String(f.limit ?? 100));
  return q.toString();
}

/** GET — paginated question bank with optional filters. */
export function listQuestions(f: QuestionFilters = {}): Promise<QuestionsResponse> {
  return apiFetch<QuestionsResponse>(`${INTELLIGENCE_ENDPOINTS.questions}?${questionQuery(f)}`);
}

/** GET — the problem bank with each problem's content (docs/question-bank.md). */
export function listProblemBank(f: QuestionFilters = {}): Promise<QuestionBankPage> {
  return apiFetch<QuestionBankPage>(`${INTELLIGENCE_ENDPOINTS.questions}?${questionQuery({ ...f, includeContent: true })}`);
}

/** GET — counts per round type and content status. */
export function getQuestionBankStats(): Promise<QuestionBankStats> {
  return apiFetch<QuestionBankStats>(INTELLIGENCE_ENDPOINTS.questionStats);
}

/** POST — start content generation over the index; progress via the shared scrape status. */
export function triggerQuestionGeneration(opts: { roundType?: string; limit?: number; force?: boolean } = {}): Promise<QuestionGenerateResponse> {
  const q = new URLSearchParams();
  if (opts.roundType) q.set("roundType", opts.roundType);
  if (opts.limit && opts.limit > 0) q.set("limit", String(opts.limit));
  if (opts.force) q.set("force", "true");
  const qs = q.toString();
  return apiFetch<QuestionGenerateResponse>(`${INTELLIGENCE_ENDPOINTS.questionGenerate}${qs ? `?${qs}` : ""}`, { method: "POST" });
}
