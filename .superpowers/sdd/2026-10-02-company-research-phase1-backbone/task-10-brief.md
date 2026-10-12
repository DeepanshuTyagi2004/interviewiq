## Task 10: Catalogue schema, migration, slug, seeder and the student filter

**Files:**
- Modify: `apps/api/src/db/pg/schema.ts`, `apps/api/src/repositories/pg.ts`, `apps/api/src/services/catalogueSeeder.ts`, `apps/api/src/routes/catalogue.ts`, `apps/api/test/routes/helpers.ts`, `apps/api/test/routes/adminCompanyController.test.ts` (the seed describe block only), `apps/api/test/db/hibernateCompat.test.ts`
- Create: `apps/api/drizzle/0002_company_research.sql` (generated) and its snapshot, `apps/api/src/domain/slug.ts`
- Test: `apps/api/test/domain/slug.test.ts`, `apps/api/test/db/companyResearchMigration.test.ts`, `apps/api/test/routes/companiesController.test.ts`

**Interfaces:**
- Produces:
  - `slugify(name: string): string`, with the same output as Python's `slugify`.
  - `COMPANY_STATUSES = ["active","archived"] as const`, `COMPANY_ORIGINS = ["seed","admin"] as const` and `ReviewQuote`.
  - New `CompanyRow` fields: `website`, `aliases: string[]`, `sector`, `businessModel`, `headcountBand`, `revenueBand`, `fundingStage`, `tierRationale`, `wlbRating`, `wlbReviewCount`, `reviewSummary`, `reviewQuotes`, `status`, `origin`, `publishedVersion`, `publishedAt`.
  - New `JobDescriptionRow` fields: `yoeMin`, `yoeMax`, `ctcMinLpa`, `ctcMaxLpa`, `ctcSourceCount`, `roleKey`.
  - New `CompanyRepository` methods:
    - `findById(id)`
    - `findPublished()`: `published_at` not null and `status = active`, ordered by `createdAt`
    - `findActive()`
    - `create(row): Promise<CompanyRow>`
    - `update(id, patch): Promise<CompanyRow | null>`
    - `deleteById(id)`
  - `CompanyRoleConfigRepository.deleteByCompany(company)`.
  - `SeedResult = {companies, inserted, backfilled, total}`.
- Removes: `deleteAllExceptSlugs` and both `deleteAllExceptCompanies` methods.

- [ ] **Step 1: Write the failing slug test**

`apps/api/test/domain/slug.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { slugify } from "../../src/domain/slug.js";

// Mirrored verbatim in apps/ai-service/tests/research/test_identity.py: a slug joins Postgres rows,
// briefs and research fixture folders, so both languages must agree exactly.
const CASES: Array<[string, string]> = [
  ["Meesho", "meesho"],
  ["  Big   Co ", "big-co"],
  ["Tata Consultancy Services (TCS)", "tata-consultancy-services-tcs"],
  ["AT&T", "at-and-t"],
  ["Café Coffee Day", "cafe-coffee-day"],
  ["Straße Labs", "strae-labs"],
];

describe("slugify", () => {
  it.each(CASES)("%s → %s", (name, expected) => {
    expect(slugify(name)).toBe(expected);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @interviewiq/api exec vitest run test/domain/slug.test.ts`
Expected: FAIL. Cannot find module `src/domain/slug.js`.

- [ ] **Step 3: Implement `slugify`**

`apps/api/src/domain/slug.ts`:

```ts
/**
 * Company slug: the join key between Postgres rows, AI-service briefs and research fixtures.
 * MUST stay byte-identical to apps/ai-service/app/research/normalize/identity.py::slugify:
 * NFKD-fold, drop non-ASCII, lowercase, "&" → " and ", non-alphanumerics → "-", trim "-".
 */
export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[^\x00-\x7f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
```

Run the slug test again. Expected: PASS.

- [ ] **Step 4: Extend the schema**

In `apps/api/src/db/pg/schema.ts`:
- Add `jsonb` and `numeric` to the `drizzle-orm/pg-core` import list.
- Add `import { sql } from "drizzle-orm";`.
- Replace the `companies` table with the version below.

