import { apiFetch } from "@/lib/api-client/client";
import { INTERVIEW_AGENT_ENDPOINTS as E } from "@/lib/constants/observability";
import type { AgentSession, AgentSessionSummary, SubmitTurnBody } from "./types";

export function startAgentSession(plan: unknown) {
  return apiFetch<{ run_id: string; status: string }>(E.run, { method: "POST", json: plan });
}
export function submitTurn(runId: string, body: SubmitTurnBody) {
  return apiFetch<{ status: string }>(E.turnOf(runId), { method: "POST", json: body });
}
export function getAgentSession(runId: string, after = 0) {
  return apiFetch<AgentSession>(`${E.runOf(runId)}?after=${after}`);
}
export function listAgentSessions() {
  return apiFetch<{ runs: AgentSessionSummary[] }>(E.runs);
}
export function endAgentSession(runId: string) {
  return apiFetch<{ status: string }>(E.endOf(runId), { method: "POST" });
}
