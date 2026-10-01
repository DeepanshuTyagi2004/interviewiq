import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bearer, createTestEnv, createUser, type TestEnv } from "./support/harness.js";

let env: TestEnv;
let userAuth: string;

beforeAll(async () => {
  env = await createTestEnv();
  userAuth = await bearer(env, await createUser(env));
});
afterAll(() => env.close());

/** A USER must never reach an ADMIN router by spelling the path differently. */
describe("admin gate can't be bypassed by path spelling", () => {
  const variants = [
    "/api/v1/admin/users",
    "/api/v1/ADMIN/users",
    "/api/v1/Admin/users",
    "/API/V1/ADMIN/USERS",
    "/api/v1/intelligence/briefs",
    "/api/v1/INTELLIGENCE/briefs",
    "/api/v1/%61dmin/users",
    "/api/v1/admin/users/",
    "/api/v1//admin/users",
    "/api/v1/./admin/users",
  ];
  for (const path of variants) {
    it(`GET ${path} → never 200 for a USER`, async () => {
      const res = await env.http.get(path).set("Authorization", userAuth);
      expect(res.status).not.toBe(200);
      expect([401, 403, 404]).toContain(res.status);
    });
  }

  it("internal endpoints can't be reached without the key via case tricks either", async () => {
    const res = await env.http.get("/api/v1/INTERNAL/scrape-targets").set("Authorization", userAuth);
    expect(res.status).not.toBe(200);
  });
});

describe("request ordering", () => {
  it("an unauthenticated request with a malformed JSON body is 401, not 400", async () => {
    const res = await env.http.post("/api/v1/interviews/sessions").set("Content-Type", "application/json").send("{not json");
    expect(res.status).toBe(401);
  });

  it("an authenticated malformed JSON body is a 400 envelope", async () => {
    const res = await env.http.post("/api/v1/interviews/sessions").set("Authorization", userAuth).set("Content-Type", "application/json").send("{not json");
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("bad_request");
  });
});
