import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { status } from "../support/fakeFetch.js";
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

  it("loads the starter catalogue: {companies, inserted, backfilled, removed, total}; removes non-MVP rows; never triggers ingestion", async () => {
    // non-MVP rows that the seed must hard-delete (1 role config + 1 JD + 1 company = 3)
    await seedCompany(env, "acme", "Acme");
    await seedRoleConfig(env, { company: "acme" });
    await seedJd(env, { company: "acme" });

    const res = await env.http.post(`${BASE}/seed`).set("Authorization", admin);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(["backfilled", "companies", "inserted", "removed", "total"]);
    expect(res.body).toEqual({ companies: 1, inserted: 1, backfilled: 0, removed: 3, total: 3 });
    expect(aiCalls(env)).toHaveLength(0);

    const list = await env.http.get(BASE).set("Authorization", admin);
    expect(list.body.map((c: { company: string }) => c.company)).toEqual(["meesho"]);
    expect(list.body[0].jds).toHaveLength(3);
    const companies = await env.http.get("/api/v1/companies").set("Authorization", admin);
    expect(companies.body.map((c: { slug: string }) => c.slug)).toEqual(["meesho"]);
  });

  it("is idempotent: a re-run inserts nothing and refreshes the same JDs", async () => {
    const res = await env.http.post(`${BASE}/seed`).set("Authorization", admin);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ companies: 0, inserted: 0, backfilled: 0, removed: 0, total: 3 });
    const list = await env.http.get(BASE).set("Authorization", admin);
    expect(list.body[0].jds).toHaveLength(3);
  });

  it("ADMIN-only", async () => {
    const user = await bearer(env, await createUser(env));
    expect((await env.http.post(`${BASE}/seed`).set("Authorization", user)).status).toBe(403);
    expect((await env.http.post(`${BASE}/seed`)).status).toBe(401);
  });
});

