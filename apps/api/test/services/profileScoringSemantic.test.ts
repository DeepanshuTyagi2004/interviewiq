import { beforeEach, describe, expect, it } from "vitest";
import { ProfileScoringService } from "../../src/services/profileScoring.js";
import { PROFILE_BETA_V5_SCORING_CONFIG } from "../../src/domain/profileScoring/config.js";
import type { ProfileScoringAssessmentRequest } from "../../src/integrations/aiService/types.js";

const userId = "00000000-0000-4000-8000-000000000001";
const asOf = new Date("2026-10-04T00:00:00Z");

/** In-memory stand-ins for exactly the repository surface the producer and `get()` use. */
function harness(options: { failAssessment?: boolean } = {}) {
  const semantic = new Map<string, Record<string, unknown>>(), companies = new Map<string, Record<string, unknown>>(), snapshots = new Map<string, Record<string, unknown>>();
  const requests: ProfileScoringAssessmentRequest[] = [], companyCalls: string[] = [];
  const profile = {
    userId, level: "fresher", fullName: "Asha Rao", email: "asha@example.com", phone: null, location: "Pune", headline: null, targetRole: "Backend Engineer", targetJdId: null,
    education: [], skills: [], achievements: [],
    experience: [{ company: "Acme Payments", title: "Backend Intern", startDate: "2025-05", endDate: "2025-07", location: "Bengaluru", bullets: ["Built a payout reconciliation API at Acme Payments used by 40 merchants; cut manual review by 60%."] }],
    projects: [{ name: "QueueLite", description: "A Redis-backed job queue with retries and dead-letter handling.", tech: ["Go", "Redis"], bullets: ["Benchmarked 10k jobs/s with integration tests in CI."], link: null }],
    detectedLinks: { github: null, leetcode: null, linkedin: null }, resumeFilename: null, resumeParsedAt: null, updatedAt: asOf,
  };
  const ai = {
    async assessProfileScoring(request: ProfileScoringAssessmentRequest) {
      requests.push(request);
      if (options.failAssessment) throw new Error("upstream down");
      const item = [...(request.projects ?? []), ...(request.experience ?? []), ...(request.internships ?? [])][0]!;
      return { assessments: request.requestedFeatures.map((feature, i) => {
        const key = typeof feature === "string" ? feature : feature.key, quoted = i % 4 !== 3;
        return { feature: key, value: quoted ? 60 : 0, rationale: "r", evidenceExcerpts: quoted ? [item.excerpts?.[0] ?? item.title] : [], evidenceType: "INFERRED" as const };
      }), provider: "fake", model: "fake-1", generatedAt: asOf.toISOString(), algorithmVersion: "profile-scoring-assessment-v1" as const, promptVersion: "profile-scoring-assessment-prompt-v5" as const };
    },
    async companyContext(name: string) {
      companyCalls.push(name);
      return { known: true, industry: "fintech", companySize: "1001-5000" as const, engineeringSize: "201-500" as const, productType: "product" as const, technicalDomains: ["payments"], knownTechnologies: [],
        internshipProgram: null, internshipSelectivity: null, geographicScope: "national" as const, companyStage: "late-stage" as const, basis: "model_knowledge" as const, evidenceUrls: [], provider: "f", model: "f",
        companyHeadcount: null, engineeringHeadcount: null, sizeEvidence: null,
        generatedAt: asOf.toISOString(), promptVersion: "profile-scoring-company-context-prompt-v5" as const };
    },
  };
  const repo = {
    settings: async () => ({ declaredLevel: null, leaderboardOptIn: false }), settingsRevision: async () => null,
    semanticAssessments: async (id: string) => [...semantic.values()].filter((doc) => doc.userId === id),
    saveSemanticAssessment: async (doc: Record<string, unknown>) => { semantic.set(String(doc._id), doc); },
    pruneSemanticAssessments: async (id: string, keep: string[]) => { for (const [key, doc] of semantic) if (doc.userId === id && !keep.includes(key)) semantic.delete(key); },
    company: async (key: string) => companies.get(key) ?? null, saveCompany: async (doc: Record<string, unknown>) => { companies.set(String(doc._id), doc); },
    findSnapshot: async (id: string) => snapshots.get(id) ?? null, save: async (doc: Record<string, unknown>) => { snapshots.set(String(doc._id), doc); return doc; },
    history: async () => [], latestForWeek: async () => [],
  };
  const service = new ProfileScoringService({
    repo: repo as never, users: { findById: async () => ({ id: userId, name: "Asha Rao", email: "asha@example.com" }) } as never,
    profiles: { findByUserId: async () => profile } as never, fragments: { findByUserId: async () => [] } as never,
    github: { findByUserId: async () => null } as never, leetcode: { findByUserId: async () => null } as never,
    preferences: { get: async () => ({ privacy: { leaderboardVisibility: "name" }, updatedAt: asOf }) } as never,
    pseudonymKey: "k", schedulerEnabled: false, aiService: ai, companies: { findAll: async () => [] }, config: PROFILE_BETA_V5_SCORING_CONFIG, now: () => asOf,
  });
  return { service, profile, semantic, companies, requests, companyCalls };
}