```ts
export const COMPANY_STATUSES = ["active", "archived"] as const;
export type CompanyStatus = (typeof COMPANY_STATUSES)[number];
export const COMPANY_ORIGINS = ["seed", "admin"] as const;
export type CompanyOrigin = (typeof COMPANY_ORIGINS)[number];

/** A short attributed quote from a public review, shown to students with its link (spec §4.1). */
export interface ReviewQuote {
  text: string;
  sourceUrl: string;
  sourceName: string | null;
  date: string | null;
}

/**
 * A company students can target. `slug` joins to JDs, role configs and the AI-service brief keys.
 * Students only ever see rows with `publishedAt` set and `status = active` (spec §4.1); everything
 * below `companySize` is written only when an admin approves a research draft (Phase 2+).
 */
export const companies = pgTable("companies", {
  id: id(),
  name: varchar("name", { length: 255 }).notNull(),
  slug: varchar("slug", { length: 255 }).notNull().unique(),
  /** Placement tier 1-4 (pay band + selectivity, spec §6.4); descriptive metadata only. */
  tier: integer("tier"),
  logoUrl: varchar("logo_url", { length: 255 }),
  headquarterLocation: varchar("headquarter_location", { length: 255 }),
  companySize: varchar("company_size", { length: 255 }),
  createdAt: createdAt(),
  website: varchar("website", { length: 255 }),
  aliases: text("aliases").array().notNull().default(sql`'{}'::text[]`),
  sector: varchar("sector", { length: 64 }),
  businessModel: varchar("business_model", { length: 16 }),
  headcountBand: varchar("headcount_band", { length: 32 }),
  revenueBand: varchar("revenue_band", { length: 32 }),
  fundingStage: varchar("funding_stage", { length: 32 }),
  tierRationale: text("tier_rationale"),
  wlbRating: numeric("wlb_rating", { precision: 2, scale: 1 }),
  wlbReviewCount: integer("wlb_review_count"),
  reviewSummary: text("review_summary"),
  reviewQuotes: jsonb("review_quotes").$type<ReviewQuote[]>().notNull().default([]),
  status: varchar("status", { length: 16, enum: COMPANY_STATUSES }).notNull().default("active"),
  origin: varchar("origin", { length: 16, enum: COMPANY_ORIGINS }).notNull().default("admin"),
  publishedVersion: integer("published_version"),
  publishedAt: instant("published_at"),
});
```

In the `jobDescriptions` table, add these columns after `active`:

```ts
    /** Research-derived role facts (spec §4.1), written on draft approval (Phase 3). */
    yoeMin: numeric("yoe_min", { precision: 3, scale: 1 }),
    yoeMax: numeric("yoe_max", { precision: 3, scale: 1 }),
    ctcMinLpa: numeric("ctc_min_lpa", { precision: 6, scale: 2 }),
    ctcMaxLpa: numeric("ctc_max_lpa", { precision: 6, scale: 2 }),
    ctcSourceCount: integer("ctc_source_count"),
    /** Stable role identity across research runs: slug(level + specialization + title). */
    roleKey: varchar("role_key", { length: 128 }),
```

Then change its table extras to:

```ts
  (t) => [index("idx_jd_company_level").on(t.company, t.level), unique("uq_jd_company_role_key").on(t.company, t.roleKey)],
```

- [ ] **Step 5: Generate the migration, then add the backfill**

Run: `pnpm --filter @interviewiq/api exec drizzle-kit generate --name company_research`
Expected: this creates `apps/api/drizzle/0002_company_research.sql` and `drizzle/meta/0002_snapshot.json`, and updates `_journal.json`.

The SQL must contain only `ALTER TABLE … ADD COLUMN` statements for the 16 company columns and 6 JD columns, plus `ADD CONSTRAINT "uq_jd_company_role_key" UNIQUE("company","role_key")`. If drizzle-kit asks about renames, answer "create column" every time. Nothing is renamed.

Append these lines to the end of `0002_company_research.sql`:

```sql
--> statement-breakpoint
-- Companies created before research existed were seeded and already visible to students: keep
-- them visible (published) and mark where they came from.
UPDATE "companies" SET "published_at" = "created_at", "origin" = 'seed' WHERE "published_at" IS NULL;
```

- [ ] **Step 6: Write the failing migration, student-filter and seeder tests**

`apps/api/test/db/companyResearchMigration.test.ts`:

```ts
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { describe, expect, it } from "vitest";
import { MIGRATIONS_FOLDER } from "../../src/db/pg/client.js";

/** A copy of the migrations folder whose journal stops just BEFORE `tag`. */
function migrationsBefore(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), "iq-migrations-"));
  cpSync(MIGRATIONS_FOLDER, dir, { recursive: true });
  const journalPath = join(dir, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: Array<{ tag: string }> };
  journal.entries = journal.entries.slice(0, journal.entries.findIndex((e) => e.tag === tag));
  writeFileSync(journalPath, JSON.stringify(journal));
  return dir;
}

describe("0002_company_research", () => {
  it("publishes every company that existed before research, so none disappears for students", async () => {
    const client = new PGlite();
    try {
      await migrate(drizzle(client), { migrationsFolder: migrationsBefore("0002_company_research") });
      await client.query(
        `insert into companies (id, name, slug, tier, created_at) values (gen_random_uuid(), 'Meesho', 'meesho', 2, '2026-01-01T00:00:00Z')`,
      );
      await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER });
      const { rows } = await client.query<{ published_at: Date; origin: string; status: string; aliases: string[] }>(
        "select published_at, origin, status, aliases from companies",
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.published_at.toISOString()).toBe("2026-01-01T00:00:00.000Z");
      expect(rows[0]).toMatchObject({ origin: "seed", status: "active", aliases: [] });
    } finally {
      await client.close();
    }
  });
});
```

