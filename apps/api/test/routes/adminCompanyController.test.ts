import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { bearer, createUser, createTestEnv, type TestEnv } from "../support/harness.js";
import { AI, aiCalls, seedCompany, seedJd, seedRoleConfig } from "./helpers.js";

/**
 * Admin catalogue management (/api/v1/admin/companies) — no Java controller test existed. Asserts
 * AdminCompanyController's contract: seed result shape, create validation codes, 201 with
 * ingestion_triggered, list grouping and 204 delete.
 */

const BASE = "/api/v1/admin/companies";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("POST /admin/companies/seed", () => {
  let env: TestEnv;
  let admin: string;
  beforeAll(async () => {
    env = await createTestEnv();
    admin = await bearer(env, await createUser(env, { role: "ADMIN" }));
  });
  afterAll(() => env.close());

  it("loads the starter catalogue: {companies, inserted, backfilled, total}; never deletes other companies; never triggers ingestion", async () => {
    await seedCompany(env, "acme", "Acme");
    await seedRoleConfig(env, { company: "acme" });
    await seedJd(env, { company: "acme" });

    const res = await env.http.post(`${BASE}/seed`).set("Authorization", admin);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(["backfilled", "companies", "inserted", "total"]);
    expect(res.body).toEqual({ companies: 1, inserted: 1, backfilled: 0, total: 3 });
    expect(aiCalls(env)).toHaveLength(0);

    const companies = await env.http.get("/api/v1/companies").set("Authorization", admin);
    expect(companies.body.map((c: { slug: string }) => c.slug).sort()).toEqual(["acme", "meesho"]);
    expect((await env.c.repos.jds.findAllActiveOrdered()).filter((j) => j.company === "acme")).toHaveLength(1);
  });

  it("is idempotent: a re-run inserts nothing and refreshes the same JDs", async () => {
    const res = await env.http.post(`${BASE}/seed`).set("Authorization", admin);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ companies: 0, inserted: 0, backfilled: 0, total: 3 });
  });

  it("ADMIN-only", async () => {
    const user = await bearer(env, await createUser(env));
    expect((await env.http.post(`${BASE}/seed`).set("Authorization", user)).status).toBe(403);
    expect((await env.http.post(`${BASE}/seed`)).status).toBe(401);
  });
});

