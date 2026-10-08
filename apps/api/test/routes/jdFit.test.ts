import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { JobDescriptionRow } from "../../src/db/pg/schema.js";
import { bearer, createUser, createTestEnv, type TestEnv } from "../support/harness.js";
import { AI, seedCompany, seedJd } from "./helpers.js";

/**
 * JD fit (/api/v1/jd-fit): the signed-in user's match per role card, for exactly the JDs /jds lists,
 * and a part-by-part breakdown for one JD. Rules only: nothing is stored and no LLM is called.
 */

let env: TestEnv;
let userId: string;
let authz: string;
let emptyAuthz: string;
let p1: JobDescriptionRow; // payco fresher backend, fintech
let p2: JobDescriptionRow; // payco sde3 backend: a stretch for a fresher
let a1: JobDescriptionRow; // acme (generic sector), no specialization or stack
let h1: JobDescriptionRow; // unpublished company

const UPI_PROJECT = { name: "UPI split-pay service", description: "Split bills between friends over UPI payments.", tech: ["Java", "Spring Boot"], bullets: ["Built REST APIs"], link: null };
const BRIEF = `${AI}/briefs/payco/software-engineer/fresher/backend`;

beforeAll(async () => {
  env = await createTestEnv();
  const user = await createUser(env);
  userId = user.id;
  authz = await bearer(env, user);
  emptyAuthz = await bearer(env, await createUser(env, { email: "empty@example.com" }));
  await seedCompany(env, "payco", "PayCo", { sector: "fintech" });
  await seedCompany(env, "acme", "Acme", { sector: "it-services" });
  await seedCompany(env, "hidden", "Hidden", { publishedAt: null });
  p1 = await seedJd(env, { company: "payco", level: "fresher", specialization: "backend", title: "SDE I Backend", techStack: "Java, Spring Boot, MySQL", yoeMin: "0", yoeMax: "1" });
  p2 = await seedJd(env, { company: "payco", level: "sde3", specialization: "backend", title: "Senior Backend", techStack: "Java" });
  a1 = await seedJd(env, { company: "acme", level: "fresher", specialization: null, title: "Acme SDE", techStack: null });
  h1 = await seedJd(env, { company: "hidden", level: "fresher", title: "Hidden SDE" });
  await env.c.repos.candidateProfiles.save({
    userId, fullName: "Asha", email: null, phone: null, location: null, headline: null, targetRole: null, targetJdId: null, level: "fresher",
    education: [], experience: [], projects: [UPI_PROJECT], skills: ["MySQL"], achievements: [],
    detectedLinks: { github: null, leetcode: null, linkedin: null }, resumeFilename: null, resumeParsedAt: null,
  });
  await env.c.repos.fragments.insert({ userId, source: "LEETCODE", data: { byTopic: [{ topic: "Dynamic Programming", count: 9 }] }, contentHash: "h", version: 1, fetchedAt: new Date() });
});
afterAll(() => env.close());
beforeEach(() => env.fetch.reset());

const ids = (rows: { id?: string; jdId?: string }[]) => rows.map((r) => r.id ?? r.jdId);

describe("GET /jd-fit", () => {
  it("requires sign-in", async () => {
    expect((await env.http.get("/api/v1/jd-fit")).status).toBe(401);
    expect((await env.http.get(`/api/v1/jd-fit/${p1.id}`)).status).toBe(401);
  });

  it.each([["", ""], ["company", "?company=PAYCO"], ["level", "?level=fresher"], ["specialization", "?specialization=backend"]])(
    "scores exactly the JDs /jds lists (%s filter)",
    async (_label, qs) => {
      const [jds, fit] = await Promise.all([
        env.http.get(`/api/v1/jds${qs}`).set("Authorization", authz),
        env.http.get(`/api/v1/jd-fit${qs}`).set("Authorization", authz),
      ]);
      expect(fit.status).toBe(200);
      expect(ids(fit.body.results)).toEqual(ids(jds.body));
      expect(ids(fit.body.results)).not.toContain(h1.id);
    },
  );

  it("returns a score and level gap per role, capping a stretch role", async () => {
    const res = await env.http.get("/api/v1/jd-fit?company=payco").set("Authorization", authz);
    expect(res.body).toMatchObject({ configVersion: "jd-fit-v1", userLevel: "fresher" });
    const byId = new Map(res.body.results.map((r: { jdId: string }) => [r.jdId, r]));
    expect(byId.get(p1.id)).toMatchObject({ levelGap: "none", cap: null, levelFactor: null });
    expect((byId.get(p1.id) as { score: number }).score).toBeGreaterThan(0);
    expect(byId.get(p2.id)).toMatchObject({ levelGap: "stretch", cap: 40 });
    expect((byId.get(p2.id) as { score: number }).score).toBeLessThanOrEqual(40);
  });

  it("rejects an unknown level", async () => {
    const res = await env.http.get("/api/v1/jd-fit?level=senior").set("Authorization", authz);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("invalid_level");
  });

  it("a degraded AI service only drops round topics", async () => {
    // No route: every brief read fails.
    const res = await env.http.get("/api/v1/jd-fit").set("Authorization", authz);
    expect(res.status).toBe(200);
    expect(ids(res.body.results)).toContain(a1.id);
  });
});

