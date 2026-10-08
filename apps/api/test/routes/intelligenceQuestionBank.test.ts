import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { bearer, createUser, createTestEnv, type TestEnv } from "../support/harness.js";
import { AI, aiCalls } from "./helpers.js";

/** Problem-bank proxies (docs/question-bank.md): generation trigger, stats, and the richer list filters. ADMIN only. */

let env: TestEnv;
let admin: string;
let user: string;
const BASE = "/api/v1/intelligence";

beforeAll(async () => {
  env = await createTestEnv();
  admin = await bearer(env, await createUser(env, { role: "ADMIN" }));
  user = await bearer(env, await createUser(env));
});
afterAll(() => env.close());
beforeEach(() => env.fetch.reset());

describe("problem bank proxies", () => {
  it("are admin only", async () => {
    expect((await env.http.post(`${BASE}/questions/generate`).set("Authorization", user)).status).toBe(403);
    expect((await env.http.get(`${BASE}/questions/stats`).set("Authorization", user)).status).toBe(403);
    expect((await env.http.get(`${BASE}/questions/stats`)).status).toBe(401);
  });

  it("generate forwards roundType, limit and force to the AI service and returns the run", async () => {
    env.fetch.on("POST", `${AI}/admin/questions/generate`, { run_id: "r1", status: "running", already_running: false });
    const res = await env.http.post(`${BASE}/questions/generate?roundType=dsa&limit=25&force=true`).set("Authorization", admin);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ run_id: "r1", status: "running", already_running: false });
    const q = new URL(aiCalls(env)[0]!.url).searchParams;
    expect([q.get("round_type"), q.get("limit"), q.get("force")]).toEqual(["dsa", "25", "true"]);
    await env.http.post(`${BASE}/questions/generate`).set("Authorization", admin).expect(200);
    expect(new URL(aiCalls(env)[1]!.url).search).toBe("");
  });

  it("stats pass through, and degrade to an empty bank when the AI service is down", async () => {
    env.fetch.on("GET", `${AI}/questions/stats`, { rounds: { dsa: { none: 10, verified: 2 } }, total: 12 });
    expect((await env.http.get(`${BASE}/questions/stats`).set("Authorization", admin)).body).toEqual({ rounds: { dsa: { none: 10, verified: 2 } }, total: 12 });
    env.fetch.reset();
    expect((await env.http.get(`${BASE}/questions/stats`).set("Authorization", admin)).body).toEqual({ rounds: {}, total: 0 });
  });

  it("the list forwards content filters with the AI service's names", async () => {
    env.fetch.on("GET", `${AI}/questions`, { questions: [], count: 0 });
    await env.http.get(`${BASE}/questions?roundType=lld&contentStatus=verified&topic=graphs&includeContent=true&limit=20`).set("Authorization", admin).expect(200);
    const q = new URL(aiCalls(env)[0]!.url).searchParams;
    expect(Object.fromEntries(q)).toEqual({ limit: "20", round_type: "lld", content_status: "verified", topic: "graphs", include_content: "true" });
  });
});
