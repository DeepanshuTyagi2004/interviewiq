import type { CandidateProfileDoc, ProfileFragmentDoc } from "../../db/mongo/client.js";
import { normalizeLegacyLevel } from "../engineeringLevels.js";
import { ENGINEERING_LEVELS, type EngineeringLevel, type ScoringInput, type ScoringProfile, type SemanticItemAssessment } from "./types.js";
import { normalizeAchievement } from "./achievements.js";
import { cleanText, deepFreeze, hashJson, list, number, object, sortedUnique, textList } from "./sanitization.js";
import { sanitizeLinkedIn } from "./linkedin.js";
import { supportsLinkedIn } from "./config.js";
import { normalizeV5ScoringInput } from "./v5Adapters.js";
import { PROFILE_BETA_V5_SCORING_CONFIG } from "./config.js";

export function sanitizeProfile(profile: ScoringProfile | null, identities: string[] = []): ScoringProfile | null {
  if (!profile) return null;
  return {
    headline: cleanText(profile.headline, identities),
    // Education is preserved minimally for replay but is never numerically scored.
    education: sortedUnique(list(profile.education).map((raw) => { const x = object(raw); return {
      degree: cleanText(x.degree, identities), field: cleanText(x.field, identities), grade: cleanText(x.grade),
      startYear: cleanText(x.startYear), endYear: cleanText(x.endYear),
    }; })),
    experience: sortedUnique(list(profile.experience).map((raw) => { const x = object(raw); return {
      title: cleanText(x.title, identities), startDate: cleanText(x.startDate), endDate: cleanText(x.endDate), bullets: textList(x.bullets, identities),
    }; })),
    projects: sortedUnique(list(profile.projects).map((raw) => { const x = object(raw); return {
      name: cleanText(x.name, identities), description: cleanText(x.description, identities), tech: textList(x.tech, identities),
      bullets: textList(x.bullets, identities), link: null,
    }; })),
    skills: textList(profile.skills, identities), achievements: textList(profile.achievements, identities),
  };
}

/** Payload whitelist is intentionally independent of provider response size/shape. */
export function sanitizeFragmentData(source: string, raw: unknown, version = "profile-beta-v2", identities: string[] = []): Record<string, unknown> {
  const data = object(raw);
  const result: Record<string, unknown> = {};
  if (source === "github") {
    result.languages = sortedUnique(list(data.languages).map((raw) => {
      const x = object(raw); return { name: cleanText(x.name), bytes: number(x.bytes), pct: number(x.pct) };
    }).filter((x) => x.name && ((x.bytes !== null && Number.isInteger(x.bytes) && x.bytes > 0) || (x.pct !== null && x.pct > 0 && x.pct <= 100))));
    result.externalPRs = number(data.externalPRs);
    // Collector has no READMEs, merged PR state, dated activity or code quality: exclude topRepos/commits/stars.
  } else if (source === "leetcode") {
    const solved = object(data.solved), contest = object(data.contest), activity = object(data.recentActivity);
    const availability = object(data.scoringAvailability);
    const missing = list(availability.missingSolveBuckets);
    result.solved = Object.fromEntries(["easy", "medium", "hard"].map((key) => [key, missing.includes(key) ? null : number(solved[key])]));
    result.byTopic = sortedUnique(list(data.byTopic).map((raw) => { const x = object(raw); return { topic: cleanText(x.topic), count: number(x.count) }; }).filter((x) => x.topic && x.count !== null));
    result.contest = Object.keys(contest).length ? Object.fromEntries(["attended", "rating", "globalRanking", "totalParticipants", "topPercent"].map((key) => [key, number(contest[key])])) : null;
    result.partial = data.partial === true || missing.length > 0 || availability.recentActivity === false;
    // Existing collector does not identify the failed optional query. Conservatively drop recent activity for every partial snapshot.
    result.recentActivity = result.partial === true ? null : { last30Days: number(activity.last30Days), preferredLanguage: cleanText(activity.preferredLanguage), windowAsOf: cleanText(activity.windowAsOf) };
  } else if (source === "resume") {
    result.achievements = sortedUnique(list(data.achievements).map((value) => normalizeAchievement(value)).filter((x) => x !== null));
  } else if (source === "linkedin" && supportsLinkedIn(version)) {
    return sanitizeLinkedIn(data, identities, version);
  }
  return result;
}

