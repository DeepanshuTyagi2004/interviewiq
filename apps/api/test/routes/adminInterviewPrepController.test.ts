import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { JobDescriptionRow } from "../../src/db/pg/schema.js";
import { json, status } from "../support/fakeFetch.js";
import { bearer, createUser, createTestEnv, type TestEnv } from "../support/harness.js";
import { AI, aiCalls, seedJd } from "./helpers.js";

/**
 * Port of AdminInterviewPrepControllerTest (interview-prep bench under
 * /api/v1/intelligence/interview-prep). Real JD lookup + candidate-profile assembly; the AI
 * service is stubbed and the forwarded GenerateInterviewPlanRequest is asserted.
 */

let env: TestEnv;
let admin: string;
let jd: JobDescriptionRow;

beforeAll(async () => {
  env = await createTestEnv();
  admin = await bearer(env, await createUser(env, { role: "ADMIN" }));
  jd = await seedJd(env, {
    company: "acme",
    role: "software-engineer",
    level: "sde1",
    title: "SDE 1",
    specialization: "backend",
    description: "Build things",
    techStack: "Java, Spring",
  });
});
afterAll(() => env.close());
beforeEach(async () => {
  env.fetch.reset();
  await env.mongo.candidateProfiles.deleteMany({});
});

const BASE = "/api/v1/intelligence/interview-prep";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const EMPTY_LINKS = { github: null, leetcode: null, linkedin: null };

function forwarded() {
  const call = env.fetch.callsTo(`${AI}/admin/interview-prep/run`, "POST")[0];
  expect(call, "expected a POST to /admin/interview-prep/run").toBeDefined();
  return call!.json as {
    session: Record<string, unknown>;
    jobDescription: Record<string, unknown>;
    candidateProfile: Record<string, unknown>;
  };
}

