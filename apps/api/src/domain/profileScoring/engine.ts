import type { EngineDebugSink, EngineeringLevel, ScoreClassification, ScoreComponent, ScoreEvaluation, ScoreEvidence, ScoreSource, ScoringConfig, ScoringInput } from "./types.js";
import { COMPONENT_LABELS, DEFAULT_SCORING_CONFIG, linkedInProvider, supportsLinkedIn, validateScoringConfig } from "./config.js";
import { normalizeScoringInput, validTimestamp } from "./adapters.js";
import { normalizeAchievement } from "./achievements.js";
import { experienceMonths, industryContributionClaims, semanticClaims, type SemanticClaim } from "./experience.js";
import { compare, hashJson, list, number, object, sortedUnique } from "./sanitization.js";
import { linkedInClaims } from "./linkedin.js";
import { evaluateProfileV5 } from "./engineV5.js";

const round = (value: number): number => Math.round(value * 100) / 100;
const clamp = (value: number): number => Math.max(0, Math.min(100, value));
interface Signal { score: number; confidence: number; evidenceIds: string[] }

/** `debug` is honored by v5 only (admin live trace); it never changes the evaluation. */
export function evaluateProfile(raw: ScoringInput, config: ScoringConfig = DEFAULT_SCORING_CONFIG, debug?: EngineDebugSink): ScoreEvaluation {
  validateScoringConfig(config);
  if (config.version === "profile-beta-v5") return evaluateProfileV5(raw, config, debug);
  const input = normalizeScoringInput(raw, config.version), now = Date.parse(input.asOf), v3 = supportsLinkedIn(config.version);
  if (config.version === "profile-beta-v1" && (input.declaredLevel === "intern" || input.declaredLevel === "distinguished")) {
    throw new Error("Legacy v1 replay supports only its original six declared levels");
  }
  const warnings: string[] = ["Provisional beta assessment; not an interview result, hiring recommendation or validated measure of engineering ability."];
  const evidence: ScoreEvidence[] = [], sources: ScoreSource[] = [], signals = new Map<string, Signal>();
  const n = config.normalizers;
  const linkedin = v3 ? input.fragments.find((x) => x.source === "linkedin") : undefined;
  const importTime = linkedin && validTimestamp(linkedin.data.importedAt) ? Date.parse(linkedin.data.importedAt) : NaN;
  const urlImport = linkedin?.data.importMethod === "url";
  const retrievalTime = urlImport && validTimestamp(linkedin?.data.retrievedAt) ? Date.parse(linkedin!.data.retrievedAt as string) : NaN;
  const linkedinAge = (now - (urlImport ? retrievalTime : importTime)) / 86_400_000;
  const linkedinUsable = !!linkedin && validTimestamp(linkedin.fetchedAt) && Date.parse(linkedin.fetchedAt) <= now
    && linkedinAge >= 0 && linkedinAge <= n.observationHalfLifeDays!
    && ["archive", "pdf", "text", "url"].includes(String(linkedin.data.importMethod))
    && (urlImport ? linkedInProvider(linkedin.data.provider, config.version) !== null && importTime <= now && retrievalTime <= importTime && retrievalTime <= Date.parse(linkedin.fetchedAt)
      : importTime <= Date.parse(linkedin.fetchedAt));
  const linkedinProfile = linkedinUsable ? object(linkedin!.data.profile) as unknown as ScoringInput["profile"] : null;
  const addEvidence = (source: string, path: string, claim: string, value: string | number, verification: "collector" | "self_reported", observedAt: string | null, factor = 1): string => {
    const item = { source, path, claim, value, confidence: round((verification === "collector" ? 90 : 45) * factor), observedAt, verification, recencyFactor: round(factor) };
    const id = hashJson(item).slice(0, 24);
    if (!evidence.some((x) => x.id === id)) evidence.push({ id, ...item });
    return id;
  };
  const addSignal = (component: string, score: number, ids: string[], confidenceScale = 1) => {
    const found = ids.map((id) => evidence.find((x) => x.id === id)!);
    const signal = { score: clamp(score), confidence: confidenceScale * found.reduce((sum, x) => sum + x.confidence, 0) / found.length, evidenceIds: [...new Set(ids)].sort(compare) };
    const previous = signals.get(component);
    // Repeated records cannot accumulate credit. Keep one strongest signal, deterministic tie.
    if (!previous || signal.score > previous.score || (signal.score === previous.score && signal.confidence > previous.confidence)) signals.set(component, signal);
  };

  const semantic = semanticClaims(input.profile);
  for (const item of v3 ? [] : semantic) {
    const id = addEvidence("resume", item.path, item.claim, item.scope, "self_reported", null);
    addSignal(item.component, item.score, [id]);
  }
  if (!v3 && config.version !== "profile-beta-v1") {
    for (const item of industryContributionClaims(input.profile)) {
      const id = addEvidence("resume", item.path, `Unverified cited industry contribution: ${item.claim}`, item.scope, "self_reported", null);
      addSignal(item.component, item.score, [id]);
    }
  }
  const tenure = experienceMonths(v3 && linkedinProfile ? { ...(input.profile ?? linkedinProfile), experience: [...(input.profile?.experience ?? []), ...linkedinProfile.experience] } : input.profile, input.asOf);
  warnings.push(...tenure.warnings);
  if (tenure.months > 0) addEvidence(v3 && !input.profile && linkedinProfile ? "linkedin" : "resume", v3 && !input.profile && linkedinProfile ? "fragments.linkedin.profile.experience" : "profile.experience", "Union of valid inclusive experience months (context only; never classification by tenure)", tenure.months, "self_reported", null);
  if ((input.profile?.achievements.length ?? 0) > 0) warnings.push("Resume achievement strings are unverified narrative; no event-name or winner-substring points awarded");
  sources.push({ source: "resume", status: input.profile || input.fragments.some((x) => x.source === "resume") ? "available" : "missing", fetchedAt: null, ageDays: null, contentHash: input.profile ? hashJson(input.profile) : null });
  if (!input.profile && !input.fragments.some((x) => x.source === "resume")) warnings.push("resume: missing source; evidence is unknown");
  for (const expected of v3 ? ["github", "leetcode", "linkedin"] : ["github", "leetcode"]) {
    if (!input.fragments.some((x) => x.source === expected)) {
      sources.push({ source: expected, status: "missing", fetchedAt: null, ageDays: null, contentHash: null, ...(expected === "linkedin" ? { importMethod: null, importedAt: null } : {}) });
      warnings.push(`${expected}: missing source; evidence is unknown`);
    }
  }

  for (const fragment of input.fragments) {
    const source = fragment.source, data = fragment.data, observed = Date.parse(fragment.fetchedAt);
    const age = Number.isFinite(observed) ? (now - observed) / 86_400_000 : null;
    if (source === "linkedin" && v3) {
      sources.push({ source, status: linkedinUsable ? data.partial === true ? "partial" : "available" : "missing",
        fetchedAt: age !== null && age >= 0 ? fragment.fetchedAt : null, ageDays: Number.isFinite(linkedinAge) ? round(linkedinAge) : null,
        contentHash: fragment.contentHash, importMethod: data.importMethod as ScoreSource["importMethod"],
        importedAt: validTimestamp(data.importedAt) ? data.importedAt : null,
        ...(urlImport ? { provider: linkedInProvider(data.provider, config.version),
          retrievedAt: validTimestamp(data.retrievedAt) ? data.retrievedAt : null } : {}) });
      warnings.push(urlImport
        ? (config.version === "profile-beta-v3" ? "linkedin: public profile snapshot retrieved via Exa is partial and self-reported (45% confidence), not verified employment or OAuth identity proof; provider retrieval never grants collector confidence"
          : "linkedin: public profile snapshot retrieved via " + (data.provider === "firecrawl" ? "Firecrawl" : "Exa") + " is partial and self-reported (45% confidence), not verified employment or OAuth identity proof; provider retrieval never grants collector confidence")
        : "linkedin: owner-provided imported claims are self-reported (45% confidence); archive/PDF/text provenance is a file receipt, never employment verification");
      if (!linkedinUsable) warnings.push(`linkedin: stale (older than ${n.observationHalfLifeDays} days), invalid or future import/observation date or invalid method; evidence excluded`);
      if (data.partial === true) warnings.push("linkedin: partial selected-section import; absent sections are unknown, not zero");
      continue;
    }
    if (!["github", "leetcode", "resume"].includes(source)) {
      sources.push({ source, status: "unsupported", fetchedAt: age === null ? null : fragment.fetchedAt, ageDays: age === null ? null : round(age), contentHash: fragment.contentHash });
      warnings.push(`${source}: unsupported source payload excluded`); continue;
    }
    if (age === null || age < 0) {
      if (source !== "resume") sources.push({ source, status: "missing", fetchedAt: null, ageDays: null, contentHash: fragment.contentHash });
      else if (!input.profile) sources.find((x) => x.source === "resume")!.status = "missing";
      warnings.push(`${source}: invalid or future observation date; evidence excluded`); continue;
    }
    if (source !== "resume") sources.push({ source, status: data.partial === true ? "partial" : "available", fetchedAt: fragment.fetchedAt, ageDays: round(age), contentHash: fragment.contentHash });
    if (source === "github") {
      const langs = list(data.languages).map(object).filter((x) => typeof x.name === "string");
      const claimedSkills = [...(input.profile?.skills ?? []), ...(linkedinProfile?.skills ?? [])];
      const corroborated = langs.filter((lang) => claimedSkills.some((skill) => skill.toLowerCase() === String(lang.name).toLowerCase()));
      if (corroborated.length) {
        const ids = corroborated.map((lang) => addEvidence(source, "fragments.github.languages", "Language bytes corroborate a listed skill, not repository complexity or proficiency", String(lang.name), "collector", fragment.fetchedAt));
        addSignal("skills", 70, ids);
      }
      const prs = number(data.externalPRs);
      if (prs !== null && prs > 0) addEvidence(source, "fragments.github.externalPRs", "External PR activity only; merge state, quality and dates unavailable; no score", prs, "collector", fragment.fetchedAt);
      warnings.push("github: collector lacks READMEs, code quality, PR merge state and dated activity; topRepos, stars and raw commits are not scored");
    } else if (source === "leetcode") {
      const solved = object(data.solved), parts: { value: number; weight: number; id: string }[] = [];
      for (const [difficulty, cap, weight] of [["easy", n.easyCap!, 15], ["medium", n.mediumCap!, 50], ["hard", n.hardCap!, 35]] as const) {
        const count = number(solved[difficulty]);
        if (count === null) continue;
        if (!Number.isInteger(count) || count > 10_000_000) { warnings.push(`leetcode.solved.${difficulty}: invalid count excluded`); continue; }
        const id = addEvidence(source, `fragments.leetcode.solved.${difficulty}`, `Difficulty-specific solve attainment, saturates at ${cap}; permanent attainment`, count, "collector", fragment.fetchedAt);
        parts.push({ value: Math.min(count / cap, 1) * 100, weight, id });
      }
      if (parts.length) {
        const observedDifficultyWeight = parts.reduce((sum, x) => sum + x.weight, 0);
        addSignal("coding", parts.reduce((sum, x) => sum + x.value * x.weight, 0) / observedDifficultyWeight,
          parts.map((x) => x.id), observedDifficultyWeight / 100);
        if (observedDifficultyWeight < 100) warnings.push("leetcode: incomplete difficulty distribution; coding confidence is scaled by observed difficulty weight, missing buckets remain unknown");
      }
      const topics = new Map<string, number>();
      for (const rawTopic of list(data.byTopic)) {
        const topic = object(rawTopic), count = number(topic.count);
        if (typeof topic.topic === "string" && count !== null && Number.isInteger(count)) topics.set(topic.topic.toLowerCase(), Math.max(topics.get(topic.topic.toLowerCase()) ?? 0, count));
      }
      if (topics.size) {
        const breadth = [...topics.values()].filter((count) => count >= n.topicMinimum!).length;
        const id = addEvidence(source, "fragments.leetcode.byTopic", `Distinct topics with at least ${n.topicMinimum} solved; saturates at ${n.topicCap}; duplicated tags do not accumulate`, breadth, "collector", fragment.fetchedAt);
        addSignal("topics", 100 * Math.min(breadth / n.topicCap!, 1), [id]);
      }
      const contest = object(data.contest), attended = number(contest.attended), rating = number(contest.rating), rank = number(contest.globalRanking), population = number(contest.totalParticipants);
      const mutableRecency = Math.pow(0.5, age / n.observationHalfLifeDays!);
      if (attended !== null && Number.isInteger(attended) && attended > 0) {
        const measures: { score: number; id: string }[] = [];
        if (rating !== null && rating > 0 && rating < 10000) measures.push({ score: clamp(100 * (rating - n.ratingFloor!) / (n.ratingCeiling! - n.ratingFloor!)),
          id: addEvidence(source, "fragments.leetcode.contest.rating", `Contest rating normalized ${n.ratingFloor}–${n.ratingCeiling}; confidence ages independently`, rating, "collector", fragment.fetchedAt, mutableRecency) });
        if (rank !== null && population !== null && Number.isInteger(rank) && Number.isInteger(population) && population >= 2 && rank >= 1 && rank <= population) {
          const percentile = 100 * (population - rank) / (population - 1);
          measures.push({ score: percentile, id: addEvidence(source, "fragments.leetcode.contest.globalRanking", `Percentile computed from rank ${rank} of ${population}; provider topPercent is not trusted without valid denominator`, round(percentile), "collector", fragment.fetchedAt, mutableRecency) });
        } else if (rank !== null || population !== null || number(contest.topPercent) !== null) warnings.push("leetcode.contest: invalid/missing rank denominator; percentile excluded");
        if (measures.length) addSignal("contest", measures.reduce((sum, x) => sum + x.score, 0) / measures.length, measures.map((x) => x.id));
      }
      const activity = object(data.recentActivity), recent = number(activity.last30Days);
      const windowDate = activity.windowAsOf === null || activity.windowAsOf === undefined ? observed : validTimestamp(activity.windowAsOf) ? Date.parse(activity.windowAsOf) : NaN;
      const windowAge = (now - windowDate) / 86_400_000;
      if (data.partial === true) warnings.push("leetcode: partial query failure; absent contest and recent activity are unknown, not zero");
      else if (recent !== null && Number.isInteger(recent) && recent <= 20 && windowAge >= 0 && windowAge <= 90 && windowDate <= observed) {
        const factor = Math.pow(0.5, windowAge / n.activityHalfLifeDays!);
        const id = addEvidence(source, "fragments.leetcode.recentActivity.last30Days", "Accepted activity from a maximum-20 sample, not total submissions or unique solves; decays from original observation window", recent, "collector", new Date(windowDate).toISOString(), factor);
        addSignal("activity", 100 * Math.min(recent / n.activityCap!, 1) * factor, [id]);
      } else if (recent !== null) warnings.push("leetcode.recentActivity: stale, future or invalid activity window; unknown");
    } else if (source === "resume") {
      const resumeSource = sources.find((x) => x.source === "resume")!;
      resumeSource.contentHash = hashJson({ profile: input.profile, data });
      resumeSource.fetchedAt = fragment.fetchedAt;
      resumeSource.ageDays = round(age);
      for (const [index, rawAchievement] of list(data.achievements).entries()) {
        const achievement = normalizeAchievement(rawAchievement);
        if (!achievement) continue;
        if (achievement.year !== null && achievement.year > new Date(now).getUTCFullYear()) { warnings.push("resume.achievements: future achievement excluded"); continue; }
        // Structured metadata remains a claim: no award has been externally verified by this beta collector.
        let score = achievement.kind === "oss_program" && achievement.outcome === "completed" ? 70 : achievement.outcome === "participant" ? 25 : achievement.outcome === "finalist" ? 50 : achievement.outcome === "winner" ? 70 : 25;
        if (achievement.kind === "competition" && achievement.rank !== null && achievement.participants !== null && achievement.participants >= 2) score = 25 + 55 * (achievement.participants - achievement.rank) / (achievement.participants - 1);
        const id = addEvidence(source, `fragments.resume.achievements[${index}]`, `${achievement.kind}: ${achievement.event}; explicitly reported ${achievement.outcome}; unverified, permanent achievement`, round(score), "self_reported", null);
        addSignal("achievements", score, [id]);
      }
    }
  }

  if (v3) {
    const reported = [...semantic.map((claim) => ({ ...claim, source: "resume", observedAt: null as string | null })),
      ...industryContributionClaims(input.profile).map((claim) => ({ ...claim, source: "resume", observedAt: null as string | null })),
      ...(linkedinUsable ? linkedInClaims(linkedin!.data).map((claim) => ({ ...claim, source: "linkedin", observedAt: (urlImport ? linkedin!.data.retrievedAt : linkedin!.data.importedAt) as string })) : [])];
    const groups = new Map<string, typeof reported>();
    for (const claim of reported) {
      const key = hashJson({ component: claim.component, scope: claim.scope, claim: claim.claim.toLowerCase() });
      groups.set(key, [...(groups.get(key) ?? []), claim]);
    }
    for (const [, claims] of [...groups].sort(([a], [b]) => compare(a, b))) {
      claims.sort((a, b) => compare(a.source === "resume" ? "0" : "1", b.source === "resume" ? "0" : "1") || compare(a.path, b.path));
      const claim = claims[0]!;
      const paths = sortedUnique(claims.map((x) => x.source === "resume" ? `resume.${x.path}` : x.path));
      const provenance = claims.some((x) => x.source === "linkedin") ? list(linkedin?.data.provenance).map(object)
        .filter((x) => typeof x.quote === "string" && x.quote.toLowerCase() === claim.claim.toLowerCase())
        .map((x) => ({ section: String(x.section), path: String(x.path), file: typeof x.file === "string" ? x.file : null, quote: String(x.quote) })) : [];
      const id = addEvidence(claim.source, claim.path, claim.component === "industry_contribution" ? `Unverified cited industry contribution: ${claim.claim}` : claim.claim,
        claim.scope, "self_reported", claim.observedAt);
      const evidenceItem = evidence.find((x) => x.id === id)!;
      evidenceItem.paths = paths;
      if (provenance.length) evidenceItem.provenance = sortedUnique(provenance);
      addSignal(claim.component, claim.score, [id]);
    }
    if (linkedinUsable) semantic.push(...linkedInClaims(linkedin!.data).filter((x) => x.component !== "industry_contribution"));
  }

  const classification = classify(input.declaredLevel, semantic);
  warnings.push(...classification.warnings);
  const level = input.declaredLevel ?? classification.assessedLevel;
  const weights = config.weights[level]!;
  if (level === "intern") {
    classification.warnings.push("Intern selects a learning-stage implementation rubric, not the Fresher rubric; internship or entry-level scope is not verified by the evidence floor. Review any declared/assessed mismatch.");
  }
  if (level === "distinguished") {
    classification.warnings.push("Distinguished selects an industry-contribution rubric; titles and organization-wide strategy alone cannot establish distinguished scope. Cited contributions remain unverified, and assessment is capped at Principal.");
  }
  warnings.push(...classification.warnings);
  const availableWeight = Object.entries(weights).reduce((sum, [id, weight]) => sum + (signals.has(id) ? weight : 0), 0);
  const components: ScoreComponent[] = Object.entries(weights).sort(([a], [b]) => compare(a, b)).map(([id, weight]) => {
    const signal = weight > 0 ? signals.get(id) : undefined;
    const label = level === "intern" && id === "implementation" ? "Learning-stage implementation (Intern rubric)" : COMPONENT_LABELS[id]!;
    return { id, label, weight, score: signal ? round(signal.score) : null,
      contribution: signal && availableWeight ? round(signal.score * weight / availableWeight) : null,
      evidenceIds: signal?.evidenceIds ?? [], status: signal ? "available" : "missing" };
  });
  const confidence = availableWeight ? round(Object.entries(weights).reduce((sum, [id, weight]) => sum + (signals.get(id)?.confidence ?? 0) * weight, 0) / availableWeight) : 0;
  const coverage = round(availableWeight);
  const score = availableWeight ? round(Object.entries(weights).reduce((sum, [id, weight]) => sum + (signals.get(id)?.score ?? 0) * weight, 0) / availableWeight) : null;
  const reasons: string[] = [];
  if (coverage < config.thresholds.minimumCoverage) reasons.push(`Coverage below ${config.thresholds.minimumCoverage}%`);
  if (confidence < config.thresholds.minimumConfidence) reasons.push(`Confidence below ${config.thresholds.minimumConfidence}%`);
  const usedEvidence = components.flatMap((component) => component.evidenceIds).map((id) => evidence.find((x) => x.id === id)!);
  if (!usedEvidence.some((item) => item.verification === "collector" && item.confidence >= config.thresholds.minimumConfidence)) reasons.push("No sufficiently current collector evidence in an available scoring component");
  if (classification.declaredLevel && classification.declaredLevel !== classification.assessedLevel) reasons.push("Declared and evidence-assessed level differ; review required");
  if (level === "intern") reasons.push("Internship learning-stage scope is not independently established; review required (Fresher is not an Intern classification)");
  if (level === "distinguished") reasons.push("Distinguished industry/multi-organization scope is not independently verified; review required");
  if (score === null) reasons.push("No scoreable evidence");
  return { algorithmVersion: config.version, configHash: hashJson(config), inputHash: hashJson(input), asOf: input.asOf,
    status: score === null ? "insufficient_evidence" : "scored", score, confidence, coverage, level, classification, components,
    evidence: evidence.sort((a, b) => compare(a.id, b.id)), warnings: [...new Set(warnings)].sort(compare),
    eligibility: { eligible: reasons.length === 0, reasons }, sources: sources.sort((a, b) => compare(a.source, b.source)) };
}

