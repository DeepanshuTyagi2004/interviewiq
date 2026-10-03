import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { EnrichmentDocument } from "../../src/domain/enrichment.js";
import { bearer, createTestEnv, createUser, type TestEnv } from "../support/harness.js";
import { AI, FUTURE_SLOT, seedJd, seedSession } from "./helpers.js";

function document(): EnrichmentDocument {
  return {
    company: { overview: "Builds useful tools", culture: "Collaborative", benefits: "Flexible hours", sourceUrls: ["https://acme.example/about"], verified: true },
    roles: [{
      id: randomUUID(), title: "Backend engineer", role: "software-engineer", level: "sde2", specialization: "backend",
      description: "Build APIs", techStack: ["TypeScript"], yoeMin: 2, yoeMax: 5, ctcMinLpa: 20, ctcMaxLpa: 30,
      sourceUrls: ["https://acme.example/careers"], verified: true,
      rounds: [{ id: randomUUID(), name: "Architecture", type: "system-design", durationMinutes: 60, difficulty: "hard",
        topics: ["Caching"], questions: ["Design a cache"], guidance: "Discuss trade-offs", sourceUrls: ["https://acme.example/interviews"], verified: true }],
    }],
  };
}

describe("verified manual company enrichment", () => {
  let env: TestEnv;
  let admin: string;
  let student: string;
  let actor: string;
  let companyId: string;
  let slug: string;
  const url = () => `/api/v1/admin/companies/${companyId}/enrichment`;
  const publish = (d: EnrichmentDocument, revision = 0) => env.http.post(`${url()}/publish`).set("Authorization", admin).send({ revision, document: d });
  beforeAll(async () => {
    env = await createTestEnv();
    const user = await createUser(env, { role: "ADMIN" });
    actor = user.id;
    admin = await bearer(env, user);
    student = await bearer(env, await createUser(env));
  });
  afterAll(() => env.close());
  beforeEach(async () => {
    env.fetch.reset();
    slug = `manual-${randomUUID()}`;
    companyId = (await env.c.repos.companies.create({ name: "Acme", slug, website: "https://acme.example" })).id;
  });

  it("blocks students and anonymous callers on read, save and publish", async () => {
    for (const method of ["get", "put", "post"] as const) {
      const path = method === "post" ? `${url()}/publish` : url();
      expect((await env.http[method](path).set("Authorization", student).send({ revision: 0, document: document() })).status).toBe(403);
      expect((await env.http[method](path)).status).toBe(401);
    }
  });

  it("falls back to company facts while AI is offline, saves incomplete drafts, reopens and CAS rejects stale saves", async () => {
    const initial = await env.http.get(url()).set("Authorization", admin);
    expect(initial.status).toBe(200);
    expect(initial.body).toMatchObject({ revision: 0, publishedRevision: null, publishedAt: null, verifiedBy: null, document: { roles: [] } });
    expect(initial.body.document.company.sourceUrls).toEqual(["https://acme.example"]);
    const d = document();
    d.company.verified = false;
    d.roles[0]!.title = "";
    d.roles[0]!.rounds = [];
    const saved = await env.http.put(url()).set("Authorization", admin).send({ revision: 0, document: d });
    expect(saved.status).toBe(200);
    expect(saved.body.revision).toBe(1);
    expect((await env.http.get(url()).set("Authorization", admin)).body).toEqual(saved.body);
    expect((await env.http.put(url()).set("Authorization", admin).send({ revision: 0, document: document() })).status).toBe(409);
    expect((await env.c.repos.companies.findById(companyId))!.publishedAt).toBeNull();
    expect(env.fetch.calls).toHaveLength(1); // Only the initial read attempts research.
  });

  it("publishes immediately and sends the identical verified process into actual prep, with durable IDs", async () => {
    const first = await publish(document());
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ revision: 1, publishedRevision: 1, verifiedBy: actor });
    const jdId = first.body.document.roles[0].jdId;
    const detail = await env.http.get(`/api/v1/jds/${jdId}`).set("Authorization", student);
    expect(detail.status).toBe(200);
    expect(detail.body.companyOverview.overview).toBe("Builds useful tools");
    expect(detail.body).toMatchObject({ yoeMin: 2, yoeMax: 5, ctcMinLpa: 20, ctcMaxLpa: 30 });
    expect(detail.body.interviewProcess.rounds[0]).toMatchObject({ round_number: 1, type: "system-design", duration_minutes: 60, problems: ["Design a cache"], format: "Discuss trade-offs" });
    const booking = await env.http.post("/api/v1/interviews/sessions").set("Authorization", student)
      .send({ jobDescriptionId: jdId, scheduledAt: FUTURE_SLOT, timezone: "Asia/Kolkata" });
    expect(booking.status).toBe(201);
    expect(booking.body.roundType).toBe("system-design");
    const session = (await env.c.repos.sessions.findById(booking.body.id))!;
    const request = await env.c.prep.assembleRequest(session);
    expect(request.companyBrief?.final_experience.rounds).toEqual(detail.body.interviewProcess.rounds);
    expect(request.companyBrief?.company_overview).toEqual(detail.body.companyOverview);
    const listed = await env.http.get(`/api/v1/jds?company=${slug}`).set("Authorization", student);
    expect(listed.body).toEqual([expect.objectContaining({ id: jdId, dataConfidence: "high", dataAvailability: "rich" })]);
    expect(env.fetch.calls).toHaveLength(0);

    const d = first.body.document as EnrichmentDocument;
    d.roles[0]!.title = "Senior backend engineer";
    const next = await publish(d, 1);
    expect(next.status).toBe(200);
    expect(next.body.document.roles[0].jdId).toBe(jdId);
    expect(next.body.publishedRevision).toBe(2);
    expect((await env.c.prep.assembleRequest(session)).companyBrief?.published_revision).toBe(2);
    expect((await env.c.repos.sessions.findById(session.id))!.status).toBe("SCHEDULED");
    env.fetch.on("POST", `${AI}/interview-plans/start`, { run_id: "manual-run" });
    env.fetch.on("GET", `${AI}/interview-plans/runs/manual-run`, { status: "completed", plan: { provenance: { planVersion: "manual-v2", inputHash: "verified" } } });
    await env.c.prep.generatePrep(session.id);
    expect((env.fetch.callsTo(`${AI}/interview-plans/start`)[0]!.json as { companyBrief: unknown }).companyBrief).toEqual(await env.c.enrichment.briefForJd(jdId));
    expect((await env.c.repos.sessions.findById(session.id))!.status).toBe("PREP_READY");
  });

  it.each([
    ["unverified company", (d: EnrichmentDocument) => { d.company.verified = false; }],
    ["missing company evidence", (d: EnrichmentDocument) => { d.company.sourceUrls = []; }],
    ["unverified role", (d: EnrichmentDocument) => { d.roles[0]!.verified = false; }],
    ["missing role evidence", (d: EnrichmentDocument) => { d.roles[0]!.sourceUrls = []; }],
    ["unverified round", (d: EnrichmentDocument) => { d.roles[0]!.rounds[0]!.verified = false; }],
    ["missing round evidence", (d: EnrichmentDocument) => { d.roles[0]!.rounds[0]!.sourceUrls = []; }],
    ["zero rounds", (d: EnrichmentDocument) => { d.roles[0]!.rounds = []; }],
    ["reversed experience", (d: EnrichmentDocument) => { d.roles[0]!.yoeMin = 8; }],
    ["reversed compensation", (d: EnrichmentDocument) => { d.roles[0]!.ctcMinLpa = 80; }],
    ["invalid URL", (d: EnrichmentDocument) => { d.roles[0]!.sourceUrls = ["javascript:alert(1)"]; }],
    ["credential URL", (d: EnrichmentDocument) => { d.company.sourceUrls = ["https://name:pass@acme.example"]; }],
    ["duplicate IDs", (d: EnrichmentDocument) => { d.roles[0]!.rounds[0]!.id = d.roles[0]!.id; }],
    ["duration bounds", (d: EnrichmentDocument) => { d.roles[0]!.rounds[0]!.durationMinutes = 500; }],
    ["too many rounds", (d: EnrichmentDocument) => { d.roles[0]!.rounds = Array.from({ length: 13 }, () => ({ ...d.roles[0]!.rounds[0]!, id: randomUUID() })); }],
  ])("rejects %s before any publication", async (_name, change) => {
    const d = document();
    change(d);
    const result = await publish(d);
    expect(result.status).toBe(400);
    expect(result.body.code).toBe("invalid_enrichment");
    expect((await env.c.repos.companies.findById(companyId))!.publishedAt).toBeNull();
    expect((await env.c.repos.jds.findAllActiveOrdered()).filter((j) => j.company === slug)).toHaveLength(0);
  });

  it("a draft after publication leaves the candidate snapshot unchanged; stale publish cannot mutate it", async () => {
    const published = await publish(document());
    const jdId = published.body.document.roles[0].jdId;
    const d = published.body.document as EnrichmentDocument;
    d.roles[0]!.title = "Unverified new title";
    d.company.overview = "Unverified new overview";
    d.company.verified = false;
    const saved = await env.http.put(url()).set("Authorization", admin).send({ revision: 1, document: d });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ revision: 2, publishedRevision: 1 });
    expect((await publish(document(), 1)).status).toBe(409);
    const detail = await env.http.get(`/api/v1/jds/${jdId}`).set("Authorization", student);
    expect(detail.body.title).toBe("Backend engineer");
    expect(detail.body.companyOverview.overview).toBe("Builds useful tools");
  });

  it("rolls back every write when a later role references a foreign JD", async () => {
    const published = await publish(document());
    const jdId = published.body.document.roles[0].jdId;
    const foreign = await seedJd(env, { company: "elsewhere" });
    const d = published.body.document as EnrichmentDocument;
    d.roles[0]!.title = "Must roll back";
    d.roles.push({ ...document().roles[0]!, jdId: foreign.id });
    expect((await publish(d, 1)).status).toBe(400);
    expect((await env.c.repos.jds.findById(jdId))!.title).toBe("Backend engineer");
    expect((await env.http.get(url()).set("Authorization", admin)).body.revision).toBe(1);
    expect((await env.c.enrichment.briefForJd(jdId))!.published_revision).toBe(1);
  });

  it("concurrent publications at the same revision have exactly one winner", async () => {
    const outcomes = await Promise.all([publish(document()), publish(document())]);
    expect(outcomes.map((r) => r.status).sort()).toEqual([200, 409]);
    const current = await env.http.get(url()).set("Authorization", admin);
    expect(current.body.revision).toBe(1);
    expect((await env.c.repos.jds.findAllActiveOrdered()).filter((j) => j.company === slug)).toHaveLength(1);
  });

  it("rejects archived publication until the company is explicitly restored", async () => {
    await env.c.repos.companies.update(companyId, { status: "archived" });
    const result = await publish(document());
    expect(result.status).toBe(409);
    expect(result.body.code).toBe("company_archived");
    expect((await env.c.repos.companies.findById(companyId))!).toMatchObject({ status: "archived", publishedAt: null });
    expect((await env.http.get(url()).set("Authorization", admin)).body.revision).toBe(0);
    await env.http.patch(`/api/v1/admin/companies/${companyId}`).set("Authorization", admin).send({ status: "active" }).expect(200);
    const restored = await publish(document());
    expect(restored.status).toBe(200);
    expect((await env.http.get("/api/v1/companies").set("Authorization", student)).body).toContainEqual(expect.objectContaining({ id: companyId }));
    expect((await env.http.get(`/api/v1/jds/${restored.body.document.roles[0].jdId}`).set("Authorization", student)).status).toBe(200);
  });

  it("initializes an unverified editor from published JDs without a research service", async () => {
    await env.c.repos.companies.update(companyId, { publishedAt: new Date(), reviewSummary: "Current company facts" });
    const jd = await seedJd(env, { company: slug, yoeMin: "2.0", yoeMax: "5.0" });
    const initial = await env.http.get(url()).set("Authorization", admin);
    expect(initial.body.document.company).toMatchObject({ overview: "Company: Acme", culture: "Current company facts", verified: false });
    expect(initial.body.document.roles).toEqual([expect.objectContaining({ id: jd.id, jdId: jd.id, title: jd.title, yoeMin: 2, yoeMax: 5, verified: false, rounds: [] })]);
    expect(env.fetch.calls).toHaveLength(2); // Unavailable draft and brief degrade to stored facts.
  });

  it("archives only removed manually owned JDs and retains their booked-session brief", async () => {
    const unrelated = await seedJd(env, { company: slug });
    const d = document();
    d.roles.push(document().roles[0]!);
    const first = await publish(d);
    const removedId = first.body.document.roles[0].jdId;
    const jd = (await env.c.repos.jds.findById(removedId))!;
    const session = await seedSession(env, (await createUser(env)).id, jd);
    const next = first.body.document as EnrichmentDocument;
    next.roles.shift();
    expect((await publish(next, 1)).status).toBe(200);
    expect((await env.c.repos.jds.findById(removedId))!.active).toBe(false);
    expect((await env.c.repos.jds.findById(unrelated.id))!.active).toBe(true);
    expect((await env.c.prep.assembleRequest(session)).companyBrief?.final_experience.rounds).toHaveLength(1);
    expect((await env.http.get(`/api/v1/jds/${removedId}`).set("Authorization", student)).status).toBe(404);
    expect((await env.http.post("/api/v1/interviews/sessions").set("Authorization", student)
      .send({ jobDescriptionId: removedId, scheduledAt: FUTURE_SLOT, timezone: "Asia/Kolkata" })).status).toBe(400);
  });

  it.each(["role", "level", "specialization"] as const)("rejects changing booked JD %s and retains a prep-compatible publication", async (field) => {
    const first = await publish(document());
    const jdId = first.body.document.roles[0].jdId;
    const jd = (await env.c.repos.jds.findById(jdId))!;
    const session = await seedSession(env, (await createUser(env)).id, jd);
    const before = await env.c.prep.assembleRequest(session);
    const d = structuredClone(first.body.document) as EnrichmentDocument;
    d.company.overview = "Must not publish";
    d.roles[0]![field] = field === "level" ? "sde3" : "different";
    const rejected = await publish(d, 1);
    expect(rejected.status).toBe(409);
    expect(rejected.body.code).toBe("enrichment_identity_conflict");
    expect((await env.http.get(url()).set("Authorization", admin)).body).toEqual(first.body);
    const after = await env.c.prep.assembleRequest(session);
    expect(after).toEqual(before);
    expect(after.companyBrief).toMatchObject({ company: after.session.company, role: after.session.role, level: after.session.level, specialization: after.session.specialization });
    expect((await env.c.repos.sessions.findById(session.id))!.status).toBe("SCHEDULED");
  });

  it("protects adopted seed JD identity even before any booking", async () => {
    const jd = await seedJd(env, { company: slug });
    const d = document();
    d.roles[0]!.jdId = jd.id;
    const rejected = await publish(d);
    expect(rejected.status).toBe(409); // Seed is sde1; enrichment attempts sde2.
    expect(rejected.body.code).toBe("enrichment_identity_conflict");
    expect(await env.c.repos.jds.findById(jd.id)).toEqual(jd);
    expect(await env.c.enrichment.briefForJd(jd.id)).toBeNull();
  });

  it("a new role can replace an old identity while booked sessions retain their original brief", async () => {
    const first = await publish(document());
    const oldJd = (await env.c.repos.jds.findById(first.body.document.roles[0].jdId))!;
    const session = await seedSession(env, (await createUser(env)).id, oldJd);
    const d = document();
    d.roles[0]!.level = "sde3";
    expect((await publish(d, 1)).status).toBe(200);
    expect((await env.c.repos.jds.findById(oldJd.id))!.active).toBe(false);
    const request = await env.c.prep.assembleRequest(session);
    expect(request.companyBrief?.level).toBe(request.session.level);
    expect(request.companyBrief?.level).toBe("sde2");
  });

  it("stores company overview separately and never reuses or overwrites review summaries", async () => {
    await env.c.repos.companies.update(companyId, { reviewSummary: "Employees report a collaborative culture" });
    const initial = await env.http.get(url()).set("Authorization", admin);
    expect(initial.body.document.company.overview).toBe("Company: Acme");
    expect(initial.body.document.company.culture).toBe("Employees report a collaborative culture");
    const first = await publish(document());
    expect(first.status).toBe(200);
    expect((await env.c.repos.companies.findById(companyId))!.reviewSummary).toBe("Employees report a collaborative culture");
    expect((await env.http.get(url()).set("Authorization", admin)).body.document.company.overview).toBe("Builds useful tools");
    const detail = await env.http.get(`/api/v1/jds/${first.body.document.roles[0].jdId}`).set("Authorization", student);
    expect(detail.body.companyOverview.overview).toBe("Builds useful tools");
  });

  it("blocks legacy research approval after manual publication", async () => {
    await env.c.repos.companies.update(companyId, { reviewSummary: "Reviews describe flexible hours" });
    expect((await publish(document())).status).toBe(200);
    const draftId = randomUUID();
    env.fetch.on("GET", `${AI}/research/companies/${companyId}/draft`, {
      company_id: companyId, draft_id: draftId, status: "pending_review", version: 99, conflicts: [],
      snapshot: { identity: { name: { value: "Overwritten" } }, compensation: { review_summary: { value: "AI overwrite" } } },
    });
    const result = await env.http.post(`/api/v1/admin/companies/${companyId}/draft/${draftId}/approve`).set("Authorization", admin).send({});
    expect(result.status).toBe(409);
    expect(result.body.code).toBe("manual_enrichment_protected");
    expect((await env.c.repos.companies.findById(companyId))!.reviewSummary).toBe("Reviews describe flexible hours");
    expect(env.fetch.calls.filter((c) => c.method === "POST")).toHaveLength(0);
  });

  it("starter refresh preserves manual JDs and stable seed IDs", async () => {
    await env.c.seeder.seed();
    const company = (await env.c.repos.companies.findBySlug("meesho"))!;
    companyId = company.id;
    const seeds = (await env.c.repos.jds.findAllActiveOrdered()).filter((j) => j.company === "meesho");
    const d = document();
    d.roles[0]!.jdId = seeds[0]!.id;
    d.roles[0]!.level = seeds[0]!.level;
    d.roles[0]!.specialization = seeds[0]!.specialization;
    const result = await publish(d);
    expect(result.status).toBe(200);
    await env.c.seeder.seed();
    expect((await env.c.repos.jds.findById(seeds[0]!.id))!.title).toBe("Backend engineer");
    expect(await env.c.enrichment.briefForJd(seeds[0]!.id)).not.toBeNull();
    for (const seed of seeds) expect(await env.c.repos.jds.findById(seed.id)).not.toBeNull();
  });
});
