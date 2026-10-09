import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LiveSessionSweepJob } from "../../src/jobs/jobs.js";
import { createTestEnv, createUser, type TestEnv } from "../support/harness.js";
import { seedCompany, seedJd, seedSession } from "../routes/helpers.js";

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
  await seedCompany(env, "google", "Google");
});
afterAll(() => env.close());

const briefing = { interviewer_name: "S", interviewer_style: "w", format: "coding", duration_mins: 60 };
const quiet = { info: () => {}, warn: () => {} } as never;

describe("LiveSessionSweepJob", () => {
  it("aborts live sessions only past 1.5x their duration plus 30 minutes", async () => {
    const jd = await seedJd(env);
    const user = await createUser(env);
    const now = Date.now();
    const stuck = await seedSession(env, user.id, jd, { status: "LIVE_IN_PROGRESS", liveStartedAt: new Date(now - 121 * 60_000), prepBriefing: briefing });
    const running = await seedSession(env, user.id, jd, { status: "LIVE_IN_PROGRESS", liveStartedAt: new Date(now - 100 * 60_000), prepBriefing: briefing });
    const job = new LiveSessionSweepJob(env.c.repos.sessions, quiet, () => now);
    expect(await job.tick()).toBe(1);
    expect(await env.c.repos.sessions.findById(stuck.id)).toMatchObject({ status: "ABORTED_TECHNICAL", endedReason: "technical" });
    expect((await env.c.repos.sessions.findById(running.id))!.status).toBe("LIVE_IN_PROGRESS");
  });

  it("uses the session's own duration, and a default of 60 minutes without a briefing", async () => {
    const jd = await seedJd(env);
    const user = await createUser(env);
    const now = Date.now();
    // 30-minute round: 1.5x30 + 30 = 75 minutes
    const short = await seedSession(env, user.id, jd, { status: "LIVE_IN_PROGRESS", liveStartedAt: new Date(now - 80 * 60_000), prepBriefing: { ...briefing, duration_mins: 30 } });
    const noBriefing = await seedSession(env, user.id, jd, { status: "LIVE_IN_PROGRESS", liveStartedAt: new Date(now - 100 * 60_000) });
    const job = new LiveSessionSweepJob(env.c.repos.sessions, quiet, () => now);
    await job.tick();
    expect((await env.c.repos.sessions.findById(short.id))!.status).toBe("ABORTED_TECHNICAL");
    expect((await env.c.repos.sessions.findById(noBriefing.id))!.status).toBe("LIVE_IN_PROGRESS"); // 100 < 120
  });
});
