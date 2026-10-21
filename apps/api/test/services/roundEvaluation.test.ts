import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { JobDescriptionRow, UserRow } from "../../src/db/pg/schema.js";
import { createTestEnv, createUser, type TestEnv } from "../support/harness.js";
import { AI, seedJd, seedSession } from "../routes/helpers.js";

/** RoundEvaluationService: applying runs, retries, gating columns, disputes, and the round-end hook. */

let env: TestEnv;
let user: UserRow;
let jd: JobDescriptionRow;

beforeAll(async () => {
  env = await createTestEnv({ LIVE_INTERVIEWER_AVAILABLE: "true" });
  jd = await seedJd(env, { company: "google", role: "software-engineer", level: "sde1" });
});
afterAll(() => env.close());
beforeEach(async () => {
  env.fetch.reset();
  user = await createUser(env);
});

const svc = () => env.c.roundEvaluation;
const row = async (id: string) => (await env.c.repos.sessions.findById(id))!;
const DAY = 86_400_000;

const running = (extra: Record<string, unknown> = {}) =>
  seedSession(env, user.id, jd, {
    status: "COMPLETED", scheduledAt: new Date(Date.now() - 3_600_000), evalStatus: "running", passMark: 7.0, codeStandard: "near_runnable",
    evalRunId: "evr_1", evalRunStartedAt: new Date(), ...extra,
  });

const reportDoc = (extra: Record<string, unknown> = {}) => ({
  outcome: "below_pass", score: 6.8, areas: [{ key: "problem_solving", score: 6.8 }], questions: [{ id: "q1" }, { id: "q2" }, { id: "q3" }, { id: "q4" }],
  disputes: [], eval_version: "ev-1", ...extra,
});

function aiReturns(version: number, result: Record<string, unknown>, report = reportDoc()): void {
  env.fetch.on("GET", `${AI}/evaluations/runs/evr_1`, { run_id: "evr_1", status: "completed", result: { version, pass_mark: 7.0, ...result } });
  env.fetch.on("GET", `${AI}/evaluations/sessions/`, { version, outcome: result.outcome, report });
}

