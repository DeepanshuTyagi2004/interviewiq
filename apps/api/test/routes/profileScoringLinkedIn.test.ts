import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { LEGACY_V2_SCORING_CONFIG, LEGACY_V3_SCORING_CONFIG } from "../../src/domain/profileScoring/config.js";
import { evaluateProfile } from "../../src/domain/profileScoring/engine.js";
import { ProfileScoringService } from "../../src/services/profileScoring.js";
import { careerDraft } from "../../src/services/linkedinImport.js";
import { bearer, createTestEnv, createUser, type TestEnv } from "../support/harness.js";

let env: TestEnv;
beforeAll(async () => { env = await createTestEnv({ PROFILE_SCORING_SCHEDULER_ENABLED: "false" }); });
afterAll(() => env.close());
const claim = "Built and deployed a service with tests.";
const payload = (at: string) => ({ importMethod: "url", sourceUrl: "https://www.linkedin.com/in/local-fixture/", provider: "exa", retrievedAt: at, importedAt: at, partial: true,
  profile: { headline: null, about: claim, experience: [], education: [], projects: [], skills: [], achievements: [] },
  sections: [{ key: "about", label: "About", entries: [claim], sourceFile: null }],
  provenance: [{ section: "about", path: "profile.about", file: null, quote: claim,
    sourceUrl: "https://www.linkedin.com/in/local-fixture/", retrievedAt: at }], warnings: ["Public profile snapshot may be incomplete."] });
async function imported(userId: string, at: Date) {
  await env.c.repos.fragments.insert({ userId, source: "LINKEDIN", data: payload(at.toISOString()), contentHash: "receipt", version: 1, fetchedAt: at });
}

