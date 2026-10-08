import { apiFetch } from "@/lib/api-client/client";
import { BLUEPRINT_ENDPOINTS } from "@/lib/constants/blueprints";
import type {
  AnswerKeyList,
  BlueprintBenchCandidate,
  BlueprintBenchRequest,
  BlueprintDiff,
  BlueprintRunDetail,
  BlueprintRunFilters,
  BlueprintRunList,
  BlueprintRunStarted,
  BlueprintVersionList,
} from "./types";

export function listBlueprintRuns(filters: BlueprintRunFilters = {}): Promise<BlueprintRunList> {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
  const qs = q.toString();
  return apiFetch<BlueprintRunList>(qs ? `${BLUEPRINT_ENDPOINTS.runs}?${qs}` : BLUEPRINT_ENDPOINTS.runs);
}

export function getBlueprintRun(id: string): Promise<BlueprintRunDetail> {
  return apiFetch<BlueprintRunDetail>(BLUEPRINT_ENDPOINTS.run(id));
}

export function rerunBlueprint(id: string, body: { bypassAnswerKeyCache?: boolean; ignoreExclusions?: boolean }): Promise<BlueprintRunStarted> {
  return apiFetch<BlueprintRunStarted>(BLUEPRINT_ENDPOINTS.rerun(id), { method: "POST", json: body });
}

export function startBlueprintBench(body: BlueprintBenchRequest): Promise<BlueprintRunStarted> {
  return apiFetch<BlueprintRunStarted>(BLUEPRINT_ENDPOINTS.bench, { method: "POST", json: body });
}

export function listBenchCandidates(): Promise<BlueprintBenchCandidate[]> {
  return apiFetch<BlueprintBenchCandidate[]>(BLUEPRINT_ENDPOINTS.candidates);
}

export function listBlueprintVersions(sessionId: string): Promise<BlueprintVersionList> {
  return apiFetch<BlueprintVersionList>(BLUEPRINT_ENDPOINTS.versions(sessionId));
}

export function diffBlueprintVersions(sessionId: string, from: number, to: number): Promise<BlueprintDiff> {
  return apiFetch<BlueprintDiff>(BLUEPRINT_ENDPOINTS.diff(sessionId, from, to));
}

export function getAnswerKeys(roundType: string, slug: string): Promise<AnswerKeyList> {
  return apiFetch<AnswerKeyList>(BLUEPRINT_ENDPOINTS.answerKeys(roundType, slug));
}
