import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DEFAULT_SCORING_CONFIG, LEGACY_V1_SCORING_CONFIG } from "../../src/domain/profileScoring/config.js";
import { ENGINEERING_LEVELS } from "../../src/domain/profileScoring/types.js";
import { evaluateProfile } from "../../src/domain/profileScoring/engine.js";
import { ProfileScoringService, scoringWeek } from "../../src/services/profileScoring.js";
import { bearer, createTestEnv, createUser, type TestEnv } from "../support/harness.js";

let env: TestEnv;
beforeAll(async () => { env = await createTestEnv({ PROFILE_SCORING_SCHEDULER_ENABLED: "false" }); });
afterAll(() => env.close());
const SCORE = "/api/v1/users/me/profile-score";
const DIAG = "/api/v1/intelligence/diagnostics";
const LIVE = "/api/v1/intelligence/profile-scoring/live";
/** The live trace streams NDJSON; read the raw text and split it into events. */
/** supertest `.parse()` hands over the raw response stream (typed as superagent's Response). */
const streamText = (raw: unknown, done: (err: Error | null, body: string) => void) => {
  const res = raw as NodeJS.ReadableStream & { setEncoding(encoding: string): void };
  let text = ""; res.setEncoding("utf8"); res.on("data", (chunk: string) => { text += chunk; }); res.on("end", () => done(null, text));
};
const eventsOf = (body: unknown) => String(body).trim().split("\n").map((line) => JSON.parse(line) as { kind: string; stage: string; level: string; message: string; data?: Record<string, unknown> });

function service(now: () => Date = () => new Date(), minimumCohort = 2) {
  const config = structuredClone(DEFAULT_SCORING_CONFIG);
  config.version = `test-${randomUUID()}`;
  config.thresholds = { minimumCoverage: 1, minimumConfidence: 1, minimumCohort };
  return new ProfileScoringService({ repo: env.c.repos.profileScoring, users: env.c.repos.users, profiles: env.c.repos.candidateProfiles,
    fragments: env.c.repos.fragments, github: env.c.repos.githubConnections, leetcode: env.c.repos.leetcodeConnections,
    preferences: env.c.preferences, pseudonymKey: env.c.config.jwt.secret, schedulerEnabled: true, config, now });
}

async function seedCoding(name = "Private Name", solved = 80) {
  const user = await createUser(env, { name });
  const connection = await env.c.repos.leetcodeConnections.upsertSyncing(user.id, "private-handle");
  await env.c.repos.leetcodeConnections.update(connection.id, { status: "SYNCED" });
  await env.c.repos.fragments.insert({ userId: user.id, source: "LEETCODE", data: {
    username: "private-handle", email: user.email, solved: { easy: solved, medium: solved, hard: solved },
    byTopic: [{ topic: "array", count: 30 }, { topic: "graph", count: 20 }], contest: { attended: 5, rating: 1800 },
    recentActivity: { last30Days: 10, windowAsOf: new Date().toISOString() }, partial: false,
  }, contentHash: "untrusted-original-hash", version: 1, fetchedAt: new Date() });
  return user;
}

