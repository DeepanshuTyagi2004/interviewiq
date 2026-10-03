import { apiFetch } from "@/lib/api-client/client";
import { EVENTS_PAGE_LIMIT, RESEARCH_ENDPOINTS as E } from "@/lib/constants/research";
import type {
  AdminCompany, AdminCompanyList, CompanyDraftResponse, CreateCompanyRequest, ResearchBudgetUpdate, ResearchEvent, ResearchEventPage,
  ResearchLevel, ResearchRun, ResearchRunDetail, ResearchRunList, ResearchSpanDetailResponse, ResearchSpanList,
  RunAction, SeedResult, StartResearchRunRequest, UpdateCompanyRequest,
} from "./types";

export function listAdminCompanies(): Promise<AdminCompanyList> {
  return apiFetch<AdminCompanyList>(E.companies);
}

export function createCompany(body: CreateCompanyRequest): Promise<AdminCompany> {
  return apiFetch<AdminCompany>(E.companies, { method: "POST", json: body });
}

export function updateCompany(id: string, patch: UpdateCompanyRequest): Promise<AdminCompany> {
  return apiFetch<AdminCompany>(E.company(id), { method: "PATCH", json: patch });
}

export function deleteCompany(id: string): Promise<void> {
  return apiFetch<void>(E.company(id), { method: "DELETE" });
}

export function getCompanyDraft(companyId: string): Promise<CompanyDraftResponse> {
  return apiFetch<CompanyDraftResponse>(E.draft(companyId));
}

export function approveCompanyDraft(companyId: string, draftId: string, note?: string): Promise<AdminCompany> {
  return apiFetch<AdminCompany>(E.draftDecision(companyId, draftId, "approve"), { method: "POST", json: { note } });
}

export function rejectCompanyDraft(companyId: string, draftId: string, note?: string): Promise<void> {
  return apiFetch<void>(E.draftDecision(companyId, draftId, "reject"), { method: "POST", json: { note } });
}

export function seedCompanies(): Promise<SeedResult> {
  return apiFetch<SeedResult>(E.seed, { method: "POST" });
}

export function listRuns(limit = 20): Promise<ResearchRunList> {
  return apiFetch<ResearchRunList>(`${E.runs}?limit=${limit}`);
}

export function getRun(runId: string): Promise<ResearchRunDetail> {
  return apiFetch<ResearchRunDetail>(E.run(runId));
}

export function startRun(body: StartResearchRunRequest): Promise<ResearchRun> {
  return apiFetch<ResearchRun>(E.runs, { method: "POST", json: body });
}

export function controlRun(runId: string, action: RunAction): Promise<ResearchRun> {
  return apiFetch<ResearchRun>(E.control(runId, action), { method: "POST" });
}

export function raiseBudget(runId: string, body: ResearchBudgetUpdate): Promise<ResearchRun> {
  return apiFetch<ResearchRun>(E.budget(runId), { method: "PATCH", json: body });
}

export interface EventPageParams {
  afterSeq?: number;
  beforeSeq?: number;
  limit?: number;
  level?: ResearchLevel;
  spanId?: string;
}

export function listRunEvents(runId: string, params: EventPageParams = {}): Promise<ResearchEventPage> {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== null) qs.set(key, String(value));
  const s = qs.toString();
  return apiFetch<ResearchEventPage>(`${E.events(runId)}${s ? `?${s}` : ""}`);
}

export function listRunSpans(runId: string, companyId?: string | null): Promise<ResearchSpanList> {
  return apiFetch<ResearchSpanList>(`${E.spans(runId)}${companyId ? `?companyId=${encodeURIComponent(companyId)}` : ""}`);
}

export function getSpan(spanId: string): Promise<ResearchSpanDetailResponse> {
  return apiFetch<ResearchSpanDetailResponse>(E.span(spanId));
}

/** Everything needed to look at a run offline: the run, its items, every span and every event. */
export async function collectRunExport(runId: string) {
  const [detail, spans] = await Promise.all([getRun(runId), listRunSpans(runId)]);
  const events: ResearchEvent[] = [];
  let afterSeq = 0;
  for (;;) {
    const page = await listRunEvents(runId, { afterSeq, limit: EVENTS_PAGE_LIMIT });
    events.push(...page.events);
    if (page.events.length < EVENTS_PAGE_LIMIT) break;
    afterSeq = page.events[page.events.length - 1]!.seq;
  }
  return { exported_at: new Date().toISOString(), ...detail, spans: spans.spans, events };
}
