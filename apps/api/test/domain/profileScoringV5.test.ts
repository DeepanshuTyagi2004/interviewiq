import { describe, expect, it } from "vitest";
import { evaluateProfile } from "../../src/domain/profileScoring/engine.js";
import { CURRENT_SCORING_CONFIG, PROFILE_BETA_V5_SCORING_CONFIG as C, validateScoringConfig } from "../../src/domain/profileScoring/config.js";
import { normalizeCompetition, platformRatingScore, registerCompetitionAdapter, scoreCompetitionSignals, supportedCompetitionPlatforms } from "../../src/domain/profileScoring/competition.js";
import { extractCompetitionResult, scoreCompetitionResult } from "../../src/domain/profileScoring/competitionResults.js";
import { companyContextFromEntry } from "../../src/domain/profileScoring/company.js";
import { normalizeInternship } from "../../src/domain/profileScoring/internship.js";
import { validateLLMAssessment } from "../../src/domain/profileScoring/assessment.js";
import { buildItemAssessmentRequest, packExcerpts, profileItems, sanitizeSemanticAssessments } from "../../src/domain/profileScoring/semantic.js";
import { sanitizeProfile } from "../../src/domain/profileScoring/adapters.js";
import { ENGINEERING_LEVELS, type EngineeringLevel, type ScoringInput, type ScoringProfile, type SemanticItemAssessment } from "../../src/domain/profileScoring/types.js";

const asOf = "2026-10-04T00:00:00.000Z", nowSeconds = Date.parse(asOf) / 1000, DAY = 86_400;
const input = (fragments: ScoringInput["fragments"], declaredLevel: EngineeringLevel | null = "fresher", extras: Partial<ScoringInput> = {}): ScoringInput => ({ asOf, declaredLevel, profile: null, fragments, ...extras });
const fragment = (source: string, data: Record<string, unknown>): ScoringInput["fragments"][number] => ({ source, data, fetchedAt: asOf, contentHash: "untrusted" });
const component = (result: ReturnType<typeof evaluateProfile>, id: string) => result.components.find((c) => c.id === id);
const emptyProfile = (): ScoringProfile => ({ headline: null, education: [], experience: [], projects: [], skills: [], achievements: [] });
/** A stored assessment for every item of a profile, with one value for every feature that has a quote. */
const assessAll = (profile: ScoringProfile, level: EngineeringLevel, value: (key: string) => number, company: number | null = null): SemanticItemAssessment[] =>
  profileItems(sanitizeProfile(profile)).map((item) => ({ itemType: item.type, itemHash: item.hash, level, promptVersion: C.v5Policy!.semantic.promptVersion, assessedAt: asOf, model: "test",
    features: C.v5Policy!.semantic.features[item.type].map((f) => ({ key: f.key, value: value(f.key), excerpts: [item.text[0] ?? item.title], rationale: "test" })),
    companyContext: company === null || item.type === "project" ? null : { value: company, source: "test" } }));

describe("v5 policy: level weights", () => {
  it("is valid, sums every level to 100 and shifts weight from DSA/CP to engineering as levels rise", () => {
    expect(CURRENT_SCORING_CONFIG.version).toBe("profile-beta-v5");
    expect(() => validateScoringConfig(C)).not.toThrow();
    const cp = ENGINEERING_LEVELS.map((level) => (C.weights[level]!.problem_solving ?? 0) + (C.weights[level]!.competitive_programming ?? 0));
    for (const level of ENGINEERING_LEVELS) expect(Object.values(C.weights[level]!).reduce((a, b) => a + b, 0)).toBe(100);
    for (let i = 1; i < cp.length; i++) expect(cp[i]).toBeLessThanOrEqual(cp[i - 1]! + 1);
    expect(cp[1]).toBeLessThanOrEqual(19); // fresher: what was built outweighs DSA
    expect(cp[2]).toBeLessThanOrEqual(16); // SDE-1: DSA and contests still separate candidates
    expect(cp.at(-1)).toBeLessThanOrEqual(3); // distinguished
  });

  it("weights engineering scope above open source and open source above projects at every level; open source above DSA/CP from SDE-2", () => {
    const dsaOf = (w: Record<string, number>) => (w.problem_solving ?? 0) + (w.competitive_programming ?? 0);
    for (const level of ENGINEERING_LEVELS) {
      const w = C.weights[level]!;
      const scope = ["implementation", "ownership", "impact", "architecture", "cross_team", "strategy"].reduce((sum, id) => sum + (w[id] ?? 0), 0);
      expect(scope).toBeGreaterThan(w.open_source!);
      expect(w.open_source!).toBeGreaterThan(w.projects ?? 0);
    }
    // Entry levels keep DSA + CP as a real separator (19% intern/fresher, 16% SDE-1); from SDE-2 open source outweighs it.
    for (const level of ["sde2", "sde3", "staff", "principal", "distinguished"] as const) expect(C.weights[level]!.open_source!).toBeGreaterThan(dsaOf(C.weights[level]!));
    // What was built (projects, internships, work) outweighs DSA + CP for interns and freshers.
    for (const level of ["intern", "fresher"] as const) {
      const w = C.weights[level]!;
      expect((w.projects ?? 0) + (w.internship_experience ?? 0) + (w.professional_experience ?? 0)).toBeGreaterThan(dsaOf(w));
    }
  });

  it("rejects a policy that lets company context dominate or a non-monotonic rating curve", () => {
    const bad = structuredClone(C) as typeof C;
    bad.v5Policy!.subFeatures.internship_experience!.default.company_context = 60;
    expect(() => validateScoringConfig(bad)).toThrow(/Company context/);
    const curve = structuredClone(C) as typeof C;
    curve.v5Policy!.competition.platforms.leetcode!.ratingCurve = [[1500, 50], [1400, 60]];
    expect(() => validateScoringConfig(curve)).toThrow(/Rating curve/);
  });

  it("keeps absent evidence unknown and does not score an empty profile", () => {
    const result = evaluateProfile(input([]), C);
    expect(result.score).toBeNull();
    expect(result.coverage).toBe(0);
    expect(result.components.every((c) => c.score === null && c.status === "missing")).toBe(true);
  });
});

