import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { JobDescriptionRow } from "../../src/db/pg/schema.js";
import { bearer, createUser, createTestEnv, type TestEnv } from "../support/harness.js";
import { AI, FUTURE_SLOT, seedCompany, seedJd, seedRoleConfig, seedSession } from "./helpers.js";

/**
 * Port of InterviewSessionControllerTest (booking + prep status under /api/v1/interviews). Real
 * InterviewSessionService over PGlite; the AI service is stubbed only for the regenerate path.
 */

let env: TestEnv;
let jd: JobDescriptionRow;

beforeAll(async () => {
  env = await createTestEnv();
  await seedCompany(env, "google", "Google");
  await seedRoleConfig(env, { company: "google", role: "software-engineer", level: "sde1" });
  jd = await seedJd(env, { company: "google", role: "software-engineer", level: "sde1", specialization: "backend" });
});
afterAll(() => env.close());
beforeEach(() => env.fetch.reset());
afterEach(() => env.c.background.drain());

const SESSIONS = "/api/v1/interviews/sessions";

/** The exact key set of InterviewSessionResponse (the Java record, plus loopId/nodeId). */
const SESSION_KEYS = [
  "candidateId",
  "company",
  "companyName",
  "createdAt",
  "id",
  "inputHash",
  "jobDescriptionId",
  "level",
  "loopId",
  "nodeId",
  "planReady",
  "planVersion",
  "prepError",
  "role",
  "roundType",
  "scheduledAt",
  "specialization",
  "status",
  "timezone",
  "updatedAt",
];

const createBody = (overrides: Record<string, unknown> = {}) => ({
  jobDescriptionId: jd.id,
  roundType: "dsa",
  scheduledAt: FUTURE_SLOT,
  timezone: "Asia/Kolkata",
  ...overrides,
});

describe("POST /interviews/sessions", () => {
  it("createSession_returns201WithWireShape", async () => {
    const user = await createUser(env);
    const res = await env.http.post(SESSIONS).set("Authorization", await bearer(env, user)).send(createBody());

    expect(res.status).toBe(201);
    expect(Object.keys(res.body).sort()).toEqual(SESSION_KEYS);
    expect(res.body).toMatchObject({
      candidateId: user.id,
      jobDescriptionId: jd.id,
      company: "google",
      companyName: "Google",
      role: "software-engineer",
      level: "sde1",
      specialization: "backend",
      roundType: "dsa", // wire value, not the enum name
      timezone: "Asia/Kolkata",
      status: "SCHEDULED",
      planReady: false,
      planVersion: null,
      inputHash: null,
      prepError: null,
    });
    expect(new Date(res.body.scheduledAt).toISOString()).toBe(FUTURE_SLOT);
    expect(Number.isNaN(Date.parse(res.body.createdAt))).toBe(false);
    expect(Number.isNaN(Date.parse(res.body.updatedAt))).toBe(false);

    const row = await env.c.repos.sessions.findById(res.body.id);
    expect(row?.status).toBe("SCHEDULED");
    expect(row?.candidateId).toBe(user.id);
  });

  it("roundType is optional (defaults to the first round) and an explicit one is honoured", async () => {
    const user = await createUser(env);
    const authz = await bearer(env, user);
    const defaulted = await env.http.post(SESSIONS).set("Authorization", authz).send(createBody({ roundType: undefined }));
    expect(defaulted.status).toBe(201);
    expect(defaulted.body.roundType).toBe("dsa");
    const explicit = await env.http.post(SESSIONS).set("Authorization", authz).send(createBody({ roundType: "system-design", scheduledAt: "2099-07-10T12:00:00.000Z" }));
    expect(explicit.status).toBe(201);
    expect(explicit.body.roundType).toBe("system-design");
  });

  it("createSession_jdNotFound_maps400WithCode", async () => {
    const res = await env.http
      .post(SESSIONS)
      .set("Authorization", await bearer(env, await createUser(env)))
      .send(createBody({ jobDescriptionId: randomUUID() }));
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ code: "session_jd_not_found", message: "job description not found" });
  });

  it.each([
    ["session_jd_required", { jobDescriptionId: null }],
    ["session_slot_required", { scheduledAt: null }],
    ["session_timezone_required", { timezone: "   " }],
    ["session_slot_in_past", { scheduledAt: "2020-01-01T00:00:00Z" }],
    ["session_bad_request", { jobDescriptionId: "not-a-uuid" }],
    ["session_bad_request", { scheduledAt: "next tuesday" }],
    ["session_bad_request", { roundType: "online-assessment" }],
  ])("validation → 400 %s (%j)", async (code, overrides) => {
    const res = await env.http
      .post(SESSIONS)
      .set("Authorization", await bearer(env, await createUser(env)))
      .send(createBody(overrides));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe(code);
    expect(typeof res.body.message).toBe("string");
  });

  it("a JD without a configured role is 400 session_role_not_configured; a disabled one is session_role_disabled", async () => {
    const authz = await bearer(env, await createUser(env));
    const unconfigured = await seedJd(env, { company: "google", level: "sde3", title: "Staff" });
    const a = await env.http.post(SESSIONS).set("Authorization", authz).send(createBody({ jobDescriptionId: unconfigured.id }));
    expect(a.status).toBe(400);
    expect(a.body.code).toBe("session_role_not_configured");

    await seedRoleConfig(env, { company: "google", level: "sde2", enabled: false });
    const disabled = await seedJd(env, { company: "google", level: "sde2", title: "SDE 2" });
    const b = await env.http.post(SESSIONS).set("Authorization", authz).send(createBody({ jobDescriptionId: disabled.id }));
    expect(b.status).toBe(400);
    expect(b.body.code).toBe("session_role_disabled");
  });

  it("companyName is null when the company has no catalogue row", async () => {
    await seedRoleConfig(env, { company: "nocorp", level: "sde1" });
    const orphan = await seedJd(env, { company: "nocorp", level: "sde1" });
    const res = await env.http
      .post(SESSIONS)
      .set("Authorization", await bearer(env, await createUser(env)))
      .send(createBody({ jobDescriptionId: orphan.id }));
    expect(res.status).toBe(201);
    expect(res.body.company).toBe("nocorp");
    expect(res.body.companyName).toBeNull();
  });
});

