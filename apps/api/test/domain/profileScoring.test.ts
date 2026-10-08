import { describe, expect, it } from "vitest";
import { evaluateProfile } from "../../src/domain/profileScoring/engine.js";
import { DEFAULT_SCORING_CONFIG, LEGACY_V1_SCORING_CONFIG, validateScoringConfig } from "../../src/domain/profileScoring/config.js";
import { buildScoringInput, normalizeScoringInput } from "../../src/domain/profileScoring/adapters.js";
import { normalizeAchievement } from "../../src/domain/profileScoring/achievements.js";
import { experienceMonths } from "../../src/domain/profileScoring/experience.js";
import { ENGINEERING_LEVELS, type ScoringConfig, type ScoringInput, type ScoringProfile } from "../../src/domain/profileScoring/types.js";
import { hashJson } from "../../src/domain/profileScoring/sanitization.js";
import type { CandidateProfileDoc, ProfileFragmentDoc } from "../../src/db/mongo/client.js";

const asOf = "2026-10-04T00:00:00.000Z";
const profile = (fields: Partial<ScoringProfile> = {}): ScoringProfile => ({ headline: null, education: [], experience: [], projects: [], skills: [], achievements: [], ...fields });
const input = (data: Record<string, unknown> = {}, source = "leetcode", fields: Partial<ScoringInput> = {}): ScoringInput => ({
  asOf, declaredLevel: null, profile: null, fragments: [{ source, data, fetchedAt: asOf, contentHash: "untrusted-original" }], ...fields,
});
const component = (value: ReturnType<typeof evaluateProfile>, id: string) => value.components.find((x) => x.id === id);
const config = (): ScoringConfig => structuredClone(DEFAULT_SCORING_CONFIG);

