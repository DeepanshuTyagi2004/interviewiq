/**
 * Extensible company-context knowledge-base contract. Company context is only a small supporting
 * input (capped by policy at <=5% of any composite); the work actually performed remains the
 * primary signal. Scores come from engineering-relevant facts (engineering scale, product vs.
 * services, technical domains, stage, internship selectivity), never from a name, logo or
 * placement tier, so "Google = high" / "unknown company = low" cannot happen.
 */
export interface CompanyKnowledgeBaseEntry {
  name: string;
  industry: string | null;
  companySize: string | null;
  engineeringSize: string | null;
  productType: string | null;
  technicalDomains: string[];
  knownTechnologies: string[];
  internshipProgram: string | null;
  /** 0-100, only when evidenced (published acceptance rates, documented selection process). */
  internshipSelectivity: number | null;
  geographicScope: string | null;
  companyStage: string | null;
  evidenceSources: string[];
  observedAt: string | null;
  /** Stated headcounts behind the size bands, and their source quote (explainable size). */
  companyHeadcount?: number | null;
  engineeringHeadcount?: number | null;
  sizeEvidence?: string | null;
}

export interface CompanyContextScore {
  rawValue: number;
  normalizedValue: number;
  capped: boolean;
  evidenceType: "DIRECT" | "DERIVED" | "INFERRED" | "SELF_REPORTED";
}

/** Apply the policy cap so context can never substitute for demonstrated internship work. */
export function scoreCompanyContext(value: number, cap = 10): CompanyContextScore {
  const rawValue = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
  const normalizedValue = Math.min(rawValue, Math.max(0, cap) * 10);
  return { rawValue, normalizedValue, capped: normalizedValue !== rawValue, evidenceType: "DERIVED" };
}

/** First number in a free-text headcount ("About 2,277 (one source)", "1,001-5,000", "~300,000"). */
export function headcount(text: string | null | undefined): number | null {
  const match = /(\d[\d,]*)/.exec(text ?? "");
  const value = match ? Number.parseInt(match[1]!.replace(/,/g, ""), 10) : NaN;
  return Number.isFinite(value) && value > 0 ? value : null;
}

const SIZE_BANDS: [number, number][] = [[10, 20], [50, 35], [200, 50], [1000, 65], [5000, 78], [20000, 85], [Infinity, 88]];
function sizeScore(text: string | null): number | null {
  if (!text) return null;
  const words: Record<string, number> = { tiny: 20, small: 35, medium: 55, large: 75, enterprise: 85 };
  const word = Object.keys(words).find((key) => new RegExp(`\\b${key}\\b`, "i").test(text));
  const value = headcount(text);
  return value !== null ? SIZE_BANDS.find(([limit]) => value <= limit)![1] : word ? words[word]! : null;
}
function productScore(text: string | null): number | null {
  if (!text) return null;
  if (/\b(?:product|platform|saas|consumer[- ]internet|marketplace|infrastructure|developer tools?)\b/i.test(text)) return 70;
  if (/\b(?:services?|consult\w*|outsourc\w*|staffing|it services)\b/i.test(text)) return 45;
  if (/\b(?:non[- ]tech\w*|retail|manufacturing|agency)\b/i.test(text)) return 30;
  return null;
}
function stageScore(text: string | null): number | null {
  if (!text) return null;
  if (/\b(?:public|listed|enterprise)\b/i.test(text)) return 70;
  if (/\b(?:late[- ]stage|growth|series [c-z])\b/i.test(text)) return 65;
  if (/\b(?:series [ab]|early)\b/i.test(text)) return 55;
  if (/\b(?:seed|pre[- ]seed|bootstrapped|startup)\b/i.test(text)) return 45;
  return null;
}

/**
 * Deterministic 0-100 context from an entry's engineering-relevant fields (mean of what is known).
 * Unknown fields are skipped, not zero; an entry with nothing known yields null (unavailable).
 */
export function companyContextFromEntry(entry: CompanyKnowledgeBaseEntry): { value: number } | null {
  const parts = [
    // The exact stated headcount when known, else the band.
    sizeScore(entry.engineeringHeadcount ? String(entry.engineeringHeadcount) : entry.engineeringSize) ?? sizeScore(entry.companyHeadcount ? String(entry.companyHeadcount) : entry.companySize),
    productScore(entry.productType) ?? productScore(entry.industry),
    entry.technicalDomains.length ? Math.min(85, 35 + 10 * entry.technicalDomains.length) : null,
    stageScore(entry.companyStage),
    entry.internshipSelectivity !== null && Number.isFinite(entry.internshipSelectivity) ? Math.max(0, Math.min(100, entry.internshipSelectivity)) : null,
  ].filter((x): x is number => x !== null);
  if (!parts.length) return null;
  return { value: Math.round(parts.reduce((a, b) => a + b, 0) / parts.length * 100) / 100 };
}

/** Normalized lookup key: lowercase, punctuation/legal suffixes stripped. */
export function companyKey(name: string): string {
  return name.toLowerCase().replace(/&/g, " and ").replace(/\b(?:pvt|private|ltd|limited|inc|llc|llp|corp|corporation|technologies|technology|solutions|labs?)\b\.?/g, " ")
    .replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, "-").slice(0, 120);
}