describe("semantic item assessment producer", () => {
  let h: ReturnType<typeof harness>;
  beforeEach(() => { h = harness(); });

  it("assesses each item once with the user's level, never sending names, contacts or employers", async () => {
    expect(await h.service.refreshSemanticAssessments(userId)).toMatchObject({ assessed: 2, reused: 0, failed: 0 });
    expect(h.requests).toHaveLength(2);
    for (const request of h.requests) {
      expect(request.userContext.declaredLevel).toBe("fresher");
      const sent = JSON.stringify(request);
      for (const secret of ["Asha", "asha@example.com", "Acme Payments", "Bengaluru", "Pune"]) expect(sent).not.toContain(secret);
    }
    expect(h.companyCalls).toEqual(["Acme Payments"]); // company context resolved once, by name only
  });

  it("reuses unchanged items and re-assesses only an edited one", async () => {
    await h.service.refreshSemanticAssessments(userId);
    h.requests.length = 0;
    expect(await h.service.refreshSemanticAssessments(userId)).toMatchObject({ assessed: 0, reused: 2 });
    expect(h.requests).toHaveLength(0);
    h.profile.projects[0]!.bullets = ["Benchmarked 12k jobs/s with integration tests in CI."];
    expect(await h.service.refreshSemanticAssessments(userId)).toMatchObject({ assessed: 1, reused: 1 });
    expect(h.semantic.size).toBe(2); // the stale project assessment was pruned
  });

  it("stores unquoted features as unavailable and keeps no confidence", async () => {
    await h.service.refreshSemanticAssessments(userId);
    for (const doc of h.semantic.values()) {
      const features = doc.features as Record<string, unknown>[];
      expect(features.every((feature) => (feature.excerpts as string[]).length > 0 && !("confidence" in feature))).toBe(true);
    }
    const internship = [...h.semantic.values()].find((doc) => doc.itemType === "internship")!;
    expect(internship.companyContext).toEqual({ value: expect.any(Number), source: "company-model-knowledge" });
  });

  it("feeds stored assessments into the deterministic score without calling the model on read", async () => {
    const before = await h.service.get(userId);
    expect(before.current?.components.find((c) => c.id === "projects")?.status).toBe("missing");
    await h.service.refreshSemanticAssessments(userId);
    h.requests.length = 0;
    const after = await h.service.get(userId);
    expect(after.current?.components.find((c) => c.id === "projects")?.status).toBe("available");
    expect(after.current?.components.find((c) => c.id === "internship_experience")?.status).toBe("available");
    expect(h.requests).toHaveLength(0);
  });

  it("respects the batch budget and stores nothing for a failed call", async () => {
    expect(await h.service.refreshSemanticAssessments(userId, { budget: { remaining: 1 } })).toMatchObject({ assessed: 1, budgetExhausted: true });
    const failing = harness({ failAssessment: true });
    expect(await failing.service.refreshSemanticAssessments(userId)).toMatchObject({ assessed: 0, failed: 2 });
    expect(failing.semantic.size).toBe(0);
  });

  it("never falls back to an older assessment when a fresh one fails: the item counts as 0", async () => {
    const options = { failAssessment: false };
    const flaky = harness(options);
    await flaky.service.refreshSemanticAssessments(userId);
    expect(flaky.semantic.size).toBe(2);
    options.failAssessment = true;
    expect(await flaky.service.refreshSemanticAssessments(userId, { force: true })).toMatchObject({ assessed: 0, failed: 2 });
    expect(flaky.semantic.size).toBe(0);
    const score = await flaky.service.get(userId);
    expect(score.current?.components.find((c) => c.id === "projects")).toMatchObject({ status: "missing", role: "core", contribution: 0 });
  });

  it("rate-limits user-triggered refreshes", async () => {
    for (let i = 0; i < 3; i++) await h.service.assessNow(userId);
    await expect(h.service.assessNow(userId)).rejects.toMatchObject({ status: 429, code: "profile_scoring_assessment_rate_limited" });
  });
});
