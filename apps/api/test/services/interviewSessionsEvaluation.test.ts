import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ProcessGraph } from "../../src/domain/process.js";
import { InterviewSessionError } from "../../src/services/interviewSessions.js";
import { createTestEnv, createUser, type TestEnv } from "../support/harness.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const future = (days = 7) => new Date(Date.now() + days * DAY_MS);

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
  await env.c.repos.companies.insert({ name: "Meesho", slug: "meesho", tier: 2, businessModel: "product", publishedAt: new Date() });
  await env.c.repos.roleConfigs.insert({ company: "meesho", role: "software-engineer", level: "sde1", enabled: true });
});
afterAll(() => env.close());
beforeEach(async () => { await env.c.background.drain(); env.fetch.reset(); });
afterEach(async () => { await env.c.background.drain(); });

const round = (id: string, difficulty: "easy" | "medium" | "hard") => ({
  id, kind: "round" as const, type: "dsa" as const, name: id, durationMinutes: 45, difficulty, topics: ["Arrays"], position: { x: 0, y: 0 },
});
const graph: ProcessGraph = { nodes: [round("r1", "hard"), round("r2", "medium")], edges: [{ source: "r1", target: "r2" }] };

async function loopWith(candidateId: string) {
  const loop = await env.c.repos.loops.insertIfNoLiveLoop({ userId: candidateId, jdId: null, name: "Practice", level: "sde1", kind: "standalone", status: "active", graph });
  return loop!;
}
const finished = (candidateId: string, loopId: string, extra: Record<string, unknown>) => env.c.repos.sessions.insert({
  candidateId, company: "custom-practice", role: "Practice", level: "sde1", roundType: "dsa", scheduledAt: new Date(Date.now() - DAY_MS), timezone: "UTC",
  status: "COMPLETED", loopId, nodeId: "r1", liveEndedAt: new Date(Date.now() - DAY_MS), ...extra,
});

describe("booking snapshot", () => {
  it("stores pass mark, code standard, tier and difficulty (Meesho tier 2, SDE1)", async () => {
    const user = await createUser(env);
    const jd = await env.c.repos.jds.insert({ company: "meesho", role: "software-engineer", level: "sde1", title: "SWE", source: "seed", active: true });
    const resp = await env.c.sessions.createSession(user.id, { jobDescriptionId: jd.id, roundType: "dsa", scheduledAt: future(), timezone: "Asia/Kolkata", loopId: null, nodeId: null });
    const row = (await env.c.repos.sessions.findById(resp.id))!;
    expect(row).toMatchObject({ passMark: 6.8, codeStandard: "runnable", companyTier: 2, evalAttempts: 0, evalStatus: null });
    expect(typeof row.passMark).toBe("number");
  });

  it("custom practice has no tier; a hard loop node raises the pass mark", async () => {
    const user = await createUser(env);
    const loop = await loopWith(user.id);
    const resp = await env.c.sessions.createSession(user.id, { jobDescriptionId: null, roundType: null, scheduledAt: future(), timezone: "UTC", loopId: loop.id, nodeId: "r1" });
    const row = (await env.c.repos.sessions.findById(resp.id))!;
    expect(row).toMatchObject({ companyTier: null, roundDifficulty: "hard", passMark: 6.8, codeStandard: "near_runnable" });
  });
});

describe("booking guards", () => {
  it("rejects a node in cooldown with the retake date", async () => {
    const user = await createUser(env);
    const loop = await loopWith(user.id);
    const until = future(3);
    await finished(user.id, loop.id, { evalStatus: "ready", outcome: "below_pass", score: 5.5, retakeAfter: until });
    const err = await env.c.sessions.createSession(user.id, { jobDescriptionId: null, roundType: null, scheduledAt: future(), timezone: "UTC", loopId: loop.id, nodeId: "r1" })
      .then(() => null, (e: unknown) => e as InterviewSessionError);
    expect(err).toMatchObject({ status: 409, code: "round_cooldown" });
    expect(err!.message).toContain(until.toISOString().slice(0, 10));
  });

  it("rejects an evaluating node and a passed node", async () => {
    const user = await createUser(env);
    const loop = await loopWith(user.id);
    const s = await finished(user.id, loop.id, { evalStatus: "pending" });
    const book = () => env.c.sessions.createSession(user.id, { jobDescriptionId: null, roundType: null, scheduledAt: future(), timezone: "UTC", loopId: loop.id, nodeId: "r1" })
      .then(() => null, (e: unknown) => e as InterviewSessionError);
    expect(await book()).toMatchObject({ status: 409, code: "round_evaluating" });
    await env.c.repos.sessions.applyEvaluation(s.id, { evalStatus: "ready", outcome: "passed", score: 8 });
    expect(await book()).toMatchObject({ status: 409, code: "round_already_completed" });
  });
});

describe("evaluation repositories", () => {
  it("finds work, claims a run once and reads the latest session for a node", async () => {
    const user = await createUser(env);
    const loop = await loopWith(user.id);
    const pending = await finished(user.id, loop.id, { evalStatus: "pending" });
    await finished(user.id, loop.id, { evalStatus: "ready", outcome: "passed" });
    await finished(user.id, loop.id, { evalStatus: "failed", evalAttempts: 2, evalRetryWindowStart: new Date() });
    const work = (await env.c.repos.sessions.findEvaluationWork()).filter((r) => r.candidateId === user.id);
    expect(work.map((r) => r.evalStatus)).toEqual(["pending"]);
    expect((await env.c.repos.sessions.attachEvalRun(pending.id, "run-1"))?.evalRunId).toBe("run-1");
    expect(await env.c.repos.sessions.attachEvalRun(pending.id, "run-2")).toBeNull();
    expect(await env.c.repos.sessions.findLatestForNode(user.id, loop.id, "r1")).not.toBeNull();
  });

  it("round reports keep versions and delete by candidate", async () => {
    const sid = randomUUID(); const cid = randomUUID();
    const r = env.c.repos.roundReports;
    await r.save(sid, cid, 1, { n: 1 });
    await r.save(sid, cid, 2, { n: 2 });
    await r.save(sid, cid, 2, { n: 99 });
    expect((await r.latest(sid))?.report).toEqual({ n: 2 });
    expect((await r.first(sid))?.report).toEqual({ n: 1 });
    await r.deleteByCandidate(cid);
    expect(await r.latest(sid)).toBeNull();
  });
});
