import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { JobDescriptionRow } from "../../src/db/pg/schema.js";
import { json } from "../support/fakeFetch.js";
import { bearer, createUser, createTestEnv, TEST_INTERNAL_KEY, type TestEnv } from "../support/harness.js";
import { AI, aiCalls, seedCompany, seedJd } from "./helpers.js";

/**
 * Student-facing JD library (/api/v1/jds) — no Java controller test existed. Asserts JdController's
 * contract: list filters + dataAvailability derived from the AI service's /briefs summaries, and the
 * detail embedding the brief's consolidated_process.
 */

let env: TestEnv;
let authz: string;
let m1: JobDescriptionRow; // meesho fresher backend  (high → rich)
let m2: JobDescriptionRow; // meesho fresher android  (medium → available)
let m3: JobDescriptionRow; // meesho sde1 data-eng    (low → limited)
let a1: JobDescriptionRow; // acme sde2, no specialization, no brief (none)
let z1: JobDescriptionRow; // zeta — no companies row; unknown confidence (none)
let old: JobDescriptionRow; // inactive

const t = (n: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, n));

beforeAll(async () => {
  env = await createTestEnv();
  authz = await bearer(env, await createUser(env));
  await seedCompany(env, "meesho", "Meesho");
  await seedCompany(env, "acme", "Acme Corp");
  m1 = await seedJd(env, {
    company: "meesho",
    level: "fresher",
    specialization: "backend",
    title: "SDE I — Backend",
    description: "Build backend services.",
    techStack: "Java, Go ,, Spring Boot ",
    sourceUrl: "https://www.meesho.io/jobs",
    createdAt: t(1),
  });
  m2 = await seedJd(env, { company: "meesho", level: "fresher", specialization: "android", title: "SDE I — Android", createdAt: t(2) });
  m3 = await seedJd(env, { company: "meesho", level: "sde1", specialization: "data-engineering", title: "Data Engineer I", createdAt: t(3) });
  a1 = await seedJd(env, { company: "acme", level: "sde2", specialization: null, title: "SDE 2", techStack: null, createdAt: t(4) });
  z1 = await seedJd(env, { company: "zeta", level: "fresher", specialization: "backend", title: "Zeta SDE", createdAt: t(5) });
  old = await seedJd(env, { company: "meesho", level: "fresher", specialization: "backend", title: "Old JD", active: false, createdAt: t(0) });
});
afterAll(() => env.close());
beforeEach(() => env.fetch.reset());

const SUMMARIES = {
  briefs: [
    { company: "meesho", role: "software-engineer", level: "fresher", specialization: "backend", data_confidence: "high", generation_status: "done" },
    { company: "meesho", role: "software-engineer", level: "fresher", specialization: "android", data_confidence: "medium" },
    { company: "meesho", role: "software-engineer", level: "sde1", specialization: "data-engineering", data_confidence: "low" },
    { company: "zeta", role: "software-engineer", level: "fresher", specialization: "backend", data_confidence: "experimental" },
  ],
};

const SUMMARY_KEYS = [
  "company", "companyName", "ctcMaxLpa", "ctcMinLpa", "dataAvailability", "dataConfidence", "id", "level", "role",
  "specialization", "techStack", "title", "yoeMax", "yoeMin",
];

const ids = (body: { id: string }[]) => body.map((j) => j.id);

