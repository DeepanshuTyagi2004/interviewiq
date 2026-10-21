import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { JobDescriptionRow, UserRow } from "../../src/db/pg/schema.js";
import { linearGraph } from "../../src/domain/process.js";
import { bearer, createTestEnv, createUser, type TestEnv } from "../support/harness.js";
import { AI, seedJd, seedSession } from "./helpers.js";

/** GET /report, POST /report/disputes, the session fields, the loop payload and the admin evaluation routes. */

let env: TestEnv;
let user: UserRow;
let auth: string;
let jd: JobDescriptionRow;

beforeAll(async () => {
  env = await createTestEnv();
  jd = await seedJd(env, { company: "google", role: "software-engineer", level: "sde1" });
});
afterAll(() => env.close());
beforeEach(async () => {
  env.fetch.reset();
  user = await createUser(env);
  auth = await bearer(env, user);
});

const doc = () => ({
  meta: { company: "google", role: "software-engineer", level: "sde1", round_type: "dsa", round_minutes: 45, minutes_played: 41.5, code_standard: "near_runnable", weights_version: "w1", eval_version: "e1" },
  outcome: "passed", score: 7.4, pass_mark: 7.0, verdict: "pass", cap: null, practical_score: 7.5, theory_score: 7.0,
  areas: [{ key: "problem_solving", label: "Problem solving", weight: 60, score: 7.4, reason: "good", evidence: ["turn 3"], previous_score: 6.1 }],
  adjustments: [], questions: [{ id: "q1", part: "p1", kind: "dsa", asked: "two sum", answer_quotes: [{ turn_id: 2, text: "hash map" }], verdict: "correct", score: 8,
    strong_answer: "x", gap: "", topics: [{ subject: "DSA", topic: "Hashing" }], code: { language: "python", text: "pass", trace: [], logic_works: "yes", syntax_slips: [] } }],
  delivery: { observations: [], stats: { median_answer_latency_s: 2, slow_starts: 0, fillers: { um: 3 }, long_silences: 0, self_corrections: 1 } },
  conduct: [], integrity: [], focus: [{ title: "t", why: "w", moments: [2] }],
  topic_gaps: [{ subject: "DSA", topics: [{ topic: "Graphs", why: "w", practice: [{ slug: "a", title: "A", difficulty: "easy" }] }] }],
  strengths: ["s"], summary: "sum", end_questions: { quality: "basic", bonus: 0.1, note: "n" },
  transcript: [{ turn_id: 1, speaker: "interviewer", text: "hi", at: "2026-10-18T10:00:00+00:00", markers: [{ kind: "hint", note: "" }], cut_off: false }],
  disputes: [],
});

async function completed(over: Record<string, unknown> = {}) {
  return seedSession(env, user.id, jd, {
    status: "COMPLETED", scheduledAt: new Date(Date.now() - 3_600_000), evalStatus: "ready", passMark: 7.0, codeStandard: "near_runnable",
    score: 7.4, outcome: "passed", verdict: "pass", evaluatedAt: new Date(), ...over,
  });
}

describe("GET report, abandoned problem", () => {
  it("passes the retry flag of a practice problem through", async () => {
    const s = await completed();
    const d = doc();
    d.topic_gaps[0].topics[0].practice = [{ slug: "r", title: "R", difficulty: "hard", retry: true } as never, { slug: "a", title: "A", difficulty: "easy" }];
    await env.c.repos.roundReports.save(s.id, user.id, 1, d);
    const res = await env.http.get(`/api/v1/interviews/sessions/${s.id}/report`).set("Authorization", auth);
    expect(res.status).toBe(200);
    expect(res.body.topicGaps[0].topics[0].practice[0]).toMatchObject({ slug: "r", retry: true });
    expect(res.body.topicGaps[0].topics[0].practice[1]).not.toHaveProperty("retry");
  });
});

