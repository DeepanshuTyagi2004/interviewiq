import { randomUUID } from "node:crypto";
import { jwtVerify } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { JobDescriptionRow } from "../../src/db/pg/schema.js";
import { bearer, createUser, createTestEnv, type TestEnv } from "../support/harness.js";
import { seedCompany, seedJd, seedSession } from "./helpers.js";

/**
 * Port of InterviewSessionLiveControllerTest (go-live / resume under
 * /api/v1/interviews/sessions/:id/live). Real LiveSessionService + real LiveKit token minting.
 */

let env: TestEnv;
let jd: JobDescriptionRow;

// Values from the harness config.
const LIVEKIT_URL = "wss://livekit.test";
const LIVEKIT_KEY = "lk-key";
const LIVEKIT_SECRET = "lk-secret-lk-secret-lk-secret-lk-secret";

beforeAll(async () => {
  env = await createTestEnv({ LIVE_INTERVIEWER_AVAILABLE: "true" });
  await seedCompany(env, "google", "Google");
  jd = await seedJd(env);
});
afterAll(() => env.close());

const live = (sessionId: string) => `/api/v1/interviews/sessions/${sessionId}/live`;

/** Verify a LiveKit join token and return its claims. */
async function claims(token: string) {
  const { payload } = await jwtVerify(token, new TextEncoder().encode(LIVEKIT_SECRET));
  return payload as { sub?: string; iss?: string; exp?: number; video?: { room?: string; roomJoin?: boolean } };
}

describe("POST /sessions/:id/live (go live)", () => {
  it("goLive_returns200WithConnection: PREP_READY → LIVE_IN_PROGRESS + a join token for the candidate", async () => {
    const user = await createUser(env);
    const s = await seedSession(env, user.id, jd, { status: "PREP_READY" });

    const res = await env.http.post(live(s.id)).set("Authorization", await bearer(env, user));
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(["livekitUrl", "roomName", "status", "token"]);
    expect(res.body.livekitUrl).toBe(LIVEKIT_URL);
    expect(res.body.roomName).toBe(`interview-${s.id}`);
    expect(res.body.status).toBe("LIVE_IN_PROGRESS");

    const c = await claims(res.body.token);
    expect(c.sub).toBe(user.id);
    expect(c.iss).toBe(LIVEKIT_KEY);
    expect(c.video).toMatchObject({ room: `interview-${s.id}`, roomJoin: true });
    const ttl = (c.exp ?? 0) - Math.floor(Date.now() / 1000);
    expect(ttl).toBeGreaterThan(3500);
    expect(ttl).toBeLessThanOrEqual(3600);

    const row = await env.c.repos.sessions.findById(s.id);
    expect(row?.status).toBe("LIVE_IN_PROGRESS");
    expect(row?.livekitRoom).toBe(`interview-${s.id}`);
    expect(row?.liveStartedAt).toBeInstanceOf(Date);
  });

  it("resuming an already-live session returns a fresh token without touching state", async () => {
    const user = await createUser(env);
    const startedAt = new Date("2099-07-10T10:01:00Z");
    const s = await seedSession(env, user.id, jd, {
      status: "LIVE_IN_PROGRESS",
      liveStartedAt: startedAt,
      livekitRoom: "interview-original",
    });
    const res = await env.http.post(live(s.id)).set("Authorization", await bearer(env, user));
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("LIVE_IN_PROGRESS");
    expect(typeof res.body.token).toBe("string");
    expect(res.body.roomName).toBe(`interview-${s.id}`);

    const row = await env.c.repos.sessions.findById(s.id);
    expect(row?.liveStartedAt?.toISOString()).toBe(startedAt.toISOString());
    expect(row?.livekitRoom).toBe("interview-original");
  });

  it.each(["SCHEDULED", "PREP_QUEUED", "PREP_FAILED", "COMPLETED", "ABORTED_TECHNICAL"] as const)(
    "a %s session cannot go live → 409 session_not_ready",
    async (status) => {
      const user = await createUser(env);
      const s = await seedSession(env, user.id, jd, { status });
      const res = await env.http.post(live(s.id)).set("Authorization", await bearer(env, user));
      expect(res.status).toBe(409);
      expect(res.body).toEqual({ code: "session_not_ready", message: "session must be PREP_READY to go live" });
      expect((await env.c.repos.sessions.findById(s.id))?.status).toBe(status);
    },
  );

  it("another candidate's session is 404 session_not_found and stays untouched", async () => {
    const owner = await createUser(env);
    const s = await seedSession(env, owner.id, jd, { status: "PREP_READY" });
    const res = await env.http.post(live(s.id)).set("Authorization", await bearer(env, await createUser(env)));
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("session_not_found");
    expect((await env.c.repos.sessions.findById(s.id))?.status).toBe("PREP_READY");
  });

  it("goLive_withoutJwt_isUnauthorized", async () => {
    expect((await env.http.post(live(randomUUID()))).status).toBe(401);
  });
});

describe("GET /sessions/:id/live (gate / resume)", () => {
  it("getLive_returns200: not live yet → nulls + the current status", async () => {
    const user = await createUser(env);
    const s = await seedSession(env, user.id, jd, { status: "PREP_READY" });
    const res = await env.http.get(live(s.id)).set("Authorization", await bearer(env, user));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ livekitUrl: null, token: null, roomName: null, status: "PREP_READY" });
    // a read never flips state
    expect((await env.c.repos.sessions.findById(s.id))?.status).toBe("PREP_READY");
  });

  it("already live → a fresh connection", async () => {
    const user = await createUser(env);
    const s = await seedSession(env, user.id, jd, { status: "LIVE_IN_PROGRESS" });
    const res = await env.http.get(live(s.id)).set("Authorization", await bearer(env, user));
    expect(res.status).toBe(200);
    expect(res.body.livekitUrl).toBe(LIVEKIT_URL);
    expect(res.body.roomName).toBe(`interview-${s.id}`);
    expect(res.body.status).toBe("LIVE_IN_PROGRESS");
    expect((await claims(res.body.token)).sub).toBe(user.id);
  });

  it("unknown session → 404 session_not_found; no JWT → 401", async () => {
    const res = await env.http.get(live(randomUUID())).set("Authorization", await bearer(env, await createUser(env)));
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("session_not_found");
    expect((await env.http.get(live(randomUUID()))).status).toBe(401);
  });
});