describe("GET /jds", () => {
  it("lists active JDs (company asc, level asc) with companyName and dataAvailability from /briefs", async () => {
    env.fetch.on("GET", `${AI}/briefs`, SUMMARIES);
    const res = await env.http.get("/api/v1/jds").set("Authorization", authz);
    expect(res.status).toBe(200);
    expect(ids(res.body)).toEqual([a1.id, m1.id, m2.id, m3.id, z1.id]);
    expect(ids(res.body)).not.toContain(old.id);
    for (const j of res.body) expect(Object.keys(j).sort()).toEqual(SUMMARY_KEYS);

    expect(res.body[0]).toEqual({
      id: a1.id,
      company: "acme",
      companyName: "Acme Corp",
      role: "software-engineer",
      level: "sde2",
      title: "SDE 2",
      specialization: null,
      techStack: [],
      yoeMin: null,
      yoeMax: null,
      ctcMinLpa: null,
      ctcMaxLpa: null,
      dataConfidence: null,
      dataAvailability: "none",
    });
    expect(res.body[1]).toEqual({
      id: m1.id,
      company: "meesho",
      companyName: "Meesho",
      role: "software-engineer",
      level: "fresher",
      title: "SDE I — Backend",
      specialization: "backend",
      techStack: ["Java", "Go", "Spring Boot"],
      yoeMin: null,
      yoeMax: null,
      ctcMinLpa: null,
      ctcMaxLpa: null,
      dataConfidence: "high",
      dataAvailability: "rich",
    });
    expect(res.body[2]).toMatchObject({ dataConfidence: "medium", dataAvailability: "available" });
    expect(res.body[3]).toMatchObject({ dataConfidence: "low", dataAvailability: "limited" });
    // unknown confidence passes through but is not "available"; no companies row → slug as name
    expect(res.body[4]).toMatchObject({ companyName: "zeta", dataConfidence: "experimental", dataAvailability: "none" });

    const [call] = aiCalls(env);
    expect(call?.url).toBe(`${AI}/briefs`);
    expect(call?.headers["x-internal-api-key"]).toBe(TEST_INTERNAL_KEY);
  });

  it.each([
    ["company (case-insensitive)", "?company=MEESHO", () => [m1, m2, m3]],
    ["level", "?level=Fresher", () => [m1, m2, z1]],
    ["specialization (null specialization never matches)", "?specialization=BACKEND", () => [m1, z1]],
    ["all three", "?company=meesho&level=fresher&specialization=android", () => [m2]],
    ["an unknown company", "?company=nobody", () => []],
  ])("filters by %s", async (_label, qs, expected) => {
    env.fetch.on("GET", `${AI}/briefs`, SUMMARIES);
    const res = await env.http.get(`/api/v1/jds${qs}`).set("Authorization", authz);
    expect(res.status).toBe(200);
    expect(ids(res.body)).toEqual(expected().map((j) => j.id));
  });

  it("a degraded AI service never breaks the list — every JD is 'none'", async () => {
    // no route → transport failure
    const res = await env.http.get("/api/v1/jds").set("Authorization", authz);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(5);
    for (const j of res.body) {
      expect(j.dataConfidence).toBeNull();
      expect(j.dataAvailability).toBe("none");
    }
  });

  it("an upstream 5xx on /briefs is also tolerated", async () => {
    env.fetch.on("GET", `${AI}/briefs`, () => json({ detail: "down" }, 500));
    const res = await env.http.get("/api/v1/jds").set("Authorization", authz);
    expect(res.status).toBe(200);
    expect(res.body.every((j: { dataAvailability: string }) => j.dataAvailability === "none")).toBe(true);
  });

  it("requires a JWT (any role)", async () => {
    expect((await env.http.get("/api/v1/jds")).status).toBe(401);
  });
});

