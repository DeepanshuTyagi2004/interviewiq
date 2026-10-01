import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { InterviewSessionRow, JobDescriptionRow } from "../../src/db/pg/schema.js";
import type { GenerateInterviewPlanRequest } from "../../src/integrations/aiService/types.js";
import { parseCandidateProfileRequest } from "../../src/services/candidateProfileService.js";
import { json, status } from "../support/fakeFetch.js";
import { createTestEnv, createUser, TEST_INTERNAL_KEY, type TestEnv } from "../support/harness.js";

/**
 * Port of InterviewPrepServiceTest. Real session/JD repositories (PGlite), the candidate profile
 * from Mongo, and the ai-service fire-and-poll endpoints stubbed at the HTTP boundary:
 * POST {AI}/interview-plans/start → {run_id}, then GET {AI}/interview-plans/runs/{id}.
 * Poll interval is 1 ms and max wait 2000 ms (harness defaults) so nothing sleeps long.
 */

const START = "http://ai.test/interview-plans/start";
const RUNS = "http://ai.test/interview-plans/runs/";

const completed = (provenance: Record<string, unknown> = {}) => ({ status: "completed", plan: { provenance } });

async function insertJd(env: TestEnv): Promise<JobDescriptionRow> {
  return env.c.repos.jds.insert({
    company: "google",
    role: "software-engineer",
    level: "sde1",
    title: "SWE",
    specialization: "backend",
    description: "Build things",
    techStack: "Java, Spring",
    sourceUrl: "http://jd",
    source: "seed",
    active: true,
  });
}

async function newSession(env: TestEnv, candidateId?: string): Promise<{ s: InterviewSessionRow; jd: JobDescriptionRow }> {
  const jd = await insertJd(env);
  const s = await env.c.repos.sessions.insert({
    candidateId: candidateId ?? (await createUser(env)).id,
    jobDescriptionId: jd.id,
    company: jd.company,
    role: jd.role,
    level: jd.level,
    specialization: jd.specialization,
    roundType: "dsa",
    scheduledAt: new Date("2026-07-10T10:00:00Z"),
    timezone: "Asia/Kolkata",
    status: "SCHEDULED",
  });
  return { s, jd };
}

/** The Java fixture profile, saved the way the onboarding wizard saves it. */
async function saveProfile(env: TestEnv, userId: string): Promise<void> {
  await env.c.candidateProfiles.saveProfile(
    userId,
    parseCandidateProfileRequest({
      fullName: "Asha Rao",
      email: "asha@example.com",
      phone: null,
      location: "Delhi",
      headline: "Aspiring SDE",
      targetRole: "SDE",
      education: [{ institution: "IIT", degree: "B.Tech", field: "CS", startYear: "2021", endYear: "2025", grade: "8.9" }],
      experience: [{ company: "Acme", title: "Intern", startDate: "2024", endDate: "2024", location: "Remote", bullets: ["Built X"] }],
      projects: [{ name: "Relay", description: "Mac automation agent", tech: ["Node.js"], bullets: ["Built a real-time automation agent"], link: null }],
      skills: ["Python"],
      achievements: ["Smart India Hackathon 2024 finalist"],
      detectedLinks: { github: "https://github.com/asha", leetcode: null, linkedin: null },
      resumeFilename: "resume.pdf",
      complete: true,
    }),
  );
}

const row = async (env: TestEnv, id: string) => (await env.c.repos.sessions.findById(id))!;
const startBody = (env: TestEnv) => env.fetch.callsTo(START, "POST").map((c) => c.json as GenerateInterviewPlanRequest);

