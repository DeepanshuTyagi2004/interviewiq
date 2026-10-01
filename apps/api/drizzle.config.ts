import { defineConfig } from "drizzle-kit";

/**
 * `pnpm db:generate` diffs src/db/pg/schema.ts against the snapshots in ./drizzle and writes a
 * new SQL migration. Migrations are applied by the API at startup (DATABASE_MIGRATE_ON_START) or
 * with `pnpm db:migrate`.
 *
 * NOTE: 0000_baseline.sql is hand-guarded with IF NOT EXISTS so it is a no-op against the
 * database the Spring/Hibernate backend already created. Keep new migrations additive.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/pg/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL ?? "postgres://localhost:5432/interviewiq" },
  strict: true,
});
