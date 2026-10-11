import { randomUUID } from "node:crypto";
import { decodeJwt } from "jose";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { InterviewSessionRow, UserRow } from "../../src/db/pg/schema.js";
import type { SessionStatus } from "../../src/domain/enums.js";
import { InterviewSessionError } from "../../src/services/interviewSessions.js";
import { json } from "../support/fakeFetch.js";
import { createTestEnv, createUser, type TestEnv } from "../support/harness.js";

/**
 * Port of LiveSessionServiceTest. Real session repository (PGlite) and the real LiveKit token minter
 * (config: wss://livekit.test / lk-key) — the minted JWT is decoded instead of stubbing
 * mintCandidateToken. The live interviewer is switched on here (LIVE_INTERVIEWER_AVAILABLE=true);
 * the default-off gate has its own test.
 */

const LIVEKIT_URL = "wss://livekit.test";

let env: TestEnv;
let user: UserRow;
let jdId: string;

beforeAll(async () => {
  env = await createTestEnv({ LIVE_INTERVIEWER_AVAILABLE: "true" });
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
  env.fetch.reset();
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

/** What LiveKit answers: by default an empty room with nothing dispatched. */
function livekit(answers: { participants?: unknown; dispatches?: unknown } = {}): void {
  env.fetch.reset();
  env.fetch.on("POST", /CreateDispatch$/, {});
  env.fetch.on("POST", /ListParticipants$/, answers.participants ?? { participants: [] });
  env.fetch.on("POST", /ListDispatch$/, answers.dispatches ?? { agent_dispatches: [] });
}
const dispatches = () => env.fetch.callsTo(/CreateDispatch$/);

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

describe("LiveSessionService gating and seen problems", () => {
  it("records the live blueprint's problems as seen for this candidate", async () => {
    const s = await session("PREP_READY", { blueprintVersion: 2 });
    env.fetch.on("GET", `http://ai.test/blueprints/sessions/${s.id}?version=2`, {
      slots: [{ problem: { slug: "two-sum", round_type: "dsa" } }, { problem: { slug: "lru-cache", round_type: "dsa" } }],
    });
    await env.c.liveSessions.startLive(user.id, s.id);
    expect(await env.c.repos.blueprintSeen.slugsFor(user.id)).toEqual(["lru-cache", "two-sum"]);
  });

  it("is refused while the live interviewer is unavailable (the default)", async () => {
    const off = await createTestEnv();
    try {
      const u = await createUser(off);
      const jd = await off.c.repos.jds.insert({ company: "google", role: "software-engineer", level: "sde1", title: "SWE", source: "seed", active: true });
      const s = await off.c.repos.sessions.insert({
        candidateId: u.id, jobDescriptionId: jd.id, company: "google", role: "software-engineer", level: "sde1",
        roundType: "dsa", scheduledAt: new Date(Date.now() + 60_000), timezone: "UTC", status: "PREP_READY",
      });
      await expect(off.c.liveSessions.startLive(u.id, s.id)).rejects.toMatchObject({ status: 409, code: "live_unavailable" });
      expect((await off.c.repos.sessions.findById(s.id))!.status).toBe("PREP_READY");
    } finally {
      await off.close();
    }
  });
});

describe("LiveSessionService.warm", () => {
  it("dispatches the interviewer for a ready round and changes nothing else", async () => {
    livekit();
    const s = await session("PREP_READY");
    expect(await env.c.liveSessions.warm(user.id, s.id)).toEqual({ warming: true });
    expect(dispatches()).toHaveLength(1);
    expect(dispatches()[0]!.json).toMatchObject({ room: `interview-${s.id}`, agent_name: "interviewer" });
    const after = await row(s.id);
    expect(after.status).toBe("PREP_READY");
    expect(after.liveStartedAt).toBeNull();
    expect(await env.c.repos.blueprintSeen.slugsFor(user.id)).toEqual([]);
  });

  it("does not dispatch when an interviewer is already in the room", async () => {
    livekit({ participants: { participants: [{ identity: "agent-1", kind: "AGENT" }] } });
    const s = await session("PREP_READY");
    expect(await env.c.liveSessions.warm(user.id, s.id)).toEqual({ warming: true });
    expect(dispatches()).toHaveLength(0);
  });

  it("does not dispatch when an interviewer is already on its way", async () => {
    livekit({ dispatches: { agent_dispatches: [{ id: "AD_1", agent_name: "interviewer", state: { jobs: [] } }] } });
    const s = await session("PREP_READY");
    expect(await env.c.liveSessions.warm(user.id, s.id)).toEqual({ warming: true });
    expect(dispatches()).toHaveLength(0);
  });

  it("dispatches once for repeated and for concurrent warm-ups", async () => {
    livekit();
    const s = await session("PREP_READY");
    const [a, b] = await Promise.all([env.c.liveSessions.warm(user.id, s.id), env.c.liveSessions.warm(user.id, s.id)]);
    const again = await env.c.liveSessions.warm(user.id, s.id);
    expect([a, b, again]).toEqual([{ warming: true }, { warming: true }, { warming: true }]);
    expect(dispatches()).toHaveLength(1);
  });

  it.each(["SCHEDULED", "PREP_QUEUED", "PREP_FAILED", "COMPLETED", "ABORTED_TECHNICAL"] as const)(
    "a %s round is not warmed and LiveKit is never called",
    async (status) => {
      livekit();
      const s = await session(status);
      expect(await env.c.liveSessions.warm(user.id, s.id)).toEqual({ warming: false });
      expect(env.fetch.calls).toHaveLength(0);
    },
  );

  it("a round already live gets an interviewer again when its room has none", async () => {
    livekit();
    const s = await session("LIVE_IN_PROGRESS", { liveStartedAt: new Date(Date.now() - 120_000) });
    expect(await env.c.liveSessions.warm(user.id, s.id)).toEqual({ warming: true });
    expect(dispatches()).toHaveLength(1);
  });

  it("another candidate's round is 404", async () => {
    livekit();
    const other = await createUser(env);
    const theirs = await session("PREP_READY", {}, other.id);
    await expectStatus(env.c.liveSessions.warm(user.id, theirs.id), 404);
    await expectStatus(env.c.liveSessions.warm(user.id, randomUUID()), 404);
    expect(env.fetch.calls).toHaveLength(0);
  });

  it("is a quiet no-op for an account the live interviewer is not available to", async () => {
    const off = await createTestEnv();
    try {
      const u = await createUser(off);
      const jd = await off.c.repos.jds.insert({ company: "google", role: "software-engineer", level: "sde1", title: "SWE", source: "seed", active: true });
      const s = await off.c.repos.sessions.insert({
        candidateId: u.id, jobDescriptionId: jd.id, company: "google", role: "software-engineer", level: "sde1",
        roundType: "dsa", scheduledAt: new Date(Date.now() + 60_000), timezone: "UTC", status: "PREP_READY",
      });
      expect(await off.c.liveSessions.warm(u.id, s.id)).toEqual({ warming: false });
      expect(off.fetch.calls).toHaveLength(0);
    } finally {
      await off.close();
    }
  });

  it("answers warming false, without throwing, when LiveKit refuses the dispatch", async () => {
    livekit();
    env.fetch.on("POST", /CreateDispatch$/, () => json({ code: "internal" }, 500));
    const s = await session("PREP_READY");
    expect(await env.c.liveSessions.warm(user.id, s.id)).toEqual({ warming: false });
    expect(dispatches()).toHaveLength(1);
  });

  it("still dispatches when the presence check itself fails", async () => {
    livekit();
    env.fetch.on("POST", /ListParticipants$/, () => json({ code: "internal" }, 500));
    const s = await session("PREP_READY");
    expect(await env.c.liveSessions.warm(user.id, s.id)).toEqual({ warming: true });
    expect(dispatches()).toHaveLength(1);
  });
});

describe("LiveSessionService.startLive and the interviewer", () => {
  it("dispatches at go-live when nobody warmed the room, and not again when it was warmed", async () => {
    livekit();
    const cold = await session("PREP_READY");
    await env.c.liveSessions.startLive(user.id, cold.id);
    expect(dispatches()).toHaveLength(1);

    livekit();
    const warmed = await session("PREP_READY");
    await env.c.liveSessions.warm(user.id, warmed.id);
    await env.c.liveSessions.startLive(user.id, warmed.id);
    expect(dispatches()).toHaveLength(1); // the warm-up's dispatch is reused
  });

  it("reuses an interviewer that is already in the room", async () => {
    livekit({ participants: { participants: [{ identity: "agent-1", kind: "AGENT" }] } });
    const s = await session("PREP_READY");
    await env.c.liveSessions.startLive(user.id, s.id);
    expect(dispatches()).toHaveLength(0);
  });
});