function classify(declaredLevel: EngineeringLevel | null, claims: SemanticClaim[]): ScoreClassification {
  const has = (id: string, scope?: SemanticClaim["scope"]) => claims.some((claim) => claim.component === id && (!scope || claim.scope === scope));
  let assessedLevel: EngineeringLevel = "fresher";
  const reasons: string[] = ["Conservative evidence floor; years of experience, titles and target role do not select a level"];
  if (has("implementation") && has("ownership")) { assessedLevel = "sde1"; reasons.push("Implementation and explicit ownership claims"); }
  if (assessedLevel === "sde1" && claims.some((claim) => claim.component === "ownership" && claim.scope !== "individual") && has("impact")) { assessedLevel = "sde2"; reasons.push("Service-or-wider ownership and measurable engineering impact claims"); }
  if (assessedLevel === "sde2" && has("architecture")) { assessedLevel = "sde3"; reasons.push("Architecture decisions with system trade-off/scaling context"); }
  if (assessedLevel === "sde3" && has("cross_team") && claims.some((x) => x.component === "architecture" && (x.scope === "cross_team" || x.scope === "organization"))) { assessedLevel = "staff"; reasons.push("Cross-team architecture scope and technical influence claims"); }
  if (assessedLevel === "staff" && has("strategy", "organization") && has("impact", "organization")) { assessedLevel = "principal"; reasons.push("Organization-wide strategy and measurable organization-wide impact claims"); }
  const warnings = claims.length ? ["Level assessment uses self-reported semantic claims, not verified seniority; classification confidence is capped at 45%"] : ["No multifactor engineering-scope evidence; fresher is an assessment floor, not a conclusion about ability"];
  if (declaredLevel && declaredLevel !== assessedLevel) warnings.push(`Declared ${declaredLevel} differs from evidence-assessed ${assessedLevel}; declared level selects rubric only`);
  return { declaredLevel, assessedLevel, confidence: claims.length ? 45 : 0, reasons, warnings };
}
