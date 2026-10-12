## Task 11: Admin company CRUD, research targets and the research client

**Files:**
- Modify: `apps/api/src/routes/admin.ts` (`adminCompaniesRouter`), `apps/api/src/routes/internal.ts`, `apps/api/src/integrations/aiService/client.ts`
- Test: `apps/api/test/routes/adminCompanyController.test.ts` (rewrite the "catalogue CRUD" describe block), `apps/api/test/routes/internalResearchTargets.test.ts`

**Interfaces:**
- Consumes: `slugify`, the company repository and `COMPANY_STATUSES` (Task 10).
- Produces these HTTP routes:

  | Method | Path | Body | Response |
  |---|---|---|---|
  | `GET` | `/api/v1/admin/companies` | | `{ companies: AdminCompany[], researchAvailable: boolean }` |
  | `POST` | `/api/v1/admin/companies` | `{ name, website?, aliases? }` | 201 `AdminCompany`; 400 `invalid_company` / `invalid_website` / `invalid_aliases`; 409 `company_exists` |
  | `PATCH` | `/api/v1/admin/companies/:id` | `{ name?, website?, aliases?, status? }` | 200 `AdminCompany`; 400 `invalid_status`; 404 `company_not_found`. The slug never changes. |
  | `DELETE` | `/api/v1/admin/companies/:id` | | 204 (also deletes the company's JDs and role configs); 404 |
  | `POST` | `/api/v1/admin/companies/seed` | | Unchanged route (Task 10 result shape) |
  | `GET` | `/api/v1/internal/research-targets` | | `[{ id, name, slug, website, aliases }]` for active companies |

  - `AdminCompany = { id, name, slug, website, aliases, status, origin, tier, publishedVersion, publishedAt, createdAt, research: { lastRunId, lastResearchedAt, lastStatus, latestDraftId, latestDraftStatus } | null }`.
  - New `AiServiceClient` methods:
    - `companyResearchStates(ids)`: a lookup that resolves to null on failure and never throws;
    - `startResearchRun(body)` and `listResearchRuns(limit)`;
    - `getResearchRun(runId)` and `controlResearchRun(runId, action)`;
    - `patchResearchBudget(runId, body)`;
    - `listResearchEvents(runId, qs: URLSearchParams)`;
    - `listResearchSpans(runId, companyId | null)` and `getResearchSpan(spanId)`.

- [ ] **Step 1: Write the failing tests**

In `apps/api/test/routes/adminCompanyController.test.ts`, replace the whole `describe("catalogue CRUD", …)` block (and remove any `describe.skip` left from Task 10) with:

```ts
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
```

`apps/api/test/routes/internalResearchTargets.test.ts`:

```ts
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
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @interviewiq/api exec vitest run test/routes/adminCompanyController.test.ts test/routes/internalResearchTargets.test.ts`
Expected: FAIL. POST still demands `jds`, and `/research-targets` returns 404.

- [ ] **Step 3: Add the AI-service client methods**

In `apps/api/src/integrations/aiService/client.ts`, add a section before `// --- transport`:

```ts
  // --- company research (Phase 1) -------------------------------------------------------------

  /** Research state per company `{states: [...]}`; null when the AI service is unreachable (lookup: never throws). */
  async companyResearchStates(ids: string[]): Promise<unknown | null> {
    try {
      return await this.getJson(`/research/companies/state?ids=${ids.map(encodeURIComponent).join(",")}`);
    } catch (err) {
      if (err instanceof UpstreamError) {
        this.log.warn({ err: err.message }, "AI service research-state lookup failed");
        return null;
      }
      throw err;
    }
  }

  startResearchRun(body: unknown): Promise<unknown> {
    return this.postJson("/research/runs", body);
  }

  listResearchRuns(limit: number): Promise<unknown> {
    return this.getJson(`/research/runs?limit=${limit}`);
  }

  getResearchRun(runId: string): Promise<unknown> {
    return this.getJson(`/research/runs/${seg(runId)}`);
  }

  controlResearchRun(runId: string, action: "pause" | "resume" | "stop"): Promise<unknown> {
    return this.postJson(`/research/runs/${seg(runId)}/${action}`);
  }

  async patchResearchBudget(runId: string, body: unknown): Promise<unknown> {
    const path = `/research/runs/${seg(runId)}/budget`;
    return this.nonEmptyJson(
      await this.send({ method: "PATCH", url: this.url(path), body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }),
      path,
    );
  }

  listResearchEvents(runId: string, query: URLSearchParams): Promise<unknown> {
    const qs = query.toString();
    return this.getJson(`/research/runs/${seg(runId)}/events${qs ? `?${qs}` : ""}`);
  }

  listResearchSpans(runId: string, companyId: string | null): Promise<unknown> {
    return this.getJson(`/research/runs/${seg(runId)}/spans${companyId ? `?company_id=${encodeURIComponent(companyId)}` : ""}`);
  }

  getResearchSpan(spanId: string): Promise<unknown> {
    return this.getJson(`/research/spans/${seg(spanId)}`);
  }
```

- [ ] **Step 4: Rewrite the admin company router**

In `apps/api/src/routes/admin.ts`:
- Delete the old `adminCompaniesRouter` and its now-unused helpers (`DEFAULT_ROLE`, `DEFAULT_SPECIALIZATION`, `slug`).
- Remove the now-unused imports (`LEVELS`, `UpstreamError`, `items`, `stringParam`, `isBlank` if unused).
- Add:

```ts
import { COMPANY_STATUSES, type CompanyRow, type CompanyStatus } from "../db/pg/schema.js";
import { slugify } from "../domain/slug.js";
import { ApiError } from "../lib/errors.js";
// (merge into the existing ../lib/json.js import so it reads: import { isObject, items, path } from "../lib/json.js";)

const MAX_ALIASES = 10;
const MAX_ALIAS_LENGTH = 100;

/** The AI service's per-company research state (spec §4.2 company_research_state). */
interface ResearchState {
  company_id: string;
  last_run_id?: string | null;
  last_researched_at?: string | null;
  last_status?: string | null;
  latest_draft_id?: string | null;
  latest_draft_status?: string | null;
}

function toAdminCompany(row: CompanyRow, state: ResearchState | undefined) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    website: row.website,
    aliases: row.aliases,
    status: row.status,
    origin: row.origin,
    tier: row.tier,
    publishedVersion: row.publishedVersion,
    publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    research: state
      ? {
          lastRunId: state.last_run_id ?? null,
          lastResearchedAt: state.last_researched_at ?? null,
          lastStatus: state.last_status ?? null,
          latestDraftId: state.latest_draft_id ?? null,
          latestDraftStatus: state.latest_draft_status ?? null,
        }
      : null,
  };
}

function parseName(raw: unknown): { name: string; slug: string } {
  const name = typeof raw === "string" ? raw.trim().replace(/\s+/g, " ") : "";
  const slug = slugify(name);
  if (!name || name.length > 255 || !slug) {
    throw new ApiError(400, "invalid_company", "name is required (up to 255 characters, with at least one letter or digit)");
  }
  return { name, slug };
}

function parseWebsite(raw: unknown): string | null {
  if (raw === undefined || raw === null || (typeof raw === "string" && raw.trim() === "")) return null;
  const invalid = new ApiError(400, "invalid_website", "website must be an http(s) URL like https://meesho.com");
  if (typeof raw !== "string") throw invalid;
  const trimmed = raw.trim();
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw invalid;
  }
  if (!["http:", "https:"].includes(url.protocol) || !url.hostname.includes(".") || /\s/.test(trimmed) || withScheme.length > 255) {
    throw invalid;
  }
  return withScheme;
}

function parseAliases(raw: unknown): string[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.some((a) => typeof a !== "string")) {
    throw new ApiError(400, "invalid_aliases", "aliases must be a list of strings");
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const alias of raw as string[]) {
    const clean = alias.trim().replace(/\s+/g, " ");
    if (!clean) continue;
    if (clean.length > MAX_ALIAS_LENGTH) throw new ApiError(400, "invalid_aliases", `each alias is at most ${MAX_ALIAS_LENGTH} characters`);
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
  }
  if (out.length > MAX_ALIASES) throw new ApiError(400, "invalid_aliases", `at most ${MAX_ALIASES} aliases`);
  return out;
}

/**
 * Admin company catalogue (Intelligence → Companies): the curated list the research job works
 * through. A new company starts unpublished: students see it only after an admin approves its
 * first research draft (Phase 2). The slug is fixed at creation; it joins JDs, briefs and research.
 */
export function adminCompaniesRouter(c: Container): Router {
  const r = router();

  /** Load the starter catalogue on demand. Idempotent, upsert-only. Does NOT trigger research. */
  r.post("/seed", async (_req, res) => {
    res.json(await c.seeder.seed());
  });

  r.get("/", async (_req, res) => {
    const rows = await c.repos.companies.findAll();
    const states = rows.length > 0 ? await c.aiService.companyResearchStates(rows.map((row) => row.id)) : { states: [] };
    const byId = new Map<string, ResearchState>();
    for (const s of items(path(states, "states"))) {
      if (isObject(s) && typeof s.company_id === "string") byId.set(s.company_id, s as unknown as ResearchState);
    }
    res.json({ companies: rows.map((row) => toAdminCompany(row, byId.get(row.id))), researchAvailable: states !== null });
  });

  r.post("/", async (req, res) => {
    const b = isObject(req.body) ? req.body : {};
    const { name, slug } = parseName(b.name);
    const website = parseWebsite(b.website);
    const aliases = parseAliases(b.aliases);
    if (await c.repos.companies.findBySlug(slug)) {
      sendError(res, 409, "company_exists", `a company with the slug "${slug}" already exists`);
      return;
    }
    const row = await c.repos.companies.create({ name, slug, website, aliases, origin: "admin" });
    res.status(201).json(toAdminCompany(row, undefined));
  });

  r.patch("/:id", async (req, res) => {
    const id = uuidParam(req, "id");
    const b = isObject(req.body) ? req.body : {};
    const patch: Partial<typeof companies.$inferInsert> = {};
    if ("name" in b) patch.name = parseName(b.name).name;
    if ("website" in b) patch.website = parseWebsite(b.website);
    if ("aliases" in b) patch.aliases = parseAliases(b.aliases);
    if ("status" in b) {
      if (typeof b.status !== "string" || !(COMPANY_STATUSES as readonly string[]).includes(b.status)) {
        throw new ApiError(400, "invalid_status", `status must be one of [${COMPANY_STATUSES.join(", ")}]`);
      }
      patch.status = b.status as CompanyStatus;
    }
    const row = Object.keys(patch).length > 0 ? await c.repos.companies.update(id, patch) : await c.repos.companies.findById(id);
    if (!row) {
      sendError(res, 404, "company_not_found", "no company with that id");
      return;
    }
    res.json(toAdminCompany(row, undefined));
  });

  r.delete("/:id", async (req, res) => {
    const id = uuidParam(req, "id");
    const row = await c.repos.companies.findById(id);
    if (!row) {
      sendError(res, 404, "company_not_found", "no company with that id");
      return;
    }
    await c.repos.jds.deleteByCompany(row.slug);
    await c.repos.roleConfigs.deleteByCompany(row.slug);
    await c.repos.companies.deleteById(id);
    res.status(204).end();
  });

  return r;
}
```

Add `companies` to the `../db/pg/schema.js` import (it's used for `$inferInsert`).

- [ ] **Step 5: Add the research-targets endpoint**

In `apps/api/src/routes/internal.ts`, after `/scrape-targets`, add:

```ts
  /** Company research targets: every ACTIVE company, published or not (spec §8.1). */
  r.get("/research-targets", async (_req, res) => {
    const rows = await c.repos.companies.findActive();
    res.json(rows.map((co) => ({ id: co.id, name: co.name, slug: co.slug, website: co.website, aliases: co.aliases })));
  });
```

- [ ] **Step 6: Run the API suite and typecheck**

Run: `pnpm --filter @interviewiq/api test && pnpm --filter @interviewiq/api typecheck`
Expected: PASS.

- [ ] **Step 7: Checkpoint**

Run `git status`; leave the changes uncommitted.

---

