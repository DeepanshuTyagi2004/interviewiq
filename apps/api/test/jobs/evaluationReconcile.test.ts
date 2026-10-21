import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { JobDescriptionRow, UserRow } from "../../src/db/pg/schema.js";
import { createTestEnv, createUser, type TestEnv } from "../support/harness.js";
import { AI, seedJd, seedSession } from "../routes/helpers.js";

/** EvaluationReconcileJob (spec §11.1): start pending evaluations once, collect finished runs, retry transient failures. */

let env: TestEnv;
let user: UserRow;
let jd: JobDescriptionRow;

beforeAll(async () => {
  env = await createTestEnv();
  jd = await seedJd(env, { company: "google", role: "software-engineer", level: "sde1" });
});
afterAll(() => env.close());
beforeEach(async () => {
  env.fetch.reset();
  user = await createUser(env);
});

const row = async (id: string) => (await env.c.repos.sessions.findById(id))!;
const completed = (extra: Record<string, unknown> = {}) =>
  seedSession(env, user.id, jd, {
    status: "COMPLETED", scheduledAt: new Date(Date.now() - 3_600_000), evalStatus: "pending", passMark: 7.0, codeStandard: "near_runnable", ...extra,
  });

describe("EvaluationReconcileJob.tick", () => {
  it("starts a pending session once; a second tick polls the run instead of starting another", async () => {
    const s = await completed();
    env.fetch.on("POST", `${AI}/evaluations/runs`, { run_id: "evr_1", status: "running", existing: false });
    env.fetch.on("GET", `${AI}/evaluations/runs/evr_1`, { run_id: "evr_1", status: "running" });

    await env.c.jobs.evaluationReconcile.tick();
    await env.c.jobs.evaluationReconcile.tick();

    expect(await row(s.id)).toMatchObject({ evalStatus: "running", evalRunId: "evr_1" });
    const starts = env.fetch.callsTo(`${AI}/evaluations/runs`, "POST");
    expect(starts).toHaveLength(1);
    const body = starts[0]!.json as { trigger: string; session_id: string; meta: Record<string, unknown> };
    expect(body).toMatchObject({ trigger: "reconcile", session_id: s.id, meta: { pass_mark: 7, code_standard: "near_runnable", official: false, company: "google" } });
    expect(starts[0]!.headers["x-internal-api-key"]).toBeTruthy();
  });

  it("computes and stores the grading snapshot for a session booked before it existed", async () => {
    const s = await completed({ passMark: null, codeStandard: null });
    env.fetch.on("POST", `${AI}/evaluations/runs`, { run_id: "evr_snap", status: "running" });

    await env.c.jobs.evaluationReconcile.tick();

    const after = await row(s.id);
    expect(after.passMark).toBeGreaterThanOrEqual(5.5);
    expect(after.codeStandard).not.toBeNull();
    expect((env.fetch.callsTo(`${AI}/evaluations/runs`, "POST")[0]!.json as { meta: { pass_mark: number } }).meta.pass_mark).toBe(after.passMark);
  });

  it("does not touch sessions that are not COMPLETED or have no evaluation status (legacy)", async () => {
    const legacy = await completed({ evalStatus: null });
    await env.c.jobs.evaluationReconcile.tick();
    expect(await row(legacy.id)).toMatchObject({ evalStatus: null, evalRunId: null });
    expect(env.fetch.callsTo(`${AI}/evaluations/runs`, "POST")).toHaveLength(0);
  });

  it("retries a failure with a permanent-looking code once its hour has passed, and starts nothing inside the hour", async () => {
    const waiting = await completed({ evalStatus: "failed", evalErrorCode: "invalid_grades", evalAttempts: 2, evalRetryWindowStart: new Date() });
    await env.c.jobs.evaluationReconcile.tick();
    expect(await row(waiting.id)).toMatchObject({ evalStatus: "failed", evalRunId: null });
    expect(env.fetch.callsTo(`${AI}/evaluations/runs`, "POST")).toHaveLength(0);

    const due = await completed({ evalStatus: "failed", evalErrorCode: "invalid_grades", evalAttempts: 2, evalRetryWindowStart: new Date(Date.now() - 2 * 3_600_000) });
    env.fetch.on("POST", `${AI}/evaluations/runs`, { run_id: "evr_h", status: "running", existing: false });
    await env.c.jobs.evaluationReconcile.tick();
    expect(await row(due.id)).toMatchObject({ evalStatus: "running", evalRunId: "evr_h" });
  });

  it("never retries a stale_report failure", async () => {
    const s = await completed({ evalStatus: "failed", evalErrorCode: "stale_report", evalAttempts: 2, evalRetryWindowStart: new Date(Date.now() - 2 * 3_600_000) });
    await env.c.jobs.evaluationReconcile.tick();
    expect(await row(s.id)).toMatchObject({ evalStatus: "failed", evalRunId: null });
    expect(env.fetch.callsTo(`${AI}/evaluations/runs`, "POST").filter((c) => (c.json as { session_id?: string })?.session_id === s.id)).toHaveLength(0);
  });
});
