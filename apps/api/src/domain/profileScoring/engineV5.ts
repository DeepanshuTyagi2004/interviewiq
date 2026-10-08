import type { EngineDebugSink, EngineeringLevel, ScoreClassification, ScoreComponent, ScoreEvaluation, ScoreEvidence, ScoreSource, ScoringConfig, ScoringInput } from "./types.js";
import { COMPONENT_LABELS } from "./config.js";
import { normalizeV5ScoringInput } from "./v5Adapters.js";
import { normalizeCompetition, PROBLEM_SOLVING_SIGNALS, scoreCompetitionSignals } from "./competition.js";
import { collectorResults, extractCompetitionResults, scoreCompetitionResult, type CandidateCompetitionResult } from "./competitionResults.js";
import { INTERNSHIP_FACTOR_KEYS, normalizeInternship } from "./internship.js";
import { validateLLMAssessments } from "./assessment.js";
import { experienceMonths, semanticClaims, type SemanticClaim } from "./experience.js";
import { deterministicItemFeatures, matchingAssessment, profileItems, type ProfileItem } from "./semantic.js";
import { sanitizeMergedPullRequests, scoreOpenSource } from "./openSource.js";
import { aggregateItems, composite, fillMissing, levelWeights, type SubFeatureValue } from "./subFeatures.js";
import { compare, hashJson, list, object } from "./sanitization.js";
import { linkedInClaims } from "./linkedin.js";
import { validTimestamp } from "./adapters.js";

const clamp = (value: number) => Math.max(0, Math.min(100, value));
const round = (value: number) => Math.round(value * 100) / 100;
interface Signal { score: number; evidenceIds: string[] }

/** Item features that modify a score but are never on their own evidence of quality. */
const MODIFIER_FEATURES = new Set(["tech_stack_breadth", "delivery_signals", "duration", "tenure", "recency", "evidence_verification", "company_context"]);
const COMPOSITES = new Set(["problem_solving", "competitive_programming", "projects", "internship_experience", "professional_experience", "skills", "achievements", "open_source"]);

/**
 * Enhanced policy implementation, separate from the frozen v1-v4 path. Everything here is
 * deterministic: stored LLM item assessments are inputs, never computed or called here.
 * There is no confidence weighting: what the user's resume and connected sources say is taken
 * as correct (the user fixes anything wrong), so evidence only differs by what it measures.
 * `debug` (admin live trace only) receives every intermediate step; it never changes the result.
 */
