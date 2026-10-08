import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { companyEnrichments } from "../../src/db/pg/schema.js";
import { ENGINEERING_LEVELS } from "../../src/domain/engineeringLevels.js";
import { draftFromParsedResume } from "../../src/domain/candidateProfile.js";
import { parseCandidateProfileRequest } from "../../src/services/candidateProfileService.js";
import { linearGraph } from "../../src/domain/process.js";
import { practiceProfiles, practiceOverview } from "../../scripts/catalogue/practiceProfiles.js";
import { bearer, createTestEnv, createUser, type TestEnv } from "../support/harness.js";
import { AI, FUTURE_SLOT, seedJd, seedRoleConfig, seedSession } from "./helpers.js";

let env: TestEnv;
let userId: string;
let auth: string;
let admin: string;
const graph = linearGraph([{ id: "coding", name: "Coding", type: "dsa", durationMinutes: 45, difficulty: "medium", topics: [] }]);
const profilePath = "/api/v1/users/me/candidate-profile";
beforeAll(async () => {
  env = await createTestEnv();
  admin = await bearer(env, await createUser(env, { role: "ADMIN" }));
});
afterAll(() => env.close());
beforeEach(async () => {
  env.fetch.reset();
  const user = await createUser(env);
  userId = user.id;
  auth = await bearer(env, user);
});

