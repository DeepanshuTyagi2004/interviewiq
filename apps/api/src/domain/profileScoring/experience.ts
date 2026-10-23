import type { ScoringProfile } from "./types.js";

/** Month precision, UTC, with inclusive month intervals. Invalid dates never become tenure. */
export function experienceMonths(profile: ScoringProfile | null, asOf: string): { months: number; warnings: string[] } {
  const warnings: string[] = [], ranges: [number, number][] = [];
  const now = new Date(asOf), current = now.getUTCFullYear() * 12 + now.getUTCMonth();
  for (const [index, entry] of (profile?.experience ?? []).entries()) {
    const start = parseMonth(entry.startDate), end = /^(?:present|current(?:ly)?|now|ongoing|till (?:date|now|present)|to (?:date|present))$/i.test(entry.endDate?.trim() ?? "") ? current : parseMonth(entry.endDate);
    const exactFuture = [entry.startDate, entry.endDate].some((date) => date && /^\d{4}-\d{2}-\d{2}$/.test(date) && Date.parse(date) > Date.parse(asOf));
    const exactReversed = entry.startDate && entry.endDate && /^\d{4}-\d{2}-\d{2}$/.test(entry.startDate) && /^\d{4}-\d{2}-\d{2}$/.test(entry.endDate) && Date.parse(entry.startDate) > Date.parse(entry.endDate);
    if (start === null || end === null || start > end || start > current || end > current || exactFuture || exactReversed) {
      warnings.push(`experience[${index}]: invalid, future, reversed or missing dates excluded from tenure`); continue;
    }
    ranges.push([start, end]);
  }
  ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const union: [number, number][] = [];
  for (const range of ranges) {
    const previous = union.at(-1);
    if (previous && range[0] <= previous[1] + 1) previous[1] = Math.max(previous[1], range[1]); else union.push([...range]);
  }
  return { months: union.reduce((sum, [start, end]) => sum + end - start + 1, 0), warnings };
}

