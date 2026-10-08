/**
 * Item-level sub-features: what can be read directly is computed here deterministically; what needs
 * semantic understanding (complexity, real ownership, production exposure, credibility of impact,
 * design trade-offs, role relevance) is requested from an LLM per item, in the candidate's level
 * context, and stored. The engine never calls an LLM: it only reads a stored assessment whose
 * item hash, level and prompt version match the item being scored, so an edited project or a level
 * change can never reuse a stale judgment.
 */
import type { ProfileScoringAssessmentRequest, ProfileScoringAssessmentResponse } from "../../integrations/aiService/types.js";
import { ENGINEERING_LEVELS, type EngineeringLevel, type ScoringConfig, type ScoringProfile, type SemanticItemAssessment, type SemanticItemType, type SemanticPolicy } from "./types.js";
import { cleanText, hashJson, list, number, object, textList } from "./sanitization.js";

export const INTERNSHIP_TITLE = /\b(?:intern|interns|internship|trainee|co[- ]?op|apprentice(?:ship)?)\b/i;
const QUANTIFIED = /\d+(?:\.\d+)?\s*(?:%|x\b|ms\b|milliseconds?\b|seconds?\b|minutes?\b|hours?\b|rps\b|qps\b|requests?\b|users?\b|customers?\b|downloads?\b|transactions?\b|records?\b|tb\b|gb\b|k\b|m\b|percent\b)/i;
const DEPLOYED = /\b(?:deploy(?:ed|ment)?|production|live|launched|shipped|released|hosted|in use by|used by|play store|app store)\b/i;
const TESTED = /\b(?:unit tests?|integration tests?|e2e|end[- ]to[- ]end tests?|test coverage|tested|jest|pytest|junit|ci\/cd|ci pipeline|github actions|code reviews?)\b/i;

export interface ProfileItem {
  type: SemanticItemType;
  /** Index in the sanitized (canonically ordered) profile array. */
  index: number;
  pathPrefix: string;
  title: string;
  content: Record<string, unknown>;
  hash: string;
  startDate: string | null;
  endDate: string | null;
  text: string[];
}

export function semanticItemHash(type: SemanticItemType, content: Record<string, unknown>): string {
  return hashJson({ type, content });
}

/** Sanitized profile -> scoreable items. Pure; the producer and the engine enumerate identically. */
export function profileItems(profile: ScoringProfile | null): ProfileItem[] {
  if (!profile) return [];
  const items: ProfileItem[] = [];
  profile.projects.forEach((entry, index) => {
    const content = { name: entry.name, description: entry.description, tech: [...(entry.tech ?? [])].sort(), bullets: [...(entry.bullets ?? [])].sort() };
    const text = [entry.description, ...(entry.bullets ?? [])].filter((x): x is string => !!x);
    if (!text.length && !entry.name) return;
    items.push({ type: "project", index, pathPrefix: `profile.projects[${index}]`, title: entry.name ?? `Project ${index + 1}`, content, hash: semanticItemHash("project", content), startDate: null, endDate: null, text });
  });
  profile.experience.forEach((entry, index) => {
    const type: SemanticItemType = INTERNSHIP_TITLE.test(entry.title ?? "") ? "internship" : "experience";
    const content = { title: entry.title, startDate: entry.startDate, endDate: entry.endDate, bullets: [...(entry.bullets ?? [])].sort() };
    const text = [...(entry.bullets ?? [])];
    if (!text.length && !entry.title) return;
    items.push({ type, index, pathPrefix: `profile.experience[${index}]`, title: entry.title ?? (type === "internship" ? "Internship" : "Role"), content, hash: semanticItemHash(type, content), startDate: entry.startDate, endDate: entry.endDate, text });
  });
  return items;
}

function monthIndex(value: string | null, asOf: string): number | null {
  if (!value) return null;
  const text = value.trim();
  if (/^(?:present|current|now|ongoing)$/i.test(text)) { const d = new Date(asOf); return d.getUTCFullYear() * 12 + d.getUTCMonth(); }
  const iso = /^(\d{4})(?:-(\d{2}))?/.exec(text);
  if (iso) { const month = iso[2] ? Number(iso[2]) : 1; return month >= 1 && month <= 12 ? Number(iso[1]) * 12 + month - 1 : null; }
  const named = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{4})$/i.exec(text);
  return named ? Number(named[2]) * 12 + ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(named[1]!.toLowerCase()) : null;
}