describe("v5 takes source data as correct (no confidence)", () => {
  const strong = fragment("leetcode", { solved: { easy: 100, medium: 200, hard: 80 }, contest: { attended: 20, rating: 2000, topPercent: 5 } });
  const profile: ScoringProfile = { ...emptyProfile(), achievements: ["Smart India Hackathon 2024 finalist"],
    projects: [{ name: "QueueLite", description: "A Redis-backed job queue.", tech: ["Go"], bullets: ["Benchmarked 10k jobs/s."], link: null }] };

  it("reports full confidence on every evidence item and on the evaluation whenever it scores", () => {
    const result = evaluateProfile(input([strong], "fresher", { profile, semanticAssessments: assessAll(profile, "fresher", () => 70) }), C);
    expect(result.confidence).toBe(100);
    expect(result.evidence.every((e) => e.confidence === 100)).toBe(true);
    expect(evaluateProfile(input([]), C).confidence).toBe(0);
  });

  it("lists every scored profile: there is no minimum coverage, missing parts already count as 0", () => {
    const thin = evaluateProfile(input([strong], "fresher"), C);
    expect(thin.coverage).toBeLessThan(100);
    expect(thin.eligibility).toEqual({ eligible: true, reasons: [] });
    expect(evaluateProfile(input([]), C).eligibility).toEqual({ eligible: false, reasons: ["No scoreable evidence"] });
    const full = evaluateProfile(input([strong], "fresher", { profile, semanticAssessments: assessAll(profile, "fresher", () => 70) }), C);
    expect(full.eligibility).toEqual({ eligible: true, reasons: [] });
    // Self-reported resume evidence alone is not a reason to exclude someone.
    expect(full.eligibility.reasons.some((r) => /confidence|collector|review/i.test(r))).toBe(false);
  });
});