describe("InterviewPrepService.generatePrep", () => {
  let env: TestEnv;
  beforeAll(async () => {
    env = await createTestEnv();
  });
  afterAll(() => env.close());
  beforeEach(() => env.fetch.reset());
  afterEach(() => vi.restoreAllMocks());

  it("success: marks PREP_READY with the plan reference (queued first)", async () => {
    const { s } = await newSession(env);
    await saveProfile(env, s.candidateId);
    let statusAtStart: string | undefined;
    env.fetch.on("POST", START, async () => {
      statusAtStart = (await row(env, s.id)).status;
      return json({ run_id: "run1", status: "running" });
    });
    env.fetch.on("GET", `${RUNS}run1`, completed({ planVersion: "v1", inputHash: "sha256:abc" }));

    await env.c.prep.generatePrep(s.id);

    const after = await row(env, s.id);
    expect(after.status).toBe("PREP_READY");
    expect(after.planVersion).toBe("v1");
    expect(after.inputHash).toBe("sha256:abc");
    expect(after.prepError).toBeNull();
    expect(statusAtStart).toBe("PREP_QUEUED");
    expect(env.fetch.callsTo(START)[0]!.headers["x-internal-api-key"]).toBe(TEST_INTERNAL_KEY);
  });

  it("assembles the body from the session, the JD and the candidate profile", async () => {
    const { s, jd } = await newSession(env);
    await saveProfile(env, s.candidateId);
    env.fetch.on("POST", START, { run_id: "run1" });
    env.fetch.on("GET", `${RUNS}run1`, completed());

    await env.c.prep.generatePrep(s.id);

    const bodies = startBody(env);
    expect(bodies).toHaveLength(1);
    const body = bodies[0]!;

    expect(body.session.sessionId).toBe(s.id);
    expect(body.session.candidateId).toBe(s.candidateId);
    expect(body.session.company).toBe("google");
    expect(body.session.role).toBe("software-engineer");
    expect(body.session.level).toBe("sde1");
    expect(body.session.specialization).toBe("backend");
    expect(body.session.roundType).toBe("dsa");

    expect(body.jobDescription.id).toBe(jd.id);
    expect(body.jobDescription.title).toBe("SWE");
    expect(body.jobDescription.techStack).toBe("Java, Spring");

    expect(body.candidateProfile.fullName).toBe("Asha Rao");
    expect(body.candidateProfile.skills).toEqual(["Python"]);
    expect(body.candidateProfile.links.github).toBe("https://github.com/asha");
    expect(body.candidateProfile.codingProfile).toEqual({ github: null, leetcode: null }); // nothing connected

    // assembleRequest is exactly what went over the wire.
    expect(JSON.parse(JSON.stringify(await env.c.prep.assembleRequest(s)))).toEqual(body);
    expect((await row(env, s.id)).status).toBe("PREP_READY");
  });

  it("missing profile still builds the body", async () => {
    const { s } = await newSession(env);
    env.fetch.on("POST", START, { run_id: "run1" });
    env.fetch.on("GET", `${RUNS}run1`, completed());

    await env.c.prep.generatePrep(s.id);

    const [body] = startBody(env);
    expect(body!.candidateProfile.fullName).toBeNull();
    expect(body!.candidateProfile.skills).toEqual([]);
    expect(body!.candidateProfile.links).toEqual({ github: null, leetcode: null, linkedin: null });
    expect((await row(env, s.id)).status).toBe("PREP_READY");
  });

  it("polls a running run until it completes", async () => {
    const { s } = await newSession(env);
    env.fetch.on("POST", START, { run_id: "run1" });
    env.fetch.on("GET", `${RUNS}run1`, completed({ planVersion: "v2" }));
    env.fetch.on("GET", `${RUNS}run1`, { status: "running" }, { times: 2 });

    await env.c.prep.generatePrep(s.id);

    expect(env.fetch.callsTo(`${RUNS}run1`, "GET")).toHaveLength(3);
    const after = await row(env, s.id);
    expect(after.status).toBe("PREP_READY");
    expect(after.planVersion).toBe("v2");
  });

  it("upstream failure (ai-service unreachable) marks PREP_FAILED", async () => {
    const { s } = await newSession(env);
    // No route for /interview-plans/start → FakeFetch throws a transport error ("ai-service down").

    await env.c.prep.generatePrep(s.id);

    const after = await row(env, s.id);
    expect(after.status).toBe("PREP_FAILED");
    expect(after.prepError).not.toBeNull();
    expect(after.prepError).toBe("prep_generation_failed");
  });

  it("an HTTP error status from the ai-service is recorded as prep_generation_upstream_<status>", async () => {
    const { s } = await newSession(env);
    env.fetch.on("POST", START, () => status(503, "unavailable"));

    await env.c.prep.generatePrep(s.id);

    const after = await row(env, s.id);
    expect(after.status).toBe("PREP_FAILED");
    expect(after.prepError).toBe("prep_generation_upstream_503");
  });

  it("run reports failed → PREP_FAILED with the ai-service error code", async () => {
    const { s } = await newSession(env);
    env.fetch.on("POST", START, { run_id: "run1" });
    env.fetch.on("GET", `${RUNS}run1`, { status: "failed", error: { code: "llm_error", message: "model never valid" } });

    await env.c.prep.generatePrep(s.id);

    const after = await row(env, s.id);
    expect(after.status).toBe("PREP_FAILED");
    expect(after.prepError).toBe("prep_generation_llm_error");
  });

  it("run reports failed without a code → prep_generation_failed", async () => {
    const { s } = await newSession(env);
    env.fetch.on("POST", START, { run_id: "run1" });
    env.fetch.on("GET", `${RUNS}run1`, { status: "failed", error: { message: "?" } });

    await env.c.prep.generatePrep(s.id);

    expect((await row(env, s.id)).prepError).toBe("prep_generation_failed");
  });

  it("missing session is a no-op (no ai-service call, no write)", async () => {
    const update = vi.spyOn(env.c.repos.sessions, "update");

    await env.c.prep.generatePrep(randomUUID());

    expect(env.fetch.calls).toHaveLength(0);
    expect(update).not.toHaveBeenCalled();
  });
});

describe("InterviewPrepService.generatePrep — max wait", () => {
  let env: TestEnv;
  beforeAll(async () => {
    env = await createTestEnv({ INTERVIEW_PREP_PLAN_MAX_WAIT_MS: "50" });
  });
  afterAll(() => env.close());

  it("a run still running past the max wait → PREP_FAILED prep_generation_timeout", async () => {
    const { s } = await newSession(env);
    env.fetch.on("POST", START, { run_id: "slow" });
    env.fetch.on("GET", `${RUNS}slow`, { status: "running" });

    await env.c.prep.generatePrep(s.id);

    const after = await row(env, s.id);
    expect(after.status).toBe("PREP_FAILED");
    expect(after.prepError).toBe("prep_generation_timeout");
    expect(env.fetch.callsTo(`${RUNS}slow`).length).toBeGreaterThan(1); // it did poll
  });
});
