import { cleanText, number, object, sortedUnique, textList } from "./sanitization.js";
import { validTimestamp } from "./adapters.js";
import { composite } from "./subFeatures.js";
import type { InternshipRecord, ScoringConfig } from "./types.js";

/**
 * Structured internship records from a trusted local adapter (a future verified source). Resume
 * internships are scored as profile items instead (`semantic.ts`). Factor values are explicit
 * observations; none is ever derived from the employer's name or prestige.
 */
const FACTORS = ["roleRelevance", "technicalDepth", "ownership", "productionExposure", "scale", "impact", "practices", "outcome", "companyContext"] as const;
/** Record factor -> shared internship sub-feature key (same keys the semantic layer produces). */
export const INTERNSHIP_FACTOR_KEYS: Record<(typeof FACTORS)[number] | "duration", string> = {
  roleRelevance: "role_relevance", technicalDepth: "technical_depth", ownership: "ownership", productionExposure: "production_exposure",
  scale: "scale", impact: "impact", practices: "engineering_practices", outcome: "outcome", companyContext: "company_context", duration: "duration",
};
const bounded = (raw: unknown, max = 100) => { const n = number(raw); return n === null || n > max ? null : n; };

export function sanitizeInternship(raw: unknown, identities: string[] = []): InternshipRecord {
  const value = object(raw);
  return {
    company: cleanText(value.company, identities), title: cleanText(value.title ?? value.role, identities), role: cleanText(value.role ?? value.title, identities),
    startDate: validTimestamp(value.startDate) ? new Date(value.startDate).toISOString() : cleanText(value.startDate),
    endDate: validTimestamp(value.endDate) ? new Date(value.endDate).toISOString() : cleanText(value.endDate),
    employmentType: cleanText(value.employmentType), domain: cleanText(value.domain), technologies: textList(value.technologies, identities),
    project: cleanText(value.project, identities), responsibilities: textList(value.responsibilities, identities),
    durationMonths: bounded(value.durationMonths, 120),
    ...Object.fromEntries(FACTORS.map((key) => [key, bounded(value[key])])),
    observedAt: validTimestamp(value.observedAt) ? new Date(value.observedAt).toISOString() : null,
    source: "self_reported",
  };
}
export function sanitizeInternships(raw: unknown, identities: string[] = []): InternshipRecord[] {
  return sortedUnique(Array.isArray(raw) ? raw.slice(0, 100).map((item) => sanitizeInternship(item, identities)) : []);
}

export interface InternshipMeasure { factor: string; rawValue: number; normalizedValue: number; weight: number }
export interface NormalizedInternship { record: InternshipRecord; measures: InternshipMeasure[]; score: number | null; completeness: number }

/** Duration has diminishing returns; company context is capped by the composite policy. */
export function normalizeInternship(raw: unknown, config: ScoringConfig, asOf?: string): NormalizedInternship {
  const record = sanitizeInternship(raw), weights = config.v5Policy!.subFeatures.internship_experience!.default, measures: InternshipMeasure[] = [];
  const duration = record.durationMonths ?? durationMonths(record.startDate, record.endDate, asOf);
  if (duration !== null) measures.push({ factor: "duration", rawValue: duration,
    normalizedValue: 100 * (1 - Math.pow(0.5, duration / config.normalizers.internshipDurationHalfLifeMonths!)), weight: weights.duration ?? 0 });
  for (const factor of FACTORS) {
    const amount = record[factor], key = INTERNSHIP_FACTOR_KEYS[factor];
    if (amount !== null && amount !== undefined) measures.push({ factor: key, rawValue: amount, normalizedValue: amount, weight: weights[key] ?? 0 });
  }
  // Existence plus dates is not internship quality: without one substantive factor there is no score.
  const substantive = measures.filter((x) => !["duration", "company_context"].includes(x.factor));
  if (!substantive.length) return { record, measures, score: null, completeness: 0 };
  const result = composite(weights, measures.map((x) => ({ key: x.factor, value: x.normalizedValue, evidenceIds: [] })));
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  return { record, measures, score: result?.score ?? null, completeness: measures.reduce((sum, x) => sum + x.weight, 0) / total };
}

export const normalizeInternshipRecord = normalizeInternship;

function durationMonths(start: string | null | undefined, end: string | null | undefined, asOf?: string): number | null {
  if (!start || !end) return null;
  const startDate = monthIndex(start), endDate = /^(?:present|current|now)$/i.test(end) ? asOf ? monthIndex(asOf) : null : monthIndex(end);
  return startDate !== null && endDate !== null && endDate >= startDate ? endDate - startDate + 1 : null;
}

function monthIndex(value: string): number | null {
  const match = /^(\d{4})-(\d{2})/.exec(value);
  if (!match) return null;
  const year = Number(match[1]), month = Number(match[2]);
  return year >= 1970 && month >= 1 && month <= 12 ? year * 12 + month - 1 : null;
}
