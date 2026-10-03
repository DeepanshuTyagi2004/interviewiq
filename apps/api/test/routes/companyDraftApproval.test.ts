import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { bearer, createUser, createTestEnv, type TestEnv } from "../support/harness.js";
import { AI, seedJd, seedRoleConfig } from "./helpers.js";

const BASE = "/api/v1/admin/companies";
const field = (value: unknown) => ({ value, confidence: "high", provenance: "evidence", source_urls: [], note: null });
const reviewQuote = { text: "Supportive team and flexible hours.", sourceUrl: "https://reviews.example.com/acme", sourceName: "Reviews", date: "2026-09-01" };
function snapshot() {
  return {
    identity: { name: field("Acme Research"), website: field("https://acme.example.com"), aliases: field(["Acme"]) },
    profile: {
      sector: field("saas"), business_model: field("product"), hq: field("Bengaluru, India"),
      headcount_band: field("1k-5k"), revenue_band: field("₹1k-5k Cr"), funding_stage: field("growth"),
    },
    compensation: {
      wlb_rating: field(4.2), wlb_review_count: field(125), review_summary: field("Employees describe flexible hours."),
      review_quotes: field([reviewQuote]),
    },
    roles: [{
      role_key: "sde2-backend-engineer", title: field("Backend Engineer"), level: field("sde2"), specialization: field("backend"),
      yoe_min: field(2), yoe_max: field(5), ctc_min_lpa: field(20), ctc_max_lpa: field(35), ctc_source_count: 3,
      jd: field({ description: "Build APIs" }), interview_process: field({ rounds: [{ type: "dsa" }] }),
    }],
  };
}

