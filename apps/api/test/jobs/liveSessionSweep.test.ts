import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MOCK_ROUND_MINUTES } from "../../src/domain/liveRound.js";
import { CEILING_FACTOR, LiveSessionSweepJob, SWEEP_GRACE_MINUTES } from "../../src/jobs/jobs.js";
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

  it("uses the session's own duration, and a default of 45 minutes (the mock-round length) without a briefing", async () => {
    const jd = await seedJd(env);
    const user = await createUser(env);
    const now = Date.now();
    // A 20-minute briefing: 1.5x20 + 30 = 60 minutes, so 70 minutes live is past it (it would not be under the 97.5-minute default).
    const short = await seedSession(env, user.id, jd, { status: "LIVE_IN_PROGRESS", liveStartedAt: new Date(now - 70 * 60_000), prepBriefing: { ...briefing, duration_mins: 20 } });
    // No briefing: falls back to 45 minutes, so the deadline is 1.5x45 + 30 = 97.5 minutes.
    expect(CEILING_FACTOR * MOCK_ROUND_MINUTES + SWEEP_GRACE_MINUTES).toBe(97.5);
    const noBriefingStuck = await seedSession(env, user.id, jd, { status: "LIVE_IN_PROGRESS", liveStartedAt: new Date(now - 100 * 60_000) });
    const noBriefingRunning = await seedSession(env, user.id, jd, { status: "LIVE_IN_PROGRESS", liveStartedAt: new Date(now - 90 * 60_000) });
    const job = new LiveSessionSweepJob(env.c.repos.sessions, quiet, () => now);
    await job.tick();
    expect((await env.c.repos.sessions.findById(short.id))!.status).toBe("ABORTED_TECHNICAL");
    expect((await env.c.repos.sessions.findById(noBriefingStuck.id))!.status).toBe("ABORTED_TECHNICAL"); // 100 > 97.5
    expect((await env.c.repos.sessions.findById(noBriefingRunning.id))!.status).toBe("LIVE_IN_PROGRESS"); // 90 < 97.5
  });
});