describe("v5 competitive programming", () => {
  it("normalizes each platform on its own scale: an 1800 means different things on LeetCode and Codeforces", () => {
    const lc = platformRatingScore(C.v5Policy!.competition.platforms.leetcode!, 1800);
    const cf = platformRatingScore(C.v5Policy!.competition.platforms.codeforces!, 1800);
    expect(lc).not.toBe(cf);
    expect(cf).toBeGreaterThan(lc); // CF 1800 is Expert; LC 1800 is just below Knight
    const lcContest = scoreCompetitionSignals(normalizeCompetition("leetcode", { contest: { attended: 5, rating: 1800 } }, asOf), asOf, asOf, C).find((m) => m.signal === "contest")!;
    expect(lcContest.normalizedValue).toBeCloseTo(lc, 5);
  });

  it("weights population percentile above raw rating when the platform reports one", () => {
    const withPct = scoreCompetitionSignals(normalizeCompetition("leetcode", { contest: { attended: 5, rating: 1500, topPercent: 3 } }, asOf), asOf, asOf, C).find((m) => m.signal === "contest")!;
    const without = scoreCompetitionSignals(normalizeCompetition("leetcode", { contest: { attended: 5, rating: 1500 } }, asOf), asOf, asOf, C).find((m) => m.signal === "contest")!;
    expect(withPct.normalizedValue).toBeGreaterThan(without.normalizedValue);
  });

  it("does not reward raw volume: 500 easy problems lose to 250 medium/hard with a strong contest rating", () => {
    const a = evaluateProfile(input([fragment("leetcode", { solved: { easy: 500, medium: 0, hard: 0 } })]), C);
    const b = evaluateProfile(input([fragment("leetcode", { solved: { easy: 50, medium: 150, hard: 50 }, contest: { attended: 20, rating: 2100, topPercent: 2 } })]), C);
    expect(b.score!).toBeGreaterThan(a.score!);
    const huge = evaluateProfile(input([fragment("leetcode", { solved: { easy: 10_000_000, medium: 10_000_000, hard: 10_000_000 } })]), C);
    // Saturates: solve counts alone max out the difficulty sub-feature, and the other sub-features
    // (topics, consistency, recency) count as 0 when missing, so no volume buys more than difficulty's share.
    expect(component(huge, "problem_solving")?.score).toBe(C.v5Policy!.subFeatures.problem_solving!.default.difficulty);
  });

  it("uses the best platform per signal, so a thin second account never lowers problem solving", () => {
    const strong = fragment("leetcode", { solved: { easy: 100, medium: 150, hard: 75 } });
    const thin = fragment("codeforces", { problems: [{ problemId: "1A", rating: 800, tags: ["math"] }] });
    const one = evaluateProfile(input([strong]), C), two = evaluateProfile(input([strong, thin]), C);
    expect(component(two, "problem_solving")?.score).toBe(component(one, "problem_solving")?.score);
  });

  it("derives trajectory, stability, participation and consistency from contest history and the calendar", () => {
    const history = [1, 2, 3, 4, 5, 6].map((k) => ({ attended: true, rating: 1500 + k * 50, ranking: 9000 - k * 500, startTime: nowSeconds - (7 - k) * 30 * DAY }));
    const lc = normalizeCompetition("leetcode", { solved: { easy: 10, medium: 10, hard: 1 }, contest: { attended: 6, rating: 1800 }, contestHistory: history,
      calendar: { activeWeeks: 39, windowWeeks: 52, last30Days: 20 } }, asOf);
    expect(lc.contest.maxRating).toBe(1800);
    const signals = new Set(scoreCompetitionSignals(lc, asOf, asOf, C).map((m) => m.signal));
    for (const signal of ["contest_trajectory", "rating_stability", "contest_consistency", "contest_recency", "solving_consistency", "solving_recency"]) expect(signals).toContain(signal);
  });

  it("treats contest platforms as alternatives: a LeetCode-only candidate is not scored 0 for having no Codeforces record", () => {
    const rows = new Map<string, { key: string; status: string }[]>();
    evaluateProfile(input([fragment("leetcode", { solved: { easy: 50, medium: 80, hard: 10 }, contest: { attended: 10, rating: 1700, topPercent: 10 } })]), C, (e) => { if (e.step === "composite") rows.set(String(e.detail.component), e.detail.used as never); });
    const cp = rows.get("competitive_programming")!;
    expect(cp.find((r) => r.key === "leetcode_contest")?.status).toBe("found");
    for (const key of ["codeforces_contest", "other_contest", "competition_results"]) expect(cp.some((r) => r.key === key)).toBe(false);
    for (const key of ["contest_trajectory", "rating_stability"]) expect(cp.find((r) => r.key === key)?.status).toBe("missing");
    // A listed contest result alone satisfies the same group.
    rows.clear();
    evaluateProfile(input([], "fresher", { profile: { ...emptyProfile(), achievements: ["ICPC Asia Regional 2024: rank 12 of 300 teams"] } }), C, (e) => { if (e.step === "composite") rows.set(String(e.detail.component), e.detail.used as never); });
    expect(rows.get("competitive_programming")!.map((r) => `${r.key}:${r.status}`)).toEqual(expect.arrayContaining(["competition_results:found", "contest_consistency:missing"]));
    expect(rows.get("competitive_programming")!.some((r) => r.key === "leetcode_contest")).toBe(false);
  });

  it("scores AtCoder difficulty from the rating colour, as CodeChef uses stars", () => {
    const at = normalizeCompetition("atcoder", { rating: 1250, history: [{ IsRated: true, NewRating: 1250, Place: 900, EndTime: "2026-08-01T00:00:00Z" }] }, asOf);
    expect(at.platformLevel).toEqual({ value: 3, maximum: 8 });
    expect(scoreCompetitionSignals(at, asOf, asOf, C).find((m) => m.signal === "difficulty")?.normalizedValue).toBeCloseTo(37.5, 1);
  });

  it("supports every listed platform through adapters, and new platforms plug in without engine changes", () => {
    expect(supportedCompetitionPlatforms()).toEqual(expect.arrayContaining(["leetcode", "codeforces", "codechef", "atcoder", "hackerearth", "tuf"]));
    const chef = normalizeCompetition("codechef", { rating: 1850, highestRating: 1920, stars: "4", contests: [{ endDate: "2026-09-01T00:00:00Z", rating: 1850, rank: 300 }] }, asOf);
    expect(chef.contest.maxRating).toBe(1920); expect(chef.platformLevel).toEqual({ value: 4, maximum: 7 });
    const at = normalizeCompetition("atcoder", { history: [{ IsRated: true, NewRating: 1200, Place: 900, EndTime: "2026-08-01T00:00:00Z" }], acceptedProblems: [{ difficulty: 1700 }] }, asOf);
    expect(at.difficulty.hard).toBe(1); expect(at.contest.rating).toBe(1200);
    // takeUforward: Basic/Core/Pro sheet solves are difficulty bands; a fetch-relative activity window is dated by the observation.
    const tuf = normalizeCompetition("tuf", { solved: { easy: 35, medium: 190, hard: 69 }, totalSolved: 294, byTopic: [{ topic: "dynamic programming", count: 53 }],
      consistency: { activeWeeks: 30, windowWeeks: 52 }, recentActivity: { last30Days: 12 } }, asOf);
    expect(tuf.difficulty).toEqual({ easy: 35, hard: 69, medium: 190 });
    expect(tuf.consistency.windowAsOf).toBe(asOf); expect(tuf.recency).toMatchObject({ activityCount: 12, windowAsOf: asOf });
    expect(new Set(scoreCompetitionSignals(tuf, asOf, asOf, C).map((m) => m.signal))).toEqual(new Set(["difficulty", "advanced_topics", "breadth", "solving_consistency", "solving_recency"]));
    registerCompetitionAdapter({ platform: "newjudge", adapt: (raw) => ({ difficulty: { easy: raw.e, medium: raw.m, hard: raw.h }, contest: { attended: 3, rating: raw.r } }) });
    const result = evaluateProfile(input([fragment("newjudge", { platform: "newjudge", e: 50, m: 60, h: 20, r: 1600 })]), C);
    expect(component(result, "problem_solving")?.status).toBe("available");
    expect(result.evidence.some((e) => e.feature === "other_contest" || e.feature === "newjudge_contest")).toBe(true);
  });
});