describe("LinkedIn v4 local scoring persistence integration", () => {
  it.each(["exa", "firecrawl"] as const)("scores exactly the %s URL fragment persisted by confirmation and removes it after source disconnect", async (provider) => {
    const user = await createUser(env);
    const token = await bearer(env, user);
    const id = randomUUID(), at = new Date(), expiresAt = new Date(at.getTime() + 60_000);
    const raw = payload(at.toISOString());
    const sourceProfile = { ...raw.profile, skills: ["TypeScript"], experience: [{ company: "Private Employer", title: "Principal",
      startDate: "2020-01", endDate: "Present", location: null, bullets: ["Owned the service end-to-end. Reduced service latency by 40%."] }] };
    const draft = { id, createdAt: at.toISOString(), expiresAt: expiresAt.toISOString(), method: "url" as const, profileRevision: null,
      profile: careerDraft(sourceProfile), sections: raw.sections.map((x) => ({ ...x, key: "about" as const })), warnings: raw.warnings,
      sourceUrl: raw.sourceUrl, provider, retrievedAt: raw.retrievedAt };
    await env.c.repos.linkedinImports.insert({ _id: id, userId: user.id, draft, sourceProfile, expiresAt,
      provenance: raw.provenance.map((x) => ({ ...x, section: "about" as const })) });
    const confirmation = await env.http.post(`/api/v1/users/me/linkedin/imports/${id}/confirm`).set("Authorization", token).send({ sections: ["about"], mergeProfile: false });
    expect(confirmation.status).toBe(200);
    const actual = (await env.c.repos.fragments.findByUserId(user.id))[0]!;
    expect(actual.source).toBe("LINKEDIN");
    expect(actual.data).toMatchObject({ importMethod: "url", provider, retrievedAt: at.toISOString(), partial: true, profile: { about: claim } });
    expect(actual.data.profile).not.toHaveProperty("skills");
    expect(actual.data.profile).not.toHaveProperty("experience");
    const result = await env.http.get("/api/v1/users/me/profile-score").set("Authorization", token);
    expect(result.status).toBe(200);
    expect(result.body.current).toMatchObject({ score: 85, confidence: 45, coverage: 15, classification: { assessedLevel: "fresher" } });
    expect(await env.c.repos.candidateProfiles.findByUserId(user.id)).toBeNull();
    expect((await env.http.delete("/api/v1/users/me/linkedin").set("Authorization", token)).status).toBe(204);
    const disconnected = await env.c.profileScoring.get(user.id);
    expect(disconnected.current!.score).toBeNull();
    expect(disconnected.current!.id).not.toBe(result.body.current.id);
    expect(disconnected.history.some((x) => x.id === result.body.current.id)).toBe(true);
    expect(env.fetch.calls).toHaveLength(0);
  });

  it("redacts profile-less account identity and excludes source URL/raw provider hashes from scoring identity", async () => {
    const user = await createUser(env, { name: "Private Owner" });
    const at = new Date();
    const raw = payload(at.toISOString());
    raw.profile.about = "Built and deployed a service with tests by Private Owner.";
    raw.provenance[0]!.quote = raw.profile.about;
    await env.c.repos.fragments.insert({ userId: user.id, source: "LINKEDIN", data: raw, contentHash: "private-url-hash", version: 1, fetchedAt: at });
    const first = await env.c.profileScoring.get(user.id);
    const frozen = (await env.c.repos.profileScoring.history(user.id))[0]!;
    expect(JSON.stringify(frozen.input)).not.toContain(user.name);
    expect(JSON.stringify(frozen.input)).not.toContain("linkedin.com");
    expect(JSON.stringify(frozen.input)).not.toContain("private-url-hash");
    const fragment = (await env.c.repos.fragments.findByUserId(user.id))[0]!;
    await env.c.repos.fragments.update(fragment._id, { data: { ...raw, sourceUrl: "https://www.linkedin.com/in/other-private-owner/" }, contentHash: "other-private-url-hash" });
    expect((await env.c.profileScoring.get(user.id)).current!.id).toBe(first.current!.id);
  });

  it("persists minimized self-reported evidence, exact replay, diagnostics and idempotent cache", async () => {
    const user = await createUser(env);
    const admin = await createUser(env, { role: "ADMIN" });
    await imported(user.id, new Date());
    const result = await env.c.profileScoring.get(user.id);
    expect(result.current).toMatchObject({ algorithmVersion: "profile-beta-v4", score: 85, confidence: 45, coverage: 15, rank: null });
    expect(result.current!.sources.find((x) => x.source === "linkedin")).toMatchObject({ status: "partial", importMethod: "url", provider: "exa" });
    expect((await env.c.profileScoring.get(user.id)).current!.id).toBe(result.current!.id);
    const saved = (await env.c.repos.profileScoring.history(user.id))[0]!;
    expect(saved.input.fragments[0]!.data.sections).toEqual([{ key: "about" }]);
    expect(JSON.stringify(saved.input)).not.toContain("sourceFile");
    expect(JSON.stringify(saved.input)).not.toContain("sourceUrl");
    expect(JSON.stringify(saved.input)).not.toContain("linkedin.com");
    const { id: _id, week: _week, calculatedAt: _calculatedAt, rank: _rank, percentile: _percentile, cohortSize: _cohortSize, ...evaluation } = saved.snapshot;
    expect(evaluateProfile(saved.input, saved.config)).toEqual(evaluation);
    const diag = await env.http.get(`/api/v1/intelligence/diagnostics?userId=${user.id}`).set("Authorization", await bearer(env, admin));
    expect(diag.status).toBe(200);
    expect(diag.body.checks.find((x: { id: string }) => x.id === "replay").status).toBe("pass");
    const sourceCheck = diag.body.checks.find((x: { id: string }) => x.id === "sources");
    expect(sourceCheck.detail).toContain("linkedin: partial");
    expect(sourceCheck.detail).toContain("self-reported");
    expect(sourceCheck.detail).toContain("provider exa");
    expect(sourceCheck.detail).toContain("public partial snapshot");
    expect(sourceCheck.detail).toContain("receipt is not employment verification");
    expect(env.fetch.calls).toHaveLength(0);
  });

  it("invalidates stale opt-in cohort membership on source removal and identical same-time reimport", async () => {
    const user = await createUser(env);
    const at = new Date();
    const connection = await env.c.repos.leetcodeConnections.upsertSyncing(user.id, "local-fixture");
    await env.c.repos.leetcodeConnections.update(connection.id, { status: "SYNCED" });
    await env.c.repos.fragments.insert({ userId: user.id, source: "LEETCODE", data: {
      solved: { easy: 100, medium: 150, hard: 75 }, byTopic: Array.from({ length: 10 }, (_, i) => ({ topic: `topic${i}`, count: 10 })),
      contest: { attended: 10, rating: 2400 }, recentActivity: { last30Days: 15 },
    }, contentHash: "coding", version: 1, fetchedAt: new Date() });
    await imported(user.id, at);
    const first = await env.c.profileScoring.updateSettings(user.id, { declaredLevel: "fresher", leaderboardOptIn: true });
    expect(first.current!.eligibility.eligible).toBe(true);
    expect((await env.c.profileScoring.leaderboard("fresher", 100)).total).toBe(1);
    await env.c.repos.fragments.deleteByUserIdAndSource(user.id, "LINKEDIN");
    expect((await env.c.profileScoring.leaderboard("fresher", 100)).total).toBe(0);
    await imported(user.id, at);
    expect((await env.c.profileScoring.leaderboard("fresher", 100)).total).toBe(0);
    const reimport = await env.c.profileScoring.get(user.id);
    expect(reimport.current!.id).not.toBe(first.current!.id);
    expect(reimport.current!.score).toBe(first.current!.score);
    expect(reimport.current!.confidence).toBe(first.current!.confidence);
    expect((await env.c.profileScoring.leaderboard("fresher", 100)).total).toBe(1);
    await env.c.repos.fragments.deleteByUserIdAndSource(user.id, "LINKEDIN");
    const removed = await env.c.profileScoring.get(user.id);
    expect(removed.current!.sources.find((x) => x.source === "linkedin")?.status).toBe("missing");
    expect(removed.current!.id).not.toBe(reimport.current!.id);
  });

  it.each([LEGACY_V2_SCORING_CONFIG, LEGACY_V3_SCORING_CONFIG])("retains $version frozen replay after current v4 scoring", async (config) => {
    const user = await createUser(env);
    await imported(user.id, new Date());
    const old = new ProfileScoringService({ repo: env.c.repos.profileScoring, users: env.c.repos.users, profiles: env.c.repos.candidateProfiles,
      fragments: env.c.repos.fragments, github: env.c.repos.githubConnections, leetcode: env.c.repos.leetcodeConnections,
      preferences: env.c.preferences, pseudonymKey: env.c.config.jwt.secret, schedulerEnabled: false, config });
    const historical = await old.get(user.id);
    expect(historical.current!.score).toBe(config.version === "profile-beta-v2" ? null : 85);
    const saved = await env.c.repos.profileScoring.findSnapshot(historical.current!.id);
    if (config.version === "profile-beta-v2") expect(saved!.input.fragments[0]!.data).toEqual({});
    else expect(saved!.input.fragments[0]!.data.provider).toBe("exa");
    const current = await env.c.profileScoring.get(user.id);
    expect(current.current!.score).toBe(85);
    expect(current.current!.id).not.toBe(historical.current!.id);
    expect(await env.c.repos.profileScoring.findSnapshot(historical.current!.id)).toEqual(saved);
    expect(evaluateProfile(saved!.input, saved!.config).inputHash).toBe(saved!.snapshot.inputHash);
    expect(env.fetch.calls).toHaveLength(0);
  });
});
