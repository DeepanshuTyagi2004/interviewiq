import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { json, status } from "../support/fakeFetch.js";
import { bearer, createUser, createTestEnv, TEST_INTERNAL_KEY, type TestEnv } from "../support/harness.js";
import { AI, aiCalls } from "./helpers.js";

/**
 * Port of AdminInterviewAgentControllerTest (Agent Diagnostics bench under
 * /api/v1/intelligence/interview-agent). Pure BFF proxy; the AI service is stubbed.
 */

let env: TestEnv;
let admin: string;
beforeAll(async () => {
  env = await createTestEnv();
  admin = await bearer(env, await createUser(env, { role: "ADMIN" }));
});
afterAll(() => env.close());
beforeEach(() => env.fetch.reset());

const BASE = "/api/v1/intelligence/interview-agent";

describe("POST /intelligence/interview-agent/run", () => {
  it("start_run_proxies_and_returns_body", async () => {
    env.fetch.on("POST", `${AI}/admin/interview-agent/run`, { run_id: "r1", status: "running" });
    const res = await env.http.post(`${BASE}/run`).set("Authorization", admin).send({});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ run_id: "r1", status: "running" });
  });

  it("forwards the plan body verbatim with the internal key", async () => {
    env.fetch.on("POST", `${AI}/admin/interview-agent/run`, { run_id: "r2", status: "running" });
    const plan = { plan: { rounds: [{ type: "dsa", probes: ["two-sum"] }] }, candidate: { name: "Asha" } };
    await env.http.post(`${BASE}/run`).set("Authorization", admin).send(plan).expect(200);
    const [call] = aiCalls(env);
    expect(call?.json).toEqual(plan);
    expect(call?.headers["content-type"]).toBe("application/json");
    expect(call?.headers["x-internal-api-key"]).toBe(TEST_INTERNAL_KEY);
  });

  it("capacity_maps_to_429_sessions_at_capacity", async () => {
    env.fetch.on("POST", `${AI}/admin/interview-agent/run`, () => json({ detail: "too many" }, 429));
    const res = await env.http.post(`${BASE}/run`).set("Authorization", admin).send({});
    expect(res.status).toBe(429);
    expect(res.body).toEqual({ code: "sessions_at_capacity", message: "too many active diagnostic sessions" });
  });

  it("a missing body is 400", async () => {
    const res = await env.http.post(`${BASE}/run`).set("Authorization", admin);
    expect(res.status).toBe(400);
    expect(aiCalls(env)).toHaveLength(0);
  });

  it("an empty JSON body is 400 as well (Spring: required @RequestBody) — nothing forwarded", async () => {
    env.fetch.on("POST", `${AI}/admin/interview-agent/run`, { run_id: "r-empty", status: "running" });
    const res = await env.http.post(`${BASE}/run`).set("Authorization", admin).set("Content-Type", "application/json").send("");
    expect(res.status).toBe(400);
    expect(aiCalls(env)).toHaveLength(0);
  });
});

describe("runs", () => {
  it("unknown_run_maps_to_404_run_not_found", async () => {
    env.fetch.on("GET", `${AI}/admin/interview-agent/runs/nope`, () => json({ detail: "nf" }, 404));
    const res = await env.http.get(`${BASE}/runs/nope`).set("Authorization", admin);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ code: "run_not_found", message: "no such diagnostic session" });
  });

  it("aiservice_down_maps_to_502", async () => {
    const res = await env.http.get(`${BASE}/runs`).set("Authorization", admin);
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ code: "ai_service_unreachable", message: "ai-service unavailable" });
  });

  it("an upstream 5xx is 502 as well", async () => {
    env.fetch.on("GET", `${AI}/admin/interview-agent/runs`, () => status(500));
    const res = await env.http.get(`${BASE}/runs`).set("Authorization", admin);
    expect(res.status).toBe(502);
    expect(res.body.code).toBe("ai_service_unreachable");
  });

  it("GET /runs/:id proxies the snapshot and forwards ?after (default 0)", async () => {
    env.fetch.on("GET", `${AI}/admin/interview-agent/runs/r1`, { run_id: "r1", status: "awaiting_turn", last_seq: 9 });
    const a = await env.http.get(`${BASE}/runs/r1`).set("Authorization", admin);
    expect(a.status).toBe(200);
    expect(a.body).toEqual({ run_id: "r1", status: "awaiting_turn", last_seq: 9 });
    await env.http.get(`${BASE}/runs/r1?after=4`).set("Authorization", admin).expect(200);
    expect(aiCalls(env).map((c) => c.url)).toEqual([`${AI}/admin/interview-agent/runs/r1?after=0`, `${AI}/admin/interview-agent/runs/r1?after=4`]);
  });

  it("GET /runs lists", async () => {
    env.fetch.on("GET", `${AI}/admin/interview-agent/runs`, { runs: [{ run_id: "r1" }] });
    const res = await env.http.get(`${BASE}/runs`).set("Authorization", admin);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ runs: [{ run_id: "r1" }] });
  });

  it("POST /runs/:id/turn forwards the turn body", async () => {
    env.fetch.on("POST", `${AI}/admin/interview-agent/runs/r1/turn`, { accepted: true });
    const turn = { text: "I'd use a hash map", kind: "speech" };
    const res = await env.http.post(`${BASE}/runs/r1/turn`).set("Authorization", admin).send(turn);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ accepted: true });
    expect(aiCalls(env)[0]?.json).toEqual(turn);
  });

  it("turn on an unknown run is 404; a missing turn body is 400", async () => {
    env.fetch.on("POST", `${AI}/admin/interview-agent/runs/gone/turn`, () => json({ detail: "nf" }, 404));
    const res = await env.http.post(`${BASE}/runs/gone/turn`).set("Authorization", admin).send({ text: "hi" });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("run_not_found");
    const noBody = await env.http.post(`${BASE}/runs/r1/turn`).set("Authorization", admin);
    expect(noBody.status).toBe(400);
  });

  it("POST /runs/:id/end force-ends", async () => {
    env.fetch.on("POST", `${AI}/admin/interview-agent/runs/r1/end`, { run_id: "r1", status: "ended" });
    const res = await env.http.post(`${BASE}/runs/r1/end`).set("Authorization", admin);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ run_id: "r1", status: "ended" });
    expect(aiCalls(env)[0]?.method).toBe("POST");
  });
});

describe("security", () => {
  it("ADMIN-only", async () => {
    const user = await bearer(env, await createUser(env));
    expect((await env.http.post(`${BASE}/run`).set("Authorization", user).send({})).status).toBe(403);
    expect((await env.http.get(`${BASE}/runs`)).status).toBe(401);
    expect(aiCalls(env)).toHaveLength(0);
  });
});