describe("collect", () => {
  it("applies a completed run: score 6.8 vs pass 7.0 -> below_pass, retake in 7 days, report v1 saved", async () => {
    const s = await running();
    aiReturns(1, { outcome: "below_pass", score: 6.8, verdict: "borderline" });

    await svc().collect(s);

    const after = await row(s.id);
    expect(after).toMatchObject({ evalStatus: "ready", score: 6.8, outcome: "below_pass", verdict: "borderline", evalRunId: null, evalVersion: "ev-1" });
    expect(after.retakeAfter!.getTime() - after.evaluatedAt!.getTime()).toBe(7 * DAY);
    const saved = await env.c.repos.roundReports.latest(s.id);
    expect(saved?.version).toBe(1);
    expect(saved?.report.areas[0].key).toBe("problem_solving");
    expect(await svc().report(user.id, s.id)).toMatchObject({ status: "ready", report: { outcome: "below_pass", version: 1 } });
  });

  it("an unscorable run stores the report with no score and no cooldown", async () => {
    const s = await running();
    aiReturns(1, { outcome: "unscorable", score: null, verdict: null }, { outcome: "unscorable", unscorable_reason: "too short", disputes: [] } as never);
    await svc().collect(s);
    expect(await row(s.id)).toMatchObject({ evalStatus: "unscorable", outcome: "unscorable", score: null, retakeAfter: null });
    expect(await svc().report(user.id, s.id)).toMatchObject({ status: "ready", report: { unscorable_reason: "too short" } });
  });

  it("retries a transient failure twice in the hour, then stays failed (retried hourly) with no cooldown", async () => {
    let s = await running();
    const failRun = () => env.fetch.on("GET", `${AI}/evaluations/runs/evr_1`, { run_id: "evr_1", status: "failed", error: { code: "llm_unavailable", message: "x" } });
    failRun();

    await svc().collect(s);
    s = await row(s.id);
    expect(s).toMatchObject({ evalStatus: "pending", evalAttempts: 1, evalRunId: null, evalErrorCode: "llm_unavailable" });
    expect(await svc().report(user.id, s.id)).toEqual({ status: "evaluating" });

    s = await env.c.repos.sessions.applyEvaluation(s.id, { evalStatus: "running", evalRunId: "evr_1", evalRunStartedAt: new Date() }) as typeof s;
    await svc().collect(s);
    s = await row(s.id);
    expect(s).toMatchObject({ evalStatus: "pending", evalAttempts: 2 });

    s = await env.c.repos.sessions.applyEvaluation(s.id, { evalStatus: "running", evalRunId: "evr_1", evalRunStartedAt: new Date() }) as typeof s;
    await svc().collect(s);
    s = await row(s.id);
    expect(s).toMatchObject({ evalStatus: "failed", evalErrorCode: "llm_unavailable", retakeAfter: null, evalRunId: null });
    expect(await svc().report(user.id, s.id)).toEqual({ status: "failed" });
  });

  it("a permanent-looking failure goes straight to failed and waits for the hourly retry", async () => {
    const s = await running();
    env.fetch.on("GET", `${AI}/evaluations/runs/evr_1`, { run_id: "evr_1", status: "failed", error: { code: "invalid_grades", message: "x" } });
    await svc().collect(s);
    expect(await row(s.id)).toMatchObject({ evalStatus: "failed", evalErrorCode: "invalid_grades", retakeAfter: null });
    const failed = await row(s.id);
    expect(failed.evalAttempts).toBeGreaterThanOrEqual(2);                       // the fast retries are skipped
    expect(Date.now() - failed.evalRetryWindowStart!.getTime()).toBeLessThan(60_000);
    expect(await env.c.repos.sessions.findEvaluationWork(new Date(), 2)).not.toContainEqual(expect.objectContaining({ id: s.id }));
    const later = new Date(Date.now() + 61 * 60_000);
    expect(await env.c.repos.sessions.findEvaluationWork(later, 2)).toContainEqual(expect.objectContaining({ id: s.id }));
  });

  it("a run older than the timeout is cancelled and treated as a timeout", async () => {
    const s = await running({ evalRunStartedAt: new Date(Date.now() - 21 * 60_000) });
    env.fetch.on("GET", `${AI}/evaluations/runs/evr_1`, { run_id: "evr_1", status: "running" });
    env.fetch.on("POST", `${AI}/evaluations/runs/evr_1/cancel`, { cancelled: true });
    await svc().collect(s);
    expect(env.fetch.callsTo(`${AI}/evaluations/runs/evr_1/cancel`, "POST")).toHaveLength(1);
    expect(await row(s.id)).toMatchObject({ evalStatus: "pending", evalErrorCode: "timeout", evalRunId: null });
  });
});

