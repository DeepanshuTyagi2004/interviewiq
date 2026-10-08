import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SESSION_STATUSES } from "../../src/domain/enums.js";
import { createTestEnv, createUser, type TestEnv } from "../support/harness.js";

/**
 * Port of InterviewSessionLiveFieldsTest. The live fields (and the blueprint prep fields) map onto
 * the Drizzle `interview_sessions` table and round-trip unchanged.
 */

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(() => env.close());

describe("interview session live fields", () => {
  it("live states exist", () => {
    expect(SESSION_STATUSES).toContain("LIVE_IN_PROGRESS");
    expect(SESSION_STATUSES).toContain("COMPLETED");
    expect(SESSION_STATUSES).toContain("ABORTED_TECHNICAL");
  });

  it("live columns keep the Hibernate names", async () => {
    const res = await env.db.execute<{ column_name: string }>(
      sql`select column_name from information_schema.columns where table_name = 'interview_sessions'`,
    );
    const rows = (Array.isArray(res) ? res : (res as { rows: { column_name: string }[] }).rows).map((r) => r.column_name);
    expect(rows).toEqual(
      expect.arrayContaining(["live_started_at", "live_ended_at", "ended_reason", "livekit_room", "live_score_final", "duration_s"]),
    );
  });

  it("live and blueprint prep fields round-trip", async () => {
    const user = await createUser(env);
    const jd = await env.c.repos.jds.insert({ company: "google", role: "software-engineer", level: "sde1", title: "SWE", source: "seed", active: true });
    const s = await env.c.repos.sessions.insert({
      candidateId: user.id,
      jobDescriptionId: jd.id,
      company: "google",
      role: "software-engineer",
      level: "sde1",
      roundType: "dsa",
      scheduledAt: new Date(),
      timezone: "Asia/Kolkata",
    });
    expect(s.status).toBe("SCHEDULED"); // column default
    expect(s.liveStartedAt).toBeNull();

    const now = new Date();
    await env.c.repos.sessions.update(s.id, {
      status: "LIVE_IN_PROGRESS",
      liveStartedAt: now,
      liveEndedAt: now,
      endedReason: "natural_complete",
      livekitRoom: "interview-abc",
      liveScoreFinal: 0.72,
      durationS: 1830,
    });
    await env.c.repos.sessions.update(s.id, {
      prepRunId: "bpr_1", prepInputHash: "h", blueprintVersion: 3, prepRefreshing: true, preparedAt: now,
      prepBriefing: { interviewer_name: "Asha", interviewer_style: "calm", format: "45-minute coding interview", duration_mins: 45 },
    });

    const r = (await env.c.repos.sessions.findById(s.id))!;
    expect(r.status).toBe("LIVE_IN_PROGRESS");
    expect(r.liveStartedAt).toEqual(now);
    expect(r.liveEndedAt).toEqual(now);
    expect(r.endedReason).toBe("natural_complete");
    expect(r.livekitRoom).toBe("interview-abc");
    expect(r.liveScoreFinal).toBe(0.72);
    expect(r.durationS).toBe(1830);
    expect(r).toMatchObject({ prepRunId: "bpr_1", prepInputHash: "h", blueprintVersion: 3, prepRefreshing: true, prepRetryCount: 0 });
    expect(r.prepBriefing?.interviewer_name).toBe("Asha");
  });
});
