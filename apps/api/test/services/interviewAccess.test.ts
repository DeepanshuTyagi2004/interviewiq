import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ApiError } from "../../src/lib/errors.js";
import type { JobDescriptionRow } from "../../src/db/pg/schema.js";
import type { CreateSessionRequest } from "../../src/services/interviewSessions.js";
import { seedCompany, seedJd, seedSession } from "../routes/helpers.js";
import { createTestEnv, createUser, type TestEnv } from "../support/harness.js";

let env: TestEnv;
let jd: JobDescriptionRow;

beforeAll(async () => {
  env = await createTestEnv({ LIVE_INTERVIEWER_AVAILABLE: "true" });
  await seedCompany(env, "google", "Google");
  jd = await seedJd(env);
});
afterAll(() => env.close());

async function denied(p: Promise<unknown>) {
  const err = await p.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(ApiError);
  expect(err).toMatchObject({ status: 403, code: "interview_access_required" });
}

const request = (): CreateSessionRequest => ({
  jobDescriptionId: jd.id, roundType: "dsa", scheduledAt: new Date(Date.now() + 7 * 864e5), timezone: "Asia/Kolkata", loopId: null, nodeId: null,
});

describe("InterviewAccess", () => {
  it("rejects a USER with 403 interview_access_required", async () => {
    const u = await createUser(env, { role: "USER" });
    await denied(env.c.interviewAccess.assertCanInterview(u.id));
  });

  it("lets a CANDIDATE and an ADMIN through", async () => {
    const c = await createUser(env);
    const a = await createUser(env, { role: "ADMIN" });
    await expect(env.c.interviewAccess.assertCanInterview(c.id)).resolves.toBeUndefined();
    await expect(env.c.interviewAccess.assertCanInterview(a.id)).resolves.toBeUndefined();
  });

  it("rejects an unknown user id the same way", async () => {
    await denied(env.c.interviewAccess.assertCanInterview(randomUUID()));
  });
});

describe("the gated session methods", () => {
  it("refuse a USER for create, reschedule, retry prep, go live and warm, but not list, get or cancel", async () => {
    const u = await createUser(env, { role: "USER" });
    const s = await seedSession(env, u.id, jd, { status: "PREP_READY" });
    await denied(env.c.sessions.createSession(u.id, request()));
    await denied(env.c.sessions.reschedule(u.id, s.id, new Date(Date.now() + 8 * 864e5), "Asia/Kolkata"));
    await denied(env.c.sessions.retryPrep(u.id, s.id));
    await denied(env.c.liveSessions.startLive(u.id, s.id));
    await denied(env.c.liveSessions.warm(u.id, s.id));
    expect((await env.c.sessions.listSessions(u.id)).sessions).toHaveLength(1);
    expect((await env.c.sessions.getSession(u.id, s.id)).id).toBe(s.id);
    expect((await env.c.sessions.cancel(u.id, s.id)).status).toBe("CANCELLED");
  });

  it("let a promoted user in on the very next call, without a new token", async () => {
    const u = await createUser(env, { role: "USER" });
    await denied(env.c.sessions.createSession(u.id, request()));
    await env.c.repos.users.updateRole(u.id, "CANDIDATE");
    const err = await env.c.sessions.createSession(u.id, request()).then(() => null, (e: unknown) => e);
    expect((err as { code?: string } | null)?.code).not.toBe("interview_access_required");
  });

  it("go by the database role, not the token: a stale ADMIN token on a demoted user is refused", async () => {
    const u = await createUser(env, { role: "ADMIN" });
    await env.c.repos.users.updateRole(u.id, "USER");
    await denied(env.c.sessions.createSession(u.id, request()));
  });
});
