import { randomUUID } from "node:crypto";
import { decodeJwt } from "jose";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { InterviewSessionRow, UserRow } from "../../src/db/pg/schema.js";
import type { SessionStatus } from "../../src/domain/enums.js";
import { InterviewSessionError } from "../../src/services/interviewSessions.js";
import { createTestEnv, createUser, type TestEnv } from "../support/harness.js";

/**
 * Port of LiveSessionServiceTest. Real session repository (PGlite), real outcome repository
 * (in-memory Mongo) and the real LiveKit token minter (config: wss://livekit.test / lk-key) — the
 * minted JWT is decoded instead of stubbing mintCandidateToken.
 */

const LIVEKIT_URL = "wss://livekit.test";

let env: TestEnv;
let user: UserRow;
let jdId: string;

beforeAll(async () => {
  env = await createTestEnv();
  const jd = await env.c.repos.jds.insert({
    company: "google",
    role: "software-engineer",
    level: "sde1",
    title: "SWE",
    specialization: "backend",
    source: "seed",
    active: true,
  });
  jdId = jd.id;
});
afterAll(() => env.close());
beforeEach(async () => {
  user = await createUser(env);
});
afterEach(() => vi.restoreAllMocks());

function session(status: SessionStatus, extra: Partial<InterviewSessionRow> = {}, candidateId = user.id): Promise<InterviewSessionRow> {
  return env.c.repos.sessions.insert({
    candidateId,
    jobDescriptionId: jdId,
    company: "google",
    role: "software-engineer",
    level: "sde1",
    specialization: "backend",
    roundType: "dsa",
    scheduledAt: new Date(Date.now() + 60_000),
    timezone: "Asia/Kolkata",
    status,
    ...extra,
  });
}

const row = async (id: string) => (await env.c.repos.sessions.findById(id))!;

