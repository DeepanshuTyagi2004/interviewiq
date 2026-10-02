import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestEnv, TEST_INTERNAL_KEY, type TestEnv } from "../support/harness.js";
import { seedCompany } from "./helpers.js";

describe("GET /api/v1/internal/research-targets", () => {
  let env: TestEnv;
  beforeAll(async () => {
    env = await createTestEnv();
    await seedCompany(env, "meesho", "Meesho", { aliases: ["Fashnear"], website: "https://meesho.com" });
    await seedCompany(env, "new-co", "New Co", { publishedAt: null });
    await seedCompany(env, "old-co", "Old Co", { status: "archived" });
  });
  afterAll(() => env.close());

  it("returns every ACTIVE company (published or not) for the research run", async () => {
    const res = await env.http.get("/api/v1/internal/research-targets").set("X-Internal-Api-Key", TEST_INTERNAL_KEY);
    expect(res.status).toBe(200);
    expect(res.body.map((t: { slug: string }) => t.slug)).toEqual(["meesho", "new-co"]);
    expect(res.body[0]).toEqual({ id: expect.any(String), name: "Meesho", slug: "meesho", website: "https://meesho.com", aliases: ["Fashnear"] });
  });

  it("requires the internal key", async () => {
    expect((await env.http.get("/api/v1/internal/research-targets")).status).toBe(401);
  });
});
