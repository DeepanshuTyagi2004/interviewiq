/**
 * `pnpm --filter @interviewiq/api db:migrate` — apply pending Postgres migrations and exit.
 * Needs only DATABASE_URL (+ optional DATABASE_SSL / DATABASE_SSL_CA).
 */
import { createPgPool, runMigrations, type SslMode } from "./client.js";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const pool = createPgPool({
  url,
  ssl: (process.env.DATABASE_SSL as SslMode | undefined) ?? "auto",
  sslCaFile: process.env.DATABASE_SSL_CA || undefined,
  poolMax: 1,
});

try {
  await runMigrations(pool);
  console.log("Postgres migrations applied");
} catch (err) {
  console.error("Migration failed:", err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