describe("v5 competition results", () => {
  it("scores a past-year selective open-source programme as completed, and this year's as selected", () => {
    const past = extractCompetitionResult("Google Summer of Code 2025 contributor with Apache Airflow", "p")!, current = extractCompetitionResult("Google Summer of Code 2026 contributor with Apache Airflow", "p")!;
    const pastScore = scoreCompetitionResult(past, C, 2026)!, currentScore = scoreCompetitionResult(current, C, 2026)!;
    expect(pastScore.score).toBeGreaterThan(currentScore.score);
    expect(pastScore.score).toBeCloseTo(C.v5Policy!.results.statusScores.completed! * pastScore.eventFactor, 1);
    expect(scoreCompetitionResult(extractCompetitionResult("Google Summer of Code 2025: successfully completed", "p")!, C, 2026)!.score).toBeCloseTo(pastScore.score, 1);
  });

  const score = (text: string) => { const r = extractCompetitionResult(text, "x")!; return scoreCompetitionResult(r, C, 2026)!.score; };

  it("orders participation < qualification < finalist < top-ranked < winner, never rewarding them alike", () => {
    expect(score("ICPC Asia Regional 2024 - rank 45 out of 1200 teams")).toBeLessThan(score("ICPC World Finals 2023"));
    expect(score("ICPC World Finals 2023")).toBeLessThan(score("ICPC World Finals 2023 - silver medal"));
    expect(score("ICPC World Finals 2023 - silver medal")).toBeLessThan(score("ICPC World Finals 2023 winners"));
    expect(score("Smart India Hackathon 2024 participant")).toBeLessThan(score("Smart India Hackathon 2024 finalist"));
    expect(score("Smart India Hackathon 2024 finalist")).toBeLessThan(score("Winner, Smart India Hackathon 2024"));
  });

  it("scales by event metadata, treats open programs as participation and excludes future-dated results", () => {
    expect(extractCompetitionResult("Participated in Hacktoberfest 2024", "x")!.status).toBe("participation");
    expect(extractCompetitionResult("Google Summer of Code 2025, successfully completed", "x")!.status).toBe("completed");
    expect(score("Winner, ICPC World Finals 2023")).toBeGreaterThan(score("Won college coding competition 2023"));
    expect(scoreCompetitionResult(extractCompetitionResult("Smart India Hackathon 2031 winner", "x")!, C, 2026)).toBeNull();
    expect(extractCompetitionResult("Planning to participate in ICPC 2027", "x")).toBeNull();
  });

  it("feeds competitive programming and achievements as self-reported evidence", () => {
    const profile = { ...emptyProfile(), achievements: ["ICPC World Finals 2023", "Smart India Hackathon 2024 finalist"] };
    const result = evaluateProfile(input([], "fresher", { profile }), C);
    expect(component(result, "competitive_programming")?.status).toBe("available");
    expect(component(result, "achievements")?.status).toBe("available");
    expect(result.evidence.filter((e) => ["competition_results", "hackathons"].includes(e.feature ?? "")).every((e) => e.evidenceType === "SELF_REPORTED" && e.confidence === 100)).toBe(true);
  });
});

