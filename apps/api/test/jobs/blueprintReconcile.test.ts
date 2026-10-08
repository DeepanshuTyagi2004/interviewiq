import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { JobDescriptionRow, UserRow } from "../../src/db/pg/schema.js";
import { createTestEnv, createUser, type TestEnv } from "../support/harness.js";
import { AI, seedJd, seedSession } from "../routes/helpers.js";

/** BlueprintReconcileJob (spec §5.4): start what's waiting, collect what's finished, refresh every Nth tick. */

let env: TestEnv;
let user: UserRow;
let jd: JobDescriptionRow;

beforeAll(async () => {
  env = await createTestEnv({ BLUEPRINT_REFRESH_EVERY_TICKS: "2", BLUEPRINT_REFRESH_CUTOFF_MINUTES: "30" });
  jd = await seedJd(env, { company: "google", role: "software-engineer", level: "sde1" });
});
afterAll(() => env.close());
beforeEach(async () => {
  env.fetch.reset();
  user = await createUser(env);
});

const row = async (id: string) => (await env.c.repos.sessions.findById(id))!;
const future = (minutes: number) => new Date(Date.now() + minutes * 60_000);

describe("BlueprintReconcileJob.tick", () => {
  it("queues SCHEDULED sessions, starts queued ones without a run, and leaves past slots alone", async () => {
    const legacy = await seedSession(env, user.id, jd, { status: "SCHEDULED", scheduledAt: future(600) });
    const queued = await seedSession(env, user.id, jd, { status: "PREP_QUEUED", scheduledAt: future(900) });
    const past = await seedSession(env, user.id, jd, { status: "SCHEDULED", scheduledAt: future(-24 * 60) });
    let n = 0;
    env.fetch.on("POST", `${AI}/blueprints/runs`, () => new Response(JSON.stringify({ run_id: `bpr_${++n}`, status: "running" })));

    await env.c.jobs.blueprintReconcile.tick();

    expect(await row(legacy.id)).toMatchObject({ status: "PREP_QUEUED" });
    expect((await row(legacy.id)).prepRunId).toMatch(/^bpr_/);
    expect((await row(queued.id)).prepRunId).toMatch(/^bpr_/);
    expect(await row(past.id)).toMatchObject({ status: "SCHEDULED", prepRunId: null });
    const triggers = env.fetch.callsTo(`${AI}/blueprints/runs`, "POST").map((c) => (c.json as { trigger: string }).trigger);
    expect(triggers).toEqual(["reconcile", "reconcile"]);
  });

  it("collects finished runs, and on the refresh tick re-prepares ready sessions whose inputs changed", async () => {
    const preparing = await seedSession(env, user.id, jd, { status: "PREP_QUEUED", scheduledAt: future(600), prepRunId: "bpr_done", prepRunStartedAt: new Date() });
    const hash = (await env.c.blueprintPrep.assemble(preparing, "reconcile")).input_hash;
    env.fetch.on("GET", `${AI}/blueprints/runs/bpr_done`, { status: "completed", input_hash: hash, blueprint_version: 1,
      briefing: { interviewer_name: "Asha", interviewer_style: "calm", format: "45-minute coding interview with a shared editor", duration_mins: 45 } });
    const changed = await seedSession(env, user.id, jd, { status: "PREP_READY", scheduledAt: future(600), prepInputHash: "older", blueprintVersion: 1 });
    const soon = await seedSession(env, user.id, jd, { status: "PREP_READY", scheduledAt: future(10), prepInputHash: "older", blueprintVersion: 1 });
    env.fetch.on("POST", `${AI}/blueprints/runs`, { run_id: "bpr_refresh", status: "running" });

    // Tick parity is shared with the previous test's env: tick until the refresh tick has run.
    await env.c.jobs.blueprintReconcile.tick();
    if ((await row(changed.id)).prepRunId === null) await env.c.jobs.blueprintReconcile.tick();

    expect(await row(preparing.id)).toMatchObject({ status: "PREP_READY", blueprintVersion: 1, prepRunId: null });
    expect(await row(changed.id)).toMatchObject({ status: "PREP_READY", prepRunId: "bpr_refresh", prepRefreshing: true });
    expect(await row(soon.id)).toMatchObject({ prepRunId: null }); // inside the 30-minute cutoff: never swapped
  });
});
