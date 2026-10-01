import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { json, status } from "../support/fakeFetch.js";
import { bearer, createUser, createTestEnv, TEST_INTERNAL_KEY, type TestEnv } from "../support/harness.js";
import { AI, aiCalls } from "./helpers.js";

/**
 * Interview-intelligence BFF proxies (/api/v1/intelligence/*) — no Java controller test existed.
 * Asserts IntelligenceController's contract: passthrough of AI-service JSON, 502
 * ai_service_unreachable on failure (except the "lookup" reads, which degrade to empty), the
 * /questions limit cap, and 404 brief_not_found.
 */

let env: TestEnv;
let admin: string;
beforeAll(async () => {
  env = await createTestEnv();
  admin = await bearer(env, await createUser(env, { role: "ADMIN" }));
});
afterAll(() => env.close());
beforeEach(() => env.fetch.reset());

const BASE = "/api/v1/intelligence";
const UNREACHABLE = { code: "ai_service_unreachable", message: "the intelligence service is not reachable" };

/** Command-style proxies: [method, our path, upstream method, upstream URL]. */
const COMMANDS = [
  ["post", "/scrape/run", "POST", `${AI}/admin/scrape/run`],
  ["post", "/scrape/stop", "POST", `${AI}/admin/scrape/stop`],
  ["get", "/scrape/status", "GET", `${AI}/admin/scrape/status?after=0`],
  ["post", "/questions/collect", "POST", `${AI}/admin/questions/collect`],
  ["post", "/briefs/clear", "POST", `${AI}/admin/briefs/clear`],
] as const;

describe("command proxies", () => {
  it.each(COMMANDS)("%s %s passes the AI service's JSON through", async (method, path, upMethod, upUrl) => {
    const payload = { run_id: "run-9", status: "running", already_running: false };
    env.fetch.on(upMethod, upUrl, payload);
    const res = await env.http[method](`${BASE}${path}`).set("Authorization", admin);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(payload);
    const [call] = aiCalls(env);
    expect(call?.method).toBe(upMethod);
    expect(call?.url).toBe(upUrl);
    expect(call?.headers["x-internal-api-key"]).toBe(TEST_INTERNAL_KEY);
  });

  it.each(COMMANDS)("%s %s → 502 ai_service_unreachable when the AI service is down", async (method, path) => {
    const res = await env.http[method](`${BASE}${path}`).set("Authorization", admin);
    expect(res.status).toBe(502);
    expect(res.body).toEqual(UNREACHABLE);
  });

  it.each(COMMANDS)("%s %s → 502 on an upstream error status too", async (method, path, upMethod, upUrl) => {
    env.fetch.on(upMethod, upUrl, () => status(500));
    const res = await env.http[method](`${BASE}${path}`).set("Authorization", admin);
    expect(res.status).toBe(502);
    expect(res.body.code).toBe("ai_service_unreachable");
  });

  it("scrape/status forwards ?after; a non-integer after is 400", async () => {
    env.fetch.on("GET", `${AI}/admin/scrape/status`, { logs: [], last_seq: 12 });
    const res = await env.http.get(`${BASE}/scrape/status?after=12`).set("Authorization", admin);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ logs: [], last_seq: 12 });
    expect(aiCalls(env)[0]?.url).toBe(`${AI}/admin/scrape/status?after=12`);
    expect((await env.http.get(`${BASE}/scrape/status?after=x`).set("Authorization", admin)).status).toBe(400);
  });
});