describe("v5 semantic items and internships", () => {
  const profile: ScoringProfile = { ...emptyProfile(),
    experience: [{ title: "Software Engineering Intern", startDate: "2025-05", endDate: "2025-07", bullets: ["Built a React dashboard used by 200 employees and reduced reporting time by 30%."] }],
    projects: [{ name: "QueueLite", description: "A Redis-backed job queue with retries.", tech: ["Go", "Redis"], bullets: ["Benchmarked 10k jobs/s with integration tests in CI."], link: null }] };

  it("sends every bullet of a long entry to the assessment, packed into the excerpt slots", () => {
    // Bullets are canonically (alphabetically) ordered, so a plain cut at 8 dropped whichever sorted last.
    const bullets = Array.from({ length: 12 }, (_, i) => `- ${String.fromCharCode(65 + i)} bullet with a measured outcome of ${i * 10}% across the platform`);
    const [item] = profileItems({ ...emptyProfile(), experience: [{ title: "Software Engineer", startDate: "2025-02", endDate: "present", bullets }] });
    const request = buildItemAssessmentRequest(item!, { targetRole: null, level: "sde1", specialization: null, yearsExperience: 1 }, C.v5Policy!.semantic);
    const excerpts = request.experience?.[0]?.excerpts ?? [];
    expect(excerpts.length).toBeLessThanOrEqual(8);
    expect(excerpts.every((e) => e.length <= 800)).toBe(true);
    expect(bullets.every((b) => excerpts.some((e) => e.includes(b)))).toBe(true);
    expect(packExcerpts(["x".repeat(900), "a", "b"], 1, 800)).toEqual(["x".repeat(800)]);
  });

  it("never scores an internship or project from existence, dates or keywords alone", () => {
    const result = evaluateProfile(input([], "fresher", { profile }), C);
    // Unassessed items (AI failed or not run) are never left out: a required part counts as 0.
    expect(component(result, "internship_experience")?.status).toBe("missing");
    expect(component(result, "projects")).toMatchObject({ status: "missing", role: "core", counted: true });
    expect(result.warnings).toContain("Projects has no AI assessment (it failed or has not run yet); it is required at fresher, so it counts as 0");
    expect(result.warnings).toContain("2 resume item(s) have no AI assessment (it failed or has not run yet); everything judged from them counts as 0");
  });

  it("replays older configs unchanged: there an unassessed part was left out as pending", () => {
    const legacy = { ...C, v5Policy: { ...C.v5Policy!, missingCountsAsZero: undefined } };
    const result = evaluateProfile(input([], "fresher", { profile }), legacy);
    expect(component(result, "projects")?.status).toBe("pending");
    expect(result.warnings).toContain("Projects is waiting for AI assessment and is left out until assessed");
  });

  it("counts an item feature that was not found as 0, not left out of the item's average", () => {
    const all = assessAll(profile, "fresher", () => 70);
    const withoutScale = all.map((a) => ({ ...a, features: a.features.filter((f) => f.key !== "scale") }));
    const complete = evaluateProfile(input([], "fresher", { profile, semanticAssessments: all }), C);
    const partial = evaluateProfile(input([], "fresher", { profile, semanticAssessments: withoutScale }), C);
    // scale (weight 3 of 100) at 70 -> 0 lowers the item by 3 x 70 / 100.
    expect(component(complete, "projects")!.score! - component(partial, "projects")!.score!).toBeCloseTo(2.1, 1);
  });

  it("treats achievement categories as alternatives: GSoC alone is not scored 0 for no hackathon", () => {
    const result = evaluateProfile(input([], "fresher", { profile: { ...emptyProfile(), achievements: ["Google Summer of Code 2025 contributor"] } }), C);
    expect(component(result, "achievements")!.score!).toBeGreaterThan(40);
    expect(result.evidence.filter((e) => ["hackathons", "oss_programs", "other_recognition"].includes(e.feature ?? "")).map((e) => e.feature)).toEqual(["oss_programs"]);
  });

  it("uses a stored assessment only for the same item, level and prompt version", () => {
    const fresher = assessAll(profile, "fresher", () => 70);
    const scored = evaluateProfile(input([], "fresher", { profile, semanticAssessments: fresher }), C);
    expect(component(scored, "projects")?.status).toBe("available");
    expect(component(scored, "internship_experience")?.status).toBe("available");
    expect(scored.evidence.filter((e) => e.evidenceType === "INFERRED").length).toBeGreaterThan(0);
    const otherLevel = evaluateProfile(input([], "sde2", { profile, semanticAssessments: fresher }), C);
    expect(component(otherLevel, "projects")?.status).toBe("missing");
    const oldPrompt = evaluateProfile(input([], "fresher", { profile, semanticAssessments: fresher.map((a) => ({ ...a, promptVersion: "old" })) }), C);
    expect(component(oldPrompt, "projects")?.status).toBe("missing");
    const edited = { ...profile, projects: [{ ...profile.projects[0]!, bullets: ["Benchmarked 12k jobs/s."] }] };
    expect(component(evaluateProfile(input([], "fresher", { profile: edited, semanticAssessments: fresher }), C), "projects")?.status).toBe("missing");
  });

  it("validates stored assessments: unknown keys, unquoted features and out-of-range values are dropped", () => {
    const [a] = assessAll(profile, "fresher", () => 70);
    const [clean] = sanitizeSemanticAssessments([{ ...a!, features: [...a!.features, { key: "overall_score", value: 99, excerpts: ["x"] },
      { key: a!.features[0]!.key === "originality" ? "scale" : "originality", value: 90, excerpts: [] }, { key: "technical_depth", value: 140, excerpts: ["x"] }] }], C);
    expect(clean!.features.some((f) => f.key === "overall_score")).toBe(false);
    expect(clean!.features.every((f) => f.excerpts.length > 0 && f.value <= 100 && !("confidence" in f))).toBe(true);
  });

  it("lets strong work at an unknown company beat weak work at a well-known one: context is capped", () => {
    const strong = evaluateProfile(input([], "fresher", { profile, semanticAssessments: assessAll(profile, "fresher", () => 85, 10) }), C);
    const prestige = evaluateProfile(input([], "fresher", { profile, semanticAssessments: assessAll(profile, "fresher", () => 30, 100) }), C);
    expect(component(strong, "internship_experience")!.score!).toBeGreaterThan(component(prestige, "internship_experience")!.score!);
    expect(companyContextFromEntry({ name: "x", industry: null, companySize: null, engineeringSize: null, productType: null, technicalDomains: [], knownTechnologies: [],
      internshipProgram: null, internshipSelectivity: null, geographicScope: null, companyStage: null, evidenceSources: [], observedAt: null })).toBeNull();
  });

  it("counts internships toward professional experience only from SDE-1 up, discounted", () => {
    const at = (level: EngineeringLevel) => evaluateProfile(input([], level, { profile, semanticAssessments: assessAll(profile, level, () => 70) }), C);
    expect(component(at("fresher"), "professional_experience")?.status).toBe("missing");
    const sde1 = component(at("sde1"), "professional_experience")!.score!, sde2 = component(at("sde2"), "professional_experience")!.score!;
    expect(sde1).toBeGreaterThan(sde2);
    expect(sde1).toBeLessThan(component(at("sde1"), "internship_experience")!.score!);
  });

  it("applies diminishing internship-duration returns and keeps structured company context capped", () => {
    const duration = (months: number) => normalizeInternship({ durationMonths: months, technicalDepth: 80 }, C).measures.find((m) => m.factor === "duration")!.normalizedValue;
    expect(duration(1)).toBeLessThan(duration(3)); expect(duration(3)).toBeLessThan(duration(6)); expect(duration(12)).toBeLessThan(100);
    expect(duration(6) - duration(3)).toBeGreaterThan(duration(12) - duration(9));
    expect(normalizeInternship({ durationMonths: 3 }, C).score).toBeNull(); // dates alone are not internship quality
  });
});