describe("company CRUD", () => {
  let env: TestEnv;
  let admin: string;
  beforeAll(async () => {
    env = await createTestEnv();
    admin = await bearer(env, await createUser(env, { role: "ADMIN" }));
  });
  afterAll(() => env.close());
  beforeEach(() => env.fetch.reset());

  it("POST 201: slugs the name, normalises website + aliases, starts unpublished, triggers nothing", async () => {
    const res = await env.http
      .post(BASE)
      .set("Authorization", admin)
      .send({ name: "  Tata   Consultancy Services (TCS) ", website: "tcs.com", aliases: [" TCS ", "tcs", "Tata CS"] });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      name: "Tata Consultancy Services (TCS)",
      slug: "tata-consultancy-services-tcs",
      website: "https://tcs.com",
      aliases: ["TCS", "Tata CS"],
      status: "active",
      origin: "admin",
      publishedAt: null,
      publishedVersion: null,
      research: null,
    });
    expect(res.body.id).toMatch(UUID_RE);
    expect(aiCalls(env)).toHaveLength(0);
    const student = await env.http.get("/api/v1/companies").set("Authorization", admin);
    expect(student.body.map((c: { slug: string }) => c.slug)).not.toContain("tata-consultancy-services-tcs");
  });

  it("POST validation: 400 codes and 409 on a duplicate slug", async () => {
    const post = (body: unknown) => env.http.post(BASE).set("Authorization", admin).send(body as object);
    expect((await post({ name: "  " })).body.code).toBe("invalid_company");
    expect((await post({ name: "!!!" })).body.code).toBe("invalid_company");
    expect((await post({ name: "Acme", website: "not a url" })).body.code).toBe("invalid_website");
    expect((await post({ name: "Acme", website: "ftp://acme.com" })).body.code).toBe("invalid_website");
    expect((await post({ name: "Acme", aliases: "Acme Inc" })).body.code).toBe("invalid_aliases");
    expect((await post({ name: "Acme", aliases: Array.from({ length: 11 }, (_, i) => `a${i}`) })).body.code).toBe("invalid_aliases");
    expect((await post({ name: "Zeta" })).status).toBe(201);
    const dup = await post({ name: "ZETA" });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe("company_exists");
  });

  it("GET merges each company's research state from the AI service", async () => {
    const created = await env.http.post(BASE).set("Authorization", admin).send({ name: "Groww" });
    env.fetch.on("GET", `${AI}/research/companies/state`, {
      states: [{ company_id: created.body.id, last_run_id: "r1", last_researched_at: "2026-10-02T10:00:00Z",
                 last_status: "done", latest_draft_id: "d1", latest_draft_status: "pending_review" }],
    });
    const res = await env.http.get(BASE).set("Authorization", admin);
    expect(res.status).toBe(200);
    expect(res.body.researchAvailable).toBe(true);
    const groww = res.body.companies.find((c: { slug: string }) => c.slug === "groww");
    expect(groww.research).toEqual({ lastRunId: "r1", lastResearchedAt: "2026-10-02T10:00:00Z", lastStatus: "done",
                                     latestDraftId: "d1", latestDraftStatus: "pending_review" });
    expect(aiCalls(env)[0]!.url).toContain(created.body.id);
  });

  it("GET still lists companies when the AI service is down (research null, researchAvailable false)", async () => {
    const res = await env.http.get(BASE).set("Authorization", admin);
    expect(res.status).toBe(200);
    expect(res.body.researchAvailable).toBe(false);
    expect(res.body.companies.every((c: { research: unknown }) => c.research === null)).toBe(true);
  });

  it("PATCH archives, renames without changing the slug, and 404s unknown ids", async () => {
    const created = await env.http.post(BASE).set("Authorization", admin).send({ name: "Swiggy" });
    const res = await env.http.patch(`${BASE}/${created.body.id}`).set("Authorization", admin)
      .send({ name: "Swiggy Ltd", status: "archived", website: null });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: "Swiggy Ltd", slug: "swiggy", status: "archived", website: null });
    expect((await env.http.patch(`${BASE}/${created.body.id}`).set("Authorization", admin).send({ status: "gone" })).body.code)
      .toBe("invalid_status");
    const missing = await env.http.patch(`${BASE}/00000000-0000-4000-8000-000000000000`).set("Authorization", admin).send({ name: "X" });
    expect(missing.status).toBe(404);
    expect(missing.body.code).toBe("company_not_found");
  });

  it("DELETE removes the company with its JDs and role configs", async () => {
    const created = await env.http.post(BASE).set("Authorization", admin).send({ name: "Delete Me" });
    await seedJd(env, { company: "delete-me" });
    await seedRoleConfig(env, { company: "delete-me" });
    const res = await env.http.delete(`${BASE}/${created.body.id}`).set("Authorization", admin);
    expect(res.status).toBe(204);
    expect(await env.c.repos.companies.findById(created.body.id)).toBeNull();
    expect((await env.c.repos.jds.findAllActiveOrdered()).some((j) => j.company === "delete-me")).toBe(false);
    expect(await env.c.repos.roleConfigs.findByCompanyAndRoleAndLevel("delete-me", "software-engineer", "sde1")).toBeNull();
    expect((await env.http.delete(`${BASE}/${created.body.id}`).set("Authorization", admin)).status).toBe(404);
  });

  it("ADMIN-only", async () => {
    const user = await bearer(env, await createUser(env));
    expect((await env.http.get(BASE).set("Authorization", user)).status).toBe(403);
    expect((await env.http.post(BASE).send({ name: "X" })).status).toBe(401);
  });
});
