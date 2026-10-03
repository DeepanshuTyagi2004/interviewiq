import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { companyEnrichments } from "../../src/db/pg/schema.js";
import { parseEnrichment, type EnrichmentDocument } from "../../src/domain/enrichment.js";
import { CompanyEnrichmentService } from "../../src/services/companyEnrichment.js";
import { bearer, createTestEnv, createUser, type TestEnv } from "../support/harness.js";
import { json } from "../support/fakeFetch.js";
import { AI, seedJd } from "./helpers.js";

const source = "https://acme.example/about";
const field = (value: unknown, urls = [source]) => ({ value, source_urls: urls, provenance: "evidence" });
const round = (overrides: Record<string, unknown> = {}) => ({ name: "Algorithms", type: "dsa", duration_minutes: 45,
  difficulty: "medium", topics: ["Trees"], problems: ["Traverse a tree"], format: "Explain tradeoffs", source_urls: [source], ...overrides });
const role = (overrides: Record<string, unknown> = {}) => ({ role_key: "sde2-backend-platform-engineer", title: field("Platform engineer"),
  role: field("software-engineer"), level: field("sde2"), specialization: field("backend"), jd: field("Build distributed systems"),
  tech_stack: field(["Go", "Postgres"]), yoe_min: field(2), yoe_max: field(5), ctc_min_lpa: field(20), ctc_max_lpa: field(30),
  interview_process: field({ rounds: [round()] }), ...overrides });