describe("canonical engineering level API boundaries", () => {
  it.each(ENGINEERING_LEVELS)("accepts %s for profile, process, enrichment draft, experience and catalogue filter", async (level) => {
    const profile = await env.http.put(profilePath).set("Authorization", auth).send({ level, complete: true });
    expect(profile.status).toBe(200);
    expect(profile.body.level).toBe(level);
    const process = await env.http.post("/api/v1/processes").set("Authorization", auth).send({ name: "Practice", level, graph });
    expect(process.status).toBe(201);
    expect(process.body.level).toBe(level);
    const company = await env.c.repos.companies.create({ name: "Levels", slug: `levels-${randomUUID()}` });
    const role = practiceProfiles(company.slug).find((r) => r.level === level)!;
    const enrichment = await env.http.put(`/api/v1/admin/companies/${company.id}/enrichment`).set("Authorization", admin)
      .send({ revision: 0, document: { company: practiceOverview(), roles: [role] } });
    expect(enrichment.status).toBe(200);
    expect(enrichment.body.document.roles[0].level).toBe(level);
    env.fetch.on("POST", `${AI}/admin/experiences`, { status: "queued" });
    expect((await env.http.post("/api/v1/experiences").set("Authorization", auth).send({ company: "Acme", level, content: "Interview evidence" })).status).toBe(202);
    expect((await env.http.get(`/api/v1/jds?level=${level}`).set("Authorization", auth)).status).toBe(200);
  });

  it.each(["Senior", "Staff", "principle", "sde4", "", " sde1", 3, {}, ["sde1"]])("rejects noncanonical choice %j without forwarding or saving", async (level) => {
    expect((await env.http.put(profilePath).set("Authorization", auth).send({ level })).status).toBe(400);
    expect(await env.c.repos.candidateProfiles.findByUserId(userId)).toBeNull();
    expect((await env.http.post("/api/v1/processes").set("Authorization", auth).send({ name: "Practice", level, graph })).status).toBe(400);
    expect((await env.http.post("/api/v1/experiences").set("Authorization", auth).send({ company: "Acme", level, content: "Evidence" })).status).toBe(400);
    const company = await env.c.repos.companies.create({ name: "Invalid", slug: `invalid-${randomUUID()}` });
    const document = { company: practiceOverview(), roles: [{ ...practiceProfiles(company.slug)[0]!, level }] };
    for (const publish of [false, true]) {
      const path = `/api/v1/admin/companies/${company.id}/enrichment${publish ? "/publish" : ""}`;
      const result = await env.http[publish ? "post" : "put"](path).set("Authorization", admin).send({ revision: 0, document });
      expect(result.status).toBe(400);
      expect(result.body.code).toBe("invalid_enrichment");
    }
    expect(env.fetch.calls).toHaveLength(0);
  });

  it.each(["Senior", "Staff", "principle", "sde4", ""])("rejects invalid catalogue filter %j", async (level) => {
    expect((await env.http.get(`/api/v1/jds?level=${encodeURIComponent(level)}`).set("Authorization", auth)).status).toBe(400);
    expect(env.fetch.calls).toHaveLength(0);
  });

  it("allows a null draft but requires a chosen saved or supplied level to complete onboarding", async () => {
    expect((await env.http.put(profilePath).set("Authorization", auth).send({ level: null })).status).toBe(200);
    for (const body of [{ complete: true }, { complete: true, level: null }]) {
      expect((await env.http.put(profilePath).set("Authorization", auth).send(body)).status).toBe(400);
    }
    expect((await env.c.repos.users.findById(userId))!.onboardingComplete).toBe(false);
    await env.http.put(profilePath).set("Authorization", auth).send({ level: "principal" }).expect(200);
    const saved = await env.http.put(profilePath).set("Authorization", auth).send({ skills: ["Go"], complete: true });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ level: "principal", skills: ["Go"], onboardingComplete: true });
    expect(draftFromParsedResume({ level: "staff", headline: "Principal Engineer", target_role: "sde3" }, null).level).toBeNull();
  });

  it("normalizes old profile aliases, preserves omitted stored labels, and exposes unknown labels without guessing", async () => {
    await env.c.candidateProfiles.saveProfile(userId, parseCandidateProfileRequest({ fullName: "Candidate", skills: ["Go"] }));
    for (const [raw, level] of [["SDE II", "sde2"], ["Staff", "staff"], ["principle", "principal"], ["Company L7", null]] as const) {
      await env.mongo.candidateProfiles.updateOne({ _id: userId }, { $set: { level: raw } });
      const read = await env.http.get(profilePath).set("Authorization", auth);
      expect(read.body).toMatchObject({ level, legacyLevel: level === null ? raw : null });
      const saved = await env.http.put(profilePath).set("Authorization", auth).send({ fullName: "Edited" });
      expect(saved.status).toBe(200);
      expect((await env.c.repos.candidateProfiles.findByUserId(userId))!.level).toBe(raw);
      if (level === null) expect((await env.http.put(profilePath).set("Authorization", auth).send({ complete: true })).status).toBe(400);
    }
    await env.mongo.candidateProfiles.updateOne({ _id: userId }, { $unset: { level: "" } });
    expect((await env.http.get(profilePath).set("Authorization", auth)).body.level).toBeNull();
  });

  it("patchLevel changes only level and updatedAt, never creates partial documents", async () => {
    await env.c.repos.candidateProfiles.patchLevel(userId, "staff");
    expect(await env.c.repos.candidateProfiles.findByUserId(userId)).toBeNull();
    await env.c.candidateProfiles.saveProfile(userId, parseCandidateProfileRequest({ fullName: "Name", skills: ["Rust"], level: "intern" }));
    const before = (await env.c.repos.candidateProfiles.findByUserId(userId))!;
    await env.c.repos.candidateProfiles.patchLevel(userId, "distinguished");
    const after = (await env.c.repos.candidateProfiles.findByUserId(userId))!;
    expect({ ...after, level: before.level, updatedAt: before.updatedAt }).toEqual(before);
    // A section save that already read the profile must not restore its stale level.
    const repo = env.c.repos.candidateProfiles;
    const originalSave = repo.save.bind(repo);
    const save = vi.spyOn(repo, "save").mockImplementation(async (doc) => {
      await repo.patchLevel(userId, "principal");
      return originalSave(doc);
    });
    try {
      const edited = await env.c.candidateProfiles.saveProfile(userId, parseCandidateProfileRequest({ skills: ["Go"] }));
      expect(edited).toMatchObject({ skills: ["Go"], level: "principal" });
    } finally { save.mockRestore(); }
  });

  it("reads one consistent legacy scoring choice until the profile explicitly owns its level", async () => {
    await env.c.candidateProfiles.saveProfile(userId, parseCandidateProfileRequest({ fullName: "Legacy candidate", skills: ["Go"] }));
    await env.c.repos.profileScoring.patchSettings(userId, { declaredLevel: "staff" }, new Date());
    const read = await env.http.get(profilePath).set("Authorization", auth);
    expect(read.body.level).toBe("staff");
    expect((await env.c.profileScoring.get(userId)).settings.declaredLevel).toBe("staff");
    expect(Object.hasOwn((await env.c.repos.candidateProfiles.findByUserId(userId))!, "level")).toBe(false); // read did not backfill
    const completed = await env.http.put(profilePath).set("Authorization", auth).send({ complete: true, targetRole: "Principal target" });
    expect(completed.body).toMatchObject({ level: "staff", onboardingComplete: true });
    await env.c.repos.candidateProfiles.patchLevel(userId, null);
    expect((await env.http.get(profilePath).set("Authorization", auth)).body.level).toBeNull();
    expect((await env.c.profileScoring.get(userId)).settings.declaredLevel).toBeNull();
    await env.http.put(profilePath).set("Authorization", auth).send({ level: "intern" }).expect(200);
    expect((await env.c.profileScoring.get(userId)).settings.declaredLevel).toBe("intern");
    expect((await env.c.repos.profileScoring.settings(userId)).declaredLevel).toBe("staff"); // dormant, never a second active choice
  });

  it("reads aliases in processes/loops, copies canonical values, and blocks unknown copies, confirmations and bookings until repaired", async () => {
    const process = await env.c.repos.processes.insert({ userId, jdId: null, name: "Legacy practice", level: "Staff", graph });
    expect((await env.http.get(`/api/v1/processes/${process.id}`).set("Authorization", auth)).body.level).toBe("staff");
    expect((await env.http.post(`/api/v1/processes/${process.id}/duplicate`).set("Authorization", auth)).body.level).toBe("staff");
    const loop = await env.c.repos.loops.insertIfNoLiveLoop({ userId, jdId: null, processId: process.id, name: process.name, level: "Staff", kind: "standalone", status: "active", graph });
    expect((await env.http.get(`/api/v1/loops/${loop!.id}`).set("Authorization", auth)).body.level).toBe("staff");
    const booked = await env.http.post("/api/v1/interviews/sessions").set("Authorization", auth).send({ loopId: loop!.id, nodeId: "coding", scheduledAt: FUTURE_SLOT, timezone: "UTC" });
    expect(booked.status).toBe(201);
    expect(booked.body.level).toBe("staff");
    const session = (await env.c.repos.sessions.findById(booked.body.id))!;
    expect(session.level).toBe("Staff");
    expect(session.practicePrep!.companyBrief.level).toBe("Staff");
    await env.c.repos.processes.update(process.id, { level: "L7 bespoke" });
    expect((await env.http.get(`/api/v1/processes/${process.id}`).set("Authorization", auth)).body).toMatchObject({ level: null, legacyLevel: "L7 bespoke" });
    expect((await env.http.post(`/api/v1/processes/${process.id}/duplicate`).set("Authorization", auth)).status).toBe(400);
    expect((await env.http.post("/api/v1/loops").set("Authorization", auth).send({ processId: process.id })).status).toBe(400);
    await env.c.repos.loops.update(loop!.id, { level: "L7 bespoke" });
    expect((await env.http.get(`/api/v1/loops/${loop!.id}`).set("Authorization", auth)).body).toMatchObject({ level: null, legacyLevel: "L7 bespoke" });
    expect((await env.http.post("/api/v1/interviews/sessions").set("Authorization", auth).send({ loopId: loop!.id, nodeId: "coding", scheduledAt: FUTURE_SLOT, timezone: "UTC" })).body.code).toBe("invalid_level");
    expect((await env.http.put(`/api/v1/processes/${process.id}`).set("Authorization", auth).send({ level: "principal" })).status).toBe(200);
    expect((await env.http.post(`/api/v1/processes/${process.id}/duplicate`).set("Authorization", auth)).body.level).toBe("principal");
  });

  it("normalizes JD/session responses while retaining raw booked identities and rejecting unknown targets", async () => {
    const company = await env.c.repos.companies.create({ name: "Historic", slug: `historic-${randomUUID()}`, publishedAt: new Date() });
    const jd = await seedJd(env, { company: company.slug, level: "SDE II" });
    await seedRoleConfig(env, { company: company.slug, level: "SDE II" });
    env.fetch.on("GET", `${AI}/briefs/${company.slug}/software-engineer/SDE%20II/backend`, { data_confidence: "high" });
    const detail = await env.http.get(`/api/v1/jds/${jd.id}`).set("Authorization", auth);
    expect(detail.body).toMatchObject({ level: "sde2", legacyLevel: null });
    expect(env.fetch.calls[0]!.url).toContain("SDE%20II");
    const list = await env.http.get(`/api/v1/jds?company=${company.slug}&level=sde2`).set("Authorization", auth);
    expect(list.body.map((j: { id: string }) => j.id)).toContain(jd.id);
    const booked = await env.http.post("/api/v1/interviews/sessions").set("Authorization", auth).send({ jobDescriptionId: jd.id, scheduledAt: FUTURE_SLOT, timezone: "UTC" });
    expect(booked.status).toBe(201);
    expect(booked.body.level).toBe("sde2");
    const session = (await env.c.repos.sessions.findById(booked.body.id))!;
    expect(session.level).toBe("SDE II");
    expect((await env.c.blueprintPrep.assemble(session, "booking")).session.level).toBe("SDE II");
    const unknown = await seedJd(env, { company: company.slug, level: "L7 bespoke" });
    expect((await env.http.get(`/api/v1/jds/${unknown.id}`).set("Authorization", auth)).body).toMatchObject({ level: null, legacyLevel: "L7 bespoke" });
    expect((await env.http.post("/api/v1/processes").set("Authorization", auth).send({ name: "Copy", jdId: unknown.id, graph })).status).toBe(400);
    expect((await env.http.post("/api/v1/interviews/sessions").set("Authorization", auth).send({ jobDescriptionId: unknown.id, scheduledAt: FUTURE_SLOT, timezone: "UTC" })).body.code).toBe("invalid_level");
    const old = await seedSession(env, userId, unknown);
    expect((await env.http.get(`/api/v1/interviews/sessions/${old.id}`).set("Authorization", auth)).body).toMatchObject({ level: null, legacyLevel: "L7 bespoke" });
  });

  it("saved enrichment aliases normalize and unknown labels remain repairable without rewriting the stored document", async () => {
    const company = await env.c.repos.companies.create({ name: "Historic editor", slug: `editor-${randomUUID()}` });
    const document = JSON.parse(JSON.stringify({ company: practiceOverview(), roles: practiceProfiles(company.slug).slice(0, 2) }));
    document.roles[0].level = "principle";
    document.roles[1].level = "L7 bespoke";
    await env.db.insert(companyEnrichments).values({ companyId: company.id, document });
    const path = `/api/v1/admin/companies/${company.id}/enrichment`;
    const read = await env.http.get(path).set("Authorization", admin);
    expect(read.body.document.roles[0]).toMatchObject({ level: "principal", legacyLevel: null });
    expect(read.body.document.roles[1]).toMatchObject({ level: null, legacyLevel: "L7 bespoke" });
    expect((await env.http.put(path).set("Authorization", admin).send({ revision: 0, document: read.body.document })).status).toBe(400);
    read.body.document.roles[1].level = "distinguished";
    const repaired = await env.http.put(path).set("Authorization", admin).send({ revision: 0, document: read.body.document });
    expect(repaired.status).toBe(200);
    expect(repaired.body.document.roles[1]).toMatchObject({ level: "distinguished", legacyLevel: null });
  });

  it("publishing an alias-normalized existing role preserves JD, config, booked session and brief identity", async () => {
    const company = await env.c.repos.companies.create({ name: "Alias publication", slug: `publish-${randomUUID()}`, publishedAt: new Date() });
    const jd = await seedJd(env, { company: company.slug, level: "principle" });
    await seedRoleConfig(env, { company: company.slug, level: "principle" });
    const session = await seedSession(env, userId, jd);
    const source = "https://evidence.example/verified";
    const role = { ...practiceProfiles(company.slug).find((r) => r.level === "principal")!, id: randomUUID(), jdId: jd.id,
      role: jd.role, specialization: jd.specialization, verified: true, sourceUrls: [source],
      rounds: [{ id: randomUUID(), name: "Architecture", type: "system-design", durationMinutes: 60, difficulty: "hard",
        topics: ["Reliability"], questions: [], guidance: "Discuss trade-offs", verified: true, sourceUrls: [source] }] };
    const published = await env.http.post(`/api/v1/admin/companies/${company.id}/enrichment/publish`).set("Authorization", admin)
      .send({ revision: 0, document: { company: { ...practiceOverview(), verified: true, sourceUrls: [source] }, roles: [role] } });
    expect(published.status).toBe(200);
    expect(published.body.document.roles[0].level).toBe("principal");
    expect((await env.c.repos.jds.findById(jd.id))!.level).toBe("principle");
    expect((await env.c.repos.sessions.findById(session.id))!.level).toBe("principle");
    const request = await env.c.blueprintPrep.assemble(session, "booking");
    expect(request.session.level).toBe("principle");
    // The session was booked as a DSA round, and this brief only has a system-design round: no round,
    // which the run reports as round_not_found. The brief itself is still the published one.
    expect(request.round).toBeNull();
    expect(request.company_brief?.dominant_topics).toEqual(["Reliability"]);
    expect(await env.c.repos.roleConfigs.findByCompanyAndRoleAndLevel(company.slug, jd.role, "principle")).not.toBeNull();
    expect(await env.c.repos.roleConfigs.findByCompanyAndRoleAndLevel(company.slug, jd.role, "principal")).toBeNull();
  });
});
