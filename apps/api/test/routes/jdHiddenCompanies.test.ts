import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { JobDescriptionRow } from "../../src/db/pg/schema.js";
import { bearer, createUser, createTestEnv, type TestEnv } from "../support/harness.js";
import { seedCompany, seedJd } from "./helpers.js";

/** Students never see JDs of hidden companies (unpublished or archived); JDs with no company row stay visible. */

let env: TestEnv;
let authz: string;
let pub: JobDescriptionRow;
let unpub: JobDescriptionRow;
let arch: JobDescriptionRow;
let legacy: JobDescriptionRow;

beforeAll(async () => {
  env = await createTestEnv();
  authz = await bearer(env, await createUser(env));
  await seedCompany(env, "pubco", "Pub Co");
  await seedCompany(env, "unpubco", "Unpub Co", { publishedAt: null });
  await seedCompany(env, "archco", "Arch Co", { status: "archived" });
  pub = await seedJd(env, { company: "pubco" });
  unpub = await seedJd(env, { company: "unpubco" });
  arch = await seedJd(env, { company: "archco" });
  legacy = await seedJd(env, { company: "legacyco" });
});
afterAll(() => env.close());
beforeEach(() => env.fetch.reset());

describe("hidden companies' JDs", () => {
  it("GET /jds omits unpublished and archived companies' JDs, keeps published and company-less ones", async () => {
    const res = await env.http.get("/api/v1/jds").set("Authorization", authz);
    expect(res.status).toBe(200);
    const ids = res.body.map((j: { id: string }) => j.id);
    expect(ids).toContain(pub.id);
    expect(ids).toContain(legacy.id);
    expect(ids).not.toContain(unpub.id);
    expect(ids).not.toContain(arch.id);
  });

  it("GET /jds/:id 404s jd_not_found for hidden companies, 200 otherwise", async () => {
    for (const hidden of [unpub, arch]) {
      const res = await env.http.get(`/api/v1/jds/${hidden.id}`).set("Authorization", authz);
      expect(res.status).toBe(404);
      expect(res.body.code).toBe("jd_not_found");
    }
    expect((await env.http.get(`/api/v1/jds/${pub.id}`).set("Authorization", authz)).status).toBe(200);
    expect((await env.http.get(`/api/v1/jds/${legacy.id}`).set("Authorization", authz)).status).toBe(200);
  });
});