describe("v5 core and bonus components", () => {
  const leetcode = fragment("leetcode", { solved: { easy: 120, medium: 180, hard: 30 }, byTopic: [{ topic: "Array", count: 90 }, { topic: "Dynamic Programming", count: 40 }, { topic: "Graph", count: 20 }], contest: { attended: 12, rating: 1650, topPercent: 18 } });
  const project = { name: "QueueLite", description: "A Redis-backed job queue.", tech: ["Go"], bullets: ["Benchmarked 10k jobs/s."], link: null };
  const internship = { title: "Software Engineering Intern", startDate: "2025-05", endDate: "2025-07", bullets: ["Built a React dashboard used by 200 employees."] };
  const job = { title: "Software Engineer", startDate: "2024-07", endDate: "Present", bullets: ["Owned the payments reconciliation service end to end, cutting manual review by 60%."] };
  const run = (level: EngineeringLevel, profile: ScoringProfile, fragments: ScoringInput["fragments"] = [leetcode]) =>
    evaluateProfile(input(fragments, level, { profile, semanticAssessments: assessAll(profile, level, () => 60) }), C);
  const student = { ...emptyProfile(), projects: [project] };

  it("marks every component core or bonus, and every level has core parts", () => {
    for (const level of ENGINEERING_LEVELS) expect(C.v5Policy!.coreComponents[level].length).toBeGreaterThan(0);
    const result = run("fresher", student);
    expect(component(result, "problem_solving")?.role).toBe("core");
    expect(component(result, "open_source")?.role).toBe("bonus");
  });

  it("counts a missing core part as 0", () => {
    const withDsa = run("fresher", student), withoutDsa = run("fresher", student, []);
    expect(component(withoutDsa, "problem_solving")).toMatchObject({ role: "core", status: "missing", counted: true, contribution: 0 });
    // Exactly what the LeetCode fragment fed is lost: the DSA part and its contest part.
    const lost = component(withDsa, "problem_solving")!.contribution! + (component(withDsa, "competitive_programming")?.contribution ?? 0);
    expect(withDsa.score! - withoutDsa.score!).toBeCloseTo(lost, 1);
    expect(withoutDsa.warnings).toContain("DSA & problem solving has no evidence; it is core at fresher, so it counts as 0");
    // Professional experience is core from SDE-1: no job is a real gap there.
    expect(run("sde1", student).score!).toBeLessThan(run("sde1", { ...student, experience: [job] }).score!);
  });

  it("counts a required part with no AI assessment as 0: nothing else stands in for it", () => {
    const profile = { ...student, experience: [job] };
    const failed = evaluateProfile(input([leetcode], "sde1", { profile, semanticAssessments: [] }), C);
    expect(component(failed, "professional_experience")).toMatchObject({ role: "core", status: "missing", counted: true, contribution: 0 });
    expect(failed.warnings).toContain("Professional experience has no AI assessment (it failed or has not run yet); it is required at sde1, so it counts as 0");
    expect(failed.score!).toBeLessThan(run("sde1", profile).score!);
    // The resume claim keeps its own share; the missing AI judgment counts as 0 instead of the claim standing in for it.
    const claim = C.v5Policy!.semantic.dimensions.ownership!.claimWeight, judged = C.v5Policy!.semantic.dimensions.ownership!.semanticWeight;
    expect(component(failed, "ownership")!.score!).toBeGreaterThan(0);
    expect(component(failed, "ownership")!.score!).toBeLessThanOrEqual(100 * claim / (claim + judged));
  });

  it("never goes above 100", () => {
    const strong = { ...student, experience: [internship] };
    expect(evaluateProfile(input([leetcode], "fresher", { profile: strong, semanticAssessments: assessAll(strong, "fresher", () => 100) }), C).score!).toBeLessThanOrEqual(100);
  });

  it("scores as a plain weighted sum over every part: each part adds weight x score / 100, a missing part adds 0", () => {
    const result = run("fresher", { ...student, experience: [internship] });
    const expected = result.components.reduce((sum, c) => sum + c.weight * (c.score ?? 0) / 100, 0);
    expect(result.score).toBeCloseTo(expected, 1);
    expect(result.components.every((c) => c.counted)).toBe(true);
    expect(component(result, "open_source")).toMatchObject({ role: "bonus", status: "missing", counted: true, contribution: 0 });
    expect(result.warnings).toContain(`Open-source contribution: no evidence; extra credit at fresher (${C.weights.fresher!.open_source} of 100) not earned`);
  });

  it("replays older configs with their core-base + bonus-lift formula", () => {
    const legacy = { ...C, v5Policy: { ...C.v5Policy!, formula: undefined } };
    const profile = { ...student, experience: [internship] };
    const result = evaluateProfile(input([leetcode], "fresher", { profile, semanticAssessments: assessAll(profile, "fresher", () => 60) }), legacy);
    const core = C.v5Policy!.coreComponents.fresher, byId = Object.fromEntries(result.components.map((c) => [c.id, c]));
    const coreWeight = core.reduce((sum, id) => sum + byId[id]!.weight, 0), base = core.reduce((sum, id) => sum + byId[id]!.weight * (byId[id]!.score ?? 0), 0) / coreWeight;
    const lift = result.components.filter((c) => c.role === "bonus" && c.score !== null).reduce((sum, c) => sum + c.weight / 100 * c.score! / 100, 0);
    expect(result.score).toBeCloseTo(base + (100 - base) * Math.min(1, lift), 1);
  });

  it("separates an extraordinary candidate from a typical one by a real margin", () => {
    const typical = run("sde1", { ...student, experience: [job] }, [leetcode]);
    const strong = fragment("leetcode", { solved: { easy: 400, medium: 900, hard: 350 }, byTopic: [{ topic: "Array", count: 300 }, { topic: "Dynamic Programming", count: 200 }, { topic: "Graph", count: 120 }, { topic: "Tree", count: 90 }], contest: { attended: 60, rating: 2400, topPercent: 0.5 } });
    const oss = fragment("github", { languages: [], mergedPullRequests: ["apache/airflow", "pytorch/pytorch"].map((repo) => ({ repo, stars: 40_000, additions: 600, deletions: 40, changedFiles: 8, docsOnly: false, mergedAt: "2026-08-01T00:00:00.000Z", title: "Add streaming executor" })) });
    const extraordinary = run("sde1", { ...student, experience: [job], achievements: ["Google Summer of Code 2025 contributor"] }, [strong, oss]);
    expect(extraordinary.score! - typical.score!).toBeGreaterThan(15);
  });

  it("every part adds in proportion to its weight: a weak extra part still adds, never subtracts", () => {
    const base = run("fresher", student), withInternship = run("fresher", { ...student, experience: [internship] });
    expect(component(withInternship, "internship_experience")).toMatchObject({ role: "bonus", counted: true });
    expect(withInternship.score!).toBeGreaterThan(base.score!);
    const weak = run("fresher", student, [leetcode, fragment("github", { languages: [], mergedPullRequests: [{ repo: "org/x", stars: 0, additions: 12, deletions: 0, changedFiles: 1, docsOnly: false, mergedAt: "2025-01-01T00:00:00.000Z", title: "Add option" }] })]);
    expect(component(weak, "open_source")!.score!).toBeLessThan(base.score!);
    expect(weak.score!).toBeGreaterThanOrEqual(base.score!);
  });

  it("explains the score exactly: contributions add up to it", () => {
    for (const result of [run("fresher", { ...student, experience: [internship] }), run("sde2", { ...student, experience: [job] })]) {
      expect(result.components.reduce((sum, c) => sum + (c.contribution ?? 0), 0)).toBeCloseTo(result.score!, 1);
    }
  });

  it("has no score until a core part has evidence, and measures coverage on core weight", () => {
    expect(evaluateProfile(input([], "fresher"), C).score).toBeNull();
    const thin = run("fresher", { ...emptyProfile() });
    const coreWeight = C.v5Policy!.coreComponents.fresher.reduce((sum, id) => sum + C.weights.fresher![id]!, 0);
    expect(thin.coverage).toBeCloseTo(100 * C.weights.fresher!.problem_solving! / coreWeight, 1);
  });
});

