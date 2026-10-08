/**
 * Shared bootstrap for dev scripts: the real config, Postgres, Mongo and container, closed on exit.
 * From apps/api: `pnpm exec tsx --env-file=.env scripts/dev/<script>.ts`.
 */
import { loadConfig } from "../../src/config.js";
import { createContainer, type Container } from "../../src/container.js";
import { collections, connectMongo } from "../../src/db/mongo/client.js";
import { createDatabase, createPgPool } from "../../src/db/pg/client.js";
import { createLogger } from "../../src/lib/logger.js";

export async function withContainer<T>(fn: (c: Container) => Promise<T>): Promise<T> {
  const config = loadConfig();
  const log = createLogger({ level: "warn", pretty: true });
  const pool = createPgPool(config.postgres);
  const mongo = await connectMongo(config.mongo.uri, config.mongo.database);
  try {
    return await fn(createContainer({ config, log, db: createDatabase(pool), mongo: collections(mongo.db) }));
  } finally {
    await Promise.allSettled([pool.end(), mongo.client.close()]);
  }
}

/** Deterministic small PRNG so fabricated activity is stable between runs. */
export function seeded(seed: string): () => number {
  let h = 2166136261;
  for (const ch of seed) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 10_000) / 10_000; };
}
