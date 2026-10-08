import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { JobDescriptionRow } from "../../src/db/pg/schema.js";
import { bearer, createTestEnv, createUser, type TestEnv } from "../support/harness.js";
import { AI, seedJd } from "./helpers.js";

/** /api/v1/intelligence/blueprints (spec §10): ADMIN-only proxies + the bench request the API assembles. */

let env: TestEnv;
let jd: JobDescriptionRow;
const BASE = "/api/v1/intelligence/blueprints";

beforeAll(async () => {
  env = await createTestEnv();
  jd = await seedJd(env, { company: "google", role: "software-engineer", level: "sde1" });
});
afterAll(() => env.close());
beforeEach(() => env.fetch.reset());

describe("blueprint diagnostics proxies", () => {
  it("are admin-only", async () => {
    const student = await bearer(env, await createUser(env));
    expect((await env.http.get(`${BASE}/runs`).set("Authorization", student)).status).toBe(403);
    expect((await env.http.get(`${BASE}/runs`)).status).toBe(401);
  });

  it("pass list filters and run details through (snake_case)", async () => {
    const admin = await bearer(env, await createUser(env, { role: "ADMIN" }));
    env.fetch.on("GET", /\/admin\/blueprints\/runs\?/, { runs: [{ run_id: "bpr_1", status: "failed" }], next_cursor: null });
    const list = await env.http.get(`${BASE}/runs?status=failed&round_type=dsa&ignored=x`).set("Authorization", admin);
    expect(list.body.runs[0].run_id).toBe("bpr_1");
    const url = env.fetch.calls.at(-1)!.url;
    expect(url).toContain("status=failed");
    expect(url).toContain("round_type=dsa");
    expect(url).not.toContain("ignored");

    env.fetch.on("GET", `${AI}/admin/blueprints/runs/bpr_1`, () => new Response(JSON.stringify({ detail: "unknown run_id" }), { status: 404 }));
    const missing = await env.http.get(`${BASE}/runs/bpr_1`).set("Authorization", admin);
    expect(missing.status).toBe(404);
    expect(missing.body.code).toBe("run_not_found");
  });

  it("bench assembles a session-less request for the chosen candidate, JD and round", async () => {
    const admin = await bearer(env, await createUser(env, { role: "ADMIN" }));
    const candidate = await createUser(env);
    env.fetch.on("POST", `${AI}/admin/blueprints/bench`, { run_id: "bpr_b", status: "running" });
    const res = await env.http.post(`${BASE}/bench`).set("Authorization", admin)
      .send({ candidateId: candidate.id, jobDescriptionId: jd.id, roundType: "lld", options: { bypassAnswerKeyCache: true } });
    expect(res.status).toBe(200);
    expect(res.body.run_id).toBe("bpr_b");
    const sent = env.fetch.callsTo(`${AI}/admin/blueprints/bench`, "POST")[0]!.json as {
      session: { session_id: string | null; candidate_id: string; round_type: string }; trigger: string; options: Record<string, boolean>;
    };
    expect(sent.session).toMatchObject({ session_id: null, candidate_id: candidate.id, round_type: "lld" });
    expect(sent.trigger).toBe("bench");
    expect(sent.options).toEqual({ bypass_blueprint_cache: false, bypass_answer_key_cache: true, ignore_exclusions: false });

    const bad = await env.http.post(`${BASE}/bench`).set("Authorization", admin).send({ jobDescriptionId: jd.id });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe("blueprint_bad_request");
  });
});