describe("start", () => {
  const pending = (extra: Record<string, unknown> = {}) =>
    seedSession(env, user.id, jd, {
      status: "COMPLETED", scheduledAt: new Date(Date.now() - 3_600_000), evalStatus: "pending", passMark: 7.0, codeStandard: "near_runnable",
      endedReason: "candidate_ended", ...extra,
    });

  it("sends the session's end reason with the run request (I3)", async () => {
    const s = await pending();
    env.fetch.on("POST", `${AI}/evaluations/runs`, { run_id: "evr_s", status: "running", existing: false });
    await svc().start(s, "completion");
    expect((env.fetch.callsTo(`${AI}/evaluations/runs`, "POST")[0]!.json as { ended_reason: string }).ended_reason).toBe("candidate_ended");
    expect(await row(s.id)).toMatchObject({ evalStatus: "running", evalRunId: "evr_s" });
  });

  it("a live run not finalized yet is retried like any transient failure (I3)", async () => {
    const s = await running();
    env.fetch.on("GET", `${AI}/evaluations/runs/evr_1`, { run_id: "evr_1", status: "failed", error: { code: "live_not_final", message: "x", transient: true } });
    await svc().collect(s);
    expect(await row(s.id)).toMatchObject({ evalStatus: "pending", evalErrorCode: "live_not_final", evalAttempts: 1, evalRunId: null });
  });

  it("three start failures in a row park the evaluation as failed, then it starts again hourly (M6)", async () => {
    let s = await pending();
    // no AI-service route: every start fails in transport
    await svc().start(s, "completion");
    s = await row(s.id);
    expect(s).toMatchObject({ evalStatus: "pending", evalErrorCode: "start_failed", evalAttempts: 1 });
    await svc().start(s, "retry");
    s = await row(s.id);
    expect(s).toMatchObject({ evalStatus: "pending", evalAttempts: 2 });
    await svc().start(s, "retry");
    s = await row(s.id);
    expect(s).toMatchObject({ evalStatus: "failed", evalErrorCode: "start_failed", evalAttempts: 3, retakeAfter: null, evalRunId: null });
    // inside the hour the reconcile job leaves it; an hour later it starts again
    env.fetch.reset();
    await env.c.jobs.evaluationReconcile.tick();
    expect(env.fetch.callsTo(`${AI}/evaluations/runs`, "POST").filter((c) => (c.json as { session_id?: string })?.session_id === s.id)).toHaveLength(0);
    expect(await row(s.id)).toMatchObject({ evalStatus: "failed", evalAttempts: 3 });
    await env.c.repos.sessions.applyEvaluation(s.id, { evalRetryWindowStart: new Date(Date.now() - 2 * 3_600_000) });
    env.fetch.on("POST", `${AI}/evaluations/runs`, { run_id: "evr_again", status: "running", existing: false });
    await env.c.jobs.evaluationReconcile.tick();
    expect(await row(s.id)).toMatchObject({ evalStatus: "running", evalRunId: "evr_again" });
  });

  it("never attaches a run to a round that turned out unscorable or already has a report (M2)", async () => {
    const technical = await seedSession(env, user.id, jd, { status: "ABORTED_TECHNICAL", scheduledAt: new Date(Date.now() - 3_600_000), evalStatus: "unscorable" });
    expect(await env.c.repos.sessions.attachEvalRun(technical.id, "evr_x")).toBeNull();
    const late = await pending({ evalStatus: "unscorable" });
    expect(await env.c.repos.sessions.attachEvalRun(late.id, "evr_x")).toBeNull();
    const done = await pending({ evalStatus: "ready" });
    expect(await env.c.repos.sessions.attachEvalRun(done.id, "evr_x")).toBeNull();
    const failed = await pending({ evalStatus: "failed" });
    expect(await env.c.repos.sessions.attachEvalRun(failed.id, "evr_x")).toMatchObject({ evalStatus: "running", evalRunId: "evr_x" });
    expect(await env.c.repos.sessions.attachEvalRun(failed.id, "evr_y")).toBeNull();
  });
});

