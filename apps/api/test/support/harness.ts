import { randomBytes, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { MongoClient } from "mongodb";
import supertest from "supertest";
import { inject } from "vitest";
import { createApp } from "../../src/app.js";
import { type Config, loadConfig } from "../../src/config.js";
import { createContainer, type Container } from "../../src/container.js";
import { collections, ensureMongoIndexes, type MongoCollections } from "../../src/db/mongo/client.js";
import { type Database, MIGRATIONS_FOLDER } from "../../src/db/pg/client.js";
import * as schema from "../../src/db/pg/schema.js";
import type { UserRow } from "../../src/db/pg/schema.js";
import type { Role } from "../../src/domain/enums.js";
import type { AuthRateLimits } from "../../src/http/rateLimit.js";
import { silentLogger } from "../../src/lib/logger.js";
import { FakeFetch } from "./fakeFetch.js";
import { FakeMailer } from "./fakeMailer.js";

export const TEST_INTERNAL_KEY = "test-internal-key";
export const TEST_TOKEN_KEY = randomBytes(32).toString("base64");

/** A valid config with test values; override any env var. */
export function testConfig(env: Record<string, string> = {}): Config {
  return loadConfig({
    NODE_ENV: "test",
    LOG_PRETTY: "false",
    DATABASE_URL: "postgres://unused:unused@localhost:5432/unused",
    MONGODB_URI: "mongodb://unused",
    GOOGLE_CLIENT_ID: "google-client-id",
    GOOGLE_CLIENT_SECRET: "google-client-secret",
    JWT_SECRET: "test-jwt-secret-that-is-at-least-32-bytes-long!!",
    GITHUB_OAUTH_CLIENT_ID: "gh-client-id",
    GITHUB_OAUTH_CLIENT_SECRET: "gh-client-secret",
    GITHUB_TOKEN_KEY: TEST_TOKEN_KEY,
    INTERNAL_API_KEY: TEST_INTERNAL_KEY,
    LIVEKIT_URL: "wss://livekit.test",
    LIVEKIT_API_KEY: "lk-key",
    LIVEKIT_API_SECRET: "lk-secret-lk-secret-lk-secret-lk-secret",
    AI_SERVICE_BASE_URL: "http://ai.test",
    INTERVIEW_PREP_PLAN_POLL_INTERVAL_MS: "1",
    INTERVIEW_PREP_PLAN_MAX_WAIT_MS: "2000",
    ...env,
  });
}

/** Fresh in-process Postgres (PGlite) with all migrations applied. */
export async function createTestDb(): Promise<{ db: Database; close: () => Promise<void> }> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return { db: db as unknown as Database, close: () => client.close() };
}

/** A fresh database on the shared in-memory mongod. */
export async function createTestMongo(): Promise<{ mongo: MongoCollections; close: () => Promise<void> }> {
  const client = await MongoClient.connect(inject("mongoUri"));
  const db = client.db(`test_${randomUUID().replaceAll("-", "")}`);
  const mongo = collections(db);
  await ensureMongoIndexes(mongo);
  return {
    mongo,
    close: async () => {
      await db.dropDatabase();
      await client.close();
    },
  };
}

export interface TestEnv {
  c: Container;
  db: Database;
  mongo: MongoCollections;
  fetch: FakeFetch;
  /** Captures verify/reset emails (the app never logs links in tests). */
  mailer: FakeMailer;
  http: ReturnType<typeof supertest>;
  close: () => Promise<void>;
}

/**
 * Every supertest request comes from 127.0.0.1, so the production auth rate limits would trip
 * across unrelated tests. Tests get effectively-unlimited defaults; rate-limit tests pass tiny ones.
 */
const UNLIMITED = { limit: 1_000_000, windowMs: 60_000 };
const TEST_AUTH_RATE_LIMITS: AuthRateLimits = {
  loginPerIpEmail: UNLIMITED,
  loginPerIp: UNLIMITED,
  register: UNLIMITED,
  forgotPassword: UNLIMITED,
  resendVerification: UNLIMITED,
};

/** Full app wiring against PGlite + in-memory Mongo, with all outbound HTTP stubbed. */
export async function createTestEnv(env: Record<string, string> = {}, opts: { authRateLimits?: Partial<AuthRateLimits> } = {}): Promise<TestEnv> {
  const pg = await createTestDb();
  const m = await createTestMongo();
  const fetch = new FakeFetch();
  const mailer = new FakeMailer();
  const c = createContainer({
    config: testConfig(env),
    log: silentLogger(),
    db: pg.db,
    mongo: m.mongo,
    fetch: fetch.fetch,
    mailer,
    authRateLimits: { ...TEST_AUTH_RATE_LIMITS, ...opts.authRateLimits },
  });
  const server = await listenOnLoopback(createApp(c));
  return {
    c,
    db: pg.db,
    mongo: m.mongo,
    fetch,
    mailer,
    http: supertest(server),
    close: async () => {
      await c.background.drain();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await Promise.all([pg.close(), m.close()]);
    },
  };
}

/**
 * One server per test env, bound explicitly to 127.0.0.1. Handing supertest the bare app instead
 * makes it `listen(0)` on every request on the wildcard address — and on macOS a request to
 * 127.0.0.1:<port> then reaches any *other* local process bound to that exact address/port (dev
 * servers, mongod), producing random 403/404s under load.
 */
async function listenOnLoopback(app: Parameters<typeof createServer>[1]): Promise<Server> {
  const server = createServer(app);
  server.unref(); // never keep the test worker alive on its own
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  return server;
}

let userSeq = 0;

export async function createUser(env: Pick<TestEnv, "c">, opts: { role?: Role; email?: string; name?: string; onboardingComplete?: boolean } = {}): Promise<UserRow> {
  userSeq++;
  const user = await env.c.repos.users.upsertByGoogleSub({
    googleSub: `google-sub-${userSeq}-${randomUUID()}`,
    email: opts.email ?? `user${userSeq}-${randomUUID().slice(0, 8)}@example.com`,
    name: opts.name ?? `User ${userSeq}`,
    promoteToAdmin: opts.role === "ADMIN",
  });
  if (opts.onboardingComplete) return (await env.c.repos.users.markOnboardingComplete(user.id))!;
  return user;
}

/** `Authorization: Bearer ...` header value for a user. */
export async function bearer(env: Pick<TestEnv, "c">, user: UserRow): Promise<string> {
  return `Bearer ${await env.c.jwt.createAccessToken(user)}`;
}