/** Inclusive months between dates; null when either end is unknown, reversed or in the future. */
export function itemMonths(item: Pick<ProfileItem, "startDate" | "endDate">, asOf: string): number | null {
  const start = monthIndex(item.startDate, asOf), end = monthIndex(item.endDate, asOf), now = monthIndex("present", asOf)!;
  return start !== null && end !== null && start <= end && end <= now ? end - start + 1 : null;
}

export interface DeterministicFeature { key: string; value: number; raw: unknown; evidenceType: "DERIVED" | "SELF_REPORTED" }

/**
 * Directly computable sub-features. Absence-of-mention is never scored as zero: delivery signals
 * and tech breadth appear only when present; durations only when dates are valid.
 */
export function deterministicItemFeatures(item: ProfileItem, asOf: string, config: ScoringConfig): DeterministicFeature[] {
  const n = config.normalizers, out: DeterministicFeature[] = [];
  const joined = item.text.join(" ");
  if (item.type === "project") {
    const tech = list(item.content.tech).length;
    if (tech) out.push({ key: "tech_stack_breadth", value: 100 * Math.min(1, tech / 6), raw: { technologies: tech }, evidenceType: "SELF_REPORTED" });
    const signals = { deployed: DEPLOYED.test(joined), tested: TESTED.test(joined), quantified: QUANTIFIED.test(joined) };
    const value = (signals.deployed ? 40 : 0) + (signals.tested ? 30 : 0) + (signals.quantified ? 30 : 0);
    if (value) out.push({ key: "delivery_signals", value, raw: signals, evidenceType: "SELF_REPORTED" });
    return out;
  }
  const months = itemMonths(item, asOf);
  if (item.type === "internship") {
    if (months !== null) {
      const season = /^\d{4}-(\d{2})/.exec(item.startDate ?? "")?.[1];
      out.push({ key: "duration", value: 100 * (1 - Math.pow(0.5, months / n.internshipDurationHalfLifeMonths!)), raw: { months, season: season ? Number(season) >= 4 && Number(season) <= 7 ? "summer" : Number(season) === 12 || Number(season) <= 2 ? "winter" : "other" : null }, evidenceType: "SELF_REPORTED" });
    }
  } else if (months !== null) {
    out.push({ key: "tenure", value: 100 * (1 - Math.pow(0.5, months / n.experienceTenureHalfLifeMonths!)), raw: { months }, evidenceType: "SELF_REPORTED" });
    const end = monthIndex(item.endDate, asOf), now = monthIndex("present", asOf)!;
    if (end !== null) out.push({ key: "recency", value: 100 * Math.pow(0.5, Math.max(0, now - end) / n.experienceRecencyHalfLifeMonths!), raw: { monthsSinceEnd: Math.max(0, now - end) }, evidenceType: "SELF_REPORTED" });
  }
  return out;
}

export interface AssessmentContext {
  targetRole: string | null;
  level: EngineeringLevel;
  specialization: string | null;
  yearsExperience: number | null;
}

/** One minimized item + the user's level context + that item type's semantic features. */
export function buildItemAssessmentRequest(item: ProfileItem, context: AssessmentContext, policy: SemanticPolicy, extraExcerpts: string[] = []): ProfileScoringAssessmentRequest {
  const clip = (value: string, max: number) => value.length > max ? value.slice(0, max) : value;
  const excerpts = packExcerpts([...item.text.filter((text) => text !== item.content.description), ...extraExcerpts], 8, 800);
  const evidence = {
    id: `${item.type}:${item.hash.slice(0, 12)}`, title: clip(item.title, 500),
    summary: typeof item.content.description === "string" ? clip(item.content.description, 1000) : null,
    technologies: list(item.content.tech).filter((x): x is string => typeof x === "string").slice(0, 20).map((x) => clip(x, 500)),
    outcomes: [], excerpts,
  };
  return {
    userContext: { targetRole: context.targetRole ? clip(context.targetRole, 120) : null, declaredLevel: context.level, specialization: context.specialization, yearsExperience: context.yearsExperience },
    projects: item.type === "project" ? [evidence] : [], experience: item.type === "experience" ? [evidence] : [], internships: item.type === "internship" ? [evidence] : [],
    requestedFeatures: policy.features[item.type].map((feature) => ({ key: feature.key, description: feature.description })),
  };
}

