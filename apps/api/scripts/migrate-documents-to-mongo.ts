/**
 * One-off: copy the document data the Spring backend kept in Postgres jsonb into MongoDB
 * (candidate_profile, profile_fragment, interview_sessions.outcome). See src/db/migrateDocuments.ts.
 *
 * Everything else stays in Postgres, in the same tables — the Node API reads them as-is.
 * Postgres is only READ; drop the legacy tables/column yourself once you've verified the copy.
 *
 * Usage (from apps/api, with DATABASE_URL + MONGODB_URI in .env or the environment):
 *   pnpm migrate:documents             # copy (existing Mongo docs are kept)
 *   pnpm migrate:documents --dry-run   # count only
 *   pnpm migrate:documents --overwrite # replace existing Mongo documents
 */
import { collections, connectMongo } from "../src/db/mongo/client.js";
import { migrateDocuments } from "../src/db/migrateDocuments.js";
import { createPgPool, type SslMode } from "../src/db/pg/client.js";

const dryRun = process.argv.includes("--dry-run");
const overwrite = process.argv.includes("--overwrite");

const databaseUrl = process.env.DATABASE_URL;
const mongoUri = process.env.MONGODB_URI;
if (!databaseUrl || !mongoUri) {
  console.error("DATABASE_URL and MONGODB_URI are required");
  process.exit(1);
}

const pool = createPgPool({
  url: databaseUrl,
  ssl: (process.env.DATABASE_SSL as SslMode | undefined) ?? "auto",
  sslCaFile: process.env.DATABASE_SSL_CA || undefined,
  poolMax: 2,
});
const mongo = await connectMongo(mongoUri, process.env.MONGODB_DATABASE || "interviewiq");

try {
  const reports = await migrateDocuments({
    query: (text, params) => pool.query(text, params),
    mongo: collections(mongo.db),
    dryRun,
    overwrite,
    warn: (m) => console.warn(m),
  });
  for (const r of reports) {
    if (r.skipped) console.log(`${r.table}: skipped (${r.skipped})`);
    else if (dryRun) console.log(`${r.table}: ${r.rows} row(s) (dry run — nothing written)`);
    else console.log(`${r.table}: ${r.rows} row(s) → ${r.inserted} inserted, ${r.replaced} replaced, ${r.rows - r.inserted - r.replaced} already present`);
  }
  console.log(dryRun ? "Dry run complete." : "Done. Verify in Mongo, then drop the legacy Postgres tables/column when ready.");
} catch (err) {
  console.error("Migration failed:", err);
  process.exitCode = 1;
} finally {
  await pool.end();
  await mongo.client.close();
}
