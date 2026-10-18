import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { JobDescriptionRow, UserRow } from "../../src/db/pg/schema.js";
import { DEFAULT_ROUND_TYPE, type SessionStatus } from "../../src/domain/enums.js";
import { InterviewSessionError, parseCreateSessionRequest, type CreateSessionRequest } from "../../src/services/interviewSessions.js";
import { createTestEnv, createUser, type TestEnv } from "../support/harness.js";

/**
 * Port of InterviewSessionServiceTest. Real repositories (PGlite) instead of Mockito mocks; blueprint
 * prep (started at booking and on retry) is observed through the AI-service HTTP stub + BackgroundTasks.
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
  // Bookings start prep in the background: let any still in flight land before the next test counts calls.
  await env.c.background.drain();
  env.fetch.reset();
  user = await createUser(env);
});
afterEach(async () => {
  await env.c.background.drain();
  vi.restoreAllMocks();
});

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
  return { jobDescriptionId, roundType: "dsa", scheduledAt: future(), timezone: "Asia/Kolkata", loopId: null, nodeId: null, ...overrides };
}

async function existing(candidateId: string, status: SessionStatus, extra: { prepErrorCode?: string; prepRetryCount?: number; prepRetryWindowStart?: Date } = {}) {
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
    prepErrorCode: extra.prepErrorCode ?? null,
    prepRetryCount: extra.prepRetryCount ?? 0,
    prepRetryWindowStart: extra.prepRetryWindowStart ?? null,
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
  it("happy path: copies the JD key and queues blueprint prep at booking", async () => {
    const jd = await insertJd();
    env.fetch.on("POST", "http://ai.test/blueprints/runs", { run_id: "bpr_1", status: "running", existing: false });

    const resp = await env.c.sessions.createSession(user.id, req(jd.id));

    expect(resp.status).toBe("PREP_QUEUED");
    expect(resp.company).toBe("google");
    expect(resp.companyName).toBeNull(); // no companies row for "google"
    expect(resp.level).toBe("sde1");
    expect(resp.specialization).toBe("backend");
    expect(resp.roundType).toBe("dsa");
    expect(resp.timezone).toBe("Asia/Kolkata");
    expect(resp.briefing).toBeNull();
    expect(resp.liveAvailable).toBe(false);
    expect(resp.prep).toEqual({ step: null, steps: [], refreshing: false, preparedAt: null, errorCode: null });

    const saved = await sessionsOf(user.id);
    expect(saved).toHaveLength(1);
    expect(saved[0]!.id).toBe(resp.id);
    expect(saved[0]!.candidateId).toBe(user.id);
    expect(saved[0]!.jobDescriptionId).toBe(jd.id);
    expect(saved[0]!.status).toBe("PREP_QUEUED");

    await env.c.background.drain();
    const starts = env.fetch.callsTo("http://ai.test/blueprints/runs", "POST");
    expect(starts).toHaveLength(1);
    const body = starts[0]!.json as { session: { session_id: string; round_type: string }; trigger: string; input_hash: string };
    expect(body.session.session_id).toBe(resp.id);
    expect(body.trigger).toBe("booking");
    expect(body.input_hash).toMatch(/^[0-9a-f]{64}$/);
    expect((await env.c.repos.sessions.findById(resp.id))!.prepRunId).toBe("bpr_1");
  });

  it("draws the round length at booking (30, 35, 40 or 45), stores it, and a reschedule keeps it", async () => {
    const jd = await insertJd();
    const seen = new Set<number>();
    for (const r of [0, 0.3, 0.6, 0.99]) {
      const u = await createUser(env);
      vi.spyOn(Math, "random").mockReturnValue(r); // restored after each test
      const resp = await env.c.sessions.createSession(u.id, req(jd.id));
      seen.add(resp.roundMinutes);
      expect((await env.c.repos.sessions.findById(resp.id))!.roundMinutes).toBe(resp.roundMinutes);
      const moved = await env.c.sessions.reschedule(u.id, resp.id, new Date(Date.now() + 9 * DAY_MS), "Asia/Kolkata");
      expect(moved.roundMinutes).toBe(resp.roundMinutes);
      expect((await env.c.repos.sessions.findById(resp.id))!.roundMinutes).toBe(resp.roundMinutes);
    }
    expect([...seen].sort()).toEqual([30, 35, 40, 45]);
  });

  it("a session booked before the draw (no stored length) reads as 45 minutes", async () => {
    const s = await existing(user.id, "SCHEDULED");
    expect(s.roundMinutes).toBeNull();
    expect((await env.c.sessions.getSession(user.id, s.id)).roundMinutes).toBe(45);
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

describe("InterviewSessionService reads + prep retry", () => {
  it("getSession on a session the caller does not own → 404 session_not_found", async () => {
    const other = await createUser(env);
    const theirs = await existing(other.id, "SCHEDULED");

    for (const sid of [theirs.id, randomUUID()]) {
      const err = await expectSessionError(env.c.sessions.getSession(user.id, sid));
      expect(err.code).toBe("session_not_found");
      expect(err.status).toBe(404);
    }
  });

  it("retry moves PREP_FAILED to PREP_QUEUED, clears the code and starts a retry run", async () => {
    const s = await existing(user.id, "PREP_FAILED", { prepErrorCode: "not_enough_problems" });
    env.fetch.on("POST", "http://ai.test/blueprints/runs", { run_id: "bpr_r", status: "running", existing: false });

    const resp = await env.c.sessions.retryPrep(user.id, s.id);

    expect(resp.status).toBe("PREP_QUEUED");
    expect(resp.prep.errorCode).toBeNull();
    await env.c.background.drain();
    const starts = env.fetch.callsTo("http://ai.test/blueprints/runs", "POST");
    expect(starts).toHaveLength(1);
    expect((starts[0]!.json as { trigger: string }).trigger).toBe("retry");
    const row = (await env.c.repos.sessions.findById(s.id))!;
    expect(row.prepRunId).toBe("bpr_r");
    expect(row.prepRetryCount).toBe(1);
  });

  it("retry is limited per rolling hour (429 prep_retry_limited) and only from PREP_FAILED (409)", async () => {
    const limited = await existing(user.id, "PREP_FAILED", { prepRetryCount: 3, prepRetryWindowStart: new Date(Date.now() - 10 * 60_000) });
    await expect(env.c.sessions.retryPrep(user.id, limited.id)).rejects.toMatchObject({ status: 429, code: "prep_retry_limited" });
    const ready = await existing(user.id, "PREP_READY");
    await expect(env.c.sessions.retryPrep(user.id, ready.id)).rejects.toMatchObject({ status: 409, code: "prep_not_failed" });
    // An hour later the window resets.
    const old = await existing(user.id, "PREP_FAILED", { prepRetryCount: 3, prepRetryWindowStart: new Date(Date.now() - 61 * 60_000) });
    env.fetch.on("POST", "http://ai.test/blueprints/runs", { run_id: "bpr_o", status: "running", existing: false });
    expect((await env.c.sessions.retryPrep(user.id, old.id)).status).toBe("PREP_QUEUED");
    await env.c.background.drain();
  });

  it("listSessions maps all of the caller's sessions", async () => {
    await existing(user.id, "SCHEDULED");
    await existing(user.id, "PREP_READY");
    await existing((await createUser(env)).id, "SCHEDULED"); // someone else's — not listed

    const { sessions } = await env.c.sessions.listSessions(user.id);
    expect(sessions).toHaveLength(2);
    expect(sessions.map((s) => s.status).sort()).toEqual(["PREP_READY", "SCHEDULED"]);
    expect(sessions.every((s) => s.liveAvailable === false && s.prep.steps.length === 0)).toBe(true);
  });
});

describe("parseCreateSessionRequest", () => {
  it("parses a booking body (lower-cases the UUID, ISO instant, optional round)", () => {
    const jdId = randomUUID();
    const r = parseCreateSessionRequest({ jobDescriptionId: jdId.toUpperCase(), scheduledAt: "2030-07-10T10:00:00Z", timezone: "Asia/Kolkata" });
    expect(r).toEqual({ jobDescriptionId: jdId, roundType: null, scheduledAt: new Date("2030-07-10T10:00:00Z"), timezone: "Asia/Kolkata", loopId: null, nodeId: null });
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