describe("POST /intelligence/interview-prep/run", () => {
  it("startRun_assemblesAndForwards", async () => {
    env.fetch.on("POST", `${AI}/admin/interview-prep/run`, { run_id: "prep-1", status: "running" });
    const res = await env.http.post(`${BASE}/run`).set("Authorization", admin).send({ jobDescriptionId: jd.id, roundType: "dsa" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ run_id: "prep-1", status: "running" });

    const body = forwarded();
    expect(Object.keys(body).sort()).toEqual(["candidateProfile", "jobDescription", "session"]);
    expect(body.session).toEqual({
      sessionId: expect.stringMatching(UUID_RE),
      candidateId: expect.stringMatching(UUID_RE),
      company: "acme",
      role: "software-engineer",
      level: "sde1",
      specialization: "backend",
      roundType: "dsa",
    });
    expect(body.session.sessionId).not.toBe(body.session.candidateId);
    expect(body.jobDescription).toEqual({ id: jd.id, title: "SDE 1", description: "Build things", techStack: "Java, Spring" });
    // No candidate chosen → an empty profile with no coding signals.
    expect(body.candidateProfile).toEqual({
      fullName: null,
      headline: null,
      targetRole: null,
      education: [],
      experience: [],
      projects: [],
      skills: [],
      achievements: [],
      links: EMPTY_LINKS,
      codingProfile: null,
    });
  });

  it("startRun_defaultsRoundWhenOmitted (first round)", async () => {
    env.fetch.on("POST", `${AI}/admin/interview-prep/run`, { run_id: "prep-2", status: "running" });
    const res = await env.http.post(`${BASE}/run`).set("Authorization", admin).send({ jobDescriptionId: jd.id });
    expect(res.status).toBe(200);
    expect(res.body.run_id).toBe("prep-2");
    expect(forwarded().session.roundType).toBe("dsa");
  });

  it("an explicit roundType is honoured", async () => {
    env.fetch.on("POST", `${AI}/admin/interview-prep/run`, { run_id: "prep-3", status: "running" });
    await env.http.post(`${BASE}/run`).set("Authorization", admin).send({ jobDescriptionId: jd.id, roundType: "system-design" }).expect(200);
    expect(forwarded().session.roundType).toBe("system-design");
  });

  it("a chosen candidate grounds the plan in their saved profile + coding signals", async () => {
    env.fetch.on("POST", `${AI}/admin/interview-prep/run`, { run_id: "prep-4", status: "running" });
    const cand = await createUser(env, { name: "Asha Rao" });
    await env.http
      .put("/api/v1/users/me/candidate-profile")
      .set("Authorization", await bearer(env, cand))
      .send({ fullName: "Asha Rao", headline: "Aspiring SDE", targetRole: "SDE", skills: ["Python"], detectedLinks: { github: "https://github.com/asha" } })
      .expect(200);
    await env.c.repos.fragments.insert({
      userId: cand.id,
      source: "LEETCODE",
      data: { solved: { total: 120 }, byTopic: [{ topic: "Array", count: 40 }], contest: null, recentActivity: { last30Days: 3 }, username: "asha" },
      contentHash: "h",
      version: 1,
      fetchedAt: new Date(),
    });

    await env.http.post(`${BASE}/run`).set("Authorization", admin).send({ jobDescriptionId: jd.id, candidateId: cand.id }).expect(200);
    const body = forwarded();
    expect(body.session.candidateId).toBe(cand.id);
    expect(body.candidateProfile).toMatchObject({
      fullName: "Asha Rao",
      headline: "Aspiring SDE",
      targetRole: "SDE",
      skills: ["Python"],
      links: { github: "https://github.com/asha", leetcode: null, linkedin: null },
      codingProfile: { github: null, leetcode: { solved: { total: 120 }, byTopic: [{ topic: "Array", count: 40 }], recentActivity: { last30Days: 3 } } },
    });
  });

  it("a candidate without a saved profile still gets an (empty) profile with coding signals", async () => {
    env.fetch.on("POST", `${AI}/admin/interview-prep/run`, { run_id: "prep-5", status: "running" });
    const cand = await createUser(env);
    await env.http.post(`${BASE}/run`).set("Authorization", admin).send({ jobDescriptionId: jd.id, candidateId: cand.id }).expect(200);
    expect(forwarded().candidateProfile).toMatchObject({ fullName: null, skills: [], codingProfile: { github: null, leetcode: null } });
  });

  it("startRun_unknownJd_isBadRequest", async () => {
    const res = await env.http.post(`${BASE}/run`).set("Authorization", admin).send({ jobDescriptionId: randomUUID(), roundType: "dsa" });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ code: "prep_bad_request", message: "unknown job description" });
    expect(aiCalls(env)).toHaveLength(0);
  });

  it("a missing jobDescriptionId is 400 prep_bad_request", async () => {
    const res = await env.http.post(`${BASE}/run`).set("Authorization", admin).send({ roundType: "dsa" });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ code: "prep_bad_request", message: "jobDescriptionId is required" });
  });

  it("malformed ids / round types are 400", async () => {
    const badJd = await env.http.post(`${BASE}/run`).set("Authorization", admin).send({ jobDescriptionId: "nope" });
    expect(badJd.status).toBe(400);
    const badCand = await env.http.post(`${BASE}/run`).set("Authorization", admin).send({ jobDescriptionId: jd.id, candidateId: 42 });
    expect(badCand.status).toBe(400);
    const badRound = await env.http.post(`${BASE}/run`).set("Authorization", admin).send({ jobDescriptionId: jd.id, roundType: "oa" });
    expect(badRound.status).toBe(400);
    expect(aiCalls(env)).toHaveLength(0);
  });

  it("an AI failure on start is 502 ai_service_unreachable", async () => {
    env.fetch.on("POST", `${AI}/admin/interview-prep/run`, () => status(500));
    const res = await env.http.post(`${BASE}/run`).set("Authorization", admin).send({ jobDescriptionId: jd.id });
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ code: "ai_service_unreachable", message: "the intelligence service is not reachable" });
  });
});

