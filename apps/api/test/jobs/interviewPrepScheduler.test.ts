import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InterviewSessionRow } from "../../src/db/pg/schema.js";
import type { SessionStatus } from "../../src/domain/enums.js";
import { InterviewPrepJob } from "../../src/jobs/jobs.js";
import { silentLogger } from "../../src/lib/logger.js";
import type { GenerateInterviewPlanRequest } from "../../src/integrations/aiService/types.js";
import { json, status, type RecordedCall } from "../support/fakeFetch.js";
import { createTestEnv, createUser, type TestEnv } from "../support/harness.js";

/**
 * Port of InterviewPrepSchedulerTest → InterviewPrepJob.prepareDueSessions. The job scans the
 * whole table, so every test gets a fresh database. Lead time is 15 min (as in the Java test).
 * The ai-service is stubbed so real generation runs; generatePrep is spied (call-through) to
 * assert who got prepared.
 */

const START = "http://ai.test/interview-plans/start";
const RUNS = "http://ai.test/interview-plans/runs/";
const MIN = 60_000;

let env: TestEnv;
let jdId: string;
let candidateId: string;

beforeEach(async () => {
  env = await createTestEnv({ INTERVIEW_PREP_LEAD_TIME_MINUTES: "15" });
  const jd = await env.c.repos.jds.insert({
    company: "google",
    role: "software-engineer",
    level: "sde1",
    title: "SWE",
    specialization: "backend",
    description: "d",
    techStack: "Java",
    sourceUrl: "http://jd",
    source: "seed",
    active: true,
  });
  jdId = jd.id;
  candidateId = (await createUser(env)).id;
  // Every run completes immediately; run ids echo the session so failures can target one.
  env.fetch.on("POST", START, (call: RecordedCall) => json({ run_id: `run-${(call.json as GenerateInterviewPlanRequest).session.sessionId}` }));
  env.fetch.on("GET", RUNS, { status: "completed", plan: { provenance: { planVersion: "v1", inputHash: "sha256:x" } } });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await env.close();
});

function session(scheduledAt: Date, status: SessionStatus = "SCHEDULED"): Promise<InterviewSessionRow> {
  return env.c.repos.sessions.insert({
    candidateId,
    jobDescriptionId: jdId,
    company: "google",
    role: "software-engineer",
    level: "sde1",
    specialization: "backend",
    roundType: "dsa",
    scheduledAt,
    timezone: "Asia/Kolkata",
    status,
  });
}

/** A SCHEDULED session whose slot is inside the lead-time window. */
const dueSession = () => session(new Date(Date.now() + 5 * MIN));

const statusOf = async (id: string) => (await env.c.repos.sessions.findById(id))!.status;
const startedFor = (id: string) =>
  env.fetch.callsTo(START, "POST").filter((c) => (c.json as GenerateInterviewPlanRequest).session.sessionId === id).length;