async function expectStatus(p: Promise<unknown>, status: number): Promise<void> {
  const err = await p.then(
    () => {
      throw new Error("expected an InterviewSessionError");
    },
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(InterviewSessionError);
  expect((err as InterviewSessionError).status).toBe(status);
}

/** The minted token is a LiveKit join grant for this candidate + room. */
function expectJoinToken(token: string | null, candidateId: string, sessionId: string): void {
  expect(token).toBeTruthy();
  const claims = decodeJwt(token!);
  expect(claims.sub).toBe(candidateId);
  expect(claims.iss).toBe("lk-key");
  expect(claims.video).toMatchObject({ roomJoin: true, room: `interview-${sessionId}` });
}

describe("LiveSessionService.startLive", () => {
  it("from PREP_READY: mints a token, flips to LIVE_IN_PROGRESS and returns the connection", async () => {
    const s = await session("PREP_READY");

    const resp = await env.c.liveSessions.startLive(user.id, s.id);

    expect(resp.livekitUrl).toBe(LIVEKIT_URL);
    expectJoinToken(resp.token, user.id, s.id);
    expect(resp.roomName).toBe(`interview-${s.id}`);
    expect(resp.status).toBe("LIVE_IN_PROGRESS");

    const saved = await row(s.id);
    expect(saved.status).toBe("LIVE_IN_PROGRESS");
    expect(saved.liveStartedAt).toBeInstanceOf(Date);
    expect(saved.livekitRoom).toBe(`interview-${s.id}`);
  });

  it("when already live: returns a fresh token without changing liveStartedAt (no write)", async () => {
    const started = new Date("2020-01-01T00:00:00Z");
    const s = await session("LIVE_IN_PROGRESS", { liveStartedAt: started });
    const update = vi.spyOn(env.c.repos.sessions, "update");
    const transition = vi.spyOn(env.c.repos.sessions, "transitionStatus");

    const resp = await env.c.liveSessions.startLive(user.id, s.id);

    expectJoinToken(resp.token, user.id, s.id);
    expect(resp.status).toBe("LIVE_IN_PROGRESS");
    const after = await row(s.id);
    expect(after.liveStartedAt).toEqual(started); // must not reset liveStartedAt on resume
    expect(after.updatedAt).toEqual(s.updatedAt);
    expect(update).not.toHaveBeenCalled();
    expect(transition).not.toHaveBeenCalled();
  });

  it("when not ready → 409, row untouched", async () => {
    const s = await session("SCHEDULED");
    await expectStatus(env.c.liveSessions.startLive(user.id, s.id), 409);
    const after = await row(s.id);
    expect(after.status).toBe("SCHEDULED");
    expect(after.liveStartedAt).toBeNull();
  });

  it("when not owned → 404", async () => {
    const other = await createUser(env);
    const theirs = await session("PREP_READY", {}, other.id);
    await expectStatus(env.c.liveSessions.startLive(user.id, theirs.id), 404);
    await expectStatus(env.c.liveSessions.startLive(user.id, randomUUID()), 404);
    expect((await row(theirs.id)).status).toBe("PREP_READY");
  });

  it("two concurrent go-lives both get a connection; the flip happens once", async () => {
    const s = await session("PREP_READY");
    const transition = vi.spyOn(env.c.repos.sessions, "transitionStatus");
    const [a, b] = await Promise.all([env.c.liveSessions.startLive(user.id, s.id), env.c.liveSessions.startLive(user.id, s.id)]);
    expect(a.status).toBe("LIVE_IN_PROGRESS");
    expect(b.status).toBe("LIVE_IN_PROGRESS");
    expectJoinToken(a.token, user.id, s.id);
    expectJoinToken(b.token, user.id, s.id);
    const flips = (await Promise.all(transition.mock.results.map((r) => r.value as Promise<unknown>))).filter((r) => r !== null);
    expect(flips).toHaveLength(1);
  });
});

describe("LiveSessionService.getLive", () => {
  it("when live returns a token, otherwise status only", async () => {
    const live = await session("LIVE_IN_PROGRESS");
    const r1 = await env.c.liveSessions.getLive(user.id, live.id);
    expectJoinToken(r1.token, user.id, live.id);
    expect(r1.livekitUrl).toBe(LIVEKIT_URL);
    expect(r1.roomName).toBe(`interview-${live.id}`);
    expect(r1.status).toBe("LIVE_IN_PROGRESS");

    const ready = await session("PREP_READY");
    const r2 = await env.c.liveSessions.getLive(user.id, ready.id);
    expect(r2).toEqual({ livekitUrl: null, token: null, roomName: null, status: "PREP_READY" });
    expect((await row(ready.id)).status).toBe("PREP_READY"); // read-only
  });

  it("when not owned → 404", async () => {
    await expectStatus(env.c.liveSessions.getLive(user.id, randomUUID()), 404);
  });
});

describe("LiveSessionService.recordOutcome", () => {
  it("stores the full outcome in Mongo, promotes the scalars, and flips to COMPLETED", async () => {
    const s = await session("LIVE_IN_PROGRESS");
    const body = {
      session_id: s.id,
      ended_reason: "natural_complete",
      live_score_final: 0.66,
      duration_s: 1830.0,
      per_answer_evidence: [],
      negative_events: [],
      arc_completed: true,
      extensions_granted: 0,
      derived_topics: [],
    };

    await env.c.liveSessions.recordOutcome(s.id, body);

    const saved = await row(s.id);
    expect(saved.status).toBe("COMPLETED");
    expect(saved.endedReason).toBe("natural_complete");
    expect(saved.liveScoreFinal).toBe(0.66);
    expect(saved.durationS).toBe(1830);
    expect(saved.liveEndedAt).toBeInstanceOf(Date);

    const doc = await env.mongo.sessionOutcomes.findOne({ _id: s.id });
    expect(doc).not.toBeNull();
    expect(doc!.outcome).toEqual(body);
    expect(doc!.outcome).toHaveProperty("session_id", s.id);
    expect(doc!.receivedAt).toBeInstanceOf(Date);
  });

  it("aborted_technical flips to ABORTED_TECHNICAL", async () => {
    const s = await session("LIVE_IN_PROGRESS");
    await env.c.liveSessions.recordOutcome(s.id, { ended_reason: "aborted_technical", live_score_final: 0.0, duration_s: 120.0 });
    const saved = await row(s.id);
    expect(saved.status).toBe("ABORTED_TECHNICAL");
    expect(saved.durationS).toBe(120);
    expect(saved.liveScoreFinal).toBe(0);
  });

  it("unknown session → InterviewSessionError (404), nothing stored", async () => {
    const sid = randomUUID();
    await expectStatus(env.c.liveSessions.recordOutcome(sid, { ended_reason: "early_weak" }), 404);
    expect(await env.mongo.sessionOutcomes.findOne({ _id: sid })).toBeNull();
  });

  it("on an already-completed session is a no-op (at-least-once delivery)", async () => {
    const originalEndedAt = new Date("2020-01-01T00:00:00Z");
    const s = await session("COMPLETED", { liveEndedAt: originalEndedAt, endedReason: "natural_complete" });
    const originalOutcome = { ended_reason: "natural_complete" };
    await env.c.repos.outcomes.save(s.id, originalOutcome);
    const update = vi.spyOn(env.c.repos.sessions, "update");
    const saveOutcome = vi.spyOn(env.c.repos.outcomes, "save");

    await env.c.liveSessions.recordOutcome(s.id, { ended_reason: "aborted_technical" });

    const after = await row(s.id);
    expect(after.status).toBe("COMPLETED");
    expect(after.endedReason).toBe("natural_complete");
    expect(after.liveEndedAt).toEqual(originalEndedAt);
    expect((await env.mongo.sessionOutcomes.findOne({ _id: s.id }))!.outcome).toEqual(originalOutcome);
    expect(update).not.toHaveBeenCalled();
    expect(saveOutcome).not.toHaveBeenCalled();
  });
});
