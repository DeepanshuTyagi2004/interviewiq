import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import pg from "pg";
import type { ConnectionOptions } from "node:tls";
import * as schema from "./schema.js";

export type Schema = typeof schema;

/**
 * Driver-agnostic database handle. Production uses node-postgres; tests use in-process PGlite.
 * Both are PgDatabase subclasses, so repositories are written once against this type.
 */
export type Database = PgDatabase<PgQueryResultHKT, Schema, ExtractTablesWithRelations<Schema>>;

export const MIGRATIONS_FOLDER = fileURLToPath(new URL("../../../drizzle", import.meta.url));

export type SslMode = "auto" | "disable" | "require" | "verify-full";

export interface PgSettings {
  url: string;
  ssl: SslMode;
  sslCaFile?: string;
  poolMax: number;
}

const SSL_URL_PARAMS = ["sslmode", "sslrootcert", "sslcert", "sslkey", "uselibpqcompat"];

/**
 * Resolve TLS settings explicitly instead of letting `?sslmode=` in the URL decide.
 *
 * node-postgres gives URL params precedence over the `ssl` option, and newer versions treat
 * `sslmode=require` as full certificate verification — which fails against Supabase's pooler
 * unless you ship their CA. So we strip the SSL params from the URL and map them ourselves:
 *   disable     → plain TCP (local Docker Postgres)
 *   require     → TLS without certificate verification (libpq's `require` semantics)
 *   verify-full → TLS + verification (optionally against DATABASE_SSL_CA, e.g. Supabase's CA)
 *   auto        → the URL's sslmode if present, else `require` for Supabase hosts, else `disable`
 */
export function resolvePgConnection(settings: Pick<PgSettings, "url" | "ssl" | "sslCaFile">): {
  connectionString: string;
  ssl: false | ConnectionOptions;
} {
  const url = new URL(settings.url);
  const urlMode = url.searchParams.get("sslmode");
  for (const p of SSL_URL_PARAMS) url.searchParams.delete(p);

  let mode: Exclude<SslMode, "auto"> = "disable";
  if (settings.ssl !== "auto") {
    mode = settings.ssl;
  } else if (urlMode) {
    mode = urlMode === "disable" || urlMode === "allow" ? "disable" : urlMode.startsWith("verify") ? "verify-full" : "require";
  } else if (/\.supabase\.(co|com)$/i.test(url.hostname)) {
    mode = "require";
  }

  const ssl: false | ConnectionOptions =
    mode === "disable"
      ? false
      : mode === "require"
        ? { rejectUnauthorized: false }
        : { rejectUnauthorized: true, ...(settings.sslCaFile ? { ca: readFileSync(settings.sslCaFile, "utf8") } : {}) };

  return { connectionString: url.toString(), ssl };
}

const reportIdleError = (err: Error): void => {
  console.error(`Postgres: an idle connection failed (${err.message}); the pool reconnects on the next query.`);
};

/**
 * A pooled connection that fails while idle (the database restarts, the network drops, the laptop
 * sleeps) makes the pool emit "error". With no listener Node treats that as unhandled and the whole
 * process exits. The pool has already discarded the broken connection and opens a new one on the
 * next query, so the error is only reported.
 */
export function createPgPool(settings: PgSettings, onIdleError: (err: Error) => void = reportIdleError): pg.Pool {
  const { connectionString, ssl } = resolvePgConnection(settings);
  const pool = new pg.Pool({ connectionString, ssl, max: settings.poolMax });
  pool.on("error", onIdleError);
  return pool;
}

export function createDatabase(pool: pg.Pool): Database {
  return drizzle(pool, { schema }) as unknown as Database;
}

/** Apply pending migrations from ./drizzle (the Hibernate `ddl-auto=update` replacement). */
export async function runMigrations(pool: pg.Pool): Promise<void> {
  await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_FOLDER });
}