function parseMonth(value: string | null): number | null {
  if (!value) return null;
  const text = value.trim();
  let year: number, month: number;
  const iso = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(text);
  if (iso) {
    year = Number(iso[1]); month = iso[2] ? Number(iso[2]) : 1;
    if (iso[3]) { const day = Number(iso[3]); if (day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return null; }
  } else {
    // Resume parsers emit "Sept. 2023", "Jan. 2024" and "Sep 2023" alike; the first three letters decide the month.
    const named = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s+(\d{4})$/i.exec(text);
    if (!named) return null;
    month = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(named[1]!.toLowerCase()) + 1;
    year = Number(named[2]);
  }
  return year >= 1970 && month >= 1 && month <= 12 ? year * 12 + month - 1 : null;
}

export interface SemanticClaim { component: string; score: number; claim: string; path: string; scope: "individual" | "service" | "cross_team" | "organization" }
/** Conjunctive sentence-level patterns, strongest claim only. Titles and lists of buzzwords do not qualify. */
export function semanticClaims(profile: ScoringProfile | null): SemanticClaim[] {
  const claims: SemanticClaim[] = [];
  const entries = [
    ...(profile?.experience ?? []).flatMap((entry, i) => (entry.bullets ?? []).map((claim, j) => ({ claim, path: `profile.experience[${i}].bullets[${j}]` }))),
    ...(profile?.projects ?? []).flatMap((entry, i) => [
      ...(entry.description ? [{ claim: entry.description, path: `profile.projects[${i}].description` }] : []),
      ...(entry.bullets ?? []).map((claim, j) => ({ claim, path: `profile.projects[${i}].bullets[${j}]` })),
    ]),
  ];
  const artifact = /\b(?:service|system|api|application|app|pipeline|platform|database|deployment|infrastructure|feature|library|compiler|engine|incident|latency|throughput|reliability)\b/i;
  const architectureObject = /\b(?:service|system|platform|database|infrastructure|architecture|pipeline)\b/i;
  for (const entry of entries) {
    // Do not combine unrelated bullets into synthetic senior evidence.
    for (const sentence of entry.claim.split(/(?<=[.!?])\s+/)) {
      if (/\b(?:not|never|aspire|aspiring|want to|plan to|would|hope to|learning to|observed|assisted)\b/i.test(sentence)) continue;
      const claim = sentence, scope = /\b(?:organization[- ]wide|organisation[- ]wide|company[- ]wide|enterprise[- ]wide)\b/i.test(claim) ? "organization"
        : /\b(?:cross[- ]team|multiple teams|\d+ teams|across teams)\b/i.test(claim) ? "cross_team"
        : architectureObject.test(claim) ? "service" : "individual";
      const add = (component: string, score: number) => claims.push({ ...entry, claim, component, score, scope });
      const delivery = /\b(?:deploy(?:ed|ment)?|production|launch(?:ed)?|ship(?:ped)?)\b/i.test(claim);
      const tests = /\b(?:test(?:ed|s|ing)?|unit tests|integration tests|ci\/cd)\b/i.test(claim);
      if (/\b(?:built|implemented|developed|delivered|shipped)\b/i.test(claim) && artifact.test(claim)) add("implementation", delivery && tests ? 85 : delivery ? 70 : 45);
      if (/\b(?:owned|led|drove|responsible for)\b/i.test(claim) && artifact.test(claim)) add("ownership", /\b(?:end[- ]to[- ]end|on[- ]call|incident response|slo|sla)\b/i.test(claim) ? 85 : 65);
      if (/\b(?:reduced|increased|improved|cut|saved|scaled|decreased)\b/i.test(claim) && artifact.test(claim)
        && /\d+(?:\.\d+)?\s*(?:%|ms\b|milliseconds\b|seconds\b|rps\b|requests\b|users\b|hours\b|x\b|percent\b)/i.test(claim)) add("impact", 80);
      if (/\b(?:designed|architected|migrated|redesigned)\b/i.test(claim) && architectureObject.test(claim)
        && /\b(?:trade[- ]offs?|consistency|availability|fault[- ]toleran\w*|partition\w*|shard\w*|reliability|scalability|distributed|event[- ]driven)\b/i.test(claim)) add("architecture", 80);
      if ((scope === "cross_team" || scope === "organization") && /\b(?:led|aligned|mentored|established|drove|adopted|standardized)\b/i.test(claim)
        && /\b(?:design|technical|engineering|architecture|standards|platform|migration)\b/i.test(claim)) add("cross_team", scope === "organization" ? 85 : 75);
      if (scope === "organization" && /\b(?:defined|established|led|drove|set)\b/i.test(claim)
        && /\b(?:technical strategy|technology strategy|technical roadmap|engineering roadmap)\b/i.test(claim)
        && /\b(?:adopted|investment|migration|business|multi[- ]year|portfolio)\b/i.test(claim)) add("strategy", 85);
    }
  }
  return claims;
}

/** V2-only: explicit cited contribution + independent adoption + quantified engineering outcome.
 * A citation is still a self-reported claim, never verification or an automatic seniority promotion.
 */
export function industryContributionClaims(profile: ScoringProfile | null): SemanticClaim[] {
  const entries = [
    ...(profile?.experience ?? []).flatMap((entry, i) => (entry.bullets ?? []).map((claim, j) => ({ claim, path: `profile.experience[${i}].bullets[${j}]` }))),
    ...(profile?.projects ?? []).flatMap((entry, i) => [
      ...(entry.description ? [{ claim: entry.description, path: `profile.projects[${i}].description` }] : []),
      ...(entry.bullets ?? []).map((claim, j) => ({ claim, path: `profile.projects[${i}].bullets[${j}]` })),
    ]),
  ];
  return entries.flatMap((entry) => entry.claim.split(/(?<=[.!?])\s+/).flatMap((claim): SemanticClaim[] => {
    if (/\b(?:not|never|aspire|aspiring|want to|plan to|would|hope to|learning to|observed|assisted)\b/i.test(claim)) return [];
    const adoption = /\badopted by\s+(\d+)\s+independent\s+(?:organizations|organisations|companies)\b/i.exec(claim);
    if (!/\b(?:authored|co-authored|standardized|standardised)\b/i.test(claim) || !/\bRFC[ -]?\d{3,5}\b/i.test(claim)
      || !adoption || Number(adoption[1]) < 2
      || !/\b(?:reduced|increased|improved|cut|saved|scaled|decreased)\b/i.test(claim)
      || !/\b(?:latency|throughput|reliability|platform|system|service|infrastructure)\b/i.test(claim)
      || !/\d+(?:\.\d+)?\s*(?:%|ms\b|rps\b|requests\b|hours\b|percent\b)/i.test(claim)) return [];
    return [{ ...entry, claim, component: "industry_contribution", score: 70, scope: "organization" }];
  }));
}