describe("GET /interviews/sessions", () => {
  it("listSessions_returnsList: only the caller's sessions, newest slot first", async () => {
    const user = await createUser(env);
    const other = await createUser(env);
    const older = await seedSession(env, user.id, jd, { scheduledAt: new Date("2099-01-01T00:00:00Z"), status: "PREP_READY" });
    const newer = await seedSession(env, user.id, jd, { scheduledAt: new Date("2099-06-01T00:00:00Z"), status: "SCHEDULED" });
    await seedSession(env, other.id, jd);

    const res = await env.http.get(SESSIONS).set("Authorization", await bearer(env, user));
    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toEqual(["sessions"]);
    expect(res.body.sessions.map((s: { id: string }) => s.id)).toEqual([newer.id, older.id]);
    expect(res.body.sessions[1].status).toBe("PREP_READY");
    expect(res.body.sessions[1].planReady).toBe(true);
    expect(res.body.sessions[0].planReady).toBe(false);
    expect(res.body.sessions[0].companyName).toBe("Google");
    expect(Object.keys(res.body.sessions[0]).sort()).toEqual(SESSION_KEYS);
  });

  it("an empty list is {sessions: []}", async () => {
    const res = await env.http.get(SESSIONS).set("Authorization", await bearer(env, await createUser(env)));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sessions: [] });
  });

  it("listSessions_withoutJwt_isUnauthorized", async () => {
    expect((await env.http.get(SESSIONS)).status).toBe(401);
  });
});