describe("company draft approval", () => {
  let env: TestEnv;
  let admin: string;
  let companyId: string;
  let slug: string;
  let draftId: string;
  beforeAll(async () => {
    env = await createTestEnv();
    admin = await bearer(env, await createUser(env, { role: "ADMIN" }));
  });
  afterAll(() => env.close());
  beforeEach(async () => {
    env.fetch.reset();
    slug = `research-${randomUUID()}`;
    const company = await env.c.repos.companies.create({ name: "Original name", slug, origin: "admin" });
    companyId = company.id;
    draftId = randomUUID();
  });

  function serveDraft(value: unknown = snapshot(), overrides: Record<string, unknown> = {}) {
    const draft = {
      draft_id: draftId, company_id: companyId, version: 2, run_id: "run-1", status: "pending_review",
      created_at: "2026-10-02T10:00:00Z", snapshot: value, conflicts: [], diff: [], ...overrides,
    };
    env.fetch.on("GET", `${AI}/research/companies/${companyId}/draft`, draft);
    env.fetch.on("POST", `${AI}/research/drafts/${draftId}/decision`, { ...draft, status: "approved" });
    return draft;
  }
  const approve = () => env.http.post(`${BASE}/${companyId}/draft/${draftId}/approve`).set("Authorization", admin);

  it("publishes company facts, retains role research in the snapshot, and leaves booking rows and tier intact", async () => {
    await env.c.repos.companies.update(companyId, { tier: 2, tierRationale: "Existing tier", companySize: "Existing legacy size" });
    const jd = await seedJd(env, { company: slug });
    await seedRoleConfig(env, { company: slug });
    const config = await env.c.repos.roleConfigs.findByCompanyAndRoleAndLevel(slug, "software-engineer", "sde1");
    const draft = serveDraft();
    const review = await env.http.get(`${BASE}/${companyId}/draft`).set("Authorization", admin);
    expect(review.status).toBe(200);
    expect(review.body.draft.snapshot).toEqual(draft.snapshot);

    const response = await approve().send({ note: "Checked sources" });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ name: "Acme Research", slug, publishedVersion: 2, tier: 2 });
    const row = await env.c.repos.companies.findById(companyId);
    expect(row).toMatchObject({
      name: "Acme Research", website: "https://acme.example.com", aliases: ["Acme"],
      sector: "saas", businessModel: "product", headquarterLocation: "Bengaluru, India", headcountBand: "1k-5k",
      revenueBand: "₹1k-5k Cr", fundingStage: "growth", wlbRating: "4.2", wlbReviewCount: 125,
      reviewSummary: "Employees describe flexible hours.", reviewQuotes: [reviewQuote],
      tier: 2, tierRationale: "Existing tier", companySize: "Existing legacy size", publishedVersion: 2,
    });
    expect(row?.publishedAt).toBeInstanceOf(Date);
    expect((await env.c.repos.companies.findPublished()).some((c) => c.id === companyId)).toBe(true);
    expect((await env.c.repos.jds.findAllActiveOrdered()).filter((j) => j.company === slug)).toEqual([jd]);
    expect(await env.c.repos.roleConfigs.findByCompanyAndRoleAndLevel(slug, "software-engineer", "sde1")).toEqual(config);
    expect(env.fetch.callsTo(AI, "POST")).toHaveLength(1);
    expect(env.fetch.callsTo(AI, "POST")[0]?.json).toMatchObject({ decision: "approve", note: "Checked sources" });
  });

  it("approves legacy identity-only drafts without clearing richer published facts", async () => {
    await env.c.repos.companies.update(companyId, { sector: "saas", wlbRating: "3.5", reviewQuotes: [reviewQuote] });
    serveDraft({ identity: snapshot().identity });
    expect((await approve()).status).toBe(200);
    expect(await env.c.repos.companies.findById(companyId)).toMatchObject({ sector: "saas", wlbRating: "3.5", reviewQuotes: [reviewQuote] });
  });

  it("preserves unavailable facts, accepts zero rating/count, and can clear a quote list", async () => {
    await env.c.repos.companies.update(companyId, { sector: "saas", wlbRating: "3.5", reviewQuotes: [reviewQuote] });
    serveDraft({ identity: snapshot().identity, profile: { sector: field(null) }, compensation: {
      wlb_rating: field(0), wlb_review_count: field(0), review_quotes: field([]), review_summary: field(null),
    } });
    expect((await approve()).status).toBe(200);
    expect(await env.c.repos.companies.findById(companyId)).toMatchObject({ sector: "saas", wlbRating: "0.0", wlbReviewCount: 0, reviewQuotes: [] });
  });

  it.each([
    ["profile", "sector", field("invented-sector")],
    ["profile", "business_model", field("something")],
    ["profile", "funding_stage", field("unknown")],
    ["profile", "hq", field("x".repeat(256))],
    ["profile", "headcount_band", field({ min: 100 })],
    ["profile", "revenue_band", field("x".repeat(33))],
    ["compensation", "wlb_rating", field(-0.1)],
    ["compensation", "wlb_rating", field(5.1)],
    ["compensation", "wlb_rating", field("4.2")],
    ["compensation", "wlb_review_count", field(-1)],
    ["compensation", "wlb_review_count", field(1.5)],
    ["compensation", "wlb_review_count", field(2_147_483_648)],
    ["compensation", "review_summary", field({ text: "Invalid" })],
    ["compensation", "review_quotes", field("not an array")],
    ["compensation", "review_quotes", field(Array.from({ length: 6 }, () => reviewQuote))],
    ["compensation", "review_quotes", field([{ ...reviewQuote, text: "x".repeat(301) }])],
    ["compensation", "wlb_rating", { confidence: "low" }],
    ["identity", "name", field(42)],
  ])("rejects invalid %s.%s before any publication or decision (%j)", async (section, key, value) => {
    const data: Record<string, Record<string, unknown> | unknown[]> = snapshot();
    (data[section as string] as Record<string, unknown>)[key as string] = value;
    serveDraft(data);
    const response = await approve();
    expect(response.status).toBe(400);
    expect(response.body.code).toBe("invalid_draft");
    expect(await env.c.repos.companies.findById(companyId)).toMatchObject({ name: "Original name", publishedAt: null, sector: null });
    expect(env.fetch.callsTo(AI, "POST")).toHaveLength(0);
  });

  it.each(["javascript:alert(1)", "data:text/html,hello", "//reviews.example.com/acme", "https://user:secret@reviews.example.com", "https://reviews.example.com/\npath", "not a URL"])("blocks unsafe review URL %s", async (sourceUrl) => {
    const data = snapshot();
    data.compensation.review_quotes = field([{ ...reviewQuote, sourceUrl }]);
    serveDraft(data);
    const response = await approve();
    expect(response.status).toBe(400);
    expect(response.body.code).toBe("invalid_draft");
    expect((await env.c.repos.companies.findById(companyId))?.publishedAt).toBeNull();
    expect(env.fetch.callsTo(AI, "POST")).toHaveLength(0);
  });

  it.each([0, -1, 1.5, "2", 2_147_483_648])("rejects invalid draft version %j", async (version) => {
    serveDraft(snapshot(), { version });
    expect((await approve()).body.code).toBe("invalid_draft");
    expect((await env.c.repos.companies.findById(companyId))?.publishedAt).toBeNull();
  });

  it.each([
    [{ draft_id: "new-draft" }, "draft_stale"],
    [{ company_id: randomUUID() }, "draft_stale"],
    [{ status: "approved" }, "draft_not_pending"],
    [{ conflicts: [{ type: "not_a_company", message: "Not a company" }] }, "draft_not_approvable"],
  ])("rejects stale or blocked drafts (%j)", async (overrides, code) => {
    serveDraft(snapshot(), overrides);
    const response = await approve();
    expect(response.status).toBe(409);
    expect(response.body.code).toBe(code);
    expect((await env.c.repos.companies.findById(companyId))?.publishedAt).toBeNull();
    expect(env.fetch.callsTo(AI, "POST")).toHaveLength(0);
  });

  it("requires ADMIN for approval", async () => {
    const user = await bearer(env, await createUser(env));
    serveDraft();
    expect((await env.http.post(`${BASE}/${companyId}/draft/${draftId}/approve`).set("Authorization", user)).status).toBe(403);
    expect(env.fetch.callsTo(AI)).toHaveLength(0);
  });
});