describe("GET report", () => {
  it("returns the camelCase report with the transcript to its owner", async () => {
    const s = await completed();
    await env.c.repos.roundReports.save(s.id, user.id, 1, doc());
    const res = await env.http.get(`/api/v1/interviews/sessions/${s.id}/report`).set("Authorization", auth);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "ready", score: 7.4, passMark: 7, practicalScore: 7.5, meta: { round: "dsa", minutesPlayed: 41.5 } });
    expect(res.body.areas[0]).toMatchObject({ previousScore: 6.1 });
    expect(res.body.questions[0]).toMatchObject({ answerQuotes: [{ turnId: 2, text: "hash map" }], code: { logicWorks: "yes" } });
    expect(res.body.topicGaps[0].topics[0].practice[0].slug).toBe("a");
    expect(res.body.topicGaps[0].topics[0].practice[0]).not.toHaveProperty("retry");
    expect(res.body.transcript[0]).toMatchObject({ turnId: 1, cutOff: false, markers: [{ kind: "hint" }] });
    expect(res.body.delivery.stats.fillers).toEqual({ um: 3 });
    expect(res.body.readiness).toBeNull(); // not a loop round
  });

  it("carries the score build-up, delivery counts and integer example turn ids (I5, M3)", async () => {
    const s = await completed();
    await env.c.repos.roundReports.save(s.id, user.id, 1, {
      ...doc(), base_score: 7.1, bonus_total: 0.5, penalty_total: -0.25,
      delivery: { observations: [{ text: "slow start", examples: [4, "turn:7", "x"] }],
        stats: { median_answer_latency_s: 2, slow_starts: [4, 7, 9], fillers: {}, long_silences: [{ item_id: "core-1", seconds: 120 }], self_corrections: 0 } },
    });
    const res = await env.http.get(`/api/v1/interviews/sessions/${s.id}/report`).set("Authorization", auth);
    expect(res.body).toMatchObject({ baseScore: 7.1, bonusTotal: 0.5, penaltyTotal: -0.25 });
    expect(res.body.delivery.stats).toMatchObject({ slowStarts: 3, longSilences: 1 });
    expect(res.body.delivery.observations[0].examples).toEqual([4, 7]);
    expect(res.body).toMatchObject({ recheckPending: false, recheckTarget: null });
  });

  it("shows a running re-check and its target until the new version lands (I4)", async () => {
    const s = await completed();
    await env.c.repos.roundReports.save(s.id, user.id, 1, doc());
    env.fetch.on("POST", `${AI}/evaluations/runs`, { run_id: "evr_d", status: "running", existing: false });
    await env.http.post(`/api/v1/interviews/sessions/${s.id}/report/disputes`).set("Authorization", auth)
      .send({ target: { type: "question", id: "q1" }, reason: "I answered" });
    const res = await env.http.get(`/api/v1/interviews/sessions/${s.id}/report`).set("Authorization", auth);
    expect(res.body).toMatchObject({ status: "ready", recheckPending: true, recheckTarget: { type: "question", id: "q1" } });

    env.fetch.on("GET", `${AI}/evaluations/runs/evr_d`, { run_id: "evr_d", status: "completed", result: { version: 2, outcome: "passed", score: 7.6, verdict: "Hire", pass_mark: 7.0 } });
    env.fetch.on("GET", `${AI}/evaluations/sessions/`, { version: 2, outcome: "passed",
      report: { ...doc(), score: 7.6, disputes: [{ target_type: "question", target_id: "q1", decision: "revised", old_score: 8, new_score: 9, explanation: "e" }] } });
    await env.c.jobs.evaluationReconcile.tick();
    const after = await env.http.get(`/api/v1/interviews/sessions/${s.id}/report`).set("Authorization", auth);
    expect(after.body).toMatchObject({ version: 2, recheckPending: false, recheckTarget: null });
    expect(after.body.disputes[0]).toMatchObject({ decision: "revised", target: { type: "question", id: "q1" } });
  });

  it("is 404 for another user", async () => {
    const s = await completed();
    await env.c.repos.roundReports.save(s.id, user.id, 1, doc());
    const other = await bearer(env, await createUser(env));
    expect((await env.http.get(`/api/v1/interviews/sessions/${s.id}/report`).set("Authorization", other)).status).toBe(404);
  });

  it("returns only the status while evaluating", async () => {
    const s = await completed({ evalStatus: "running", score: null, outcome: null });
    const res = await env.http.get(`/api/v1/interviews/sessions/${s.id}/report`).set("Authorization", auth);
    expect(res.body).toMatchObject({ status: "evaluating", meta: { company: "google", round: "dsa" } });
  });
});

describe("POST report/disputes", () => {
  it("rejects a 501-character reason with 400 invalid_dispute", async () => {
    const s = await completed();
    await env.c.repos.roundReports.save(s.id, user.id, 1, doc());
    const res = await env.http.post(`/api/v1/interviews/sessions/${s.id}/report/disputes`).set("Authorization", auth)
      .send({ target: { type: "question", id: "q1" }, reason: "x".repeat(501) });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("invalid_dispute");
  });

  it("starts a re-check with 202", async () => {
    const s = await completed();
    await env.c.repos.roundReports.save(s.id, user.id, 1, doc());
    env.fetch.on("POST", `${AI}/evaluations/runs`, { run_id: "evr_d", status: "running", existing: false });
    const res = await env.http.post(`/api/v1/interviews/sessions/${s.id}/report/disputes`).set("Authorization", auth)
      .send({ target: { type: "question", id: "q1" }, reason: "I answered" });
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ status: "rechecking" });
  });
});