describe("InterviewPrepJob.prepareDueSessions", () => {
  it("generates prep once per due session (and only for due SCHEDULED ones)", async () => {
    const s1 = await dueSession();
    const s2 = await session(new Date(Date.now() - 1 * MIN)); // slot already started — still due
    const later = await session(new Date(Date.now() + 2 * 60 * MIN)); // outside the 15-min window
    const ready = await session(new Date(Date.now() + 5 * MIN), "PREP_READY"); // due, but not SCHEDULED
    const gen = vi.spyOn(env.c.prep, "generatePrep");

    await env.c.jobs.interviewPrep.prepareDueSessions();

    expect(gen).toHaveBeenCalledTimes(2);
    expect(gen).toHaveBeenCalledWith(s1.id);
    expect(gen).toHaveBeenCalledWith(s2.id);
    expect(startedFor(s1.id)).toBe(1);
    expect(startedFor(s2.id)).toBe(1);
    expect(await statusOf(s1.id)).toBe("PREP_READY");
    expect(await statusOf(s2.id)).toBe("PREP_READY");
    expect(await statusOf(later.id)).toBe("SCHEDULED");
    expect(await statusOf(ready.id)).toBe("PREP_READY");
    expect(startedFor(later.id) + startedFor(ready.id)).toBe(0);
  });

  it("one generatePrep throwing doesn't stop the rest", async () => {
    const s1 = await dueSession();
    const s2 = await dueSession();
    const s3 = await dueSession();
    const real = env.c.prep.generatePrep.bind(env.c.prep);
    const gen = vi.spyOn(env.c.prep, "generatePrep").mockImplementation(async (id: string) => {
      if (id === s2.id) throw new Error("boom");
      return real(id);
    });

    await expect(env.c.jobs.interviewPrep.prepareDueSessions()).resolves.toBeUndefined();

    expect(gen).toHaveBeenCalledWith(s1.id);
    expect(gen).toHaveBeenCalledWith(s2.id);
    expect(gen).toHaveBeenCalledWith(s3.id);
    expect(await statusOf(s1.id)).toBe("PREP_READY");
    expect(await statusOf(s3.id)).toBe("PREP_READY");
  });

  it("an ai-service failure for one session is recorded and the loop continues", async () => {
    const s1 = await dueSession();
    const s2 = await dueSession();
    const s3 = await dueSession();
    env.fetch.on("POST", START, (call: RecordedCall) => {
      const sid = (call.json as GenerateInterviewPlanRequest).session.sessionId;
      return sid === s2.id ? status(500, "boom") : json({ run_id: `run-${sid}` });
    });

    await env.c.jobs.interviewPrep.prepareDueSessions();

    expect(await statusOf(s1.id)).toBe("PREP_READY");
    expect(await statusOf(s2.id)).toBe("PREP_FAILED");
    expect((await env.c.repos.sessions.findById(s2.id))!.prepError).toBe("prep_generation_upstream_500");
    expect(await statusOf(s3.id)).toBe("PREP_READY");
  });

  it("none due → does nothing", async () => {
    await session(new Date(Date.now() + 2 * 60 * MIN)); // not yet due
    const gen = vi.spyOn(env.c.prep, "generatePrep");

    await env.c.jobs.interviewPrep.prepareDueSessions();

    expect(gen).not.toHaveBeenCalled();
    expect(env.fetch.calls).toHaveLength(0);
  });

  it("claims with SCHEDULED → PREP_QUEUED: a session claimed by someone else after the scan is skipped", async () => {
    const mine = await dueSession();
    const taken = await dueSession();
    // Stale due-set: both were SCHEDULED at scan time, but another replica (or a manual
    // regenerate) claimed `taken` before this job got to it.
    const stale = await env.c.repos.sessions.findByStatusAndScheduledAtLessThanEqual("SCHEDULED", new Date(Date.now() + 15 * MIN));
    expect(stale.map((s) => s.id).sort()).toEqual([mine.id, taken.id].sort());
    await env.c.repos.sessions.transitionStatus(taken.id, "SCHEDULED", "PREP_QUEUED");
    vi.spyOn(env.c.repos.sessions, "findByStatusAndScheduledAtLessThanEqual").mockResolvedValueOnce(stale);
    const gen = vi.spyOn(env.c.prep, "generatePrep");

    await env.c.jobs.interviewPrep.prepareDueSessions();

    expect(gen).toHaveBeenCalledTimes(1);
    expect(gen).toHaveBeenCalledWith(mine.id);
    expect(startedFor(taken.id)).toBe(0);
    expect(await statusOf(taken.id)).toBe("PREP_QUEUED");
    expect(await statusOf(mine.id)).toBe("PREP_READY");
  });

  it("two replicas polling at once never prepare the same session twice", async () => {
    const s1 = await dueSession();
    const s2 = await dueSession();
    const replica2 = new InterviewPrepJob(env.c.repos.sessions, env.c.prep, 15, silentLogger());
    const gen = vi.spyOn(env.c.prep, "generatePrep");
    const claim = vi.spyOn(env.c.repos.sessions, "transitionStatus");

    await Promise.all([env.c.jobs.interviewPrep.prepareDueSessions(), replica2.prepareDueSessions()]);

    // Both replicas scanned the same due-set and raced for each session: 4 claims, 2 won.
    const claims = await Promise.all(claim.mock.results.map((r) => r.value as Promise<unknown>));
    expect(claims).toHaveLength(4);
    expect(claims.filter((c) => c !== null)).toHaveLength(2);
    expect(gen).toHaveBeenCalledTimes(2);
    expect(startedFor(s1.id)).toBe(1);
    expect(startedFor(s2.id)).toBe(1);
    expect(await statusOf(s1.id)).toBe("PREP_READY");
    expect(await statusOf(s2.id)).toBe("PREP_READY");
  });
});