describe("catalogue CRUD", () => {
  let env: TestEnv;
  let admin: string;
  beforeAll(async () => {
    env = await createTestEnv();
    admin = await bearer(env, await createUser(env, { role: "ADMIN" }));
  });
  afterAll(() => env.close());
  beforeEach(() => env.fetch.reset());

  it("POST 201: slugifies, defaults role/specialization, trims, and triggers ingestion", async () => {
    env.fetch.on("POST", `${AI}/admin/scrape/run`, { run_id: "r", status: "running" });
    const res = await env.http
      .post(BASE)
      .set("Authorization", admin)
      .send({
        company: "  Big   Co ",
        jds: [
          { title: "  SDE 1  ", level: " SDE1 " },
          {
            title: "Backend Engineer",
            level: "sde2",
            role: " Backend Engineer ",
            specialization: " Backend ",
            jdUrl: " https://big.co/jobs/1 ",
            description: "  Build APIs.  ",
          },
        ],
      });
    expect(res.status).toBe(201);
    expect(Object.keys(res.body).sort()).toEqual(["company", "ingestion_triggered", "jds"]);
    expect(res.body.company).toBe("big-co");
    expect(res.body.ingestion_triggered).toBe(true);
    expect(res.body.jds).toEqual([
      {
        id: expect.stringMatching(UUID_RE),
        role: "software-engineer",
        level: "sde1",
        specialization: "general",
        title: "SDE 1",
        jdUrl: null,
        description: null,
        enabled: true,
      },
      {
        id: expect.stringMatching(UUID_RE),
        role: "backend-engineer",
        level: "sde2",
        specialization: "backend",
        title: "Backend Engineer",
        jdUrl: "https://big.co/jobs/1",
        description: "Build APIs.",
        enabled: true,
      },
    ]);
    expect(aiCalls(env).map((c) => `${c.method} ${c.url}`)).toEqual([`POST ${AI}/admin/scrape/run`]);

    // persisted as active JDs, visible to students
    const jd = await env.c.repos.jds.findById(res.body.jds[1].id);
    expect(jd).toMatchObject({ company: "big-co", role: "backend-engineer", source: "seed", active: true, sourceUrl: "https://big.co/jobs/1" });
  });

  it("POST 201 with ingestion_triggered=false when the AI service is down (JDs still saved)", async () => {
    env.fetch.on("POST", `${AI}/admin/scrape/run`, () => status(503));
    const res = await env.http.post(BASE).set("Authorization", admin).send({ company: "Down Co", jds: [{ title: "SDE", level: "fresher" }] });
    expect(res.status).toBe(201);
    expect(res.body.ingestion_triggered).toBe(false);
    expect(res.body.company).toBe("down-co");
    expect(await env.c.repos.jds.findById(res.body.jds[0].id)).not.toBeNull();
  });

  it.each([
    ["invalid_company", "no company", { jds: [{ title: "SDE", level: "sde1" }] }],
    ["invalid_company", "a blank company", { company: "   ", jds: [{ title: "SDE", level: "sde1" }] }],
    ["invalid_company", "no jds", { company: "X" }],
    ["invalid_company", "an empty jds list", { company: "X", jds: [] }],
    ["invalid_company", "an empty body", {}],
    ["invalid_jd", "a JD without a title", { company: "X", jds: [{ level: "sde1" }] }],
    ["invalid_jd", "a JD with a blank level", { company: "X", jds: [{ title: "SDE", level: " " }] }],
    ["invalid_jd", "a null JD entry", { company: "X", jds: [null] }],
    ["invalid_level", "an unknown level", { company: "X", jds: [{ title: "SDE", level: "principal" }] }],
  ])("400 %s for %s (no ingestion)", async (code, _label, body) => {
    const res = await env.http.post(BASE).set("Authorization", admin).send(body);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe(code);
    expect(typeof res.body.message).toBe("string");
    expect(aiCalls(env)).toHaveLength(0);
  });

  it("the invalid_* messages match the Java controller", async () => {
    const a = await env.http.post(BASE).set("Authorization", admin).send({});
    expect(a.body.message).toBe("company and at least one JD are required");
    const b = await env.http.post(BASE).set("Authorization", admin).send({ company: "X", jds: [{}] });
    expect(b.body.message).toBe("each JD needs a title and a level");
    const c = await env.http.post(BASE).set("Authorization", admin).send({ company: "X", jds: [{ title: "t", level: "l9" }] });
    expect(c.body.message).toMatch(/^level must be one of \[.*\]$/);
    for (const level of ["fresher", "sde1", "sde2", "sde3"]) expect(c.body.message).toContain(level);
  });

  it("GET lists active JDs grouped by company (company asc)", async () => {
    await seedJd(env, { company: "zz-listco", level: "sde1", title: "B", specialization: "backend", sourceUrl: "https://zz/1", description: "d" });
    await seedJd(env, { company: "zz-listco", level: "fresher", title: "A", specialization: null });
    await seedJd(env, { company: "zz-listco", level: "sde3", title: "Hidden", active: false });
    const res = await env.http.get(BASE).set("Authorization", admin);
    expect(res.status).toBe(200);
    const companies = res.body.map((c: { company: string }) => c.company);
    expect(companies).toEqual([...companies].sort());
    const group = res.body.find((c: { company: string }) => c.company === "zz-listco");
    expect(Object.keys(group).sort()).toEqual(["company", "jds"]);
    expect(group.jds).toEqual([
      { id: expect.stringMatching(UUID_RE), role: "software-engineer", level: "fresher", specialization: null, title: "A", jdUrl: null, description: "Build things", enabled: true },
      { id: expect.stringMatching(UUID_RE), role: "software-engineer", level: "sde1", specialization: "backend", title: "B", jdUrl: "https://zz/1", description: "d", enabled: true },
    ]);
  });

  it("DELETE /:company → 204; removes its JDs and company row (path is slugified)", async () => {
    env.fetch.on("POST", `${AI}/admin/scrape/run`, {});
    const created = await env.http.post(BASE).set("Authorization", admin).send({ company: "Gone Co", jds: [{ title: "SDE", level: "sde1" }] });
    await seedCompany(env, "gone-co", "Gone Co");

    const res = await env.http.delete(`${BASE}/${encodeURIComponent(" Gone Co ")}`).set("Authorization", admin);
    expect(res.status).toBe(204);
    expect(res.text).toBe("");
    expect(await env.c.repos.jds.findById(created.body.jds[0].id)).toBeNull();
    expect(await env.c.repos.companies.findBySlug("gone-co")).toBeNull();
    const list = await env.http.get(BASE).set("Authorization", admin);
    expect(list.body.map((c: { company: string }) => c.company)).not.toContain("gone-co");

    // deleting an unknown company is still 204
    expect((await env.http.delete(`${BASE}/never-existed`).set("Authorization", admin)).status).toBe(204);
  });

  it("ADMIN-only", async () => {
    const user = await bearer(env, await createUser(env));
    expect((await env.http.get(BASE).set("Authorization", user)).status).toBe(403);
    expect((await env.http.post(BASE).set("Authorization", user).send({ company: "X", jds: [{ title: "t", level: "sde1" }] })).status).toBe(403);
    expect((await env.http.delete(`${BASE}/x`).set("Authorization", user)).status).toBe(403);
    expect(aiCalls(env)).toHaveLength(0);
  });
});
