import { apiFetch } from "@/lib/api-client/client";
import type { components } from "@/lib/api-client/generated/schema";
import { RESEARCH_ENDPOINTS } from "@/lib/constants/research";

export type EnrichmentDocument = components["schemas"]["EnrichmentDocument"];
export type EnrichmentRole = components["schemas"]["EnrichmentRole"];
export type EnrichmentRound = components["schemas"]["EnrichmentRound"];
export type EnrichmentResponse = components["schemas"]["EnrichmentResponse"];
export type EnrichmentWriteRequest = components["schemas"]["EnrichmentWriteRequest"];
export type EnrichmentPrefillRequest = components["schemas"]["EnrichmentPrefillRequest"];

export const enrichmentKey = (id: string) => ["research", "enrichment", id] as const;
const endpoint = (id: string) => `${RESEARCH_ENDPOINTS.company(id)}/enrichment`;
export const getEnrichment = (id: string) => apiFetch<EnrichmentResponse>(endpoint(id));
export const prefillEnrichment = (id: string, body: EnrichmentPrefillRequest) => apiFetch<EnrichmentResponse>(`${endpoint(id)}/prefill`, { method: "POST", json: body });
export const saveEnrichment = (id: string, body: EnrichmentWriteRequest) => apiFetch<EnrichmentResponse>(endpoint(id), { method: "PUT", json: body });
export const publishEnrichment = (id: string, body: EnrichmentWriteRequest) => apiFetch<EnrichmentResponse>(`${endpoint(id)}/publish`, { method: "POST", json: body });

export function newRole(): EnrichmentRole {
  return { id: crypto.randomUUID(), title: "", role: "", level: "", specialization: null, description: "", techStack: [], yoeMin: null, yoeMax: null, ctcMinLpa: null, ctcMaxLpa: null, sourceUrls: [], verified: false, rounds: [] };
}

export function newRound(): EnrichmentRound {
  return { id: crypto.randomUUID(), name: "", type: "dsa", durationMinutes: 45, difficulty: "medium", topics: [], questions: [], guidance: "", sourceUrls: [], verified: false };
}

/** Array order is the only persisted topology; every adjacent pair has exactly one edge. */
export function roundEdges(rounds: EnrichmentRound[]) {
  return rounds.slice(1).map((round, index) => ({ id: `${rounds[index]!.id}->${round.id}`, source: rounds[index]!.id, target: round.id }));
}

export function moveRound(rounds: EnrichmentRound[], id: string, delta: -1 | 1): EnrichmentRound[] {
  const index = rounds.findIndex((round) => round.id === id);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= rounds.length) return rounds;
  const next = [...rounds];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}

const cleanLines = (values: string[]) => values.map((v) => v.trim()).filter(Boolean);
export function cleanDocument(document: EnrichmentDocument): EnrichmentDocument {
  return { company: { ...document.company, sourceUrls: cleanLines(document.company.sourceUrls) }, roles: document.roles.map((role) => ({ ...role, techStack: cleanLines(role.techStack), sourceUrls: cleanLines(role.sourceUrls), rounds: role.rounds.map((round) => ({ ...round, topics: cleanLines(round.topics), questions: cleanLines(round.questions), sourceUrls: cleanLines(round.sourceUrls) })) })) };
}

export function publicationIssues(document: EnrichmentDocument): string[] {
  const issues: string[] = [];
  const sources = (values: string[], label: string) => {
    const urls = cleanLines(values);
    if (!urls.length) issues.push(`${label}: add at least one source URL.`);
    else if (urls.some((value) => { try { const url = new URL(value); return !["http:", "https:"].includes(url.protocol) || !!url.username || !!url.password || /\s/.test(value); } catch { return true; } })) issues.push(`${label}: use valid http(s) source URLs without credentials.`);
  };
  sources(document.company.sourceUrls, "Company");
  if (!document.company.overview.trim()) issues.push("Add a company overview.");
  if (!document.company.verified) issues.push("Verify company information.");
  if (!document.roles.length) issues.push("Add at least one role profile and interview sequence.");
  for (const [index, role] of document.roles.entries()) {
    const label = role.title || `Role ${index + 1}`;
    sources(role.sourceUrls, label);
    if (![role.title, role.role, role.level, role.description].every((value) => value.trim())) issues.push(`${label}: complete the title, role, level and job description.`);
    if (!role.verified) issues.push(`${label}: verify the role profile.`);
    if (!role.rounds.length) issues.push(`${label}: add at least one round.`);
    for (const [i, round] of role.rounds.entries()) {
      sources(round.sourceUrls, `${label}, round ${i + 1}`);
      if (!round.name.trim() || !round.verified) issues.push(`${label}, round ${i + 1}: name and verify the round.`);
      if (!Number.isInteger(round.durationMinutes) || round.durationMinutes < 1 || round.durationMinutes > 240) issues.push(`${label}, round ${i + 1}: duration must be 1–240 minutes.`);
    }
    if (role.yoeMin !== null && role.yoeMax !== null && role.yoeMin > role.yoeMax) issues.push(`${label}: minimum experience cannot exceed maximum.`);
    if (role.ctcMinLpa !== null && role.ctcMaxLpa !== null && role.ctcMinLpa > role.ctcMaxLpa) issues.push(`${label}: minimum compensation cannot exceed maximum.`);
  }
  return issues;
}