export function normalizeScoringInput(input: ScoringInput, version = "profile-beta-v2", identities: string[] = []): ScoringInput {
  if (version === PROFILE_BETA_V5_SCORING_CONFIG.version) return normalizeV5ScoringInput(input, PROFILE_BETA_V5_SCORING_CONFIG, identities);
  if (!validTimestamp(input.asOf)) throw new Error("Scoring requires an explicit valid asOf");
  if (input.declaredLevel !== null && !ENGINEERING_LEVELS.includes(input.declaredLevel)) throw new Error("Invalid declared engineering level");
  const asOf = new Date(input.asOf).toISOString();
  const fragments = sortedUnique(list(input.fragments).map((raw) => {
    const fragment = object(raw), source = cleanText(fragment.source)?.toLowerCase() ?? "unknown";
    const data = sanitizeFragmentData(source, fragment.data, version, identities);
    const fetched = validTimestamp(fragment.fetchedAt) ? new Date(fragment.fetchedAt as string).toISOString() : "invalid";
    return { source, data, contentHash: hashJson(data), fetchedAt: fetched };
  }));
  // Unique source snapshots: newest valid observation not after asOf; deterministic hash tiebreak.
  const selected = new Map<string, typeof fragments[number]>();
  for (const fragment of fragments) {
    const prior = selected.get(fragment.source);
    const time = Date.parse(fragment.fetchedAt), priorTime = prior ? Date.parse(prior.fetchedAt) : NaN;
    const usable = Number.isFinite(time) && time <= Date.parse(asOf);
    const priorUsable = Number.isFinite(priorTime) && priorTime <= Date.parse(asOf);
    if (!prior || (usable && !priorUsable) || (usable === priorUsable && (time > priorTime || (!Number.isFinite(priorTime) && Number.isFinite(time))))) selected.set(fragment.source, fragment);
  }
  return deepFreeze({ asOf, declaredLevel: input.declaredLevel, profile: sanitizeProfile(input.profile), fragments: [...selected.values()].sort((a, b) => a.source < b.source ? -1 : a.source > b.source ? 1 : 0) });
}

export function validTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value) || !Number.isFinite(Date.parse(value))) return false;
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  return month! >= 1 && month! <= 12 && day! >= 1 && day! <= new Date(Date.UTC(year!, month!, 0)).getUTCDate();
}

/** Identity strings redacted from every scoring input (names, contacts, employers, institutions). */
export function scoringIdentities(profile: CandidateProfileDoc | null, version?: string, extra: string[] = []): string[] {
  return [...(profile ? [profile.fullName, profile.email, profile.phone, profile.location,
    ...profile.education.map((x) => x.institution), ...profile.experience.flatMap((x) => [x.company, x.location])].filter((x): x is string => !!x) : []),
    ...(version && supportsLinkedIn(version) ? extra : [])];
}

export function buildScoringInput(profile: CandidateProfileDoc | null, fragments: ProfileFragmentDoc[], opts: { asOf: string; declaredLevel: EngineeringLevel | null; version?: string; identities?: string[]; semanticAssessments?: SemanticItemAssessment[] }): ScoringInput {
  const identities = scoringIdentities(profile, opts.version, opts.identities ?? []);
  const declaredLevel = effectiveDeclaredLevel(profile, opts.declaredLevel);
  return normalizeScoringInput({ asOf: opts.asOf, declaredLevel, profile: sanitizeProfile(profile, identities), fragments: fragments.map((x) => ({
    source: x.source.toLowerCase(), data: x.data, contentHash: "", fetchedAt: x.fetchedAt instanceof Date && Number.isFinite(x.fetchedAt.getTime()) ? x.fetchedAt.toISOString() : "invalid",
  })), ...(opts.semanticAssessments?.length ? { semanticAssessments: opts.semanticAssessments } : {}) }, opts.version, identities);
}

/** Presence matters: an explicit null/unknown profile level must never resurrect an old setting. */
export function effectiveDeclaredLevel(profile: CandidateProfileDoc | null, fallback: EngineeringLevel | null): EngineeringLevel | null {
  return profile && Object.hasOwn(profile, "level") ? normalizeLegacyLevel(profile.level) : normalizeLegacyLevel(fallback);
}