describe("GET /interviews/sessions/:sessionId", () => {
  it("getSession_returnsSession (no scoring on the session view)", async () => {
    const user = await createUser(env);
    const s = await seedSession(env, user.id, jd, { status: "PREP_QUEUED" });
    const res = await env.http.get(`${SESSIONS}/${s.id}`).set("Authorization", await bearer(env, user));
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(s.id);
    expect(res.body.status).toBe("PREP_QUEUED");
    expect(res.body.planReady).toBe(false);
    // hard rule: descriptive only
    expect(res.body.score).toBeUndefined();
    expect(res.body.rating).toBeUndefined();
  });

  it("prep plan contents are never exposed; PREP_FAILED surfaces the stable prepError code", async () => {
    const user = await createUser(env);
    const s = await seedSession(env, user.id, jd, { status: "PREP_FAILED", prepError: "prep_generation_timeout" });
    const res = await env.http.get(`${SESSIONS}/${s.id}`).set("Authorization", await bearer(env, user));
    expect(res.body.status).toBe("PREP_FAILED");
    expect(res.body.prepError).toBe("prep_generation_timeout");
    expect(res.body.plan).toBeUndefined();
  });

  it("getSession_notFound_maps404", async () => {
    const res = await env.http.get(`${SESSIONS}/${randomUUID()}`).set("Authorization", await bearer(env, await createUser(env)));
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ code: "session_not_found", message: "interview session not found" });
  });

  it("another candidate's session is 404 session_not_found (owner scope)", async () => {
    const owner = await createUser(env);
    const s = await seedSession(env, owner.id, jd);
    const res = await env.http.get(`${SESSIONS}/${s.id}`).set("Authorization", await bearer(env, await createUser(env)));
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("session_not_found");
  });

  it("a malformed session id is 400 with the ApiError envelope", async () => {
    const res = await env.http.get(`${SESSIONS}/not-a-uuid`).set("Authorization", await bearer(env, await createUser(env)));
    expect(res.status).toBe(400);
    expect(typeof res.body.code).toBe("string");
  });
});

describe("POST /interviews/sessions/:sessionId/regenerate", () => {
  it("regenerate_returns202: re-queues prep and generates it in the background", async () => {
    env.fetch.on("POST", `${AI}/interview-plans/start`, { run_id: "plan-1", status: "running" });
    env.fetch.on("GET", `${AI}/interview-plans/runs/plan-1`, {
      run_id: "plan-1",
      status: "completed",
      plan: { provenance: { planVersion: "v7", inputHash: "hash-1" } },
    });
    const user = await createUser(env);
    const authz = await bearer(env, user);
    const s = await seedSession(env, user.id, jd, { status: "PREP_FAILED", prepError: "prep_generation_failed" });

    const res = await env.http.post(`${SESSIONS}/${s.id}/regenerate`).set("Authorization", authz);
    expect(res.status).toBe(202);
    expect(res.body.status).toBe("PREP_QUEUED");
    expect(res.body.prepError).toBeNull();
    expect(res.body.planReady).toBe(false);

    await env.c.background.drain();
    const after = await env.http.get(`${SESSIONS}/${s.id}`).set("Authorization", authz);
    expect(after.body.status).toBe("PREP_READY");
    expect(after.body.planReady).toBe(true);
    expect(after.body.planVersion).toBe("v7");
    expect(after.body.inputHash).toBe("hash-1");

    const [start] = env.fetch.callsTo(`${AI}/interview-plans/start`, "POST");
    expect(start?.json).toMatchObject({ session: { sessionId: s.id, candidateId: user.id, company: "google", roundType: "dsa" } });
  });

  it("regenerate on an unknown / foreign session is 404 session_not_found", async () => {
    const owner = await createUser(env);
    const s = await seedSession(env, owner.id, jd);
    const intruder = await bearer(env, await createUser(env));
    const foreign = await env.http.post(`${SESSIONS}/${s.id}/regenerate`).set("Authorization", intruder);
    expect(foreign.status).toBe(404);
    expect(foreign.body.code).toBe("session_not_found");
    expect((await env.c.repos.sessions.findById(s.id))?.status).toBe("SCHEDULED");

    const unknown = await env.http.post(`${SESSIONS}/${randomUUID()}/regenerate`).set("Authorization", intruder);
    expect(unknown.status).toBe(404);
  });

  it("requires a JWT", async () => {
    expect((await env.http.post(`${SESSIONS}/${randomUUID()}/regenerate`)).status).toBe(401);
  });
});