`apps/api/test/routes/companiesController.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bearer, createUser, createTestEnv, type TestEnv } from "../support/harness.js";
import { seedCompany } from "./helpers.js";

describe("GET /api/v1/companies (student catalogue)", () => {
  let env: TestEnv;
  let user: string;
  beforeAll(async () => {
    env = await createTestEnv();
    user = await bearer(env, await createUser(env));
  });
  afterAll(() => env.close());

  it("lists only published, active companies — never unpublished research targets or archived ones", async () => {
    await seedCompany(env, "meesho", "Meesho");
    await seedCompany(env, "draft-co", "Draft Co", { publishedAt: null });
    await seedCompany(env, "old-co", "Old Co", { status: "archived" });
    const res = await env.http.get("/api/v1/companies").set("Authorization", user);
    expect(res.status).toBe(200);
    expect(res.body.map((c: { slug: string }) => c.slug)).toEqual(["meesho"]);
  });
});
```

In `apps/api/test/routes/helpers.ts`, replace `seedCompany` with:

```ts
export async function seedCompany(
  env: Env,
  slug: string,
  name: string,
  overrides: Partial<typeof companies.$inferInsert> = {},
): Promise<void> {
  // Published by default: most tests model the catalogue students already see.
  await env.c.repos.companies.insert({ name, slug, tier: 2, publishedAt: new Date(), ...overrides });
}
```

Add `companies` to that file's `import type { … } from "../../src/db/pg/schema.js"` list.

In `apps/api/test/routes/adminCompanyController.test.ts`, change the first test of the `POST /admin/companies/seed` describe block to:

```ts
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
```

Change the idempotency test's expected body to `{ companies: 0, inserted: 0, backfilled: 0, total: 3 }`. Delete its two `list` assertions; the list shape changes in Task 11.

- [ ] **Step 7: Run them to verify they fail**

Run: `pnpm --filter @interviewiq/api exec vitest run test/db/companyResearchMigration.test.ts test/routes/companiesController.test.ts test/routes/adminCompanyController.test.ts -t "seed|published|0002"`
Expected: FAIL. `draft-co` and `old-co` are listed, the seed result still has `removed`, and Acme is deleted.

- [ ] **Step 8: Implement the repository, seeder and filter changes**

In `apps/api/src/repositories/pg.ts`, replace `CompanyRepository` with the version below and add `isNotNull` to the `drizzle-orm` import:

```ts
export class CompanyRepository {
  constructor(private readonly db: Database) {}

  findAll(): Promise<CompanyRow[]> {
    return this.db.select().from(companies).orderBy(asc(companies.createdAt));
  }

  findById(id: string): Promise<CompanyRow | null> {
    return this.db.select().from(companies).where(eq(companies.id, id)).then(one);
  }

  findBySlug(slug: string): Promise<CompanyRow | null> {
    return this.db.select().from(companies).where(eq(companies.slug, slug)).then(one);
  }

  findAllBySlug(slugs: string[]): Promise<CompanyRow[]> {
    if (slugs.length === 0) return Promise.resolve([]);
    return this.db.select().from(companies).where(inArray(companies.slug, [...new Set(slugs)]));
  }

  /** What students see: approved (published) and not archived. */
  findPublished(): Promise<CompanyRow[]> {
    return this.db
      .select()
      .from(companies)
      .where(and(isNotNull(companies.publishedAt), eq(companies.status, "active")))
      .orderBy(asc(companies.createdAt));
  }

  /** Research targets: every non-archived company, published or not. */
  findActive(): Promise<CompanyRow[]> {
    return this.db.select().from(companies).where(eq(companies.status, "active")).orderBy(asc(companies.createdAt));
  }

  async insert(row: Insert<typeof companies>): Promise<void> {
    await this.db.insert(companies).values(row);
  }

  create(row: Insert<typeof companies>): Promise<CompanyRow> {
    return this.db
      .insert(companies)
      .values(row)
      .returning()
      .then((r) => r[0]!);
  }

  update(id: string, patch: Partial<Insert<typeof companies>>): Promise<CompanyRow | null> {
    return this.db.update(companies).set(patch).where(eq(companies.id, id)).returning().then(one);
  }

  async deleteById(id: string): Promise<void> {
    await this.db.delete(companies).where(eq(companies.id, id));
  }

  async deleteBySlug(slug: string): Promise<void> {
    await this.db.delete(companies).where(eq(companies.slug, slug));
  }
}
```

