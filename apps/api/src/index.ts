import { createServer } from "node:http";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createContainer } from "./container.js";
import { collections, connectMongo, ensureMongoIndexes } from "./db/mongo/client.js";
import { createDatabase, createPgPool, runMigrations } from "./db/pg/client.js";
import { fixedDelay, fixedRate, type ScheduledTask } from "./jobs/scheduler.js";
import { createLogger } from "./lib/logger.js";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

async function main() {
  const config = loadConfig();
  const log = createLogger(config.log);

  // Postgres (Supabase in prod) — relational core.
  const pool = createPgPool(config.postgres);
  await pool.query("select 1");
  if (config.postgres.migrateOnStart) {
    await runMigrations(pool);
    log.info("Postgres migrations applied");
  }
  const db = createDatabase(pool);

  // MongoDB (Atlas in prod) — documents.
  const mongo = await connectMongo(config.mongo.uri, config.mongo.database);
  const mongoCollections = collections(mongo.db);
  await ensureMongoIndexes(mongoCollections);
  log.info(`Connected to MongoDB (db=${config.mongo.database})`);

  const c = createContainer({ config, log, db, mongo: mongoCollections });
  const server = createServer(createApp(c));

  const tasks: ScheduledTask[] = [];
  if (config.interviewPrep.schedulerEnabled) {
    const p = config.interviewPrep;
    tasks.push(
      fixedDelay("interview-prep", () => c.jobs.interviewPrep.prepareDueSessions(), { initialDelayMs: p.pollInitialDelayMs, delayMs: p.pollIntervalMs }, log),
      fixedRate("github-refresh", () => c.jobs.githubRefresh.refreshAll(), { initialDelayMs: 60_000, periodMs: WEEK_MS }, log),
      fixedRate("leetcode-refresh", () => c.jobs.leetcodeRefresh.refreshAll(), { initialDelayMs: 120_000, periodMs: WEEK_MS }, log),
    );
  }

  server.listen(config.port, () => log.info(`interviewiq-api listening on :${config.port}`));

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info(`${signal} received — shutting down`);
    tasks.forEach((t) => t.stop());
    await new Promise<void>((resolve) => server.close(() => resolve()));
    // Give in-flight background work (prep polling, LeetCode sync) a bounded chance to finish.
    await Promise.race([Promise.all([c.background.drain(), ...tasks.map((t) => t.idle())]), new Promise((r) => setTimeout(r, 10_000))]);
    await Promise.allSettled([pool.end(), mongo.client.close()]);
    log.info("shutdown complete");
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err: unknown) => {
  console.error("interviewiq-api failed to start:", err);
  process.exit(1);
});