describe("v5 open source", () => {
  const pr = (repo: string, stars: number, lines: number, extra: Record<string, unknown> = {}) =>
    ({ repo, stars, additions: lines, deletions: 0, changedFiles: 3, docsOnly: false, mergedAt: "2026-08-01T00:00:00.000Z", title: "Add streaming parser", ...extra });
  const github = (prs: unknown[]) => fragment("github", { languages: [], externalPRs: prs.length, mergedPullRequests: prs });

  it("scores merged PRs to other people's projects of any size, and ignores trivial ones", () => {
    const result = evaluateProfile(input([github([pr("org/big", 12_000, 400), pr("org/big", 12_000, 2, { title: "Fix typo" }), pr("friend/toy", 0, 500), pr("org/docs", 900, 5, { docsOnly: true })])]), C);
    expect(component(result, "open_source")?.status).toBe("available");
    // No star floor: the 0-star project counts (its reach is 0, a separate sub-feature); the typo and the 5-line docs change do not.
    expect(result.evidence.find((e) => e.feature === "merged_contributions")?.rawValue).toMatchObject({ qualifyingMergedPRs: 2, excluded: 2 });
    expect(result.warnings).toContain("2 merged pull request(s) not counted (trivial change)");
    expect(component(evaluateProfile(input([github([pr("org/big", 12_000, 1, { title: "typo", changedFiles: 1 })])]), C), "open_source")?.status).toBe("missing");
  });

  it("rewards reach and depth over PR count, with diminishing returns", () => {
    const significant = evaluateProfile(input([github([pr("org/big", 20_000, 900), pr("tools/cli", 3_000, 300)])]), C);
    const many = evaluateProfile(input([github(Array.from({ length: 8 }, (_, i) => pr(`small/p${i % 2}`, 12, 15)))]), C);
    expect(component(significant, "open_source")!.score!).toBeGreaterThan(component(many, "open_source")!.score!);
    expect(component(evaluateProfile(input([github(Array.from({ length: 100 }, (_, i) => pr(`org/p${i}`, 50_000, 5_000)))]), C), "open_source")!.score!).toBeLessThanOrEqual(100);
  });

  it("keeps open source a substantial part at every level", () => {
    for (const level of ENGINEERING_LEVELS) expect(C.weights[level]!.open_source!).toBeGreaterThanOrEqual(10);
  });
});

describe("v5 evidence model", () => {
  it("emits typed, versioned evidence with raw/normalized values and bounded legacy LLM assessments", () => {
    expect(validateLLMAssessment({ dimension: "impact", score: 101, confidence: 100, evidenceRefs: ["x"] })).toBeNull();
    expect(validateLLMAssessment({ dimension: "impact", score: 80, confidence: 100, evidenceRefs: [] })).toBeNull();
    const result = evaluateProfile(input([fragment("leetcode", { solved: { hard: 75 }, contest: { attended: 3, rating: 1900 } })], "fresher",
      { llmAssessments: [{ dimension: "implementation", score: 80, confidence: 100, evidenceRefs: ["fragments.leetcode.competition.difficulty"] }] }), C);
    expect(result.evidence.length).toBeGreaterThan(0);
    expect(result.evidence.every((e) => e.evidenceType && e.algorithmVersion === "profile-beta-v5" && "rawValue" in e && "normalizedValue" in e && "scoreContribution" in e && e.confidence === 100)).toBe(true);
    expect(result.evidence.find((e) => e.feature === "leetcode_contest")).toMatchObject({ evidenceType: "DERIVED", source: "leetcode" });
  });
});