describe("profile scoring API and frozen persistence", () => {
  it("accepts all eight canonical settings/leaderboard values and rejects saved aliases on new writes", async () => {
    const user = await createUser(env);
    const token = await bearer(env, user);
    for (const level of ENGINEERING_LEVELS) {
      const response = await env.http.patch(`${SCORE}/settings`).set("Authorization", token).send({ declaredLevel: level });
      expect(response.status).toBe(200);
      expect(response.body.settings.declaredLevel).toBe(level);
      expect(response.body.current.level).toBe(level);
      expect((await env.http.get(`/api/v1/profile-leaderboard?level=${level}`).set("Authorization", token)).status).toBe(200);
    }
    for (const declaredLevel of ["principle", "SDE I", "Senior", "unknown"]) {
      expect((await env.http.patch(`${SCORE}/settings`).set("Authorization", token).send({ declaredLevel })).status).toBe(400);
    }
  });

  it("bridges old declaredLevel PATCH atomically into the profile and reads later profile edits immediately", async () => {
    const user = await createUser(env);
    const token = await bearer(env, user);
    const profilePath = "/api/v1/users/me/candidate-profile";
    const body = { level: "sde2", fullName: "Canonical Name", headline: "Saved headline", skills: ["TypeScript"], targetRole: "Distinguished target JD", projects: [], education: [], experience: [], achievements: [], complete: false };
    expect((await env.http.put(profilePath).set("Authorization", token).send(body)).status).toBe(200);
    await env.c.repos.profileScoring.patchSettings(user.id, { declaredLevel: "staff", leaderboardOptIn: true }, new Date());
    const first = await env.http.get(SCORE).set("Authorization", token);
    expect(first.body.settings).toEqual({ declaredLevel: "sde2", leaderboardOptIn: true });
    expect(first.body.current.level).toBe("sde2");
    const before = (await env.c.repos.candidateProfiles.findByUserId(user.id))!;
    const legacyEdit = await env.http.patch(`${SCORE}/settings`).set("Authorization", token).send({ declaredLevel: "distinguished" });
    expect(legacyEdit.status).toBe(200);
    expect(legacyEdit.body.settings.declaredLevel).toBe("distinguished");
    const after = (await env.c.repos.candidateProfiles.findByUserId(user.id))!;
    const { level: _beforeLevel, updatedAt: _beforeTime, revision: _beforeRevision, ...beforeFields } = before;
    const { level: _afterLevel, updatedAt: _afterTime, revision: _afterRevision, ...afterFields } = after;
    expect(after.level).toBe("distinguished"); expect(afterFields).toEqual(beforeFields);
    expect(after.updatedAt.getTime()).toBeGreaterThanOrEqual(before.updatedAt.getTime());
    expect((await env.c.repos.profileScoring.settings(user.id)).declaredLevel).toBeNull();
    expect((await env.http.get(profilePath).set("Authorization", token)).body.level).toBe("distinguished");
    const changed = await env.http.put(profilePath).set("Authorization", token).send({ ...body, level: "intern" });
    expect(changed.status).toBe(200);
    const scored = await env.http.get(SCORE).set("Authorization", token);
    expect(scored.body.settings.declaredLevel).toBe("intern");
    expect(scored.body.current.level).toBe("intern");
    expect(scored.body.current.id).not.toBe(legacyEdit.body.current.id);
    const cleared = await env.http.patch(`${SCORE}/settings`).set("Authorization", token).send({ declaredLevel: null });
    expect(cleared.body.settings.declaredLevel).toBeNull();
    expect((await env.http.get(profilePath).set("Authorization", token)).body.level).toBeNull();
    expect((await env.c.repos.profileScoring.settings(user.id)).leaderboardOptIn).toBe(true);
  });

  it("uses legacy settings only when the candidate has no own level field, never for explicit null or unknown", async () => {
    const user = await createUser(env);
    const token = await bearer(env, user);
    await env.http.put("/api/v1/users/me/candidate-profile").set("Authorization", token).send({ level: "sde1", complete: false });
    await env.c.repos.profileScoring.patchSettings(user.id, { declaredLevel: "principal" }, new Date());
    await env.mongo.candidateProfiles.updateOne({ _id: user.id }, { $unset: { level: "" } });
    expect((await env.c.profileScoring.get(user.id)).settings.declaredLevel).toBe("principal");
    await env.mongo.candidateProfiles.updateOne({ _id: user.id }, { $set: { level: null } });
    expect((await env.c.profileScoring.get(user.id)).settings.declaredLevel).toBeNull();
    // Simulate untyped historical storage without making arbitrary values valid new writes.
    await env.mongo.candidateProfiles.updateOne({ _id: user.id }, { $set: { level: "principle" as never } });
    expect((await env.c.profileScoring.get(user.id)).settings.declaredLevel).toBe("principal");
    await env.mongo.candidateProfiles.updateOne({ _id: user.id }, { $set: { level: "Executive Wizard" as never } });
    expect((await env.c.profileScoring.get(user.id)).settings.declaredLevel).toBeNull();
  });

  it("preserves saved v1 snapshots and excludes them from current v3 cohorts", async () => {
    const user = await seedCoding();
    await env.c.repos.profileScoring.patchSettings(user.id, { declaredLevel: "fresher", leaderboardOptIn: true }, new Date());
    const v1 = new ProfileScoringService({ repo: env.c.repos.profileScoring, users: env.c.repos.users, profiles: env.c.repos.candidateProfiles,
      fragments: env.c.repos.fragments, github: env.c.repos.githubConnections, leetcode: env.c.repos.leetcodeConnections,
      preferences: env.c.preferences, pseudonymKey: env.c.config.jwt.secret, schedulerEnabled: false, config: LEGACY_V1_SCORING_CONFIG });
    await v1.get(user.id);
    const old = (await env.c.repos.profileScoring.history(user.id))[0]!;
    const before = structuredClone(old);
    expect(old.snapshot.algorithmVersion).toBe("profile-beta-v1");
    expect((await env.c.profileScoring.leaderboard("fresher", 100)).entries).toHaveLength(0);
    const latest = await env.c.profileScoring.get(user.id);
    expect(latest.current!.algorithmVersion).toBe("profile-beta-v4");
    expect(latest.current!.configHash).not.toBe(old.snapshot.configHash);
    expect(latest.history.some((s) => s.id === old._id)).toBe(true);
    expect(await env.c.repos.profileScoring.findSnapshot(old._id)).toEqual(before);
    const { id: _id, week: _week, calculatedAt: _calculatedAt, rank: _rank, percentile: _percentile, cohortSize: _cohortSize, ...evaluation } = old.snapshot;
    expect(evaluateProfile(old.input, old.config)).toEqual(evaluation);
  });

  it("requires authentication and gates diagnostics/admin recalc by ADMIN role", async () => {
    expect((await env.http.get(SCORE)).status).toBe(401);
    expect((await env.http.get("/api/v1/profile-leaderboard")).status).toBe(401);
    expect((await env.http.get(DIAG)).status).toBe(401);
    const user = await createUser(env);
    const token = await bearer(env, user);
    expect((await env.http.get(DIAG).set("Authorization", token)).status).toBe(403);
    expect((await env.http.post(LIVE).set("Authorization", token).send({ userId: user.id })).status).toBe(403);
  });

  it("streams a redacted live trace, reuses snapshots, and never calls collectors", async () => {
    const admin = await createUser(env, { role: "ADMIN", name: "Trace Admin" });
    const target = await createUser(env, { name: "Private Candidate", email: "private.candidate@example.test" });
    const observedAt = new Date().toISOString();
    await env.c.repos.candidateProfiles.save({ userId: target.id, fullName: target.name, email: target.email, phone: "+1 555 123 4567", location: "Private City", headline: "Builder", targetRole: null, level: "sde1", education: [],
      experience: [{ company: "Private Corp", title: "Engineer", location: "Private City", startDate: "2020-01-01", endDate: null, bullets: [`Built and deployed ${target.name}'s service; email ${target.email}`] }],
      projects: [], skills: ["TypeScript"], achievements: [], detectedLinks: { github: null, leetcode: null, linkedin: null }, resumeFilename: "private-resume.pdf", resumeParsedAt: null });
    await env.c.repos.fragments.insert({ userId: target.id, source: "GITHUB", data: { languages: [{ name: "TypeScript", bytes: 100 }], externalPRs: 2 }, contentHash: "untrusted", version: 1, fetchedAt: new Date(observedAt) });
    await env.c.repos.fragments.insert({ userId: target.id, source: "LEETCODE", data: { solved: { easy: 20, medium: 10, hard: null }, byTopic: [{ topic: "arrays", count: 10 }], contest: null, recentActivity: null, partial: true }, contentHash: "untrusted", version: 1, fetchedAt: new Date(observedAt) });
    await env.c.repos.fragments.insert({ userId: target.id, source: "LINKEDIN", data: { importMethod: "url", provider: "firecrawl", sourceUrl: "https://www.linkedin.com/in/private-candidate", importedAt: observedAt, retrievedAt: observedAt, partial: true,
      sections: [{ key: "experience" }], profile: { experience: [{ bullets: [`Built and deployed ${target.name}'s service`] }] }, provenance: [{ section: "experience", path: "profile.experience[0].bullets", file: null, quote: `Built and deployed ${target.name}'s service`, sourceUrl: "https://www.linkedin.com/in/private-candidate", retrievedAt: observedAt }] }, contentHash: "untrusted", version: 1, fetchedAt: new Date(observedAt) });
    env.fetch.reset();
    const token = await bearer(env, admin);
    const first = await env.http.post(LIVE).set("Authorization", token).send({ userId: target.id }).buffer(true).parse(streamText);
    expect(first.status).toBe(200);
    expect(first.headers["content-type"]).toContain("application/x-ndjson");
    const events = eventsOf(first.body), result = events.at(-1)!;
    expect(result.kind).toBe("result");
    expect(events.filter((event) => event.kind === "stage").map((event) => `${event.stage}:${event.data?.status}`)).toEqual(expect.arrayContaining(["user:completed", "sources:completed", "semantic:skipped", "snapshot:completed", "engine:completed"]));
    const trace = result.data as Record<string, unknown> & { sources: { source: string }[]; snapshot: { id: string }; stackTrace: string };
    expect(trace).toMatchObject({ userId: target.id, snapshot: { level: "sde1" }, providerChecks: expect.arrayContaining([expect.objectContaining({ provider: "Source collectors", status: "not_used" })]) });
    expect(trace.sources.map((source) => source.source)).toEqual(expect.arrayContaining(["RESUME", "GITHUB", "LEETCODE", "LINKEDIN"]));
    expect(trace.copyText).toBe(trace.stackTrace);
    // Admin debugging keeps full detail; only credentials are scrubbed, and the password hash never appears.
    for (const detail of [target.email, target.name, "Private Corp"]) expect(first.body).toContain(detail);
    expect(first.body).not.toMatch(/passwordHash|password_hash|scrypt\$/);
    expect(env.fetch.calls).toHaveLength(0);
    const second = await env.http.post(LIVE).set("Authorization", token).send({ userId: target.id }).buffer(true).parse(streamText);
    const again = eventsOf(second.body).at(-1)!.data as { snapshot: { id: string } };
    expect(again.snapshot.id).toBe(trace.snapshot.id);
    expect(await env.mongo.profileScoreSnapshots.countDocuments({ userId: target.id })).toBe(1);
  });

  it("keeps live trace validation and authorization strict", async () => {
    const user = await createUser(env);
    const token = await bearer(env, user);
    expect((await env.http.post(LIVE).set("Authorization", token).send({ userId: user.id })).status).toBe(403);
    const admin = await createUser(env, { role: "ADMIN" });
    const adminToken = await bearer(env, admin);
    for (const body of [{}, { userId: "bad" }, { userId: randomUUID(), extra: true }, { userId: randomUUID(), forceReassess: "yes" }]) expect((await env.http.post(LIVE).set("Authorization", adminToken).send(body)).status).toBe(400);
    // An unknown user is a plain JSON 404 before any streaming starts.
    expect((await env.http.post(LIVE).set("Authorization", adminToken).send({ userId: randomUUID() })).status).toBe(404);
  });

  it("validates typed settings, body/query keys, limits, levels and UUIDs strictly", async () => {
    const user = await createUser(env, { role: "ADMIN" });
    const token = await bearer(env, user);
    for (const body of [{ declaredLevel: "senior" }, { leaderboardOptIn: "true" }, { declaredLevel: 1 }, { extra: true }, []]) {
      expect((await env.http.patch(`${SCORE}/settings`).set("Authorization", token).send(body)).status).toBe(400);
    }
    for (const query of ["limit=0", "limit=101", "limit=1.2", "limit=NaN", "level=CEO", "limit=1&limit=2", "unknown=1"]) {
      expect((await env.http.get(`/api/v1/profile-leaderboard?${query}`).set("Authorization", token)).status).toBe(400);
    }
    expect((await env.http.post(SCORE).set("Authorization", token).send({ input: {} })).status).toBe(400);
    expect((await env.http.get(`${DIAG}?userId=bad`).set("Authorization", token)).status).toBe(400);
    // The manual recalculation endpoint was removed; the live trace replaces it.
    expect((await env.http.post("/api/v1/intelligence/profile-scoring/recalculate").set("Authorization", token).send({})).status).toBe(404);
    const missingUser = randomUUID();
    await expect(env.c.profileScoring.runBatch("manual", missingUser)).rejects.toMatchObject({ status: 404 });
    expect(await env.mongo.profileScoringJobs.countDocuments({ userId: missingUser })).toBe(0);
  });

  it("returns missing evidence honestly and caches repeated GET/POST without new history", async () => {
    const user = await createUser(env);
    const token = await bearer(env, user);
    const first = await env.http.get(SCORE).set("Authorization", token);
    expect(first.status).toBe(200);
    expect(first.body.settings).toEqual({ declaredLevel: null, leaderboardOptIn: false });
    expect(first.body.current).toMatchObject({ status: "insufficient_evidence", score: null, rank: null, percentile: null });
    const again = await env.http.post(SCORE).set("Authorization", token).send({});
    expect(again.body.current.id).toBe(first.body.current.id);
    expect(again.body.current.asOf).toBe(first.body.current.asOf);
    expect(again.body.history).toHaveLength(1);
    const changed = await env.http.patch(`${SCORE}/settings`).set("Authorization", token).send({ declaredLevel: "staff", leaderboardOptIn: true });
    expect(changed.body.settings).toEqual({ declaredLevel: "staff", leaderboardOptIn: true });
    expect(changed.body.current.classification.declaredLevel).toBe("staff");
    expect(changed.body.history).toHaveLength(2);
    const cleared = await env.http.patch(`${SCORE}/settings`).set("Authorization", token).send({ declaredLevel: null });
    expect(cleared.body.settings.declaredLevel).toBeNull();
  });

  it("concurrent replica reads converge on one frozen snapshot", async () => {
    const user = await seedCoding();
    const s = service();
    const results = await Promise.all(Array.from({ length: 8 }, () => s.get(user.id)));
    expect(new Set(results.map((r) => r.current!.id)).size).toBe(1);
    expect(new Set(results.map((r) => r.current!.asOf)).size).toBe(1);
    expect(await env.mongo.profileScoreSnapshots.countDocuments({ userId: user.id })).toBe(1);
  });

  it("diagnostics are read-only, replay frozen config/asOf, and explicitly leave live pipelines untested", async () => {
    const admin = await createUser(env, { role: "ADMIN" });
    const target = await seedCoding();
    const token = await bearer(env, admin);
    const before = await env.http.get(`${DIAG}?userId=${target.id}`).set("Authorization", token);
    expect(before.status).toBe(200);
    expect(before.body.score.current).toBeNull();
    expect(await env.mongo.profileScoreSnapshots.countDocuments({ userId: target.id })).toBe(0);
    await env.c.profileScoring.get(target.id);
    const after = await env.http.get(`${DIAG}?userId=${target.id}`).set("Authorization", token);
    expect(after.body.checks.find((c: { id: string }) => c.id === "replay").status).toBe("pass");
    expect(after.body.checks.find((c: { id: string }) => c.id === "features").status).toBe("pass");
    for (const id of ["live-provider", "interview-prep", "voice"]) {
      expect(after.body.checks.find((c: { id: string }) => c.id === id).status).toBe("untested");
    }
    const fragment = (await env.c.repos.fragments.findByUserId(target.id))[0]!;
    await env.c.repos.fragments.update(fragment._id, { data: { solved: { easy: 2, medium: 2, hard: 2 } }, fetchedAt: new Date() });
    const stale = await env.http.get(`${DIAG}?userId=${target.id}`).set("Authorization", token);
    expect(stale.body.checks.find((c: { id: string }) => c.id === "freshness").status).toBe("warning");
    expect(stale.body.checks.find((c: { id: string }) => c.id === "replay").status).toBe("pass");
    expect(await env.mongo.profileScoreSnapshots.countDocuments({ userId: target.id })).toBe(1);
    expect(env.fetch.calls).toHaveLength(0);
  });

  it("uses UTC Monday weeks, frozen replay across changes, and catches up idempotently after startup gaps", async () => {
    expect(scoringWeek(new Date("2026-10-04T23:59:59Z"))).toBe("2026-09-28");
    expect(scoringWeek(new Date("2026-10-05T00:00:00Z"))).toBe("2026-10-05");
    let now = new Date("2030-01-07T12:00:00Z");
    const s = service(() => now);
    const user = await seedCoding();
    await s.updateSettings(user.id, { declaredLevel: "fresher", leaderboardOptIn: true });
    const original = (await env.c.repos.profileScoring.history(user.id))[0]!;
    expect((await s.runBatch("weekly")).status).toBe("completed");
    const firstCount = await env.mongo.profileScoreSnapshots.countDocuments({ userId: user.id });
    await s.runBatch("weekly");
    expect(await env.mongo.profileScoreSnapshots.countDocuments({ userId: user.id })).toBe(firstCount);
    expect(await env.mongo.profileScoringJobs.countDocuments({ _id: `weekly:${scoringWeek(now)}:${original.snapshot.configHash}` })).toBe(1);
    now = new Date("2030-02-04T12:00:00Z");
    await s.runBatch("weekly");
    const history = await env.c.repos.profileScoring.history(user.id);
    expect(history.some((d) => d.snapshot.week === "2030-02-04")).toBe(true);
    expect(history.some((d) => d.snapshot.week === "2030-01-14")).toBe(false); // Never fabricate missing historical weeks.
    const { id, week, calculatedAt, rank, percentile, cohortSize, ...expected } = original.snapshot;
    expect(evaluateProfile(original.input, original.config)).toEqual(expected);
    const newConfig = service(() => now);
    const changed = await newConfig.get(user.id);
    expect(changed.current!.configHash).not.toBe(original.snapshot.configHash);
    expect(evaluateProfile(original.input, original.config)).toEqual(expected);
  });

  it("serializes replicas/admin batches using the durable lease and records receipts", async () => {
    const target = await createUser(env);
    const owner = randomUUID();
    expect(await env.c.repos.profileScoring.acquireLease(owner, new Date())).toBe(true);
    expect(await env.c.repos.profileScoring.acquireLease(randomUUID(), new Date())).toBe(false);
    await expect(env.c.profileScoring.runBatch("manual", target.id)).rejects.toMatchObject({ status: 409 });
    await env.c.repos.profileScoring.releaseLease(owner);
    expect(await env.c.profileScoring.runBatch("manual", target.id)).toMatchObject({ status: "completed", processed: 1, failed: 0 });
    expect(await env.mongo.profileScoringJobs.countDocuments({ userId: target.id })).toBe(1);
  });

  it("competition ranks ties, excludes singleton percentiles, and keeps privacy/level/disconnect changes out of stale cohorts", async () => {
    const s = service();
    const a = await seedCoding("Name Visible");
    const b = await seedCoding("Never Expose Name");
    await env.c.preferences.update(a.id, { privacy: { leaderboardVisibility: "name" } });
    await s.updateSettings(a.id, { declaredLevel: "fresher", leaderboardOptIn: true });
    let board = await s.leaderboard("fresher", 100);
    expect(board.total).toBe(1);
    expect(board.entries[0]).toMatchObject({ displayName: "Name Visible", rank: 1, percentile: null });
    await s.updateSettings(b.id, { declaredLevel: "fresher", leaderboardOptIn: true });
    board = await s.leaderboard("fresher", 100);
    expect(board.total).toBe(2);
    expect(board.entries.map((e) => e.rank)).toEqual([1, 1]);
    expect(board.entries.every((e) => e.percentile === 50)).toBe(true);
    const anonymous = board.entries.find((e) => e.displayName !== "Name Visible")!;
    expect(anonymous.displayName).toMatch(/^Engineer [0-9a-f]{10}$/);
    const text = JSON.stringify(board);
    for (const secret of [a.id, b.id, a.email, b.email, "Never Expose Name", "private-handle", "evidence"]) expect(text).not.toContain(secret);
    expect((await s.leaderboard("fresher", 1)).entries).toHaveLength(1);
    await env.c.preferences.update(b.id, { privacy: { leaderboardVisibility: "hidden" } });
    expect((await s.leaderboard("fresher", 100)).total).toBe(1);
    await env.c.preferences.update(b.id, { privacy: { leaderboardVisibility: "anonymous" } });
    expect((await s.leaderboard("fresher", 100)).total).toBe(1); // Privacy changed; refresh required.
    await s.get(b.id);
    expect((await s.leaderboard("fresher", 100)).entries.some((e) => e.displayName === anonymous.displayName)).toBe(true);
    await s.updateSettings(b.id, { declaredLevel: "sde1" });
    expect((await s.leaderboard("fresher", 100)).total).toBe(1);
    expect((await s.leaderboard("sde1", 100)).total).toBe(0); // Declared/assessed mismatch is gated.
    await env.c.repos.candidateProfiles.save({ userId: b.id, fullName: b.name, email: b.email, phone: null, location: null, headline: null, targetRole: null,
      education: [], experience: [], projects: [{ name: "Example", description: "Built and deployed an API with unit tests. Owned the API end-to-end.", tech: ["TypeScript"], bullets: [], link: null }],
      skills: ["TypeScript"], achievements: [], detectedLinks: { github: null, leetcode: null, linkedin: null }, resumeFilename: null, resumeParsedAt: null });
    await s.get(b.id);
    expect((await s.leaderboard("sde1", 100)).total).toBe(1);
    await env.c.repos.leetcodeConnections.deleteByUserId(b.id);
    expect((await s.leaderboard("sde1", 100)).total).toBe(0);
    await s.updateSettings(a.id, { leaderboardOptIn: false });
    expect((await s.leaderboard("fresher", 100)).total).toBe(0);
  });

  it("freezes historical ranks once and includes scoring data in export and deletion", async () => {
    const s = service();
    const user = await seedCoding();
    await s.updateSettings(user.id, { declaredLevel: "fresher", leaderboardOptIn: true });
    await s.runBatch("weekly");
    const frozen = (await env.c.repos.profileScoring.history(user.id))[0]!;
    expect(frozen.rankFinalizedAt).toBeInstanceOf(Date);
    const snapshotBefore = structuredClone(frozen.snapshot);
    await env.c.preferences.update(user.id, { privacy: { leaderboardVisibility: "hidden" } });
    await s.get(user.id);
    const original = await env.mongo.profileScoreSnapshots.findOne({ _id: frozen._id });
    expect(original!.snapshot).toEqual(snapshotBefore);
    await s.runBatch("manual", user.id);
    const exported = (await env.c.accountExport.export(user.id))!;
    expect(exported.profileScoring.settings.leaderboardOptIn).toBe(true);
    expect(exported.profileScoring.snapshots.length).toBeGreaterThan(0);
    expect(exported.profileScoring.jobs.some((job) => job.kind === "manual")).toBe(true);
    expect(exported.profileScoring.jobs.some((job) => job.kind === "weekly")).toBe(true);
    const frozenText = JSON.stringify(exported.profileScoring.snapshots);
    expect(frozenText).not.toContain(user.email);
    expect(frozenText).not.toContain("private-handle");
    expect(await env.c.accountDeletion.delete(user.id, { confirmEmail: user.email })).toBe(true);
    expect(await env.mongo.profileScoreSnapshots.countDocuments({ userId: user.id })).toBe(0);
    expect(await env.mongo.profileScoringSettings.countDocuments({ _id: user.id })).toBe(0);
    expect(await env.mongo.profileScoringJobs.countDocuments({ userId: user.id })).toBe(0);
  });

  it("retries interrupted weekly rank finalization against the same durable coherent cohort plan", async () => {
    await env.mongo.profileScoringSettings.updateMany({}, { $set: { leaderboardOptIn: false, updatedAt: new Date() } });
    const s = service();
    const a = await seedCoding();
    const b = await seedCoding();
    await s.updateSettings(a.id, { declaredLevel: "fresher", leaderboardOptIn: true });
    await s.updateSettings(b.id, { declaredLevel: "fresher", leaderboardOptIn: true });
    const aDoc = (await env.c.repos.profileScoring.history(a.id))[0]!;
    const bDoc = (await env.c.repos.profileScoring.history(b.id))[0]!;
    const finalize = env.c.repos.profileScoring.finalizeRank.bind(env.c.repos.profileScoring);
    let calls = 0;
    const spy = vi.spyOn(env.c.repos.profileScoring, "finalizeRank").mockImplementation(async (...args) => {
      if (++calls === 2) throw new Error("simulated interruption");
      return finalize(...args);
    });
    expect((await s.runBatch("weekly")).status).toBe("failed");
    spy.mockRestore();
    const receiptId = `weekly:${aDoc.snapshot.week}:${aDoc.snapshot.configHash}`;
    const failedReceipt = (await env.c.repos.profileScoring.job(receiptId))!;
    expect(failedReceipt.rankPlan).toHaveLength(2);
    await env.c.preferences.update(b.id, { privacy: { leaderboardVisibility: "hidden" } });
    expect((await s.runBatch("weekly")).status).toBe("completed");
    expect((await env.c.repos.profileScoring.job(receiptId))!.rankPlan).toEqual(failedReceipt.rankPlan);
    for (const id of [aDoc._id, bDoc._id]) {
      expect((await env.mongo.profileScoreSnapshots.findOne({ _id: id }))!.snapshot).toMatchObject({ rank: 1, cohortSize: 2, percentile: 50 });
    }
    expect((await s.leaderboard("fresher", 100)).total).toBe(1);
  });

  it("uses current fingerprints even when snapshot timestamps tie and an older hash sorts first", async () => {
    const fixed = new Date("2031-01-06T12:00:00Z");
    const s = service(() => fixed);
    const user = await seedCoding("Tied clock");
    await s.updateSettings(user.id, { leaderboardOptIn: true });
    const old = (await env.c.repos.profileScoring.history(user.id))[0]!;
    const fragment = (await env.c.repos.fragments.findByUserId(user.id))[0]!;
    await env.c.repos.fragments.update(fragment._id, { data: { solved: { easy: 1, medium: 1, hard: 1 } } });
    const fresh = await s.get(user.id);
    expect(fresh.current!.calculatedAt).toBe(old.snapshot.calculatedAt);
    expect(fresh.current!.id).not.toBe(old._id);
    const spy = vi.spyOn(env.c.repos.profileScoring, "latestForWeek").mockResolvedValue([old]);
    try {
      const board = await s.leaderboard("fresher", 100);
      expect(board.total).toBe(1);
      expect(board.entries[0]!.score).toBe(fresh.current!.score);
    } finally { spy.mockRestore(); }
  });
});
