import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { json, status } from "../support/fakeFetch.js";
import { bearer, createUser, createTestEnv, TEST_INTERNAL_KEY, type TestEnv } from "../support/harness.js";
import { AI, aiCalls } from "./helpers.js";

/**
 * First-party interview-experience submission (POST /api/v1/experiences) — no Java controller test
 * existed. Asserts ExperienceController's contract: 400 invalid_experience, 202 passthrough of the
 * AI service's response, 502 ai_service_unreachable.
 */

let env: TestEnv;
let authz: string;
beforeAll(async () => {
  env = await createTestEnv();
  authz = await bearer(env, await createUser(env)); // any signed-in candidate — not admin-gated
});
afterAll(() => env.close());
beforeEach(() => env.fetch.reset());

const URL_ = "/api/v1/experiences";
const VALID = { company: "Meesho", level: "fresher", content: "Round 1 was two DSA questions..." };

describe("POST /experiences", () => {
  it("202 with the AI service's response passed through; role defaults to software-engineer", async () => {
    env.fetch.on("POST", `${AI}/admin/experiences`, { id: "exp-1", status: "queued", extracted: false });
    const res = await env.http.post(URL_).set("Authorization", authz).send(VALID);
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ id: "exp-1", status: "queued", extracted: false });

    const [call] = aiCalls(env);
    expect(call?.method).toBe("POST");
    expect(call?.url).toBe(`${AI}/admin/experiences`);
    expect(call?.headers["x-internal-api-key"]).toBe(TEST_INTERNAL_KEY);
    expect(call?.json).toEqual({ company: "Meesho", role: "software-engineer", level: "fresher", raw_content: VALID.content });
  });

  it("an explicit role is forwarded; a blank one falls back to the default", async () => {
    env.fetch.on("POST", `${AI}/admin/experiences`, { ok: true });
    await env.http.post(URL_).set("Authorization", authz).send({ ...VALID, role: "data-engineer" }).expect(202);
    await env.http.post(URL_).set("Authorization", authz).send({ ...VALID, role: "  " }).expect(202);
    const [a, b] = aiCalls(env);
    expect((a?.json as { role: string }).role).toBe("data-engineer");
    expect((b?.json as { role: string }).role).toBe("software-engineer");
  });

  it.each([
    ["missing company", { level: "fresher", content: "x" }],
    ["blank level", { company: "Meesho", level: " ", content: "x" }],
    ["missing content", { company: "Meesho", level: "fresher" }],
    ["an empty object", {}],
    ["an array body", [VALID]],
  ])("400 invalid_experience for %s (nothing forwarded)", async (_label, body) => {
    const res = await env.http.post(URL_).set("Authorization", authz).send(body);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ code: "invalid_experience", message: "company, level and content are required" });
    expect(aiCalls(env)).toHaveLength(0);
  });

  it("a missing body is 400", async () => {
    const res = await env.http.post(URL_).set("Authorization", authz);
    expect(res.status).toBe(400);
    expect(aiCalls(env)).toHaveLength(0);
  });

  it.each([
    ["unreachable", undefined],
    ["5xx", () => status(503)],
    ["4xx", () => json({ detail: "bad" }, 422)],
  ])("502 ai_service_unreachable when the AI service is %s", async (_label, respond) => {
    if (respond) env.fetch.on("POST", `${AI}/admin/experiences`, respond);
    const res = await env.http.post(URL_).set("Authorization", authz).send(VALID);
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ code: "ai_service_unreachable", message: "the intelligence service is not reachable" });
  });

  it("requires a JWT", async () => {
    expect((await env.http.post(URL_).send(VALID)).status).toBe(401);
    expect(aiCalls(env)).toHaveLength(0);
  });
});
