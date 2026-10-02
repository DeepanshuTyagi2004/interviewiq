import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bearer, createUser, createTestEnv, type TestEnv } from "../support/harness.js";
import { seedCompany } from "./helpers.js";

describe("GET /api/v1/companies (student catalogue)", () => {
  let env: TestEnv;
  let user: string;
  beforeAll(async () => {
    env = await createTestEnv();
    user = await bearer(env, await createUser(env));
  });
  afterAll(() => env.close());

  it("lists only published, active companies — never unpublished research targets or archived ones", async () => {
    await seedCompany(env, "meesho", "Meesho");
    await seedCompany(env, "draft-co", "Draft Co", { publishedAt: null });
    await seedCompany(env, "old-co", "Old Co", { status: "archived" });
    const res = await env.http.get("/api/v1/companies").set("Authorization", user);
    expect(res.status).toBe(200);
    expect(res.body.map((c: { slug: string }) => c.slug)).toEqual(["meesho"]);
  });
});
