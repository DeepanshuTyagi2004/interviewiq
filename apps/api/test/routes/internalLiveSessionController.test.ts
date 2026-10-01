import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { JobDescriptionRow } from "../../src/db/pg/schema.js";
import { bearer, createUser, createTestEnv, TEST_INTERNAL_KEY, type TestEnv } from "../support/harness.js";
import { seedJd, seedSession } from "./helpers.js";

/**
 * Port of InternalLiveSessionControllerTest (POST /api/v1/internal/sessions/:id/outcome — the
 * Python worker's end-of-interview callback). Guarded by X-Internal-Api-Key, not a JWT.
 */

let env: TestEnv;
let jd: JobDescriptionRow;

beforeAll(async () => {
  env = await createTestEnv();
  jd = await seedJd(env);
});
afterAll(() => env.close());

const outcome = (sessionId: string) => `/api/v1/internal/sessions/${sessionId}/outcome`;
const BODY = { ended_reason: "natural_complete" };

async function liveSession() {
  const user = await createUser(env);
  return seedSession(env, user.id, jd, { status: "LIVE_IN_PROGRESS", liveStartedAt: new Date() });
}

describe("POST /internal/sessions/:id/outcome", () => {
  it("outcome_withValidKey_persistsAndReturns204", async () => {
    const s = await liveSession();
    const res = await env.http.post(outcome(s.id)).set("X-Internal-Api-Key", TEST_INTERNAL_KEY).send(BODY);
    expect(res.status).toBe(204);
    expect(res.text).toBe("");

    const row = await env.c.repos.sessions.findById(s.id);
    expect(row?.status).toBe("COMPLETED");
    expect(row?.endedReason).toBe("natural_complete");
    expect(row?.liveEndedAt).toBeInstanceOf(Date);
    const doc = await env.c.repos.outcomes.findBySessionId(s.id);
    expect(doc?.outcome).toEqual(BODY);
  });

  it("stores the outcome verbatim and promotes live_score_final / duration_s", async () => {
    const s = await liveSession();
    const body = {
      ended_reason: "natural_complete",
      live_score_final: 7.25,
      duration_s: 1799.6,
      transcript: [{ role: "interviewer", text: "Hi" }],
      nested: { any: ["shape", 1, null] },
    };
    const res = await env.http.post(outcome(s.id)).set("X-Internal-Api-Key", TEST_INTERNAL_KEY).send(body);
    expect(res.status).toBe(204);
    const row = await env.c.repos.sessions.findById(s.id);
    expect(row?.liveScoreFinal).toBe(7.25);
    expect(row?.durationS).toBe(1800);
    expect((await env.c.repos.outcomes.findBySessionId(s.id))?.outcome).toEqual(body);
  });

  it("ended_reason aborted_technical → ABORTED_TECHNICAL", async () => {
    const s = await liveSession();
    await env.http.post(outcome(s.id)).set("X-Internal-Api-Key", TEST_INTERNAL_KEY).send({ ended_reason: "aborted_technical" }).expect(204);
    expect((await env.c.repos.sessions.findById(s.id))?.status).toBe("ABORTED_TECHNICAL");
  });

  it("a duplicate delivery on a terminal session is an idempotent 204 no-op", async () => {
    const s = await liveSession();
    await env.http.post(outcome(s.id)).set("X-Internal-Api-Key", TEST_INTERNAL_KEY).send(BODY).expect(204);
    const first = await env.c.repos.sessions.findById(s.id);

    const again = await env.http
      .post(outcome(s.id))
      .set("X-Internal-Api-Key", TEST_INTERNAL_KEY)
      .send({ ended_reason: "aborted_technical", live_score_final: 1 });
    expect(again.status).toBe(204);
    const row = await env.c.repos.sessions.findById(s.id);
    expect(row?.status).toBe("COMPLETED");
    expect(row?.liveScoreFinal).toBeNull();
    expect(row?.liveEndedAt?.getTime()).toBe(first?.liveEndedAt?.getTime());
    expect((await env.c.repos.outcomes.findBySessionId(s.id))?.outcome).toEqual(BODY);
  });

  it("outcome_withBadKey_is401_andDoesNotPersist", async () => {
    const s = await liveSession();
    const res = await env.http.post(outcome(s.id)).set("X-Internal-Api-Key", "wrong").send(BODY);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ code: "invalid_internal_key", message: "missing or invalid internal api key" });
    expect((await env.c.repos.sessions.findById(s.id))?.status).toBe("LIVE_IN_PROGRESS");
    expect(await env.c.repos.outcomes.findBySessionId(s.id)).toBeNull();
  });

  it("a missing key is 401 invalid_internal_key", async () => {
    const s = await liveSession();
    const res = await env.http.post(outcome(s.id)).send(BODY);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("invalid_internal_key");
    expect(await env.c.repos.outcomes.findBySessionId(s.id)).toBeNull();
  });

  it("a user JWT is not a substitute for the internal key", async () => {
    const s = await liveSession();
    const admin = await createUser(env, { role: "ADMIN" });
    const res = await env.http.post(outcome(s.id)).set("Authorization", await bearer(env, admin)).send(BODY);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("invalid_internal_key");
  });

  it("the key check runs before path validation", async () => {
    const res = await env.http.post(outcome("not-a-uuid")).set("X-Internal-Api-Key", "wrong").send(BODY);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("invalid_internal_key");
  });

  it("with a valid key, a malformed session id is 400", async () => {
    const res = await env.http.post(outcome("not-a-uuid")).set("X-Internal-Api-Key", TEST_INTERNAL_KEY).send(BODY);
    expect(res.status).toBe(400);
    expect(typeof res.body.code).toBe("string");
  });

  it("an unknown session is 404 session_not_found", async () => {
    const res = await env.http.post(outcome(randomUUID())).set("X-Internal-Api-Key", TEST_INTERNAL_KEY).send(BODY);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("session_not_found");
  });

  it("a missing body is 400 (required @RequestBody)", async () => {
    const s = await liveSession();
    const res = await env.http.post(outcome(s.id)).set("X-Internal-Api-Key", TEST_INTERNAL_KEY);
    expect(res.status).toBe(400);
    expect((await env.c.repos.sessions.findById(s.id))?.status).toBe("LIVE_IN_PROGRESS");
  });

  it("an empty JSON body is 400 too (Spring: 'Required request body is missing') and does not finalize the session", async () => {
    const s = await liveSession();
    const res = await env.http
      .post(outcome(s.id))
      .set("X-Internal-Api-Key", TEST_INTERNAL_KEY)
      .set("Content-Type", "application/json")
      .send("");
    expect(res.status).toBe(400);
    expect((await env.c.repos.sessions.findById(s.id))?.status).toBe("LIVE_IN_PROGRESS");
    expect(await env.c.repos.outcomes.findBySessionId(s.id)).toBeNull();
  });
});
