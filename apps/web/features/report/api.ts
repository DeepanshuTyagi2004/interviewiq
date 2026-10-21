import { apiFetch } from "@/lib/api-client/client";
import { REPORT_ENDPOINTS } from "@/lib/constants/report";
import type { CreateReportDisputeRequest, ReportDisputeStarted, RoundReport } from "./types";

/** GET /api/v1/interviews/sessions/{id}/report — the debrief (`status` evaluating|failed|legacy|ready). */
export function getReport(id: string): Promise<RoundReport> {
  return apiFetch<RoundReport>(REPORT_ENDPOINTS.report(id));
}

/** POST /api/v1/interviews/sessions/{id}/report/disputes — question one score; 202 `{status:"rechecking"}`. */
export function createDispute(id: string, body: CreateReportDisputeRequest): Promise<ReportDisputeStarted> {
  return apiFetch<ReportDisputeStarted>(REPORT_ENDPOINTS.disputes(id), { method: "POST", json: body });
}