describe("session and loop payloads", () => {
  it("the session carries the grading fields", async () => {
    const s = await completed();
    const res = await env.http.get(`/api/v1/interviews/sessions/${s.id}`).set("Authorization", auth);
    expect(res.body).toMatchObject({ passMark: 7, score: 7.4, outcome: "passed", verdict: "pass", evaluationStatus: "ready" });
  });

  it("the loop carries readiness, node states and per-round scores", async () => {
    const graph = linearGraph([
      { id: "r1", name: "Coding", type: "dsa", durationMinutes: 45, difficulty: "medium", topics: [] },
      { id: "r2", name: "Design", type: "lld", durationMinutes: 45, difficulty: "medium", topics: [] },
    ]);
    const loop = (await env.c.repos.loops.insertIfNoLiveLoop({ userId: user.id, jdId: jd.id, processId: null, name: "L", level: "sde1", kind: "official", status: "active", graph }))!;
    const s = await completed({ loopId: loop.id, nodeId: "r1" });
    await env.c.repos.roundReports.save(s.id, user.id, 1, doc());
    const res = await env.http.get(`/api/v1/loops/${loop.id}`).set("Authorization", auth);
    expect(res.body.readiness).toBe("nearly_ready");
    expect(res.body.nodeStates).toEqual({ r1: "passed", r2: "available" });
    expect(res.body.nodeResults.r1).toMatchObject({ score: 7.4, passMark: 7, outcome: "passed" });
    expect(res.body.sessions[0]).toMatchObject({ score: 7.4, evaluationStatus: "ready" });
    const report = await env.http.get(`/api/v1/interviews/sessions/${s.id}/report`).set("Authorization", auth);
    expect(report.body).toMatchObject({ readiness: "nearly_ready", nextRound: { nodeId: "r2", name: "Design" } });
    // booking the next round must not make it vanish from the report
    await seedSession(env, user.id, jd, { loopId: loop.id, nodeId: "r2", status: "SCHEDULED" });
    const again = await env.http.get(`/api/v1/interviews/sessions/${s.id}/report`).set("Authorization", auth);
    expect(again.body.nextRound).toMatchObject({ nodeId: "r2" });
  });

  it("a report whose loop is gone has no readiness or next round", async () => {
    const graph = linearGraph([{ id: "r1", name: "Coding", type: "dsa", durationMinutes: 45, difficulty: "medium", topics: [] }]);
    const loop = (await env.c.repos.loops.insertIfNoLiveLoop({ userId: user.id, jdId: jd.id, processId: null, name: "L2", level: "sde1", kind: "official", status: "active", graph }))!;
    const s = await completed({ loopId: loop.id, nodeId: "r1" });
    await env.c.repos.roundReports.save(s.id, user.id, 1, doc());
    await env.c.repos.sessions.update(s.id, { loopId: "00000000-0000-4000-8000-000000000000" } as any).catch(() => undefined);
    const res = await env.http.get(`/api/v1/interviews/sessions/${s.id}/report`).set("Authorization", auth);
    expect(res.status).toBe(200);
    expect(res.body.readiness).toBeNull();
    expect(res.body.nextRound).toBeNull();
  });
});

describe("admin evaluation routes", () => {
  it("are admin-only and pass runs through", async () => {
    expect((await env.http.get("/api/v1/intelligence/evaluations/runs").set("Authorization", auth)).status).toBe(403);
    const admin = await bearer(env, await createUser(env, { role: "ADMIN" }));
    env.fetch.on("GET", /\/admin\/evaluations\/runs\?/, { runs: [{ run_id: "evr_1" }], next_cursor: null });
    const list = await env.http.get("/api/v1/intelligence/evaluations/runs?status=failed").set("Authorization", admin);
    expect(list.body.runs[0].run_id).toBe("evr_1");
    env.fetch.on("GET", `${AI}/admin/evaluations/runs/evr_1`, { run_id: "evr_1", grader_outputs: [] });
    expect((await env.http.get("/api/v1/intelligence/evaluations/runs/evr_1").set("Authorization", admin)).body.run_id).toBe("evr_1");
  });

  it("re-runs a completed session with an admin run", async () => {
    const admin = await bearer(env, await createUser(env, { role: "ADMIN" }));
    const s = await completed({ evalStatus: "failed", score: null, outcome: null });
    env.fetch.on("POST", `${AI}/evaluations/runs`, { run_id: "evr_r", status: "running", existing: false });
    const res = await env.http.post(`/api/v1/intelligence/evaluations/sessions/${s.id}/rerun`).set("Authorization", admin);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ runId: "evr_r" });
    expect((env.fetch.callsTo(`${AI}/evaluations/runs`, "POST")[0]!.json as { trigger: string }).trigger).toBe("admin");
    expect(await env.c.repos.sessions.findById(s.id)).toMatchObject({ evalStatus: "running", evalRunId: "evr_r" });
  });
});
