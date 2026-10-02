import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { UserRow } from "../../src/db/pg/schema.js";
import { json } from "../support/fakeFetch.js";
import { bearer, createUser, createTestEnv, TEST_INTERNAL_KEY, type TestEnv } from "../support/harness.js";
import { AI, aiCalls } from "./helpers.js";

const BASE = "/api/v1/admin/research";
const RUN = "a".repeat(32);
const SPAN = "b".repeat(32);

describe("admin research proxies", () => {
  let env: TestEnv;
  let adminUser: UserRow;
  let admin: string;
  beforeAll(async () => {
    env = await createTestEnv();
    adminUser = await createUser(env, { role: "ADMIN" });
    admin = await bearer(env, adminUser);
  });
  afterAll(() => env.close());
  beforeEach(() => env.fetch.reset());

  it("POST /runs forwards scope, ids, mode and the admin as requested_by (201 passthrough)", async () => {
    env.fetch.on("POST", `${AI}/research/runs`, () => json({ run_id: RUN, status: "queued" }, 201));
    const res = await env.http.post(`${BASE}/runs`).set("Authorization", admin)
      .send({ scope: "selected", companyIds: ["c1", 7], mode: "replay" });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ run_id: RUN, status: "queued" });
    const [call] = aiCalls(env);
    expect(call!.json).toEqual({ scope: "selected", company_ids: ["c1"], mode: "replay", requested_by: adminUser.id });
    expect(call!.headers["x-internal-api-key"]).toBe(TEST_INTERNAL_KEY);
  });

  it("POST /runs validates locally: no companies for a selected run, unknown mode", async () => {
    const a = await env.http.post(`${BASE}/runs`).set("Authorization", admin).send({ scope: "selected", companyIds: [] });
    expect([a.status, a.body.code]).toEqual([400, "no_companies"]);
    const b = await env.http.post(`${BASE}/runs`).set("Authorization", admin).send({ mode: "dry" });
    expect([b.status, b.body.code]).toEqual([400, "invalid_mode"]);
    expect(aiCalls(env)).toHaveLength(0);
  });

  it("forwards an upstream 409 run_active with its code and message", async () => {
    env.fetch.on("POST", `${AI}/research/runs`, () =>
      json({ code: "run_active", message: `run ${RUN} is still active; resume or stop it first`, run_id: RUN }, 409));
    const res = await env.http.post(`${BASE}/runs`).set("Authorization", admin).send({});
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ code: "run_active", message: `run ${RUN} is still active; resume or stop it first` });
  });

  it("control actions, run detail and listing pass through", async () => {
    env.fetch.on("POST", `${AI}/research/runs/${RUN}/pause`, { run_id: RUN, status: "pausing" });
    env.fetch.on("GET", `${AI}/research/runs/${RUN}`, { run: { run_id: RUN }, items: [] });
    env.fetch.on("GET", `${AI}/research/runs?limit=100`, { runs: [] });
    expect((await env.http.post(`${BASE}/runs/${RUN}/pause`).set("Authorization", admin)).body.status).toBe("pausing");
    expect((await env.http.get(`${BASE}/runs/${RUN}`).set("Authorization", admin)).body.items).toEqual([]);
    expect((await env.http.get(`${BASE}/runs?limit=500`).set("Authorization", admin)).body).toEqual({ runs: [] });
  });

  it("events: camelCase query → snake_case upstream; blanks dropped", async () => {
    env.fetch.on("GET", `${AI}/research/runs/${RUN}/events`, { events: [], last_seq: 0 });
    await env.http.get(`${BASE}/runs/${RUN}/events?afterSeq=10&level=warn&companyId=c1&spanId=${SPAN}&q=&type=span.`)
      .set("Authorization", admin);
    const url = new URL(aiCalls(env)[0]!.url);
    expect(Object.fromEntries(url.searchParams)).toEqual({ after_seq: "10", level: "warn", company_id: "c1", span_id: SPAN, type: "span." });
  });

  it("PATCH budget maps exaCap/llmCap and rejects negatives", async () => {
    env.fetch.on("PATCH", `${AI}/research/runs/${RUN}/budget`, { run_id: RUN });
    const ok = await env.http.patch(`${BASE}/runs/${RUN}/budget`).set("Authorization", admin).send({ llmCap: 500 });
    expect(ok.status).toBe(200);
    expect(aiCalls(env)[0]!.json).toEqual({ llm_cap: 500 });
    const bad = await env.http.patch(`${BASE}/runs/${RUN}/budget`).set("Authorization", admin).send({ exaCap: -1 });
    expect([bad.status, bad.body.code]).toEqual([400, "invalid_budget"]);
  });

  it("span detail passes through; malformed ids are 400 without an upstream call", async () => {
    env.fetch.on("GET", `${AI}/research/spans/${SPAN}`, { span: { span_id: SPAN }, logs: [] });
    expect((await env.http.get(`${BASE}/spans/${SPAN}`).set("Authorization", admin)).body.span.span_id).toBe(SPAN);
    const badRun = await env.http.get(`${BASE}/runs/not-a-run`).set("Authorization", admin);
    expect([badRun.status, badRun.body.code]).toEqual([400, "invalid_run_id"]);
    const badSpan = await env.http.get(`${BASE}/spans/xyz`).set("Authorization", admin);
    expect([badSpan.status, badSpan.body.code]).toEqual([400, "invalid_span_id"]);
    expect(aiCalls(env)).toHaveLength(1);
  });

  it("AI service unreachable → 502 ai_service_unreachable", async () => {
    const res = await env.http.get(`${BASE}/runs`).set("Authorization", admin);
    expect([res.status, res.body.code]).toEqual([502, "ai_service_unreachable"]);
  });

  it("ADMIN-only", async () => {
    const user = await bearer(env, await createUser(env));
    expect((await env.http.get(`${BASE}/runs`).set("Authorization", user)).status).toBe(403);
    expect((await env.http.get(`${BASE}/runs`)).status).toBe(401);
  });
});