describe("GET /intelligence/questions", () => {
  it("default limit 100; filters are forwarded with the AI service's names", async () => {
    env.fetch.on("GET", `${AI}/questions`, { questions: [{ id: "q1" }], count: 1 });
    const res = await env.http.get(`${BASE}/questions?roundType=dsa&company=meesho&difficulty=hard`).set("Authorization", admin);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ questions: [{ id: "q1" }], count: 1 });
    const q = new URL(aiCalls(env)[0]!.url).searchParams;
    expect(q.get("limit")).toBe("100");
    expect(q.get("round_type")).toBe("dsa");
    expect(q.get("company")).toBe("meesho");
    expect(q.get("difficulty")).toBe("hard");
  });

  it("limit is capped at 500; smaller limits pass through; blank filters are omitted", async () => {
    env.fetch.on("GET", `${AI}/questions`, { questions: [], count: 0 });
    await env.http.get(`${BASE}/questions?limit=9999&roundType=`).set("Authorization", admin).expect(200);
    await env.http.get(`${BASE}/questions?limit=25`).set("Authorization", admin).expect(200);
    const [capped, small] = aiCalls(env).map((c) => new URL(c.url).searchParams);
    expect(capped?.get("limit")).toBe("500");
    expect(capped?.has("round_type")).toBe(false);
    expect(small?.get("limit")).toBe("25");
    expect([...(small?.keys() ?? [])]).toEqual(["limit"]);
  });

  it("an AI failure degrades to an empty bank (200 {questions: [], count: 0})", async () => {
    const res = await env.http.get(`${BASE}/questions`).set("Authorization", admin);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ questions: [], count: 0 });
  });

  it("a non-integer limit is 400", async () => {
    expect((await env.http.get(`${BASE}/questions?limit=lots`).set("Authorization", admin)).status).toBe(400);
  });
});

describe("GET /intelligence/briefs", () => {
  it("lists brief summaries", async () => {
    const summaries = { briefs: [{ company: "meesho", role: "software-engineer", level: "fresher", specialization: "backend", data_confidence: "high" }] };
    env.fetch.on("GET", `${AI}/briefs`, summaries);
    const res = await env.http.get(`${BASE}/briefs`).set("Authorization", admin);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(summaries);
  });

  it("an AI failure degrades to {briefs: []}", async () => {
    const res = await env.http.get(`${BASE}/briefs`).set("Authorization", admin);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ briefs: [] });
  });

  it("GET /briefs/:company/:role/:level/:specialization proxies one brief", async () => {
    const brief = { company: "meesho", consolidated_process: { rounds: [] }, data_confidence: "low", low_confidence: true };
    env.fetch.on("GET", `${AI}/briefs/meesho/software-engineer/fresher/backend`, brief);
    const res = await env.http.get(`${BASE}/briefs/meesho/software-engineer/fresher/backend`).set("Authorization", admin);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(brief);
  });

  it("an unknown brief is 404 brief_not_found", async () => {
    env.fetch.on("GET", `${AI}/briefs/meesho/software-engineer/sde3/backend`, () => json({ detail: "no brief for that JD" }, 404));
    const res = await env.http.get(`${BASE}/briefs/meesho/software-engineer/sde3/backend`).set("Authorization", admin);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ code: "brief_not_found", message: "no brief for that JD yet" });
  });

  it("a degraded AI service also reads as brief_not_found (lookup never throws)", async () => {
    const res = await env.http.get(`${BASE}/briefs/a/b/c/d`).set("Authorization", admin);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("brief_not_found");
  });

  it("path segments are URI-encoded upstream", async () => {
    env.fetch.on("GET", `${AI}/briefs/`, {});
    await env.http.get(`${BASE}/briefs/big%20co/software-engineer/sde1/full%20stack`).set("Authorization", admin).expect(200);
    expect(aiCalls(env)[0]?.url).toBe(`${AI}/briefs/big%20co/software-engineer/sde1/full%20stack`);
  });
});

describe("security", () => {
  it("ADMIN-only across /intelligence/**", async () => {
    const user = await bearer(env, await createUser(env));
    for (const [method, path] of COMMANDS) {
      expect((await env.http[method](`${BASE}${path}`).set("Authorization", user)).status).toBe(403);
    }
    expect((await env.http.get(`${BASE}/questions`).set("Authorization", user)).status).toBe(403);
    expect((await env.http.get(`${BASE}/briefs/a/b/c/d`)).status).toBe(401);
    expect(aiCalls(env)).toHaveLength(0);
  });
});
