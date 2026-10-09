import { randomUUID } from "node:crypto";
import { jwtVerify } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { JobDescriptionRow } from "../../src/db/pg/schema.js";
import { bearer, createUser, createTestEnv, type TestEnv } from "../support/harness.js";
import { json } from "../support/fakeFetch.js";
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

describe("allowlist (LIVE_INTERVIEWER_ALLOWLIST)", () => {
  it("lets an allowlisted user go live while the global flag is off, and refuses everyone else", async () => {
    const allowed = await createUser(env);
    const other = await createUser(env);
    const gated = await createTestEnv({ LIVE_INTERVIEWER_AVAILABLE: "false", LIVE_INTERVIEWER_ALLOWLIST: allowed.id });
    try {
      await seedCompany(gated, "google", "Google");
      const gatedJd = await seedJd(gated);
      const mine = await seedSession(gated, allowed.id, gatedJd, { status: "PREP_READY" });
      const theirs = await seedSession(gated, other.id, gatedJd, { status: "PREP_READY" });
      const ok = await gated.http.post(live(mine.id)).set("Authorization", await bearer(gated, allowed));
      expect(ok.status).toBe(200);
      const refused = await gated.http.post(live(theirs.id)).set("Authorization", await bearer(gated, other));
      expect(refused.status).toBe(409);
      expect(refused.body.code).toBe("live_unavailable");
      const list = await gated.http.get("/api/v1/interviews/sessions").set("Authorization", await bearer(gated, allowed));
      expect(list.body.sessions.find((s: { id: string }) => s.id === mine.id).liveAvailable).toBe(true);
    } finally {
      await gated.close();
    }
  });
});

describe("agent dispatch", () => {
  it("dispatches the interviewer at go-live, and a failed dispatch still lets the candidate in", async () => {
    env.fetch.reset();
    env.fetch.on("POST", /CreateDispatch$/, () => json({ code: "internal" }, 500));
    const user = await createUser(env);
    const s = await seedSession(env, user.id, jd, { status: "PREP_READY" });
    const res = await env.http.post(live(s.id)).set("Authorization", await bearer(env, user));
    expect(res.status).toBe(200);
    expect(env.fetch.callsTo(/CreateDispatch/)).toHaveLength(1);
    expect(env.fetch.callsTo(/CreateDispatch/)[0]!.json).toMatchObject({ room: `interview-${s.id}`, agent_name: "interviewer" });
  });

  it("re-dispatches on resume only when the room has no interviewer and enough time has passed", async () => {
    env.fetch.reset();
    env.fetch.on("POST", /CreateDispatch$/, {});
    env.fetch.on("POST", /ListParticipants$/, { participants: [] });
    const user = await createUser(env);
    const fresh = await seedSession(env, user.id, jd, { status: "LIVE_IN_PROGRESS", liveStartedAt: new Date() });
    await env.http.get(live(fresh.id)).set("Authorization", await bearer(env, user));
    expect(env.fetch.callsTo(/ListParticipants/)).toHaveLength(0);          // just went live: give the interviewer time to join

    const old = await seedSession(env, user.id, jd, { status: "LIVE_IN_PROGRESS", liveStartedAt: new Date(Date.now() - 120_000) });
    await env.http.get(live(old.id)).set("Authorization", await bearer(env, user));
    expect(env.fetch.callsTo(/CreateDispatch/)).toHaveLength(1);
    await env.http.get(live(old.id)).set("Authorization", await bearer(env, user));
    expect(env.fetch.callsTo(/CreateDispatch/)).toHaveLength(1);            // the last dispatch was under 30 s ago

    env.fetch.reset();
    env.fetch.on("POST", /ListParticipants$/, { participants: [{ identity: "agent-1", kind: "AGENT" }] });
    const healthy = await seedSession(env, user.id, jd, { status: "LIVE_IN_PROGRESS", liveStartedAt: new Date(Date.now() - 120_000) });
    await env.http.get(live(healthy.id)).set("Authorization", await bearer(env, user));
    expect(env.fetch.callsTo(/CreateDispatch/)).toHaveLength(0);            // an interviewer is already there
  });
});

describe("POST /sessions/:id/live/end (candidate fallback)", () => {
  it("ends the candidate's live round and is idempotent", async () => {
    const user = await createUser(env);
    const s = await seedSession(env, user.id, jd, { status: "LIVE_IN_PROGRESS", liveStartedAt: new Date() });
    const path = `${live(s.id)}/end`;
    const first = await env.http.post(path).set("Authorization", await bearer(env, user));
    expect(first.body).toEqual({ status: "COMPLETED", endReason: "candidate_ended", alreadyEnded: false });
    const again = await env.http.post(path).set("Authorization", await bearer(env, user));
    expect(again.body).toEqual({ status: "COMPLETED", endReason: "candidate_ended", alreadyEnded: true });
    const other = await createUser(env);
    expect((await env.http.post(path).set("Authorization", await bearer(env, other))).status).toBe(404);
  });

  it("does not overwrite an interviewer's ending: the fallback arriving late is a quiet no-op", async () => {
    const user = await createUser(env);
    const s = await seedSession(env, user.id, jd, { status: "COMPLETED", endedReason: "ended_by_interviewer" });
    const res = await env.http.post(`${live(s.id)}/end`).set("Authorization", await bearer(env, user));
    expect(res.body).toEqual({ status: "COMPLETED", endReason: "ended_by_interviewer", alreadyEnded: true });
    expect((await env.c.repos.sessions.findById(s.id))!.endedReason).toBe("ended_by_interviewer");
  });
});