Also in `pg.ts`:
- In `CompanyRoleConfigRepository`, replace `deleteAllExceptCompanies` with:

```ts
  async deleteByCompany(company: string): Promise<void> {
    await this.db.delete(companyRoleConfigs).where(eq(companyRoleConfigs.company, company));
  }
```

- Delete `JobDescriptionRepository.deleteAllExceptCompanies`.
- If `notInArray` is now unused, remove it from the import.

In `apps/api/src/services/catalogueSeeder.ts`:
- Delete the `MVP_COMPANIES` constant and the whole "Enforce MVP scope" block (`removed += …` ×3).
- Change the doc comment to: "Loads the starter catalogue ON DEMAND (admin "Load starter companies"), never on startup. Upsert-only: re-running refreshes Meesho's seed JDs and backfills missing role-config fields; it never deletes other companies (admin- and research-added companies live alongside the seed)."
- Change the company insert to:

```ts
        await this.companies.insert({
          name: cs.name, slug: cs.slug, tier: cs.tier, logoUrl: null, headquarterLocation: cs.hq,
          companySize: cs.size, origin: "seed", publishedAt: new Date(),
        });
```

- Change the result interface and return:

```ts
export interface SeedResult {
  companies: number;
  inserted: number;
  backfilled: number;
  total: number;
}
```

```ts
    this.log.info(
      `Catalogue seed: ${companiesSeeded} companies, ${inserted} combos inserted, ${backfilled} backfilled, ` +
        `${JD_SEEDS.length} role-based JDs (across ${SEEDS.length} brief combos)`,
    );
    return { companies: companiesSeeded, inserted, backfilled, total: JD_SEEDS.length };
```

In `apps/api/src/routes/catalogue.ts`, change `companiesRouter`'s `c.repos.companies.findAll()` to `c.repos.companies.findPublished()`.

- [ ] **Step 9: Update the Hibernate compatibility expectations**

`test/db/hibernateCompat.test.ts` pins the exact columns, constraints and indexes the migrations add. Extend its three expected lists:

1. In the `added(after.cols, …)` list, keep the existing entries and add these after `auth_token.user_id uuid null=NO`, in this order:

```ts
      "companies.aliases ARRAY null=NO",
      "companies.business_model character varying null=YES",
      "companies.funding_stage character varying null=YES",
      "companies.headcount_band character varying null=YES",
      "companies.origin character varying null=NO",
      "companies.published_at timestamp with time zone null=YES",
      "companies.published_version integer null=YES",
      "companies.revenue_band character varying null=YES",
      "companies.review_quotes jsonb null=NO",
      "companies.review_summary text null=YES",
      "companies.sector character varying null=YES",
      "companies.status character varying null=NO",
      "companies.tier_rationale text null=YES",
      "companies.website character varying null=YES",
      "companies.wlb_rating numeric null=YES",
      "companies.wlb_review_count integer null=YES",
      "job_descriptions.ctc_max_lpa numeric null=YES",
      "job_descriptions.ctc_min_lpa numeric null=YES",
      "job_descriptions.ctc_source_count integer null=YES",
      "job_descriptions.role_key character varying null=YES",
      "job_descriptions.yoe_max numeric null=YES",
      "job_descriptions.yoe_min numeric null=YES",
```

2. In the constraints list, add `"job_descriptions UNIQUE (company, role_key)"` after the three `auth_token` entries.
3. In the index list, add `"CREATE UNIQUE INDEX uq_jd_company_role_key ON public.job_descriptions USING btree (company, role_key)"` at the end.
4. Update the comment `...and the additions are exactly 0001_password_auth's.` to `...and the additions are exactly 0001_password_auth's and 0002_company_research's.`

If PGlite prints a type differently from the strings above (e.g. `text[]` instead of `ARRAY`), use PGlite's spelling. What matters is that the set of additions is exactly these columns.

- [ ] **Step 10: Run the whole API suite**

Run: `pnpm --filter @interviewiq/api test && pnpm --filter @interviewiq/api typecheck`
Expected: PASS.

Some old catalogue CRUD tests in `adminCompanyController.test.ts` (POST with `jds`, GET grouped by company, DELETE by slug) still fail. Task 11 rewrites them. If you run Task 10 alone, mark that describe block `describe.skip` with the comment `// rewritten in Task 11` until then.

- [ ] **Step 11: Checkpoint**

Run `git status`; leave the changes uncommitted.

---

