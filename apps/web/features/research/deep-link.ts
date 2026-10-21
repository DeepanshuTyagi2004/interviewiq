/** The Intelligence page's URL state: ?tab=&run=&company=&span= (spec §9.1 deep links). */

export const INTELLIGENCE_TABS = ["companies", "runs", "problems", "prep", "evaluations", "diagnostics", "access", "live-profile"] as const;
export type IntelligenceTab = (typeof INTELLIGENCE_TABS)[number];

export interface DeepLink {
  tab: IntelligenceTab;
  run: string | null;
  company: string | null;
  span: string | null;
}

interface ParamsLike {
  get(name: string): string | null;
}

export function parseDeepLink(params: ParamsLike): DeepLink {
  const raw = params.get("tab");
  const run = params.get("run") || null;
  const tab = (INTELLIGENCE_TABS as readonly string[]).includes(raw ?? "") ? (raw as IntelligenceTab) : run ? "runs" : "companies";
  return { tab, run, company: params.get("company") || null, span: params.get("span") || null };
}

export function deepLinkHref(current: URLSearchParams, patch: Partial<DeepLink>): string {
  const next = new URLSearchParams(current);
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === undefined || value === "") next.delete(key);
    else next.set(key, value);
  }
  const qs = next.toString();
  return qs ? `?${qs}` : "?";
}