describe("disputes", () => {
  async function ready(over: Record<string, unknown> = {}, report = reportDoc()) {
    const s = await seedSession(env, user.id, jd, {
      status: "COMPLETED", scheduledAt: new Date(Date.now() - 3_600_000), evalStatus: "ready", passMark: 7.0, codeStandard: "near_runnable",
      score: 6.8, outcome: "below_pass", verdict: "borderline", evaluatedAt: new Date(), retakeAfter: new Date(Date.now() + 7 * DAY), ...over,
    });
    await env.c.repos.roundReports.save(s.id, user.id, 1, report);
    return s;
  }
  const body = (id = "q1") => ({ target: { type: "question" as const, id }, reason: "I answered that" });

  it("starts a dispute run and flipping to passed clears the cooldown on completion", async () => {
    const s = await ready();
    env.fetch.on("POST", `${AI}/evaluations/runs`, { run_id: "evr_d", status: "running", existing: false });
    expect(await svc().dispute(user.id, s.id, body())).toEqual({ status: "rechecking" });
    const sent = env.fetch.callsTo(`${AI}/evaluations/runs`, "POST")[0]!.json as { trigger: string; dispute: Record<string, unknown> };
    expect(sent).toMatchObject({ trigger: "dispute", dispute: { target_type: "question", target_id: "q1", reason: "I answered that", report_version: 1 } });
    let mid = await row(s.id);
    expect(mid).toMatchObject({ evalStatus: "ready", evalRunId: "evr_d" }); // still ready: nothing re-locks

    env.fetch.on("GET", `${AI}/evaluations/runs/evr_d`, { run_id: "evr_d", status: "completed", result: { version: 2, outcome: "passed", score: 7.1, verdict: "pass", pass_mark: 7.0 } });
    env.fetch.on("GET", `${AI}/evaluations/sessions/`, { version: 2, outcome: "passed", report: reportDoc({ outcome: "passed", score: 7.1, disputes: [{ target_type: "question", target_id: "q1" }] }) });
    await env.c.jobs.evaluationReconcile.tick(); // the job polls the dispute run of a ready session

    mid = await row(s.id);
    expect(mid).toMatchObject({ evalStatus: "ready", outcome: "passed", score: 7.1, retakeAfter: null, evalRunId: null });
    expect((await env.c.repos.roundReports.latest(s.id))?.version).toBe(2);
  });

  it("refuses after 14 days, past 3 disputes, a repeat target, an unready report and bad input", async () => {
    const old = await ready();
    await env.mongo.roundReports.updateOne({ sessionId: old.id, version: 1 }, { $set: { createdAt: new Date(Date.now() - 15 * DAY) } });
    await expect(svc().dispute(user.id, old.id, body())).rejects.toMatchObject({ status: 409, code: "dispute_window_closed" });

    const three = await ready({}, reportDoc({ disputes: ["a", "b", "c"].map((x) => ({ target_type: "area", target_id: x })) }));
    await expect(svc().dispute(user.id, three.id, body())).rejects.toMatchObject({ status: 409, code: "dispute_limit" });

    const one = await ready({}, reportDoc({ disputes: [{ target_type: "question", target_id: "q1" }] }));
    await expect(svc().dispute(user.id, one.id, body("q1"))).rejects.toMatchObject({ status: 409, code: "dispute_exists" });

    const pending = await seedSession(env, user.id, jd, { status: "COMPLETED", evalStatus: "pending", scheduledAt: new Date(Date.now() - 3_600_000) });
    await expect(svc().dispute(user.id, pending.id, body())).rejects.toMatchObject({ status: 409, code: "report_not_ready" });

    const fresh = await ready();
    await expect(svc().dispute(user.id, fresh.id, { ...body(), reason: "x".repeat(501) })).rejects.toMatchObject({ status: 400, code: "invalid_dispute" });
    await expect(svc().dispute(user.id, fresh.id, body("nope"))).rejects.toMatchObject({ status: 400, code: "invalid_dispute" });
    expect(env.fetch.callsTo(`${AI}/evaluations/runs`, "POST")).toHaveLength(0);
  });
});

describe("round end", () => {
  it("a completed round queues the evaluation in the same transition and starts a completion run", async () => {
    const s = await seedSession(env, user.id, jd, { status: "LIVE_IN_PROGRESS", liveStartedAt: new Date(), scheduledAt: new Date(Date.now() - 600_000), passMark: 7.0, codeStandard: "near_runnable" });
    env.fetch.on("POST", `${AI}/evaluations/runs`, { run_id: "evr_c", status: "running", existing: false });

    await env.c.liveSessions.endFromInterviewer(s.id, "completed", { tab_changes: 0, screen_changes_weighted: 0, full_violations: 0, conduct_incidents: 0 } as never);
    await env.c.background.drain();

    expect(await row(s.id)).toMatchObject({ status: "COMPLETED", evalStatus: "running", evalRunId: "evr_c" });
    expect((env.fetch.callsTo(`${AI}/evaluations/runs`, "POST")[0]!.json as { trigger: string }).trigger).toBe("completion");
  });

  it("a technical end is unscorable with no run, a free retake and a plain report", async () => {
    const s = await seedSession(env, user.id, jd, { status: "LIVE_IN_PROGRESS", liveStartedAt: new Date(), scheduledAt: new Date(Date.now() - 600_000) });
    await env.c.liveSessions.endFromInterviewer(s.id, "technical", { tab_changes: 0, screen_changes_weighted: 0, full_violations: 0, conduct_incidents: 0 } as never);
    await env.c.background.drain();

    expect(await row(s.id)).toMatchObject({ status: "ABORTED_TECHNICAL", evalStatus: "unscorable", retakeAfter: null, evalRunId: null });
    expect(env.fetch.callsTo(`${AI}/evaluations/runs`, "POST")).toHaveLength(0);
    expect(await svc().report(user.id, s.id)).toMatchObject({ status: "ready", report: { outcome: "unscorable" } });
  });
});