describe("GET /jds/:id", () => {
  const DETAIL_KEYS = [
    "company",
    "companyName",
    "ctcMaxLpa",
    "ctcMinLpa",
    "dataAvailability",
    "dataConfidence",
    "description",
    "id",
    "interviewProcess",
    "level",
    "role",
    "sourceUrl",
    "sources",
    "specialization",
    "techStack",
    "title",
    "yoeMax",
    "yoeMin",
  ];

  it("embeds the brief's consolidated_process, confidence and sources", async () => {
    const process = { rounds: [{ name: "Online assessment", topics: ["arrays"] }, { name: "DSA" }], notes: "2 weeks end to end" };
    env.fetch.on("GET", `${AI}/briefs/meesho/software-engineer/fresher/backend`, {
      company: "meesho",
      consolidated_process: process,
      data_confidence: "high",
      sources: ["glassdoor", "leetcode-discuss", 7],
      experiences_by_source: { glassdoor: [] },
    });
    const res = await env.http.get(`/api/v1/jds/${m1.id}`).set("Authorization", authz);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(DETAIL_KEYS);
    expect(res.body).toEqual({
      id: m1.id,
      company: "meesho",
      companyName: "Meesho",
      role: "software-engineer",
      level: "fresher",
      title: "SDE I — Backend",
      specialization: "backend",
      description: "Build backend services.",
      techStack: ["Java", "Go", "Spring Boot"],
      sourceUrl: "https://www.meesho.io/jobs",
      yoeMin: null,
      yoeMax: null,
      ctcMinLpa: null,
      ctcMaxLpa: null,
      dataConfidence: "high",
      dataAvailability: "rich",
      interviewProcess: process,
      sources: ["glassdoor", "leetcode-discuss", "7"],
    });
    expect(aiCalls(env)[0]?.url).toBe(`${AI}/briefs/meesho/software-engineer/fresher/backend`);
  });

  it("prefers the current pipeline's final_experience and never exposes its internal diagnostics", async () => {
    const rounds = [{ round_number: 1, type: "dsa", topics: ["arrays"], support_count: 3, source_count_total: 5 }];
    env.fetch.on("GET", `${AI}/briefs/meesho/software-engineer/fresher/backend`, {
      data_confidence: "high",
      final_experience: {
        rounds,
        dominant_topics: ["arrays"],
        interviewer_style_notes: "Collaborative",
        red_flags: ["Silent thinking"],
        data_confidence: "high",
        template_used: false,
        source_funnel: [{ url: "https://x.test", thought: "model reasoning" }],
        aggregate_thought: "model reasoning",
      },
      consolidated_process: { rounds: [{ name: "stale" }] },
      sources: [],
    });
    const res = await env.http.get(`/api/v1/jds/${m1.id}`).set("Authorization", authz);
    expect(res.status).toBe(200);
    expect(res.body.interviewProcess).toEqual({
      rounds,
      dominant_topics: ["arrays"],
      interviewer_style_notes: "Collaborative",
      red_flags: ["Silent thinking"],
      data_confidence: "high",
      template_used: false,
    });
    expect(JSON.stringify(res.body)).not.toMatch(/model reasoning|source_funnel|aggregate_thought/);
  });

  it("a brief without consolidated_process → interviewProcess null", async () => {
    env.fetch.on("GET", `${AI}/briefs/meesho/software-engineer/fresher/android`, { data_confidence: "medium", consolidated_process: null });
    const res = await env.http.get(`/api/v1/jds/${m2.id}`).set("Authorization", authz);
    expect(res.status).toBe(200);
    expect(res.body.interviewProcess).toBeNull();
    expect(res.body.dataConfidence).toBe("medium");
    expect(res.body.dataAvailability).toBe("available");
    expect(res.body.sources).toEqual([]);
  });

  it("no brief yet (upstream 404) → no process, 'none'; missing techStack → []", async () => {
    env.fetch.on("GET", `${AI}/briefs/`, () => json({ detail: "not found" }, 404));
    const res = await env.http.get(`/api/v1/jds/${a1.id}`).set("Authorization", authz);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      companyName: "Acme Corp",
      specialization: null,
      techStack: [],
      dataConfidence: null,
      dataAvailability: "none",
      interviewProcess: null,
      sources: [],
    });
  });

  it("a degraded AI service still returns the JD; companyName falls back to the slug", async () => {
    const res = await env.http.get(`/api/v1/jds/${z1.id}`).set("Authorization", authz);
    expect(res.status).toBe(200);
    expect(res.body.companyName).toBe("zeta");
    expect(res.body.interviewProcess).toBeNull();
    expect(res.body.dataAvailability).toBe("none");
  });

  it("the detail does not filter on active", async () => {
    env.fetch.on("GET", `${AI}/briefs/`, () => json({}, 404));
    const res = await env.http.get(`/api/v1/jds/${old.id}`).set("Authorization", authz);
    expect(res.status).toBe(200);
    expect(res.body.title).toBe("Old JD");
  });

  it("an unknown id is 404 jd_not_found (AI service not called)", async () => {
    const res = await env.http.get(`/api/v1/jds/${randomUUID()}`).set("Authorization", authz);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ code: "jd_not_found", message: "no JD with that id" });
    expect(aiCalls(env)).toHaveLength(0);
  });

  it("a malformed id is 400", async () => {
    const res = await env.http.get("/api/v1/jds/not-a-uuid").set("Authorization", authz);
    expect(res.status).toBe(400);
    expect(typeof res.body.code).toBe("string");
  });

  it("requires a JWT", async () => {
    expect((await env.http.get(`/api/v1/jds/${m1.id}`)).status).toBe(401);
  });
});