export function evaluateProfileV5(raw: ScoringInput, config: ScoringConfig, debug?: EngineDebugSink): ScoreEvaluation {
  const input = normalizeV5ScoringInput(raw, config), policy = config.v5Policy!, evidence: ScoreEvidence[] = [], sources: ScoreSource[] = [], signals = new Map<string, Signal>();
  const warnings = ["Provisional beta assessment; not an interview result, hiring recommendation or validated measure of engineering ability."];
  const now = Date.parse(input.asOf);
  const addEvidence = (args: {
    source: string; path: string; claim: string; value: string | number; feature?: string; rawValue?: unknown; normalizedValue?: number | null;
    observedAt?: string | null; evidenceType?: ScoreEvidence["evidenceType"]; sourceMetadata?: ScoreEvidence["sourceMetadata"]; sourceUrl?: string | null;
  }) => {
    const item = { ...(args.feature ? { feature: args.feature } : {}), source: args.source, path: args.path, claim: args.claim, value: args.value, confidence: 100, observedAt: args.observedAt ?? null,
      verification: args.evidenceType === "DIRECT" || args.evidenceType === "DERIVED" ? "collector" as const : "self_reported" as const, recencyFactor: 1,
      rawValue: args.rawValue ?? args.value, normalizedValue: args.normalizedValue ?? null, scoreContribution: null,
      sourceMetadata: args.sourceMetadata ?? { platform: null, adapter: "profile-scoring-v5", observedAt: args.observedAt ?? null, retrievedAt: null, verificationMethod: null },
      evidenceType: args.evidenceType ?? "SELF_REPORTED", algorithmVersion: config.version, sourceUrl: args.sourceUrl ?? null, sourceTimestamp: args.observedAt ?? null };
    const id = hashJson(item).slice(0, 24);
    if (!evidence.some((entry) => entry.id === id)) evidence.push({ id, ...item });
    return id;
  };
  const addSignal = (component: string, score: number, ids: string[]) => {
    if (!ids.length) return;
    const signal = { score: clamp(score), evidenceIds: [...new Set(ids)].sort(compare) };
    const previous = signals.get(component);
    if (!previous || signal.score > previous.score) signals.set(component, signal);
  };
  const setComposite = (component: string, result: { score: number; evidenceIds: string[] } | null) => {
    if (result && result.evidenceIds.length) signals.set(component, { score: clamp(result.score), evidenceIds: [...new Set(result.evidenceIds)].sort(compare) });
  };
  const trace = (step: string, message: string, detail: Record<string, unknown> = {}) => { if (debug) debug({ step, message, detail }); };
  /**
   * Weighted composite, with its sub-feature breakdown reported to the debug sink. Under the current
   * policy every weighted sub-feature takes part: a missing one is 0 (see `fillMissing`).
   */
  const compose = (component: string, weights: Record<string, number>, values: SubFeatureValue[]) => {
    const result = composite(weights, policy.missingCountsAsZero ? fillMissing(weights, values, policy.alternatives?.[component]) : values);
    if (debug) {
      const total = result?.used.reduce((sum, row) => sum + row.weight, 0) ?? 0;
      const missing = result?.used.filter((row) => row.missing).length ?? 0;
      trace("composite", result ? `${component} = ${round(result.score)} from ${result.used.length} sub-feature(s)${missing ? `, ${missing} missing (counted as 0)` : ""}` : `${component}: no sub-feature has evidence`, {
        component, kind: "weighted", score: result ? round(result.score) : null, weights,
        used: (result?.used ?? []).map((row) => ({ key: row.key, value: round(row.value), weight: row.weight, share: total ? round(row.weight / total * 100) : 0, status: row.missing ? "missing" : "found" })),
        unavailable: Object.keys(weights).filter((key) => !result?.used.some((row) => row.key === key)),
      });
    }
    return result;
  };
  const usableLinkedIn = (fragment: typeof input.fragments[number]) => {
    const observed = Date.parse(fragment.fetchedAt), importAt = validTimestamp(fragment.data.importedAt) ? Date.parse(fragment.data.importedAt) : NaN;
    const retrievedAt = validTimestamp(fragment.data.retrievedAt) ? Date.parse(fragment.data.retrievedAt) : importAt;
    return Number.isFinite(observed) && observed <= now && Number.isFinite(importAt) && importAt <= observed
      && retrievedAt <= importAt && (now - retrievedAt) / 86_400_000 <= config.normalizers.observationHalfLifeDays!;
  };
  const linkedIn = input.fragments.filter((fragment) => fragment.source === "linkedin" && usableLinkedIn(fragment));
  const linkedInProfile = linkedIn.map((fragment) => object(fragment.data.profile));

  // --- 1. Deterministic resume/LinkedIn claims (also the level classifier's only input) ---
  const profileClaims = [...semanticClaims(input.profile), ...linkedIn.flatMap((fragment) => linkedInClaims(fragment.data))];
  const claimRows: { claim: SemanticClaim; id: string }[] = [];
  for (const claim of profileClaims) {
    const id = addEvidence({ source: claim.path.startsWith("fragments.linkedin") ? "linkedin" : "resume", path: claim.path, claim: claim.claim, value: claim.scope, feature: `${claim.component}_claim`,
      rawValue: claim.claim, normalizedValue: claim.score, evidenceType: "SELF_REPORTED" });
    claimRows.push({ claim, id });
  }
  const tenure = experienceMonths(input.profile, input.asOf);
  warnings.push(...tenure.warnings);
  const classification = classify(input.declaredLevel, profileClaims), level = input.declaredLevel ?? classification.assessedLevel;
  if (debug) {
    const items = profileItems(input.profile);
    trace("input", `Scoring at ${level} (${input.declaredLevel ? "selected by the user" : "no level selected; resume-claim reading"}) from ${input.fragments.length} source fragment(s) and ${items.length} resume item(s)`, {
      declaredLevel: input.declaredLevel, assessedLevel: classification.assessedLevel, level, classificationReasons: classification.reasons,
      fragments: input.fragments.map((fragment) => ({ source: fragment.source, fetchedAt: fragment.fetchedAt, contentHash: fragment.contentHash })),
      items: { project: items.filter((x) => x.type === "project").length, internship: items.filter((x) => x.type === "internship").length, experience: items.filter((x) => x.type === "experience").length },
      semanticAssessments: input.semanticAssessments?.length ?? 0, claims: profileClaims.map((claim) => ({ component: claim.component, scope: claim.scope, score: claim.score, path: claim.path })),
      tenureMonths: tenure.months, weights: config.weights[level],
    });
  }

  // --- 2. Competitive programming & DSA: every platform normalized independently ---
  const bySignal = new Map<string, { platform: string; value: number; id: string }[]>();
  const competitionResults: CandidateCompetitionResult[] = [];
  for (const fragment of input.fragments) {
    const observed = Date.parse(fragment.fetchedAt), age = Number.isFinite(observed) ? (now - observed) / 86_400_000 : null;
    if (fragment.source === "linkedin") {
      const importAt = validTimestamp(fragment.data.importedAt) ? Date.parse(fragment.data.importedAt) : NaN;
      const retrievedAt = validTimestamp(fragment.data.retrievedAt) ? Date.parse(fragment.data.retrievedAt) : importAt, usable = usableLinkedIn(fragment);
      sources.push({ source: "linkedin", status: usable ? fragment.data.partial === true ? "partial" : "available" : "missing", fetchedAt: usable ? fragment.fetchedAt : null,
        ageDays: usable ? round((now - retrievedAt) / 86_400_000) : null, contentHash: fragment.contentHash,
        importMethod: fragment.data.importMethod as ScoreSource["importMethod"], provider: fragment.data.provider as ScoreSource["provider"],
        importedAt: validTimestamp(fragment.data.importedAt) ? fragment.data.importedAt : null, retrievedAt: validTimestamp(fragment.data.retrievedAt) ? fragment.data.retrievedAt : null });
      if (!usable) warnings.push("linkedin: stale or invalid observation/import date; evidence excluded");
      continue;
    }
    if (Array.isArray(fragment.data.results)) {
      if (age !== null && age >= 0) competitionResults.push(...collectorResults(fragment.data.results, `fragments.${fragment.source}.results`));
      sources.push({ source: fragment.source, status: age !== null && age >= 0 ? "available" : "missing", fetchedAt: fragment.fetchedAt, ageDays: age === null ? null : round(age), contentHash: fragment.contentHash });
      continue;
    }
    if (object(fragment.data.competition).schemaVersion === "competition-v1") {
      if (age === null || age < 0) { warnings.push(`${fragment.source}: invalid or future observation date; evidence excluded`); continue; }
      const competition = normalizeCompetition(String(fragment.data.platform ?? fragment.source), object(fragment.data.competition), fragment.fetchedAt);
      const measures = scoreCompetitionSignals(competition, input.asOf, fragment.fetchedAt, config);
      for (const measure of measures) {
        const feature = measure.signal === "contest" ? `${competition.platform}_contest` : measure.signal;
        const id = addEvidence({ source: fragment.source, feature, path: `fragments.${fragment.source}.${measure.path}`, claim: `${measure.signal} normalized against ${competition.platform}'s own scale`,
          value: round(measure.normalizedValue), rawValue: measure.rawValue, normalizedValue: round(measure.normalizedValue),
          observedAt: fragment.fetchedAt, evidenceType: "DERIVED", sourceMetadata: { platform: competition.platform, adapter: competition.adapter, observedAt: fragment.fetchedAt, retrievedAt: fragment.fetchedAt, verificationMethod: "platform-normalizer" } });
        const rows = bySignal.get(measure.signal) ?? []; rows.push({ platform: competition.platform, value: measure.normalizedValue, id }); bySignal.set(measure.signal, rows);
      }
      sources.push({ source: fragment.source, status: fragment.data.partial === true ? "partial" : measures.length ? "available" : "missing", fetchedAt: fragment.fetchedAt, ageDays: round(age), contentHash: fragment.contentHash });
      trace("platform", `${fragment.source}: ${measures.length} signal(s) normalized on ${competition.platform}'s own scale`, {
        source: fragment.source, platform: competition.platform, adapter: competition.adapter, partial: competition.partial, ageDays: round(age),
        totals: { totalSolved: competition.totalSolved, difficulty: competition.difficulty, topics: competition.topics.length, contestsAttended: competition.contest.attended, rating: competition.contest.rating, maxRating: competition.contest.maxRating, percentile: competition.contest.percentile },
        measures: measures.map((measure) => ({ signal: measure.signal, value: round(measure.normalizedValue), raw: measure.rawValue })),
      });
    }
  }
  /**
   * Best platform per signal: each platform is independent evidence of ability, so a second platform
   * can never add volume, and a thin second account is weak evidence, not negative evidence.
   */
  const bestOf = (key: string, rows = bySignal.get(key) ?? []): SubFeatureValue | null => {
    if (!rows.length) return null;
    const top = rows.reduce((best, row) => row.value > best.value ? row : best);
    if (rows.length > 1) trace("best-of", `${key}: best of ${rows.length} platforms is ${top.platform} (${round(top.value)})`, { signal: key, chosen: top.platform, candidates: rows.map((row) => ({ platform: row.platform, value: round(row.value) })) });
    return { key, value: top.value, evidenceIds: rows.map((row) => row.id) };
  };
  const problemValues = PROBLEM_SOLVING_SIGNALS.map((key) => bestOf(key)).filter((x): x is SubFeatureValue => x !== null);
  const problemSolving = compose("problem_solving", levelWeights(config, "problem_solving", level) ?? {}, problemValues);
  setComposite("problem_solving", problemSolving);
  const missingDsa = problemSolving?.used.filter((row) => row.missing).map((row) => row.key) ?? [];
  if (missingDsa.length) warnings.push(`DSA: the connected platforms give no data for ${missingDsa.join(", ")}; those count as 0 (LeetCode, Codeforces and takeUforward can provide all of them)`);

  // Structured achievements: resume/LinkedIn lines read deterministically, scored by the knowledge base.
  const achievementLines = [
    ...(input.profile?.achievements ?? []).map((text, i) => ({ text, path: `profile.achievements[${i}]` })),
    ...linkedInProfile.flatMap((profile, f) => list(profile.achievements).filter((x): x is string => typeof x === "string").map((text, i) => ({ text, path: `fragments.linkedin[${f}].profile.achievements[${i}]` }))),
  ];
  competitionResults.push(...extractCompetitionResults(achievementLines));
  const currentYear = new Date(input.asOf).getUTCFullYear();
  const resultScores = new Map<string, { score: number; id: string }[]>();
  for (const result of competitionResults) {
    const scored = scoreCompetitionResult(result, config, currentYear);
    if (!scored) { warnings.push(`${result.evidencePath}: future-dated result excluded`); trace("competition-result", `${result.competitionId}: future-dated, excluded`, { result }); continue; }
    const bucket = result.kind === "cp_contest" ? "competition_results" : result.kind === "hackathon" ? "hackathons" : result.kind === "oss_program" ? "oss_programs" : "other_recognition";
    const id = addEvidence({ source: result.verificationStatus === "DIRECT" ? "competition_collector" : result.evidencePath.startsWith("fragments.linkedin") ? "linkedin" : "resume",
      feature: bucket, path: result.evidencePath, claim: `${result.competitionId}: ${result.status}${result.round ? ` (${result.round})` : ""}${result.rank !== null ? `, rank ${result.rank}${result.participants ? ` of ${result.participants}` : ""}` : ""}; permanent achievement`,
      value: round(scored.score), rawValue: result, normalizedValue: round(scored.score), evidenceType: result.verificationStatus,
      sourceMetadata: { platform: result.competitionId, adapter: "competition-results-v1", observedAt: null, verificationMethod: result.verificationStatus === "DIRECT" ? "collector" : "knowledge-base-match" } });
    const rows = resultScores.get(bucket) ?? []; rows.push({ score: scored.score, id }); resultScores.set(bucket, rows);
    trace("competition-result", `${result.competitionId}: ${result.status} -> ${round(scored.score)} (${bucket})`, { bucket, score: round(scored.score), result });
  }
  const resultValue = (key: string): SubFeatureValue | null => {
    const rows = resultScores.get(key) ?? [], score = aggregateItems(rows.map((row) => row.score), policy.itemAggregation.additionalItemWeights);
    return score === null ? null : { key, value: score, evidenceIds: rows.map((row) => row.id) };
  };
  const cpWeights = levelWeights(config, "competitive_programming", level) ?? {};
  const contestRows = bySignal.get("contest") ?? [];
  const cpValues = [
    ...contestRows.filter((row) => Object.hasOwn(cpWeights, `${row.platform}_contest`)).map((row) => ({ key: `${row.platform}_contest`, value: row.value, evidenceIds: [row.id] })),
    bestOf("other_contest", contestRows.filter((row) => !Object.hasOwn(cpWeights, `${row.platform}_contest`))),
    bestOf("contest_trajectory"), bestOf("contest_consistency"), bestOf("contest_recency"), bestOf("rating_stability"), resultValue("competition_results"),
  ].filter((x): x is SubFeatureValue => x !== null);
  setComposite("competitive_programming", compose("competitive_programming", cpWeights, cpValues));
  setComposite("achievements", compose("achievements", levelWeights(config, "achievements", level) ?? {}, ["hackathons", "oss_programs", "other_recognition"].map(resultValue).filter((x): x is SubFeatureValue => x !== null)));

  // --- 3. Items: deterministic sub-features + stored level-aware semantic sub-features ---
  const semanticByDimension = new Map<string, SubFeatureValue[]>();
  type ItemScore = { score: number; ids: string[]; title: string };
  const itemScores = { projects: [] as ItemScore[], internship_experience: [] as ItemScore[], professional_experience: [] as ItemScore[] };
  const componentFor = { project: "projects", internship: "internship_experience", experience: "professional_experience" } as const;
  const scoreItem = (item: { type: ProfileItem["type"]; pathPrefix: string; title: string }, values: SubFeatureValue[], semanticValues: SubFeatureValue[]) => {
    const component = componentFor[item.type];
    if (!values.some((value) => !MODIFIER_FEATURES.has(value.key))) {
      trace("item", `${item.type} "${item.title}": not scored (dates/keywords only, no assessed sub-feature)`, { component, path: item.pathPrefix, values: values.map((v) => ({ key: v.key, value: round(v.value) })) });
      return;
    }
    const weights = levelWeights(config, component, level) ?? {};
    // Every weighted feature of the item counts: one that was not found (AI saw no evidence, no dates,
    // no delivery signal, unknown employer) is 0, not left out of the item's average.
    const result = composite(weights, policy.missingCountsAsZero ? fillMissing(weights, values) : values);
    if (!result) return;
    if (debug) {
      const total = result.used.reduce((sum, row) => sum + row.weight, 0);
      const missing = result.used.filter((row) => row.missing).map((row) => row.key);
      trace("item", `${item.type} "${item.title}" = ${round(result.score)} -> ${component}${missing.length ? ` (${missing.length} feature(s) missing, counted as 0: ${missing.join(", ")})` : ""}`, { component, path: item.pathPrefix, score: round(result.score),
        used: result.used.map((row) => ({ key: row.key, value: round(row.value), weight: row.weight, share: total ? round(row.weight / total * 100) : 0, status: row.missing ? "missing" : "found" })),
        unavailable: Object.keys(weights).filter((key) => !result.used.some((row) => row.key === key)) });
    }
    itemScores[component].push({ score: result.score, ids: result.evidenceIds, title: item.title });
    if (item.type === "internship") {
      const factor = policy.internshipInExperience[level];
      if (factor) {
        itemScores.professional_experience.push({ score: result.score * factor, ids: result.evidenceIds, title: `${item.title} (internship x${factor})` });
        trace("item", `internship "${item.title}" also counts toward professional_experience at x${factor} = ${round(result.score * factor)}`, { factor, score: round(result.score * factor) });
      }
    }
    // The AI judgments behind each dimension: for an assessed item, every one it was asked for counts
    // and one without evidence is 0.
    const asked = new Set(policy.missingCountsAsZero && semanticValues.length ? (policy.semantic.features[item.type] ?? []).map((feature) => feature.key) : []);
    for (const [dimension, rule] of Object.entries(policy.semantic.dimensions)) {
      const found = semanticValues.filter((value) => rule.semanticFeatures.includes(value.key));
      const mapped = [...found, ...rule.semanticFeatures.filter((key) => asked.has(key) && !found.some((value) => value.key === key)).map((key) => ({ key, value: 0, evidenceIds: [] as string[] }))];
      if (!mapped.length) continue;
      const rows = semanticByDimension.get(dimension) ?? [];
      rows.push({ key: "semantic", value: mapped.reduce((a, b) => a + b.value, 0) / mapped.length, evidenceIds: mapped.flatMap((value) => value.evidenceIds) });
      semanticByDimension.set(dimension, rows);
    }
  };
  let semanticUsed = 0, semanticStale = 0;
  // Resume items with no current AI assessment (failed or not run): their AI-judged parts count as 0
  // (older configs left them out as pending).
  const unassessed = { project: 0, internship: 0, experience: 0 };
  for (const item of profileItems(input.profile)) {
    const values: SubFeatureValue[] = [], semanticValues: SubFeatureValue[] = [];
    for (const feature of deterministicItemFeatures(item, input.asOf, config)) {
      const id = addEvidence({ source: "resume", feature: feature.key, path: `${item.pathPrefix}.${feature.key}`, claim: `${item.type} ${feature.key.replace(/_/g, " ")} (computed directly)`,
        value: round(feature.value), rawValue: feature.raw, normalizedValue: round(feature.value), evidenceType: feature.evidenceType });
      values.push({ key: feature.key, value: feature.value, evidenceIds: [id] });
    }
    const assessment = matchingAssessment(item, level, input.semanticAssessments ?? [], policy.semantic);
    const stale = !assessment && (input.semanticAssessments ?? []).some((a) => a.itemType === item.type && a.itemHash === item.hash);
    if (stale) semanticStale++;
    trace("item-assessment", assessment ? `${item.type} "${item.title}": using stored assessment (${assessment.features.length} feature(s), ${assessment.model})`
      : stale ? `${item.type} "${item.title}": stored assessment is for another level or prompt version; not used` : `${item.type} "${item.title}": no stored assessment`,
      { itemType: item.type, itemHash: item.hash, path: item.pathPrefix, assessedAt: assessment?.assessedAt ?? null, promptVersion: assessment?.promptVersion ?? null,
        features: assessment?.features.map((f) => ({ key: f.key, value: f.value, excerpts: f.excerpts.length })) ?? [], companyContext: assessment?.companyContext ?? null });
    for (const feature of assessment?.features ?? []) {
      const id = addEvidence({ source: "semantic_assessment", feature: feature.key, path: `${item.pathPrefix}.semantic.${feature.key}`,
        claim: `${item.type} ${feature.key.replace(/_/g, " ")} judged for ${level}: ${feature.rationale ?? "see quoted evidence"}`, value: round(feature.value),
        rawValue: { excerpts: feature.excerpts }, normalizedValue: round(feature.value), evidenceType: "INFERRED", observedAt: assessment!.assessedAt,
        sourceMetadata: { adapter: "semantic-item-assessment", observedAt: assessment!.assessedAt, verificationMethod: "verbatim-excerpt-required", recordId: null } });
      const value = { key: feature.key, value: feature.value, evidenceIds: [id] };
      values.push(value); semanticValues.push(value);
    }
    if (assessment) semanticUsed++;
    else unassessed[item.type]++;
    if (assessment?.companyContext && item.type !== "project") {
      const id = addEvidence({ source: "company_knowledge_base", feature: "company_context", path: `${item.pathPrefix}.company_context`, claim: "Company engineering context (capped; never a substitute for the work itself)",
        value: round(assessment.companyContext.value), normalizedValue: round(assessment.companyContext.value), evidenceType: "INFERRED",
        sourceMetadata: { adapter: assessment.companyContext.source, observedAt: assessment.assessedAt, verificationMethod: "knowledge-base" } });
      values.push({ key: "company_context", value: assessment.companyContext.value, evidenceIds: [id] });
    }
    scoreItem(item, values, semanticValues);
  }
  if (semanticStale) warnings.push(`${semanticStale} item assessment(s) were made for a different level or prompt version and are not used until re-assessed`);
  const unassessedTotal = unassessed.project + unassessed.internship + unassessed.experience;
  if (policy.missingCountsAsZero) {
    if (unassessedTotal) warnings.push(`${unassessedTotal} resume item(s) have no AI assessment (it failed or has not run yet); everything judged from them counts as 0`);
  } else if (profileItems(input.profile).length && !semanticUsed) warnings.push("No current semantic item assessments; project, internship and experience quality are unknown until assessed, not zero");
  // Trusted structured internship records (future verified adapters) use the same sub-feature keys.
  for (const [index, record] of (input.internships ?? []).entries()) {
    const normalized = normalizeInternship(record, config, input.asOf), values: SubFeatureValue[] = [];
    for (const measure of normalized.measures) {
      const id = addEvidence({ source: "internship", feature: measure.factor, path: `input.internships[${index}].${measure.factor}`, claim: `Internship ${measure.factor.replace(/_/g, " ")}; company context is capped and never prestige-derived`,
        value: round(measure.normalizedValue), rawValue: measure.rawValue, normalizedValue: round(measure.normalizedValue), observedAt: normalized.record.observedAt, evidenceType: "SELF_REPORTED",
        sourceMetadata: { platform: "internship", adapter: "internship-v1", recordId: null, observedAt: normalized.record.observedAt, verificationMethod: "stored-local-record" } });
      values.push({ key: measure.factor, value: measure.normalizedValue, evidenceIds: [id] });
    }
    scoreItem({ type: "internship", pathPrefix: `input.internships[${index}]`, title: normalized.record.title ?? "Internship" },
      values, values.filter((value) => Object.values(INTERNSHIP_FACTOR_KEYS).includes(value.key) && !MODIFIER_FEATURES.has(value.key)));
  }
  if (input.internships?.length || profileItems(input.profile).some((item) => item.type === "internship")) {
    sources.push({ source: "internship", status: itemScores.internship_experience.length ? "available" : "partial", fetchedAt: null, ageDays: null, contentHash: hashJson(input.internships ?? []) });
  }
  for (const component of ["projects", "internship_experience", "professional_experience"] as const) {
    const rows = itemScores[component], score = aggregateItems(rows.map((row) => row.score), policy.itemAggregation.additionalItemWeights);
    if (score !== null) setComposite(component, { score, evidenceIds: rows.flatMap((row) => row.ids) });
    if (debug && score !== null) {
      // Best item counts fully; each further item adds a share of the remaining headroom.
      const sorted = [...rows].sort((a, b) => b.score - a.score), extra = policy.itemAggregation.additionalItemWeights;
      let running = 0;
      const used = sorted.map((row, i) => {
        const weight = i === 0 ? 1 : extra[i - 1] ?? 0, gain = i === 0 ? row.score : (100 - running) * weight * row.score / 100;
        running += gain;
        return { key: row.title, value: round(row.score), weight, share: score ? round(gain / score * 100) : 0 };
      });
      trace("composite", `${component} = ${round(score)} from ${rows.length} item(s): best item plus diminishing headroom`, { component, kind: "items", score: round(score), weights: { best: 1, further: extra }, used, unavailable: [] });
    }
  }

  // --- 4. Engineering dimensions: deterministic claim strength refined by item semantics ---
  for (const dimension of ["implementation", "ownership", "impact", "architecture", "cross_team", "strategy"]) {
    const claims = claimRows.filter((row) => row.claim.component === dimension), rule = policy.semantic.dimensions[dimension];
    const claimValue = claims.length ? { key: "claim", value: Math.max(...claims.map((row) => row.claim.score)), evidenceIds: claims.filter((row) => row.claim.score === Math.max(...claims.map((x) => x.claim.score))).map((row) => row.id) } : null;
    const semantic = semanticByDimension.get(dimension) ?? [];
    const semanticValue = semantic.length ? semantic.reduce((best, row) => row.value > best.value ? row : best) : null;
    if (!rule) { if (claimValue) setComposite(dimension, compose(dimension, { claim: 1 }, [claimValue])); continue; }
    // Fixed split: a missing claim or AI judgment (none given, AI failed or not run) counts as 0
    // (`compose` fills it) instead of letting the other part stand in for it.
    setComposite(dimension, compose(dimension, { claim: rule.claimWeight, semantic: rule.semanticWeight }, [claimValue, semanticValue].filter((x): x is SubFeatureValue => x !== null)));
  }

  // --- 5. Skills: listed skills corroborated by GitHub language bytes (collector evidence) ---
  const github = input.fragments.find((fragment) => fragment.source === "github");
  if (github) {
    const age = (now - Date.parse(github.fetchedAt)) / 86_400_000;
    if (Number.isFinite(age) && age >= 0) {
      const listed = new Set([...(input.profile?.skills ?? []), ...linkedInProfile.flatMap((profile) => list(profile.skills).filter((x): x is string => typeof x === "string"))].map((skill) => skill.toLowerCase()));
      const corroborated = list(github.data.languages).map(object).filter((lang) => typeof lang.name === "string" && listed.has(lang.name.toLowerCase()));
      if (corroborated.length) {
        const ids = corroborated.map((lang) => addEvidence({ source: "github", feature: "github_corroboration", path: "fragments.github.languages", claim: "Language bytes corroborate a listed skill, not proficiency",
          value: String(lang.name), normalizedValue: null, observedAt: github.fetchedAt, evidenceType: "DERIVED" }));
        setComposite("skills", compose("skills", levelWeights(config, "skills", level) ?? {}, [{ key: "github_corroboration", value: 55 + 10 * Math.min(3, corroborated.length), evidenceIds: ids }]));
      }
      // Open source: merged PRs to public repositories the user does not own, read from the collector.
      const oss = scoreOpenSource(sanitizeMergedPullRequests(github.data.mergedPullRequests), input.asOf, config);
      const ossValues = oss.measures.map((measure) => ({ key: measure.key, value: measure.value, evidenceIds: [addEvidence({ source: "github", feature: measure.key,
        path: `fragments.github.mergedPullRequests.${measure.key}`, claim: `Open source ${measure.key.replace(/_/g, " ")} from merged pull requests to other people's public repositories`,
        value: measure.value, rawValue: measure.raw, normalizedValue: measure.value, observedAt: github.fetchedAt, evidenceType: "DERIVED",
        sourceMetadata: { platform: "github", adapter: "open-source-v1", observedAt: github.fetchedAt, retrievedAt: github.fetchedAt, verificationMethod: "collector" } })] }));
      trace("open-source", `${oss.qualifying.length} qualifying merged PR(s), ${oss.excluded.length} not counted`, {
        qualifying: oss.qualifying.map((pr) => ({ repo: pr.repo, stars: pr.stars, lines: pr.additions + pr.deletions, files: pr.changedFiles, docsOnly: pr.docsOnly, mergedAt: pr.mergedAt })),
        excluded: oss.excluded, measures: oss.measures });
      setComposite("open_source", compose("open_source", levelWeights(config, "open_source", level) ?? {}, ossValues));
      if (oss.excluded.length) warnings.push(policy.missingCountsAsZero ? `${oss.excluded.length} merged pull request(s) not counted (trivial change)` : `${oss.excluded.length} merged pull request(s) not counted (repository below the star floor, or a trivial change)`);
      sources.push({ source: "github", status: "available", fetchedAt: github.fetchedAt, ageDays: round(age), contentHash: github.contentHash });
    }
  }

  // Legacy stored dimension-level assessments may only refine a linked deterministic component.
  for (const assessment of validateLLMAssessments(input.llmAssessments)) {
    const dimension = assessment.dimension, rule = policy.assessment;
    if (!rule.allowedDimensions.includes(dimension) || assessment.score > rule.maximumScore || COMPOSITES.has(dimension)) continue;
    const links = evidence.filter((item) => assessment.evidenceRefs.includes(item.id) || assessment.evidenceRefs.includes(item.path));
    if (!links.length) { warnings.push(`llm assessment ${dimension}: missing evidence link; ignored`); continue; }
    const id = addEvidence({ source: assessment.source ?? "stored_llm_assessment", path: `assessments.${dimension}`, claim: `Bounded inferred assessment linked to ${links.length} deterministic evidence item(s)`, value: assessment.score,
      rawValue: assessment.score, normalizedValue: assessment.score, evidenceType: "INFERRED", observedAt: assessment.assessedAt,
      sourceMetadata: { adapter: "stored-assessment-v1", observedAt: assessment.assessedAt, verificationMethod: "evidence-link-required" } });
    const deterministic = signals.get(dimension);
    const blended = deterministic ? deterministic.score * (1 - rule.maximumInfluence) + assessment.score * rule.maximumInfluence : assessment.score;
    addSignal(dimension, blended, [...(deterministic?.evidenceIds ?? []), id]);
    trace("legacy-assessment", `${dimension}: legacy stored assessment ${assessment.score} blended at ${rule.maximumInfluence}`, { dimension, assessment: assessment.score, deterministic: deterministic?.score ?? null, blended: round(blended) });
  }

  if (!sources.some((item) => item.source === "resume")) sources.push({ source: "resume", status: input.profile ? "available" : "missing", fetchedAt: null, ageDays: null, contentHash: input.profile ? hashJson(input.profile) : null });
  for (const source of ["leetcode", "codeforces", "codechef", "atcoder", "tuf", "internship", "linkedin", "github"]) if (!sources.some((item) => item.source === source)) sources.push({ source, status: "missing", fetchedAt: null, ageDays: null, contentHash: null });
  // --- 6. The overall score. Current policy (`formula: "weighted_sum"`): every weighted part is expected
  // at this level in proportion to its weight, like a hiring rubric: score = sum(weight x part score / 100),
  // a missing part counting as 0. Core parts are the ones nothing else stands in for (a gap is warned
  // about); the rest are extra credit, where a gap is a quiet 0 of its weight. Older saved configs
  // replay their own formula: core base + bonus lift (missing core 0; without missingCountsAsZero a
  // part still waiting for AI assessment was left out as pending).
  const weights = config.weights[level]!, core = new Set(policy.coreComponents[level] ?? Object.keys(weights));
  const weightedSum = policy.formula === "weighted_sum";
  // Parts with no value only because a resume item has no AI assessment (failed or not run).
  const awaitingAI = new Set<string>();
  if (unassessed.project) awaitingAI.add("projects");
  if (unassessed.internship) awaitingAI.add("internship_experience");
  if (unassessed.experience || (unassessed.internship && policy.internshipInExperience[level])) awaitingAI.add("professional_experience");
  if (unassessedTotal) for (const dimension of Object.keys(policy.semantic.dimensions)) awaitingAI.add(dimension);
  for (const id of [...awaitingAI]) if (signals.has(id)) awaitingAI.delete(id);
  const pending = policy.missingCountsAsZero ? new Set<string>() : awaitingAI;
  let numerator = 0, coreDenominator = 0, liftShare = 0;
  const counted = new Set<string>();
  for (const [id, weight] of Object.entries(weights)) {
    if (weightedSum) { numerator += weight * (signals.get(id)?.score ?? 0); coreDenominator += weight; counted.add(id); continue; }
    if (core.has(id)) {
      if (pending.has(id)) continue;
      numerator += weight * (signals.get(id)?.score ?? 0); coreDenominator += weight; counted.add(id);
    } else if (signals.has(id)) {
      liftShare += (weight / 100) * (signals.get(id)!.score / 100); counted.add(id);
    }
  }
  liftShare = Math.min(1, liftShare);
  const base = coreDenominator ? numerator / coreDenominator : null;
  // No score until at least one core part has evidence (nothing at all yet).
  const score = base !== null && [...core].some((id) => signals.has(id)) ? round(Math.min(100, weightedSum ? base : base + (100 - base) * liftShare)) : null;
  const components: ScoreComponent[] = Object.entries(weights).sort(([a], [b]) => compare(a, b)).map(([id, weight]) => {
    const signal = signals.get(id), isCore = core.has(id);
    const contribution = score === null || !counted.has(id) ? null
      : weightedSum ? round(weight * (signal?.score ?? 0) / 100)
      : isCore ? round((signal?.score ?? 0) * weight / coreDenominator * (1 - liftShare)) : round(weight * signal!.score / 100);
    return { id, label: COMPONENT_LABELS[id]!, weight, role: isCore ? "core" : "bonus", counted: counted.has(id), score: signal ? round(signal.score) : null,
      contribution, evidenceIds: signal?.evidenceIds ?? [], status: signal ? "available" : pending.has(id) ? "pending" : "missing" };
  });
  for (const component of components) {
    if (component.role === "core" && component.status === "missing") warnings.push(awaitingAI.has(component.id)
      ? `${component.label} has no AI assessment (it failed or has not run yet); it is required at ${level}, so it counts as 0`
      : `${component.label} has no evidence; it is core at ${level}, so it counts as 0`);
    if (component.role === "core" && component.status === "pending") warnings.push(`${component.label} is waiting for AI assessment and is left out until assessed`);
    if (weightedSum && component.role === "bonus" && component.status === "missing") warnings.push(`${component.label}: no evidence; extra credit at ${level} (${component.weight} of 100) not earned`);
  }
  // Evidence is taken as correct, so the evaluation is fully confident whenever it scores.
  const confidence = score === null ? 0 : 100;
  // Coverage: share of the level's core weight that has evidence (pending and missing parts do not).
  const coreWeight = [...core].reduce((sum, id) => sum + (weights[id] ?? 0), 0);
  const coverage = coreWeight ? round([...core].reduce((sum, id) => sum + (signals.has(id) ? weights[id] ?? 0 : 0), 0) / coreWeight * 100) : 0;
  const reasons: string[] = [], minimumCoverage = policy.minimumCoverageByLevel[level] ?? config.thresholds.minimumCoverage;
  if (coverage < minimumCoverage) reasons.push(`Coverage below ${minimumCoverage}% for ${level}`);
  if (score === null) reasons.push("No scoreable evidence");
  trace("formula", score === null ? "No core part has evidence yet; no score"
    : weightedSum ? `score = ${score} = sum(weight x part score / 100) over every part at ${level}; a missing part counts as 0 (${components.filter((c) => c.status === "missing").map((c) => c.id).join(", ") || "none missing"})`
    : `score = ${score} = base ${round(base!)} (core: sum(score x weight) / ${round(coreDenominator)}, missing = 0${pending.size ? ", pending left out" : ""}) + (100 - base) x ${round(liftShare * 100)}% bonus lift, at most 100`, {
    level, base: base === null ? null : round(base), coreWeight: round(coreDenominator), bonusLiftPercent: round(liftShare * 100), score, core: [...core], pending: [...pending],
    components: components.map((c) => ({ id: c.id, role: c.role, weight: c.weight, score: c.score, counted: c.counted, contribution: c.contribution, status: c.status })) });
  trace("eligibility", reasons.length ? `Not leaderboard-eligible: ${reasons.join("; ")}` : `Leaderboard-eligible (coverage ${coverage}% >= ${minimumCoverage}%)`, { coverage, minimumCoverage, eligible: reasons.length === 0, reasons });
  for (const component of components) for (const id of component.evidenceIds) { const item = evidence.find((entry) => entry.id === id); if (item) item.scoreContribution = component.contribution === null ? null : round(component.contribution / component.evidenceIds.length); }
  return { algorithmVersion: config.version, configHash: hashJson(config), inputHash: hashJson(input), asOf: input.asOf, status: score === null ? "insufficient_evidence" : "scored", score, confidence, coverage, level, classification, components,
    evidence: evidence.sort((a, b) => compare(a.id, b.id)), warnings: [...new Set(warnings)].sort(compare), eligibility: { eligible: reasons.length === 0, reasons }, sources: sources.sort((a, b) => compare(a.source, b.source)) };
}