describe("GET /intelligence/interview-prep/runs[/:runId]", () => {
  it("runStatus_proxies", async () => {
    env.fetch.on("GET", `${AI}/admin/interview-prep/runs/prep-1`, { run_id: "prep-1", status: "completed" });
    const res = await env.http.get(`${BASE}/runs/prep-1`).set("Authorization", admin);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ run_id: "prep-1", status: "completed" });
    expect(aiCalls(env)[0]?.url).toBe(`${AI}/admin/interview-prep/runs/prep-1?after=0`);
  });

  it("forwards ?after", async () => {
    env.fetch.on("GET", `${AI}/admin/interview-prep/runs/prep-1`, { status: "running" });
    await env.http.get(`${BASE}/runs/prep-1?after=12`).set("Authorization", admin).expect(200);
    expect(aiCalls(env)[0]?.url).toBe(`${AI}/admin/interview-prep/runs/prep-1?after=12`);
  });

  it("an unknown run is 404 run_not_found", async () => {
    env.fetch.on("GET", `${AI}/admin/interview-prep/runs/nope`, () => json({ detail: "x" }, 404));
    const res = await env.http.get(`${BASE}/runs/nope`).set("Authorization", admin);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ code: "run_not_found", message: "no such interview-prep run" });
  });

  it("list proxies", async () => {
    env.fetch.on("GET", `${AI}/admin/interview-prep/runs`, { runs: [] });
    const res = await env.http.get(`${BASE}/runs`).set("Authorization", admin);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ runs: [] });
  });

  it("aiServiceDown_maps502", async () => {
    const res = await env.http.get(`${BASE}/runs`).set("Authorization", admin);
    expect(res.status).toBe(502);
    expect(res.body.code).toBe("ai_service_unreachable");
  });
});

describe("GET /intelligence/interview-prep/candidates", () => {
  it("candidates_listsOnboardedCandidatesWithNameAndEmail", async () => {
    const asha = await createUser(env, { name: "Asha Rao", email: `asha-${randomUUID().slice(0, 6)}@example.com` });
    await env.http.put("/api/v1/users/me/candidate-profile").set("Authorization", await bearer(env, asha)).send({ fullName: "Asha Rao" }).expect(200);

    const res = await env.http.get(`${BASE}/candidates`).set("Authorization", admin);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: asha.id, name: "Asha Rao", email: asha.email }]);
  });

  it("only users with a saved profile are listed, sorted case-insensitively by name, with fallbacks", async () => {
    const zed = await createUser(env, { name: "zed" });
    const amy = await createUser(env, { name: "Amy" });
    await createUser(env, { name: "Not Onboarded" });
    for (const u of [zed, amy]) {
      await env.http.put("/api/v1/users/me/candidate-profile").set("Authorization", await bearer(env, u)).send({ fullName: "x" }).expect(200);
    }
    // A profile whose user row is gone: name falls back to the profile's fullName, email to its email.
    const orphanId = randomUUID();
    await env.c.repos.candidateProfiles.save({
      userId: orphanId,
      fullName: "Orphan Person",
      email: "orphan@example.com",
      phone: null,
      location: null,
      headline: null,
      targetRole: null,
      education: [],
      experience: [],
      projects: [],
      skills: [],
      achievements: [],
      detectedLinks: { github: null, leetcode: null, linkedin: null },
      resumeFilename: null,
      resumeParsedAt: null,
    });
    // ...and with no name anywhere → "Unnamed candidate".
    const nameless = randomUUID();
    await env.c.repos.candidateProfiles.save({
      userId: nameless,
      fullName: "  ",
      email: null,
      phone: null,
      location: null,
      headline: null,
      targetRole: null,
      education: [],
      experience: [],
      projects: [],
      skills: [],
      achievements: [],
      detectedLinks: { github: null, leetcode: null, linkedin: null },
      resumeFilename: null,
      resumeParsedAt: null,
    });

    const res = await env.http.get(`${BASE}/candidates`).set("Authorization", admin);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { id: amy.id, name: "Amy", email: amy.email },
      { id: orphanId, name: "Orphan Person", email: "orphan@example.com" },
      { id: nameless, name: "Unnamed candidate", email: null },
      { id: zed.id, name: "zed", email: zed.email },
    ]);
  });

  it("ADMIN-only", async () => {
    const user = await bearer(env, await createUser(env));
    expect((await env.http.get(`${BASE}/candidates`).set("Authorization", user)).status).toBe(403);
    expect((await env.http.post(`${BASE}/run`).set("Authorization", user).send({ jobDescriptionId: jd.id })).status).toBe(403);
  });
});
