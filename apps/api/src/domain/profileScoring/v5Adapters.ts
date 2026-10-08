import { ENGINEERING_LEVELS, type ScoringFragment, type ScoringInput, type ScoringConfig } from "./types.js";
import { normalizeCompetition, supportedCompetitionPlatforms } from "./competition.js";
import { sanitizeInternships } from "./internship.js";
import { validateLLMAssessments } from "./assessment.js";
import { sanitizeSemanticAssessments } from "./semantic.js";
import { sanitizeMergedPullRequests } from "./openSource.js";
import { cleanText, deepFreeze, hashJson, list, object, sortedUnique } from "./sanitization.js";
import { sanitizeFragmentData, sanitizeProfile, validTimestamp } from "./adapters.js";

/** Competition-result sources carry structured results (e.g. a future ICPC adapter), not ratings. */
const RESULT_SOURCES = new Set(["icpc", "competition_results"]);

function sanitizeV5Fragment(fragment: unknown, asOf: string, config: ScoringConfig, identities: string[]): ScoringFragment {
  const value = object(fragment), source = cleanText(value.source)?.toLowerCase() ?? "unknown";
  const fetchedAt = validTimestamp(value.fetchedAt) ? new Date(value.fetchedAt).toISOString() : "invalid";
  const raw = object(value.data);
  let data: Record<string, unknown> = {};
  const platform = cleanText(raw.platform)?.toLowerCase() ?? source;
  const competitionSource = [...supportedCompetitionPlatforms(), "competitive_programming", "other"].includes(platform) || Object.hasOwn(config.v5Policy?.competition.platforms ?? {}, platform);
  const competitionShape = Object.hasOwn(raw, "competition") || Object.hasOwn(raw, "schemaVersion") || Object.hasOwn(raw, "difficulty") || Object.hasOwn(raw, "contest");
  if (RESULT_SOURCES.has(source) && Array.isArray(raw.results)) {
    data = { results: raw.results.slice(0, 100) };
  } else if (source === "github") {
    // Languages for skill corroboration and merged external PRs for open source; READMEs never enter frozen scoring input.
    data = { ...sanitizeFragmentData("github", raw, config.version, identities), mergedPullRequests: sanitizeMergedPullRequests(raw.mergedPullRequests) };
  } else if (competitionSource || competitionShape) {
    const competition = normalizeCompetition(platform === "competitive_programming" || platform === "other" ? "generic" : platform, raw.competition ?? raw, fetchedAt);
    data = { platform: competition.platform, competition, ...(competition.partial ? { partial: true } : {}) };
  } else if (source === "internship" || source === "internships") {
    data = { internships: sanitizeInternships(Array.isArray(value.data) ? value.data : raw.internships ?? raw.records ?? raw, identities) };
  } else if (source === "llm_assessment" || source === "llm_assessments") {
    data = { assessments: validateLLMAssessments(Array.isArray(value.data) ? value.data : raw.assessments ?? raw) };
  } else if (source === "linkedin") {
    data = sanitizeFragmentData(source, value.data, config.version, identities);
  }
  return { source, data, contentHash: hashJson(data), fetchedAt };
}

export function normalizeV5ScoringInput(input: ScoringInput, config: ScoringConfig, identities: string[] = []): ScoringInput {
  if (!validTimestamp(input.asOf)) throw new Error("Scoring requires an explicit valid asOf");
  if (input.declaredLevel !== null && !ENGINEERING_LEVELS.includes(input.declaredLevel)) throw new Error("Invalid declared engineering level");
  const asOf = new Date(input.asOf).toISOString();
  const fragments = sortedUnique(list(input.fragments).map((fragment) => sanitizeV5Fragment(fragment, asOf, config, identities)));
  const selected = new Map<string, ScoringFragment>();
  for (const fragment of fragments) {
    const prior = selected.get(fragment.source), time = Date.parse(fragment.fetchedAt), priorTime = prior ? Date.parse(prior.fetchedAt) : NaN;
    const usable = Number.isFinite(time) && time <= Date.parse(asOf), priorUsable = Number.isFinite(priorTime) && priorTime <= Date.parse(asOf);
    if (!prior || (usable && !priorUsable) || (usable === priorUsable && time > priorTime)) selected.set(fragment.source, fragment);
  }
  const internshipFragments = [...selected.values()].flatMap((x) => x.source === "internship" || x.source === "internships" ? (Array.isArray(x.data.internships) ? x.data.internships : []) : []);
  const assessmentFragments = [...selected.values()].flatMap((x) => x.source === "llm_assessment" || x.source === "llm_assessments" ? (Array.isArray(x.data.assessments) ? x.data.assessments : []) : []);
  // Resume internships are scored as profile items (semantic.ts); deriving records from them here
  // would score an internship from its dates alone, i.e. as a binary existence signal.
  return deepFreeze({
    asOf, declaredLevel: input.declaredLevel, profile: sanitizeProfile(input.profile, identities),
    fragments: [...selected.values()].sort((a, b) => a.source.localeCompare(b.source)),
    internships: sanitizeInternships([...list(input.internships), ...internshipFragments], identities),
    llmAssessments: validateLLMAssessments([...list(input.llmAssessments), ...assessmentFragments]),
    semanticAssessments: sanitizeSemanticAssessments(input.semanticAssessments, config),
  });
}