describe("available company enrichment prefill", () => {
  let env: TestEnv, admin: string, student: string, companyId: string, slug: string;
  const url = () => `/api/v1/admin/companies/${companyId}/enrichment`;
  const draftUrl = () => `${AI}/research/companies/${companyId}/draft`;
  const research = (snapshot: unknown) => env.fetch.on("GET", draftUrl(), { company_id: companyId, version: 7, snapshot });
  const get = () => env.http.get(url()).set("Authorization", admin);
  const prefill = (revision: number) => env.http.post(`${url()}/prefill`).set("Authorization", admin).send({ revision });
  const save = (document: EnrichmentDocument, revision: number) => env.http.put(url()).set("Authorization", admin).send({ document, revision });
  beforeAll(async () => {
    env = await createTestEnv();
    admin = await bearer(env, await createUser(env, { role: "ADMIN" }));
    student = await bearer(env, await createUser(env));
  });
  afterAll(() => env.close());
  beforeEach(async () => {
    env.fetch.reset();
    slug = `prefill-${randomUUID()}`;
    companyId = (await env.c.repos.companies.create({ name: "Acme", slug, website: "https://acme.example" })).id;
    env.fetch.on("GET", `${AI}/briefs/`, () => json({ code: "not_found" }, 404));
  });

  it("prefills the latest overview and distinct facts, culture, benefits and safe evidence, never personal profiles", async () => {
    research({ identity: { name: field("Acme"), website: field("https://acme.example") }, profile: {
      overview: field("Acme builds commerce tools in Bengaluru."), hq: field("Bengaluru"), sector: field("saas"),
      headcount_band: field("100–500"), revenue_band: field("$10m FY2025"), funding_stage: field("growth"),
      benefits: field(["Health insurance", "Learning budget"]), candidate_profile: "PRIVATE CANDIDATE",
    }, compensation: { review_summary: field("Employees describe supportive teams."),
      review_quotes: field([{ text: "Flexible schedules", sourceUrl: "https://reviews.example/acme", author: "PRIVATE AUTHOR" }]) },
    candidate_profile: { name: "PRIVATE CANDIDATE" } });
    const result = await get();
    expect(result.status).toBe(200);
    const c = result.body.document.company;
    expect(c.overview).toContain("Acme builds commerce tools");
    expect(c.overview).toContain("Headcount: 100–500");
    expect(c.overview).toContain("Sector: saas");
    expect(c.overview.match(/Bengaluru/g)).toHaveLength(1);
    expect(c.culture).toContain("supportive teams");
    expect(c.culture).toContain("“Flexible schedules”");
    expect(c.benefits).toContain("Learning budget");
    expect(c.sourceUrls).toContain("https://reviews.example/acme");
    expect(c.verified).toBe(false);
    expect(JSON.stringify(result.body)).not.toContain("PRIVATE");
    expect(result.body).toMatchObject({ revision: 0, publishedRevision: null });
    expect((await env.c.repos.companies.findById(companyId))!.publishedAt).toBeNull();
  });

  it.each(["missing", "offline"])("opens safely with %s research, including local company facts", async (mode) => {
    await env.c.repos.companies.update(companyId, { sector: "saas", headquarterLocation: "Pune", reviewSummary: "Local culture" });
    if (mode === "missing") env.fetch.on("GET", draftUrl(), () => json({}, 404));
    const result = await get();
    expect(result.status).toBe(200);
    expect(result.body.document.company).toMatchObject({ culture: "Local culture", verified: false });
    expect(result.body.document.company.overview).toContain("Pune");
    expect(result.body.document.roles).toEqual([]);
    expect(parseEnrichment({ revision: 0, document: result.body.document }, false)).toBeDefined();
  });

  it("imports active unpublished JDs and supported brief rounds; incomplete rounds stay reference text", async () => {
    research({});
    const jd = await seedJd(env, { company: slug });
    await seedJd(env, { company: slug, active: false, title: "Archived" });
    env.fetch.on("GET", `${AI}/briefs/`, { sources: [source], final_experience: { rounds: [round(),
      round({ name: "Online assessment", type: "oa" }), round({ name: "Architecture", type: "system-design", duration_minutes: null })] } });
    const result = await get();
    expect(result.status).toBe(200);
    expect(result.body.document.roles).toHaveLength(1);
    const r = result.body.document.roles[0];
    expect(r).toMatchObject({ id: jd.id, jdId: jd.id, verified: false, level: "sde1" });
    expect(r.rounds).toHaveLength(1);
    expect(r.rounds[0]).toMatchObject({ name: "Algorithms", durationMinutes: 45, difficulty: "medium", verified: false, sourceUrls: [source] });
    expect(r.description).toContain("Online assessment");
    expect(r.description).toContain("Architecture");
    expect((await env.c.repos.companies.findById(companyId))!.publishedAt).toBeNull();
  });

  it("imports historical rich roles without inventing unknown level, pay, duration or difficulty", async () => {
    research({ roles: [role(), role({ role_key: "junior", title: field("Junior developer"), level: field(null),
      ctc_min_lpa: field(null), ctc_max_lpa: field(null), interview_process: field({ rounds: [round({ difficulty: null })] }) })] });
    const result = await get();
    expect(result.status).toBe(200);
    expect(result.body.document.roles[0]).toMatchObject({ title: "Platform engineer", level: "sde2", specialization: "backend",
      description: "Build distributed systems", techStack: ["Go", "Postgres"], yoeMin: 2, yoeMax: 5, ctcMinLpa: 20, ctcMaxLpa: 30, verified: false });
    expect(result.body.document.roles[1]).toMatchObject({ level: "", ctcMinLpa: null, ctcMaxLpa: null, rounds: [] });
    expect(result.body.document.roles[1].description).toContain("Interview process reference");
    expect((await prefill(0)).body).toEqual(result.body);
  });

  it("reopening saved human edits never consults AI or overwrites intentional blanks", async () => {
    research({ profile: { overview: field("Original overview") }, roles: [role()] });
    const first = await get();
    const d = first.body.document as EnrichmentDocument;
    d.company.overview = "Human company overview";
    d.roles[0]!.description = "";
    d.roles[0]!.title = "Human title";
    const saved = await save(d, 0);
    expect(saved.status).toBe(200);
    env.fetch.reset();
    const reopened = await get();
    expect(reopened.body).toEqual(saved.body);
    expect(env.fetch.calls).toHaveLength(0);
  });

  it("explicit import fills only blank unverified fields and preserves manual values and verified sections", async () => {
    research({ roles: [role()] });
    const first = await get();
    const d = first.body.document as EnrichmentDocument;
    d.company.overview = "Human overview";
    d.company.culture = "";
    d.roles[0]!.description = "Human JD";
    d.roles[0]!.techStack = [];
    d.roles[0]!.ctcMinLpa = 0; // Zero is a value, not a blank.
    d.roles[0]!.rounds[0]!.guidance = "";
    d.roles[0]!.rounds[0]!.verified = true;
    const protectedRole = structuredClone(d.roles[0]!);
    protectedRole.id = randomUUID(); protectedRole.title = "Verified role"; protectedRole.verified = true;
    protectedRole.techStack = []; protectedRole.rounds = []; protectedRole.description = "";
    d.roles.push(protectedRole);
    expect((await save(d, 0)).status).toBe(200);
    research({ profile: { overview: field("AI replacement"), culture: field("New culture") },
      roles: [role(), role({ role_key: "verified", title: field("Verified role") }), role({ role_key: "new", title: field("New role") })] });
    const imported = await prefill(1);
    expect(imported.status).toBe(200);
    expect(imported.body.revision).toBe(2);
    const merged = imported.body.document as EnrichmentDocument;
    expect(merged.company.overview).toBe("Human overview");
    expect(merged.company.culture).toBe("New culture");
    expect(merged.roles[0]).toMatchObject({ description: "Human JD", techStack: ["Go", "Postgres"], ctcMinLpa: 0 });
    expect(merged.roles[0]!.rounds[0]!.guidance).toBe("");
    expect(merged.roles[1]).toEqual(protectedRole);
    expect(merged.roles[2]).toMatchObject({ title: "New role", verified: false });
    expect((await prefill(2)).body).toEqual(imported.body);
  });

  it("deduplicates source roles by stable ID, normalized title, or linked JD and keeps edited identity", async () => {
    const jd = await seedJd(env, { company: slug, roleKey: "sde2-backend-platform-engineer", title: "Platform engineer", level: "sde2" });
    research({ roles: [role(), role({ title: field("Platform-engineer") })] });
    const first = await get();
    expect(first.body.document.roles).toHaveLength(1);
    expect(first.body.document.roles[0]).toMatchObject({ id: jd.id, jdId: jd.id });
    const d = first.body.document as EnrichmentDocument;
    d.roles[0]!.title = "Human title";
    d.roles[0]!.specialization = null;
    d.roles[0]!.description = "";
    expect((await save(d, 0)).status).toBe(200);
    const result = await prefill(1);
    expect(result.body.document.roles).toHaveLength(1);
    expect(result.body.document.roles[0]).toMatchObject({ id: jd.id, jdId: jd.id, title: "Human title", specialization: null });
    expect((await prefill(result.body.revision)).body).toEqual(result.body);
  });

  it("retains attribution when filling gaps with existing evidence and ignores link-only changes on reimport", async () => {
    research({ roles: [role()] });
    const initial = await get();
    const d = initial.body.document as EnrichmentDocument;
    const website = "https://acme.example";
    const manualRoleSource = "https://acme.example/manual-jd";
    const manualRoundSource = "https://acme.example/manual-interview";
    const cultureSource = "https://reviews.example/acme-culture";
    const jdSource = "https://careers.example/acme-platform";
    const roundSource = "https://interviews.example/acme-algorithms";
    d.company.overview = "Human overview";
    d.company.sourceUrls = [website];
    d.roles[0]!.title = "Human role title";
    d.roles[0]!.description = "";
    d.roles[0]!.sourceUrls = [manualRoleSource];
    d.roles[0]!.rounds[0]!.topics = [];
    d.roles[0]!.rounds[0]!.guidance = "";
    d.roles[0]!.rounds[0]!.sourceUrls = [manualRoundSource];
    expect((await save(d, 0)).status).toBe(200);
    const snapshot = (extraUrl?: string) => ({
      profile: { culture: field("Supportive teams", [cultureSource, ...(extraUrl ? [extraUrl] : [])]) },
      roles: [role({ jd: field("Build reliable APIs", [jdSource, ...(extraUrl ? [extraUrl] : [])]),
        interview_process: field({ rounds: [round({ source_urls: [roundSource, "javascript:alert(1)", ...(extraUrl ? [extraUrl] : [])] })] }) })],
    });
    research(snapshot());
    const imported = await prefill(1);
    expect(imported.status).toBe(200);
    expect(imported.body.revision).toBe(2);
    const merged = imported.body.document as EnrichmentDocument;
    expect(merged.company).toMatchObject({ overview: "Human overview", culture: "Supportive teams" });
    expect(merged.company.sourceUrls).toEqual(expect.arrayContaining([website, cultureSource]));
    expect(merged.roles[0]).toMatchObject({ title: "Human role title", description: "Build reliable APIs" });
    expect(merged.roles[0]!.sourceUrls).toEqual(expect.arrayContaining([manualRoleSource, jdSource]));
    expect(merged.roles[0]!.rounds[0]).toMatchObject({ topics: ["Trees"], guidance: "Explain tradeoffs" });
    expect(merged.roles[0]!.rounds[0]!.sourceUrls).toEqual(expect.arrayContaining([manualRoundSource, roundSource]));
    expect(JSON.stringify(merged)).not.toContain("javascript:");
    expect((await prefill(2)).body).toEqual(imported.body);
    research(snapshot("https://unrelated.example/later-link"));
    expect((await prefill(2)).body).toEqual(imported.body);
  });

  it("sanitizes URLs and oversized or invalid upstream values into a saveable draft", async () => {
    const invalid = ["javascript:alert(1)", "https://user:pass@example.com", "https://example.com/a b", "ftp://example.com", "https://example.com/" + "x".repeat(2100)];
    await env.c.repos.companies.update(companyId, { website: "javascript:alert(1)" });
    research({ profile: { overview: field("x".repeat(15000), [...invalid, source]) }, roles: [role({ title: field("r".repeat(400)),
      jd: field("d".repeat(25000), invalid), tech_stack: field(Array.from({ length: 80 }, (_, i) => `${i}${"x".repeat(400)}`)),
      yoe_min: field(20), yoe_max: field(2), ctc_min_lpa: field(-1), ctc_max_lpa: field(9999999),
      interview_process: field({ rounds: Array.from({ length: 20 }, (_, i) => round({ name: `Round ${i}`, source_urls: invalid })) }) })] });
    const result = await get();
    expect(result.status).toBe(200);
    const d = result.body.document as EnrichmentDocument;
    expect(d.company.sourceUrls).toEqual([source]);
    expect(d.company.overview.length).toBeLessThanOrEqual(10000);
    expect(d.roles[0]!.techStack).toHaveLength(50);
    expect(d.roles[0]).toMatchObject({ yoeMin: null, yoeMax: null, ctcMinLpa: null, ctcMaxLpa: null });
    expect(d.roles[0]!.rounds).toHaveLength(12);
    expect(() => parseEnrichment({ revision: 0, document: d }, false)).not.toThrow();
    expect((await save(d, 0)).status).toBe(200);
  });

  it("preserves distinct linked openings with identical titles during a later import", async () => {
    research({});
    await get();
    const first = await seedJd(env, { company: slug });
    const second = await seedJd(env, { company: slug });
    const result = await prefill(0);
    expect(result.status).toBe(200);
    expect(result.body.document.roles.map((r: { jdId: string }) => r.jdId).sort()).toEqual([first.id, second.id].sort());
    expect((await prefill(1)).body).toEqual(result.body);
  });

  it("keeps persisted facts when a newer snapshot explicitly lacks them", async () => {
    await env.c.repos.companies.update(companyId, { sector: "saas", headquarterLocation: "Pune" });
    research({ profile: { sector: field(null), hq: { value: null, provenance: "unavailable" } } });
    const result = await get();
    expect(result.body.document.company.overview).toContain("Sector: saas");
    expect(result.body.document.company.overview).toContain("Headquarters: Pune");
  });

  it("does not modify publication or verified company values when importing later suggestions", async () => {
    research({ profile: { overview: field("Acme overview") }, roles: [role()] });
    const initial = await get();
    const d = initial.body.document as EnrichmentDocument;
    d.company.verified = true;
    d.roles.forEach((r) => { r.verified = true; r.rounds.forEach((round) => { round.verified = true; }); });
    expect((await env.http.post(`${url()}/publish`).set("Authorization", admin).send({ revision: 0, document: d })).status).toBe(200);
    const [published] = await env.db.select().from(companyEnrichments).where(eq(companyEnrichments.companyId, companyId));
    research({ profile: { overview: field("Replacement"), culture: field("Later culture") }, roles: [role({ role_key: "new", title: field("New role") })] });
    const result = await prefill(1);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ revision: 2, publishedRevision: 1, document: { company: { overview: "Acme overview", culture: "", verified: true } } });
    const [after] = await env.db.select().from(companyEnrichments).where(eq(companyEnrichments.companyId, companyId));
    expect(after!.publishedDocument).toEqual(published!.publishedDocument);
    expect(after!.publishedAt).toEqual(published!.publishedAt);
  });

  it("distinguishes no data from outages without changing the saved draft", async () => {
    env.fetch.on("GET", draftUrl(), () => json({}, 404));
    const initial = await get();
    expect((await prefill(0)).body).toEqual(initial.body);
    env.fetch.on("GET", draftUrl(), () => json({}, 503));
    const failed = await prefill(0);
    expect(failed.status).toBe(502);
    expect(failed.body.code).toBe("enrichment_source_unavailable");
    expect((await get()).body).toEqual(initial.body);
  });

  it("reports brief upstream failure on explicit import while initial GET keeps useful local data", async () => {
    await seedJd(env, { company: slug });
    research({ profile: { overview: field("Known overview") } });
    env.fetch.on("GET", `${AI}/briefs/`, () => json({}, 500));
    const initial = await get();
    expect(initial.status).toBe(200);
    expect(initial.body.document.roles).toHaveLength(1);
    expect((await prefill(0)).status).toBe(502);
    expect((await get()).body).toEqual(initial.body);
  });

  it("enforces admin authorization, revision validation and CAS without fetching on a stale request", async () => {
    research({});
    expect((await env.http.post(`${url()}/prefill`).send({ revision: 0 })).status).toBe(401);
    expect((await env.http.post(`${url()}/prefill`).set("Authorization", student).send({ revision: 0 })).status).toBe(403);
    for (const body of [{}, { revision: -1 }, { revision: 0.5 }, { revision: 0, extra: true }]) {
      expect((await env.http.post(`${url()}/prefill`).set("Authorization", admin).send(body)).status).toBe(400);
    }
    const first = await get();
    await save(first.body.document, 0);
    env.fetch.calls.length = 0;
    expect((await prefill(0)).status).toBe(409);
    expect(env.fetch.calls).toHaveLength(0);
  });

  it("fetches outside locks and preserves a concurrent human save during initial GET and explicit prefill", async () => {
    let resolve!: (value: unknown) => void;
    const getCompanyDraft = vi.fn(() => new Promise<unknown>((r) => { resolve = r; }));
    const service = new CompanyEnrichmentService(env.db, { getCompanyDraft, fetchBrief: async () => null });
    const initial = service.get(companyId);
    await vi.waitFor(() => expect(getCompanyDraft).toHaveBeenCalledOnce());
    const d: EnrichmentDocument = { company: { overview: "Human save", culture: "", benefits: "", sourceUrls: [], verified: false }, roles: [] };
    const saved = await service.write(companyId, { revision: 0, document: d }, randomUUID(), false);
    resolve({ snapshot: { profile: { overview: field("Late AI") } } });
    expect(await initial).toEqual(saved);
    const importing = service.prefill(companyId, { revision: 1 });
    // Attach immediately because the deliberately racing operation must reject.
    const assertion = expect(importing).rejects.toMatchObject({ status: 409, code: "enrichment_stale" });
    await vi.waitFor(() => expect(getCompanyDraft).toHaveBeenCalledTimes(2));
    await service.write(companyId, { revision: 1, document: { ...d, company: { ...d.company, overview: "New human save" } } }, randomUUID(), false);
    resolve({ snapshot: { profile: { culture: field("Late culture") } } });
    await assertion;
    expect((await service.get(companyId)).document.company.overview).toBe("New human save");
  });

  it("bounds brief concurrency and reuses lookups for JDs sharing the same brief identity", async () => {
    for (let index = 0; index < 8; index++) await seedJd(env, { company: slug, level: `level${index}` });
    await seedJd(env, { company: slug, level: "level0", title: "Another opening" });
    let active = 0, peak = 0;
    const fetchBrief = vi.fn(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active--;
      return null;
    });
    const service = new CompanyEnrichmentService(env.db, { getCompanyDraft: async () => ({ snapshot: {} }), fetchBrief });
    const result = await service.get(companyId);
    expect(result.document.roles).toHaveLength(9);
    expect(peak).toBeLessThanOrEqual(4);
    expect(fetchBrief).toHaveBeenCalledTimes(8);
    expect(fetchBrief.mock.calls[0]).toEqual([slug, expect.any(String), expect.any(String), "backend", { timeoutMs: expect.any(Number), strict: true }]);
  });

  it("times out a stalled injected research reader and still opens a valid local draft", async () => {
    const service = new CompanyEnrichmentService(env.db, {
      getCompanyDraft: () => new Promise(() => {}), fetchBrief: async () => null,
    });
    const result = await service.get(companyId);
    expect(result.document.company.overview).toBe("Company: Acme");
    expect(result.revision).toBe(0);
  });
});