function classify(declaredLevel: EngineeringLevel | null, claims: SemanticClaim[]): ScoreClassification {
  const has = (id: string, scope?: SemanticClaim["scope"]) => claims.some((claim) => claim.component === id && (!scope || claim.scope === scope));
  let assessedLevel: EngineeringLevel = "fresher", reasons = ["Conservative evidence floor; years of experience, titles and target role do not select a level"];
  if (has("implementation") && has("ownership")) { assessedLevel = "sde1"; reasons.push("Implementation and explicit ownership claims"); }
  if (assessedLevel === "sde1" && claims.some((claim) => claim.component === "ownership" && claim.scope !== "individual") && has("impact")) { assessedLevel = "sde2"; reasons.push("Service-or-wider ownership and measurable engineering impact claims"); }
  if (assessedLevel === "sde2" && has("architecture")) { assessedLevel = "sde3"; reasons.push("Architecture decisions with system trade-off/scaling context"); }
  if (assessedLevel === "sde3" && has("cross_team") && claims.some((claim) => claim.component === "architecture" && (claim.scope === "cross_team" || claim.scope === "organization"))) { assessedLevel = "staff"; reasons.push("Cross-team architecture scope and technical influence claims"); }
  if (assessedLevel === "staff" && has("strategy", "organization") && has("impact", "organization")) { assessedLevel = "principal"; reasons.push("Organization-wide strategy and measurable organization-wide impact claims"); }
  const warnings = claims.length ? [] : ["No multifactor engineering-scope evidence; fresher is an assessment floor, not a conclusion about ability"];
  if (declaredLevel && declaredLevel !== assessedLevel) warnings.push(`Selected ${declaredLevel} differs from the resume-claim reading (${assessedLevel}); the selected level picks the rubric`);
  return { declaredLevel, assessedLevel, confidence: claims.length ? 100 : 0, reasons, warnings };
}