describe("GET /jd-fit/{jdId}", () => {
  it("explains every part with evidence, scoring round topics from the JD's brief", async () => {
    env.fetch.on("GET", BRIEF, { final_experience: { rounds: [{ type: "dsa", topics: ["Dynamic Programming", "System design"], difficulty: "medium" }] } });
    const res = await env.http.get(`/api/v1/jd-fit/${p1.id}`).set("Authorization", authz);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ jdId: p1.id, levelGap: "none", cap: null, userLevel: "fresher", jdLevel: "fresher", configVersion: "jd-fit-v1" });
    const part = (key: string) => res.body.parts.find((p: { key: string }) => p.key === key);
    expect(part("domain")).toMatchObject({ status: "scored", value: 0.6 });
    expect(part("domain").evidence[0]).toMatchObject({ source: "resume", item: "UPI split-pay service", tag: "fintech" });
    expect(part("role")).toMatchObject({ status: "scored", value: 0.6 });
    expect(part("skills").value).toBeCloseTo((1 + 1 + 0.5) / 3, 3);
    expect(part("experience")).toMatchObject({ status: "scored", value: 1 });
    expect(part("round_topics")).toMatchObject({ status: "scored", value: 0.45 });
    expect(part("round_topics").evidence[0]).toMatchObject({ source: "leetcode", matched: "9/20 solved" });
    const expected = Math.round(res.body.parts.reduce((s: number, p: { weight: number; value: number }) => s + p.weight * p.value, 0));
    expect(res.body.score).toBe(expected);
  });

  it("an empty profile is a 0-ish score with hints, never an error", async () => {
    const res = await env.http.get(`/api/v1/jd-fit/${p1.id}`).set("Authorization", emptyAuthz);
    expect(res.status).toBe(200);
    const statuses = Object.fromEntries(res.body.parts.map((p: { key: string; status: string }) => [p.key, p.status]));
    expect(statuses).toEqual({ skills: "missing", domain: "missing", role: "missing", experience: "scored", round_topics: "dropped" });
    // Only experience (10) scores, out of the 65 weight left once round topics are dropped.
    expect(res.body.score).toBe(Math.round((100 * 10) / 65));
    expect(res.body.levelGap).toBe("unknown");
  });

  it("counts a job at a catalogue company toward its sector", async () => {
    const worker = await createUser(env, { email: "worker@example.com" });
    await env.c.repos.candidateProfiles.save({
      userId: worker.id, fullName: "Ravi", email: null, phone: null, location: null, headline: null, targetRole: null, targetJdId: null, level: "fresher",
      education: [], projects: [], skills: [], achievements: [],
      experience: [{ company: "PayCo Pvt Ltd", title: "Software Engineer", startDate: "2025-01", endDate: "present", location: null, bullets: ["Built internal tools"] }],
      detectedLinks: { github: null, leetcode: null, linkedin: null }, resumeFilename: null, resumeParsedAt: null,
    });
    const res = await env.http.get(`/api/v1/jd-fit/${p1.id}`).set("Authorization", await bearer(env, worker));
    expect(res.body.parts.find((p: { key: string }) => p.key === "domain")).toMatchObject({ status: "scored", value: 1, evidence: [expect.objectContaining({ matched: "PayCo (catalogue: fintech)" })] });
  });

  it("drops what a JD lacks and says why", async () => {
    const res = await env.http.get(`/api/v1/jd-fit/${a1.id}`).set("Authorization", authz);
    const reasons = Object.fromEntries(res.body.parts.filter((p: { status: string }) => p.status === "dropped").map((p: { key: string; reason: string }) => [p.key, p.reason]));
    expect(Object.keys(reasons).sort()).toEqual(["domain", "round_topics", "skills"]);
    // No specialization: a generalist role, so the UPI project's backend work counts.
    expect(res.body.parts.find((p: { key: string }) => p.key === "role")).toMatchObject({ status: "scored", value: 0.6 });
    expect(reasons.domain).toMatch(/general/);
  });

  it("404s exactly where /jds/{id} does", async () => {
    expect((await env.http.get(`/api/v1/jd-fit/${randomUUID()}`).set("Authorization", authz)).status).toBe(404);
    expect((await env.http.get(`/api/v1/jd-fit/${h1.id}`).set("Authorization", authz)).status).toBe(404);
    expect((await env.http.get("/api/v1/jd-fit/not-a-uuid").set("Authorization", authz)).status).toBe(400);
  });
});