/**
 * Lines packed in order into at most `slots` excerpts of up to `max` characters (joined by
 * newlines), so a long bullet list is not cut off by the slot count: the lines are canonically
 * (alphabetically) ordered, so a plain cut would drop whichever bullets sort last. A single
 * over-long line is clipped.
 */
export function packExcerpts(lines: string[], slots: number, max: number): string[] {
  const out: string[] = [];
  for (const line of lines) {
    const text = line.length > max ? line.slice(0, max) : line;
    const last = out.at(-1);
    if (last !== undefined && last.length + 1 + text.length <= max) out[out.length - 1] = `${last}\n${text}`;
    else if (out.length < slots) out.push(text);
  }
  return out;
}

/** Context hash: everything besides the item that changes the judgment (level, prompt, README, features). */
export function assessmentContextHash(request: ProfileScoringAssessmentRequest, promptVersion: string): string {
  return hashJson({ request, promptVersion });
}

/**
 * Response -> stored assessment. A feature with no quoted evidence is unavailable (dropped), not
 * zero; a quoted 0 (e.g. a non-technical role) is kept as real evidence.
 */
export function toSemanticAssessment(response: ProfileScoringAssessmentResponse, item: ProfileItem, level: EngineeringLevel, policy: SemanticPolicy): SemanticItemAssessment {
  const allowed = new Set(policy.features[item.type].map((feature) => feature.key));
  return {
    itemType: item.type, itemHash: item.hash, level, promptVersion: policy.promptVersion,
    features: response.assessments.filter((a) => allowed.has(a.feature) && a.evidenceExcerpts.length > 0).map((a) => ({
      key: a.feature, value: Math.round(a.value * 100) / 100,
      excerpts: a.evidenceExcerpts.slice(0, 3).map((x) => x.slice(0, 300)), rationale: a.rationale.slice(0, 300),
    })),
    companyContext: null, assessedAt: response.generatedAt, model: response.model,
  };
}

/** Engine-side validation of stored assessments: whitelisted keys, bounded values, quoted evidence. */
export function sanitizeSemanticAssessments(raw: unknown, config: ScoringConfig): SemanticItemAssessment[] {
  const policy = config.v5Policy?.semantic;
  if (!policy) return [];
  return list(raw).slice(0, 80).flatMap((entry) => {
    const value = object(entry), itemType = value.itemType as SemanticItemType;
    if (!Object.hasOwn(policy.features, itemType) || typeof value.itemHash !== "string" || !/^[a-f0-9]{64}$/.test(value.itemHash)
      || !(ENGINEERING_LEVELS as readonly string[]).includes(String(value.level)) || typeof value.promptVersion !== "string") return [];
    const allowed = new Set(policy.features[itemType].map((feature) => feature.key)), seen = new Set<string>();
    const features = list(value.features).map(object).flatMap((feature) => {
      const key = String(feature.key), v = number(feature.value);
      if (!allowed.has(key) || seen.has(key) || v === null || v > 100) return [];
      const excerpts = textList(feature.excerpts).slice(0, 3).map((x) => x.slice(0, 300));
      if (!excerpts.length) return [];
      seen.add(key);
      return [{ key, value: v, excerpts, rationale: cleanText(feature.rationale)?.slice(0, 300) ?? null }];
    }).sort((a, b) => a.key < b.key ? -1 : 1);
    const company = object(value.companyContext), cv = number(company.value);
    return [{ itemType, itemHash: value.itemHash, level: value.level as EngineeringLevel, promptVersion: value.promptVersion.slice(0, 80), features,
      companyContext: cv !== null && cv <= 100 ? { value: cv, source: cleanText(company.source)?.slice(0, 40) ?? "knowledge-base" } : null,
      assessedAt: cleanText(value.assessedAt), model: cleanText(value.model)?.slice(0, 120) ?? null }];
  }).sort((a, b) => a.itemHash < b.itemHash ? -1 : a.itemHash > b.itemHash ? 1 : 0);
}

/** The stored assessment usable for this item at this level, if any. */
export function matchingAssessment(item: ProfileItem, level: EngineeringLevel, assessments: SemanticItemAssessment[], policy: SemanticPolicy): SemanticItemAssessment | null {
  return assessments.find((a) => a.itemType === item.type && a.itemHash === item.hash && a.level === level && a.promptVersion === policy.promptVersion) ?? null;
}
