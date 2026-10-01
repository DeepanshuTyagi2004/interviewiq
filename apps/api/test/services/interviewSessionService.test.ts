import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { JobDescriptionRow, UserRow } from "../../src/db/pg/schema.js";
import { DEFAULT_ROUND_TYPE, type SessionStatus } from "../../src/domain/enums.js";
import { InterviewSessionError, parseCreateSessionRequest, type CreateSessionRequest } from "../../src/services/interviewSessions.js";
import { createTestEnv, createUser, type TestEnv } from "../support/harness.js";

/**
 * Port of InterviewSessionServiceTest. Real repositories (PGlite) instead of Mockito mocks; the
 * prep trigger on regenerate is observed through the AI-service HTTP stub + BackgroundTasks.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const future = () => new Date(Date.now() + 7 * DAY_MS);

let env: TestEnv;
let user: UserRow;

beforeAll(async () => {
  env = await createTestEnv();
  // The one enabled google/software-engineer/sde1 target most tests book against.
  await env.c.repos.roleConfigs.insert({ company: "google", role: "software-engineer", level: "sde1", enabled: true });
});
afterAll(() => env.close());
beforeEach(async () => {
  env.fetch.reset();
  user = await createUser(env);
});
afterEach(() => vi.restoreAllMocks());

function insertJd(overrides: Partial<JobDescriptionRow> = {}): Promise<JobDescriptionRow> {
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
    ...overrides,
  });
}

function req(jobDescriptionId: string, overrides: Partial<CreateSessionRequest> = {}): CreateSessionRequest {
  return { jobDescriptionId, roundType: "dsa", scheduledAt: future(), timezone: "Asia/Kolkata", ...overrides };
}

async function existing(candidateId: string, status: SessionStatus, extra: { prepError?: string } = {}) {
  const jd = await insertJd();
  return env.c.repos.sessions.insert({
    candidateId,
    jobDescriptionId: jd.id,
    company: jd.company,
    role: jd.role,
    level: jd.level,
    specialization: jd.specialization,
    roundType: "dsa",
    scheduledAt: future(),
    timezone: "Asia/Kolkata",
    status,
    prepError: extra.prepError ?? null,
  });
}

async function expectSessionError(p: Promise<unknown>): Promise<InterviewSessionError> {
  const err = await p.then(
    () => {
      throw new Error("expected an InterviewSessionError");
    },
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(InterviewSessionError);
  return err as InterviewSessionError;
}

const sessionsOf = (candidateId: string) => env.c.repos.sessions.findAllByCandidateIdOrderByScheduledAtDesc(candidateId);

describe("InterviewSessionService.createSession", () => {
  it("happy path: SCHEDULED, copies the JD key, and does not trigger prep", async () => {
    const jd = await insertJd();
    const prepSpy = vi.spyOn(env.c.prep, "generatePrep");
    const bgSpy = vi.spyOn(env.c.prep, "generateInBackground");

    const resp = await env.c.sessions.createSession(user.id, req(jd.id));

    expect(resp.status).toBe("SCHEDULED");
    expect(resp.company).toBe("google");
    expect(resp.companyName).toBeNull(); // no companies row for "google"
    expect(resp.level).toBe("sde1");
    expect(resp.specialization).toBe("backend");
    expect(resp.roundType).toBe("dsa");
    expect(resp.timezone).toBe("Asia/Kolkata");
    expect(resp.planReady).toBe(false);

    const saved = await sessionsOf(user.id);
    expect(saved).toHaveLength(1);
    expect(saved[0]!.id).toBe(resp.id);
    expect(saved[0]!.candidateId).toBe(user.id);
    expect(saved[0]!.jobDescriptionId).toBe(jd.id);
    expect(saved[0]!.status).toBe("SCHEDULED");

    expect(prepSpy).not.toHaveBeenCalled();
    expect(bgSpy).not.toHaveBeenCalled();
    expect(env.fetch.calls).toHaveLength(0);
  });

  it("defaults to the first round when the round is omitted", async () => {
    const jd = await insertJd();
    // The candidate does not pick the round — omitting it must assign the default (first round).
    const resp = await env.c.sessions.createSession(user.id, req(jd.id, { roundType: null }));
    expect(resp.roundType).toBe(DEFAULT_ROUND_TYPE);
    expect(resp.roundType).toBe("dsa");
  });

  it("JD not found → 400 session_jd_not_found, nothing saved", async () => {
    const err = await expectSessionError(env.c.sessions.createSession(user.id, req(randomUUID())));
    expect(err.code).toBe("session_jd_not_found");
    expect(err.status).toBe(400);
    expect(await sessionsOf(user.id)).toHaveLength(0);
  });

  it("no company/role/level config → session_role_not_configured, nothing saved", async () => {
    const jd = await insertJd({ role: "unconfigured-role" });
    const err = await expectSessionError(env.c.sessions.createSession(user.id, req(jd.id)));
    expect(err.code).toBe("session_role_not_configured");
    expect(await sessionsOf(user.id)).toHaveLength(0);
  });

  it("disabled config → session_role_disabled", async () => {
    await env.c.repos.roleConfigs.insert({ company: "google", role: "disabled-role", level: "sde1", enabled: false });
    const jd = await insertJd({ role: "disabled-role" });
    const err = await expectSessionError(env.c.sessions.createSession(user.id, req(jd.id)));
    expect(err.code).toBe("session_role_disabled");
    expect(await sessionsOf(user.id)).toHaveLength(0);
  });

  it("blank timezone → session_timezone_required before touching the repositories", async () => {
    const jdFind = vi.spyOn(env.c.repos.jds, "findById");
    const insert = vi.spyOn(env.c.repos.sessions, "insert");
    const err = await expectSessionError(
      env.c.sessions.createSession(user.id, req(randomUUID(), { scheduledAt: new Date(), timezone: "   " })),
    );
    expect(err.code).toBe("session_timezone_required");
    expect(jdFind).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it("past slot → session_slot_in_past before touching the repositories", async () => {
    const jdFind = vi.spyOn(env.c.repos.jds, "findById");
    const insert = vi.spyOn(env.c.repos.sessions, "insert");
    const err = await expectSessionError(
      env.c.sessions.createSession(user.id, req(randomUUID(), { scheduledAt: new Date("2020-01-01T00:00:00Z") })),
    );
    expect(err.code).toBe("session_slot_in_past");
    expect(jdFind).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });
});

describe("InterviewSessionService reads + regenerate", () => {
  it("getSession on a session the caller does not own → 404 session_not_found", async () => {
    const other = await createUser(env);
    const theirs = await existing(other.id, "SCHEDULED");

    for (const sid of [theirs.id, randomUUID()]) {
      const err = await expectSessionError(env.c.sessions.getSession(user.id, sid));
      expect(err.code).toBe("session_not_found");
      expect(err.status).toBe(404);
    }
  });

  it("regenerate moves to PREP_QUEUED, clears prepError, and triggers prep for that session", async () => {
    const s = await existing(user.id, "PREP_FAILED", { prepError: "prep_generation_failed" });
    env.fetch.on("POST", "http://ai.test/interview-plans/start", { run_id: "run1", status: "running" });
    env.fetch.on("GET", "http://ai.test/interview-plans/runs/run1", {
      status: "completed",
      plan: { provenance: { planVersion: "v1", inputHash: "sha256:abc" } },
    });
    const bgSpy = vi.spyOn(env.c.prep, "generateInBackground");

    const resp = await env.c.sessions.regenerate(user.id, s.id);

    expect(resp.status).toBe("PREP_QUEUED");
    expect(resp.prepError).toBeNull();
    expect(bgSpy).toHaveBeenCalledTimes(1);
    expect(bgSpy).toHaveBeenCalledWith(s.id);

    // The background generation ran against the AI service for this session.
    await env.c.background.drain();
    const starts = env.fetch.callsTo("http://ai.test/interview-plans/start", "POST");
    expect(starts).toHaveLength(1);
    expect((starts[0]!.json as { session: { sessionId: string } }).session.sessionId).toBe(s.id);
    expect((await env.c.repos.sessions.findById(s.id))!.status).toBe("PREP_READY");
  });

  it("listSessions maps all of the caller's sessions", async () => {
    await existing(user.id, "SCHEDULED");
    await existing(user.id, "PREP_READY");
    await existing((await createUser(env)).id, "SCHEDULED"); // someone else's — not listed

    const { sessions } = await env.c.sessions.listSessions(user.id);
    expect(sessions).toHaveLength(2);
    expect(sessions.map((s) => s.planReady).sort()).toEqual([false, true]);
  });
});

describe("parseCreateSessionRequest", () => {
  it("parses a booking body (lower-cases the UUID, ISO instant, optional round)", () => {
    const jdId = randomUUID();
    const r = parseCreateSessionRequest({ jobDescriptionId: jdId.toUpperCase(), scheduledAt: "2030-07-10T10:00:00Z", timezone: "Asia/Kolkata" });
    expect(r).toEqual({ jobDescriptionId: jdId, roundType: null, scheduledAt: new Date("2030-07-10T10:00:00Z"), timezone: "Asia/Kolkata" });
    expect(parseCreateSessionRequest({ roundType: "System-Design" }).roundType).toBe("system-design");
  });

  it("rejects a malformed UUID or instant with 400 session_bad_request", () => {
    for (const body of [{ jobDescriptionId: "not-a-uuid" }, { scheduledAt: "not-a-date" }, { scheduledAt: { at: 1 } }]) {
      let caught: unknown;
      try {
        parseCreateSessionRequest(body);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(InterviewSessionError);
      expect((caught as InterviewSessionError).status).toBe(400);
      expect((caught as InterviewSessionError).code).toBe("session_bad_request");
    }
  });
});
