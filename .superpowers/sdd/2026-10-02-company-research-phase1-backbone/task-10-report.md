# Task 10 report

Status: DONE. Nothing committed (working tree).

## Implemented
Slug (`src/domain/slug.ts`), schema (companies + job_descriptions columns, status/origin consts, ReviewQuote), generated migration `drizzle/0002_company_research.sql` + `meta/0002_snapshot.json` + journal (drizzle-kit ran non-interactively, no prompts), backfill UPDATE appended, repository changes (findById/findPublished/findActive/create/update/deleteById; roleConfigs.deleteByCompany; removed deleteAllExcept* x3 and unused notInArray import), seeder (upsert-only, origin seed + publishedAt, no `removed`), `companiesRouter` uses findPublished, test helper `seedCompany` overrides, adminCompanyController seed tests, hibernateCompat expectations.

## TDD
RED (slug): `vitest run test/domain/slug.test.ts` -> "Failed to load url ../../src/domain/slug.js ... Does the file exist?"; GREEN: 6 passed.
RED (filter/seed), after schema+migration, before repo/seeder/router edits:
- companiesController: expected [ 'meesho', 'draft-co', 'old-co' ] to deeply equal [ 'meesho' ]
- seed tests: result keys still include "removed" (2 failures).
The migration test passed at that point because the migration was generated in Step 5 before the test was written (brief order); it was not seen failing.
GREEN: `pnpm --filter @interviewiq/api test` -> 40 files, 505 tests passed; `typecheck` clean.

## Generated migration SQL
22 `ALTER TABLE ... ADD COLUMN` statements (16 companies, 6 job_descriptions; aliases `text[] DEFAULT '{}'::text[] NOT NULL`, review_quotes `jsonb DEFAULT '[]'::jsonb NOT NULL`, status default 'active', origin default 'admin'), then
`ALTER TABLE "job_descriptions" ADD CONSTRAINT "uq_jd_company_role_key" UNIQUE("company","role_key");`
followed by the appended:
```
--> statement-breakpoint
UPDATE "companies" SET "published_at" = "created_at", "origin" = 'seed' WHERE "published_at" IS NULL;
```

## Deviations / notes
- None to the brief's code. hibernateCompat strings matched PGlite spelling ("ARRAY") as in the brief.
- Old company-CRUD tests in adminCompanyController.test.ts did NOT fail; no describe.skip added.
- `jdsRouter` still calls `companies.findAll()` (brief only changes `companiesRouter`); JD list therefore can still show JDs of unpublished companies - flag for Task 11 / controller.
- Files untouched: profile* files.