describe("profile-scoring deterministic beta evidence engine", () => {
  it("evaluates all eight shared levels without aliasing Intern/Fresher or Principal/Distinguished", () => {
    expect(DEFAULT_SCORING_CONFIG.version).toBe("profile-beta-v4");
    expect(Object.keys(DEFAULT_SCORING_CONFIG.weights).sort()).toEqual([...ENGINEERING_LEVELS].sort());
    for (const declaredLevel of ENGINEERING_LEVELS) {
      const result = evaluateProfile(input({}, "github", { declaredLevel }));
      expect(result.level).toBe(declaredLevel);
      expect(result.classification.declaredLevel).toBe(declaredLevel);
      expect(result.score).toBeNull();
      expect(result.eligibility.eligible).toBe(false);
    }
    const intern = evaluateProfile(input({ solved: { easy: 100, medium: 150, hard: 75 } }, "leetcode", { declaredLevel: "intern" }));
    expect(intern.components.find((c) => c.id === "coding")?.weight).toBe(20);
    expect(intern.components.find((c) => c.id === "implementation")?.label).toContain("Intern");
    expect(intern.classification.warnings.join(" ")).toContain("not the Fresher rubric");
    expect(intern.eligibility.reasons.join(" ")).toContain("Fresher is not an Intern classification");
    expect(DEFAULT_SCORING_CONFIG.weights.intern).not.toEqual(DEFAULT_SCORING_CONFIG.weights.fresher);
    expect(DEFAULT_SCORING_CONFIG.weights.distinguished).not.toEqual(DEFAULT_SCORING_CONFIG.weights.principal);
  });

  it("keeps distinguished evidence missing without a cited, adopted engineering contribution and never promotes by title", () => {
    const withClaim = (claim: string) => input({}, "github", { declaredLevel: "distinguished", profile: profile({
      headline: "Distinguished Engineer", projects: [{ name: null, description: claim, tech: null, bullets: null, link: null }],
    }) });
    for (const claim of ["Industry thought leader with strategic impact.", "Authored RFC 1234.", "Authored RFC 1234 adopted by 1 independent organizations and improved platform reliability by 20%.", "Plan to author RFC 1234 adopted by 3 independent organizations and improved platform reliability by 20%."]) {
      expect(component(evaluateProfile(withClaim(claim)), "industry_contribution")?.score).toBeNull();
    }
    const result = evaluateProfile(withClaim("Authored RFC 1234 adopted by 3 independent organizations and improved platform reliability by 20%."));
    expect(component(result, "industry_contribution")).toMatchObject({ weight: 30, score: 70, label: "Cited industry contribution (unverified)" });
    const ids = component(result, "industry_contribution")!.evidenceIds;
    expect(result.evidence.filter((e) => ids.includes(e.id))).toEqual([expect.objectContaining({
      path: "profile.projects[0].description", verification: "self_reported", confidence: 45,
      claim: expect.stringContaining("RFC 1234"),
    })]);
    expect(result.classification.assessedLevel).not.toBe("distinguished");
    expect(result.eligibility.reasons.join(" ")).toContain("not independently verified");
  });

  it("requires exactly six original rubrics for v1 replay and all eight for current/custom configs", () => {
    expect(() => validateScoringConfig(LEGACY_V1_SCORING_CONFIG)).not.toThrow();
    const sixAsV2 = structuredClone(LEGACY_V1_SCORING_CONFIG);
    sixAsV2.version = "profile-beta-v2";
    expect(() => validateScoringConfig(sixAsV2)).toThrow("eight");
    const eightAsV1 = config(); eightAsV1.version = "profile-beta-v1";
    expect(() => validateScoringConfig(eightAsV1)).toThrow("six");
    const oldWithNewComponent = structuredClone(LEGACY_V1_SCORING_CONFIG);
    oldWithNewComponent.weights.principal = { industry_contribution: 100 };
    expect(() => validateScoringConfig(oldWithNewComponent)).toThrow("Invalid weight");
    for (const declaredLevel of ["intern", "distinguished"] as const) {
      expect(() => evaluateProfile(input({}, "github", { declaredLevel }), LEGACY_V1_SCORING_CONFIG)).toThrow("original six");
    }
  });

  it("replays six-level v1 results against pre-upgrade golden hashes, isolated from v2 policy", () => {
    const oldInput = input({}, "leetcode", { profile: profile({ skills: ["TypeScript"], projects: [{ name: null, description: null, tech: null, link: null, bullets: [
      "Built and deployed the platform with tests.", "Owned the platform end-to-end.", "Reduced platform latency by 30%.",
      "Designed the distributed platform across multiple teams balancing consistency and availability.", "Led technical architecture standards adopted across multiple teams.",
      "Defined organization-wide technical strategy and multi-year investment roadmap.", "Reduced organization-wide platform latency by 50%.",
    ] }] }), fragments: [
      { source: "leetcode", data: { solved: { easy: 100, medium: 150, hard: 75 }, byTopic: [{ topic: "array", count: 10 }], contest: { attended: 4, rating: 1800 }, recentActivity: { last30Days: 15 } }, fetchedAt: asOf, contentHash: "" },
      { source: "github", data: { languages: [{ name: "TypeScript", bytes: 10 }] }, fetchedAt: asOf, contentHash: "" },
    ] });
    const hashes = {
      unset: "81fd088ef9e6a08e98bb8e722df8fc68d48621eb47337dfb041e91430eb588a1",
      fresher: "7c3f2490af9e47b6cd8a2465211a32bfa62e4005a017abb970a3e6ff443959ba",
      sde1: "e9e4216083d4f1b12cf0a9d6eed4e5f874a59f22b9560497789998b667aae760",
      sde2: "5a925fa7eb6377d10e7a25bad4aa8d4e8d80f6e51b59ac7c19b2bda7ce7ed2ae",
      sde3: "17195e29ac7ce72aedf86cde7c64e5df7043db48a92f77c668ff2578eeca5397",
      staff: "701e4e8050cbd2b5a9d66a0e3772feb9ad91e52706096394f1d28a5dce769e57",
      principal: "ec6e7e51f4c0860cdab18cf64f280c55145f7c3810f5d6482909d779426851c6",
    };
    for (const declaredLevel of [null, "fresher", "sde1", "sde2", "sde3", "staff", "principal"] as const) {
      const replay = evaluateProfile({ ...oldInput, declaredLevel }, LEGACY_V1_SCORING_CONFIG);
      expect(hashJson(replay)).toBe(hashes[declaredLevel ?? "unset"]);
      expect(evaluateProfile({ ...oldInput, declaredLevel }).configHash).not.toBe(replay.configHash);
    }
    expect(Object.isFrozen(LEGACY_V1_SCORING_CONFIG.weights.principal)).toBe(true);
  });

  it("returns unknown/null without scoreable evidence and honest missing/unsupported sources", () => {
    const result = evaluateProfile(input({ arbitrarySecret: "private" }, "unsupported"));
    expect(result.score).toBeNull(); expect(result.coverage).toBe(0); expect(result.confidence).toBe(0);
    expect(result.status).toBe("insufficient_evidence"); expect(result.eligibility.eligible).toBe(false);
    expect(result.sources.find((x) => x.source === "unsupported")?.status).toBe("unsupported");
    expect(result.warnings.some((x) => x.includes("unsupported"))).toBe(true);
  });

  it("normalizes only available weights; missing evidence is not zero", () => {
    const result = evaluateProfile(input({ solved: { hard: 75 } }));
    expect(result.score).toBe(100); expect(result.coverage).toBe(30); expect(result.confidence).toBe(31.5); // 90 × 35% observed hard bucket
    expect(component(result, "topics")?.score).toBeNull(); expect(component(result, "coding")?.contribution).toBe(100);
    expect(result.eligibility.eligible).toBe(false);
    const zero = evaluateProfile(input({ solved: { easy: 0, medium: 0, hard: 0 } }));
    expect(zero.score).toBe(0); expect(zero.status).toBe("scored");
  });

  it("caps solve difficulty and breadth, deduplicates tags and validates contest denominators", () => {
    const base = { solved: { easy: 100, medium: 150, hard: 75 }, byTopic: [{ topic: "Array", count: 5 }, { topic: "Array", count: 500 }], contest: { attended: 10, globalRanking: 1, totalParticipants: 100 } };
    const result = evaluateProfile(input(base));
    expect(component(result, "coding")?.score).toBe(100);
    expect(component(result, "topics")?.score).toBe(10); expect(component(result, "contest")?.score).toBe(100);
    expect(evaluateProfile(input({ solved: { easy: 100000, medium: 100000, hard: 100000 } })).score).toBe(100);
    const invalid = evaluateProfile(input({ contest: { attended: 1, globalRanking: 1, totalParticipants: 0, topPercent: 0 } }));
    expect(component(invalid, "contest")?.score).toBeNull(); expect(invalid.score).toBeNull();
    expect(invalid.warnings.some((x) => x.includes("denominator"))).toBe(true);
  });

  it("keeps optional query failures unknown rather than fabricated zero activity", () => {
    const result = evaluateProfile(input({ partial: true, solved: { medium: 150 }, contest: null, recentActivity: { last30Days: 0 } }));
    expect(component(result, "activity")?.score).toBeNull(); expect(component(result, "contest")?.score).toBeNull();
    expect(component(result, "coding")?.score).toBe(100); expect(result.sources.find((x) => x.source === "leetcode")?.status).toBe("partial");
  });

  it("scores language corroboration only; PR count, repo names, stars and commits confer no complexity score", () => {
    const result = evaluateProfile(input({ languages: [{ name: "TypeScript", bytes: 100 }], externalPRs: 99999, topRepos: [{ name: "distributed-architecture", stars: 99999 }], commits: 99999 }, "github", { profile: profile({ skills: ["TypeScript"] }) }));
    expect(result.score).toBe(70); expect(result.coverage).toBe(10);
    expect(component(result, "implementation")?.score).toBeNull();
    expect(evaluateProfile(input({ externalPRs: 100000, topRepos: [{ stars: 100000 }] }, "github")).score).toBeNull();
  });

  it("does not promote from title, tenure, target role, adjectives or keyword lists", () => {
    const result = evaluateProfile(input({}, "github", { profile: profile({ headline: "Principal Staff Software Engineer", experience: [{ title: "Principal Engineer", startDate: "2000-01", endDate: "Present", bullets: ["Architecture, ownership, impact, distributed, platform, strategic, cross-team"] }] }) }));
    expect(result.classification.assessedLevel).toBe("fresher"); expect(result.score).toBeNull();
  });

  it("assesses multifactor scope separately, caps self-report confidence and flags declared mismatch", () => {
    const resume = profile({ experience: [{ title: "Engineer", startDate: "2021-01", endDate: "Present", bullets: [
      "Built and deployed an API with integration tests.", "Owned the service end-to-end and incident response.",
      "Reduced service latency by 40%.", "Designed a distributed system balancing consistency and availability.",
    ] }] });
    const result = evaluateProfile(input({}, "github", { profile: resume, declaredLevel: "principal" }));
    expect(result.classification.assessedLevel).toBe("sde3"); expect(result.level).toBe("principal");
    expect(result.classification.confidence).toBe(45); expect(result.confidence).toBe(45);
    expect(result.classification.warnings.some((x) => x.includes("differs"))).toBe(true);
    expect(result.eligibility.eligible).toBe(false);
    expect(result.evidence.filter((x) => x.source === "resume").every((x) => x.verification === "self_reported")).toBe(true);
  });

  it("has genuinely distinct Staff/Principal rubrics and requires organizational strategy/impact", () => {
    const bullets = ["Built and deployed the platform with tests.", "Owned the platform end-to-end.", "Reduced platform latency by 30%.",
      "Designed the distributed platform across multiple teams balancing consistency and availability.", "Led technical architecture standards adopted across multiple teams."];
    const withBullets = (value: string[]) => profile({ projects: [{ name: null, description: null, tech: null, link: null, bullets: value }] });
    const staff = evaluateProfile(input({}, "github", { profile: withBullets(bullets) }));
    expect(staff.classification.assessedLevel).toBe("staff"); expect(staff.components.some((x) => x.id === "strategy")).toBe(false);
    const principal = evaluateProfile(input({}, "github", { profile: withBullets([...bullets, "Defined organization-wide technical strategy and multi-year investment roadmap.", "Reduced organization-wide platform latency by 50%."]) }));
    expect(principal.classification.assessedLevel).toBe("principal"); expect(component(principal, "strategy")?.weight).toBe(40);
    expect(principal.eligibility.eligible).toBe(false);
  });

  it("unions overlapping experience months and rejects invalid/future/reversed dates", () => {
    const entries = [["2026-01", "2026-06"], ["2026-04", "Present"], ["2026-11", "2026-12"], ["2026-08", "2026-01"], ["yesterday", "Present"], ["2026-02-31", "2026-03"], ["2026-10-05", "Present"], ["2026-01-30", "2026-01-01"]];
    const result = experienceMonths(profile({ experience: entries.map(([startDate, endDate]) => ({ title: null, startDate: startDate!, endDate: endDate!, bullets: null })) }), asOf);
    expect(result.months).toBe(10); expect(result.warnings).toHaveLength(6);
  });

  it("anchors recent activity to original window and never decays permanent solved attainment", () => {
    const old = "2026-09-04T00:00:00.000Z";
    const data = { solved: { hard: 75 }, recentActivity: { last30Days: 15, windowAsOf: old } };
    const result = evaluateProfile(input(data));
    expect(component(result, "activity")?.score).toBe(50); expect(component(result, "coding")?.score).toBe(100);
    const refreshed = evaluateProfile(input(data, "leetcode", { fragments: [{ source: "leetcode", data, fetchedAt: "2026-10-03T00:00:00.000Z", contentHash: "fresh" }] }));
    expect(component(refreshed, "activity")?.score).toBe(50);
    const future = evaluateProfile(input(data, "leetcode", { fragments: [{ source: "leetcode", data, fetchedAt: "2027-01-01T00:00:00Z", contentHash: "future" }] }));
    expect(future.score).toBeNull();
  });

  it("freezes whitelisted, sorted/deduplicated PII-free replay input and canonical hashes", () => {
    const document: CandidateProfileDoc = { _id: "id", userId: "user", fullName: "Jane Doe", email: "jane@example.com", phone: "+15551234567", location: "Seattle", headline: "Engineer Jane Doe at SecretCo in Seattle", targetRole: "Principal", education: [{ institution: "Private School", degree: "BSc", field: "CS", grade: null, startYear: "2020", endYear: "2024" }], experience: [{ company: "SecretCo", location: "Seattle", title: "Engineer", startDate: "2024-01", endDate: "Present", bullets: ["Built API at SecretCo. jane@example.com https://example.com?token=secret", "password=secret", "Built API at SecretCo. jane@example.com https://example.com?token=secret"] }], projects: [], skills: ["TypeScript", "Go", "Go"], achievements: [], detectedLinks: { github: null, leetcode: null, linkedin: null }, resumeFilename: "private.pdf", resumeParsedAt: null, createdAt: new Date(asOf), updatedAt: new Date(asOf) };
    const fragment: ProfileFragmentDoc = { _id: "fragment", userId: "user", source: "GITHUB", fetchedAt: new Date(asOf), version: 1, contentHash: "raw", data: { name: "Jane Doe", login: "secret-user", accessToken: "SECRET", languages: [{ name: "Go", bytes: 10 }, { name: "TypeScript", bytes: 20 }], topRepos: [{ name: "SecretCo", stars: 1000 }] } };
    const frozen = buildScoringInput(document, [fragment], { asOf, declaredLevel: null });
    expect(Object.isFrozen(frozen)).toBe(true); expect(Object.isFrozen(frozen.profile?.experience[0]?.bullets)).toBe(true);
    const serialized = JSON.stringify(frozen);
    for (const secret of ["Jane Doe", "jane@example.com", "Seattle", "SecretCo", "Private School", "SECRET", "secret-user", "https://", "password=", "private.pdf"]) expect(serialized).not.toContain(secret);
    const reversed = buildScoringInput({ ...document, skills: [...document.skills].reverse() }, [{ ...fragment, data: { ...fragment.data, languages: [...fragment.data.languages as unknown[]].reverse() } }], { asOf, declaredLevel: null });
    expect(evaluateProfile(frozen)).toEqual(evaluateProfile(reversed));
    expect(evaluateProfile(frozen).inputHash).toBe(evaluateProfile(normalizeScoringInput(frozen)).inputHash);
  });

  it("normalizes structured achievements without magic named-event wins or trusted verified flags", () => {
    expect(normalizeAchievement("GSoC winner ICPC champion")).toBeNull();
    expect(normalizeAchievement({ event: "GSoC", outcome: "completed", verified: true })?.verification).toBe("self_reported");
    expect(normalizeAchievement({ event: "ICPC", outcome: "winner", rank: 10, participants: 5 })).toBeNull();
    const a = evaluateProfile(input({ achievements: [{ event: "ICPC", outcome: "winner", rank: 1, participants: 100 }] }, "resume"));
    const b = evaluateProfile(input({ achievements: [{ kind: "competition", event: "Small local contest", outcome: "winner", rank: 1, participants: 100 }] }, "resume"));
    expect(a.score).toBe(b.score); expect(a.confidence).toBe(45); expect(a.eligibility.eligible).toBe(false);
    expect(evaluateProfile(input({}, "resume", { profile: profile({ achievements: ["GSoC winner ICPC champion"] }) })).score).toBeNull();
  });

  it("requires coverage, confidence and used verified evidence for eligibility", () => {
    const result = evaluateProfile(input({ solved: { easy: 100, medium: 150, hard: 75 }, byTopic: Array.from({ length: 10 }, (_, i) => ({ topic: `topic-${i}`, count: 5 })), contest: { attended: 10, rating: 2400 }, recentActivity: { last30Days: 15 } }));
    expect(result.coverage).toBe(65); expect(result.confidence).toBe(90); expect(result.eligibility.eligible).toBe(true);
  });

  it("rejects invalid configuration and dates and changes config hash when policy changes", () => {
    expect(() => validateScoringConfig(DEFAULT_SCORING_CONFIG)).not.toThrow();
    for (const mutate of [(x: ScoringConfig) => { x.weights.fresher.coding = -1; }, (x: ScoringConfig) => { x.weights.staff.impact = 1; }, (x: ScoringConfig) => { x.normalizers.hardCap = 0; }, (x: ScoringConfig) => { x.normalizers.ratingCeiling = x.normalizers.ratingFloor!; }, (x: ScoringConfig) => { x.thresholds.minimumConfidence = 101; }, (x: ScoringConfig) => { x.thresholds.minimumCohort = 1; }]) {
      const policy = config(); mutate(policy); expect(() => validateScoringConfig(policy)).toThrow();
    }
    const policy = config(); policy.normalizers.hardCap = 100;
    expect(evaluateProfile(input({ solved: { hard: 75 } }), policy).configHash).not.toBe(evaluateProfile(input({ solved: { hard: 75 } })).configHash);
    expect(() => evaluateProfile({ ...input(), asOf: "2026-02-31" })).toThrow();
    expect(() => evaluateProfile({ ...input(), asOf: "tomorrow" })).toThrow();
  });
});
