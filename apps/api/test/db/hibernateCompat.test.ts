import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RefreshTokenService } from "../../src/auth/refreshTokens.js";
import { JwtService } from "../../src/auth/jwt.js";
import { type Database, MIGRATIONS_FOLDER } from "../../src/db/pg/client.js";
import * as schema from "../../src/db/pg/schema.js";
import { sha256Base64Url } from "../../src/lib/crypto.js";
import { InterviewSessionRepository, JobDescriptionRepository, UserRepository } from "../../src/repositories/pg.js";

/**
 * The production Postgres (Supabase) was created by Hibernate's ddl-auto for the Spring backend.
 * This proves the Node API can adopt that database in place:
 *   1. the Drizzle baseline migration changes NOTHING on the exact Hibernate schema, and
 *   2. rows written by the Spring app are readable/writable through the Drizzle repositories.
 */
const HIBERNATE_DDL = readFileSync(new URL("../fixtures/hibernate-schema.sql", import.meta.url), "utf8");

let client: PGlite;
let db: Database;

const schemaSnapshot = async () => {
  const cols = await client.query<{ t: string; c: string; ty: string; n: string; d: string | null }>(
    `select table_name t, column_name c, data_type ty, is_nullable n, column_default d
       from information_schema.columns where table_schema = 'public' order by 1, 2`,
  );
  const cons = await client.query<{ t: string; ty: string; def: string }>(
    `select conrelid::regclass::text t, contype ty, pg_get_constraintdef(oid) def
       from pg_constraint where connamespace = 'public'::regnamespace order by 1, 2, 3`,
  );
  const idx = await client.query<{ i: string }>(`select indexdef i from pg_indexes where schemaname = 'public' order by 1`);
  return { cols: cols.rows, cons: cons.rows, idx: idx.rows };
};

const userId = randomUUID();
const jdId = randomUUID();
const sessionId = randomUUID();
const legacyRefreshToken = "legacy-raw-refresh-token";

beforeAll(async () => {
  client = new PGlite();
  await client.exec(HIBERNATE_DDL);
  // Rows as the Spring app would have written them.
  await client.query(
    `insert into app_user (id, google_sub, email, name, role, onboarding_complete, created_at, updated_at)
     values ($1, 'g-legacy', 'legacy@example.com', 'Legacy User', 'ADMIN', true, now(), now())`,
    [userId],
  );
  await client.query(
    `insert into refresh_token (id, token_hash, user_id, expires_at) values ($1, $2, $3, now() + interval '14 days')`,
    [randomUUID(), sha256Base64Url(legacyRefreshToken), userId],
  );
  await client.query(
    `insert into job_descriptions (id, company, role, level, title, specialization, source, active, created_at)
     values ($1, 'meesho', 'software-engineer', 'fresher', 'SDE I — Backend', 'backend', 'seed', true, now())`,
    [jdId],
  );
  await client.query(
    `insert into interview_sessions (id, candidate_id, job_description_id, company, role, level, specialization, round_type,
       scheduled_at, timezone, status, created_at, updated_at, outcome)
     values ($1, $2, $3, 'meesho', 'software-engineer', 'fresher', 'backend', 'system-design', now(), 'Asia/Kolkata',
       'COMPLETED', now(), now(), '{"ended_reason":"natural"}')`,
    [sessionId, userId, jdId],
  );
  db = drizzle(client, { schema }) as unknown as Database;
});

afterAll(() => client.close());

describe("adopting the Hibernate-created database", () => {
  it("the Drizzle migrations only ADD to the exact Hibernate schema (the baseline itself is a no-op)", async () => {
    const before = await schemaSnapshot();
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER });
    const after = await schemaSnapshot();

    // Nothing Hibernate created is removed or altered — except the one intentional relaxation:
    // 0001_password_auth makes app_user.google_sub nullable (email/password accounts).
    const expectedCols = before.cols.map((c) => (c.t === "app_user" && c.c === "google_sub" ? { ...c, n: "YES" } : c));
    expect(after.cols).toEqual(expect.arrayContaining(expectedCols));
    // Postgres 18 (PGlite) also lists NOT NULLs as constraints; nullability is compared on the columns above.
    const keyCons = (cons: typeof before.cons) => cons.filter((c) => c.ty !== "n");
    expect(keyCons(after.cons)).toEqual(expect.arrayContaining(keyCons(before.cons)));
    expect(after.idx).toEqual(expect.arrayContaining(before.idx));

    // ...and the additions are exactly 0001_password_auth's.
    const added = <T>(xs: T[], base: T[]) => xs.filter((x) => !base.some((b) => JSON.stringify(b) === JSON.stringify(x)));
    expect(added(after.cols, expectedCols).map((c) => `${c.t}.${c.c} ${c.ty} null=${c.n}`)).toEqual([
      "app_user.email_verified_at timestamp with time zone null=YES",
      "app_user.password_hash character varying null=YES",
      "auth_token.created_at timestamp with time zone null=NO",
      "auth_token.expires_at timestamp with time zone null=NO",
      "auth_token.id uuid null=NO",
      "auth_token.purpose character varying null=NO",
      "auth_token.token_hash character varying null=NO",
      "auth_token.used_at timestamp with time zone null=YES",
      "auth_token.user_id uuid null=NO",
    ]);
    expect(added(keyCons(after.cons), keyCons(before.cons)).map((c) => `${c.t} ${c.def}`)).toEqual([
      "auth_token FOREIGN KEY (user_id) REFERENCES app_user(id)",
      "auth_token PRIMARY KEY (id)",
      "auth_token UNIQUE (token_hash)",
    ]);
    expect(added(after.idx, before.idx).map((i) => i.i)).toEqual([
      "CREATE INDEX idx_auth_token_user_purpose ON public.auth_token USING btree (user_id, purpose)",
      "CREATE UNIQUE INDEX auth_token_pkey ON public.auth_token USING btree (id)",
      "CREATE UNIQUE INDEX auth_token_token_hash_unique ON public.auth_token USING btree (token_hash)",
    ]);
  });

  it("re-running migrations is idempotent", async () => {
    await expect(migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER })).resolves.toBeUndefined();
  });

  it("reads Spring-written rows through the repositories", async () => {
    const user = await new UserRepository(db).findById(userId);
    expect(user).toMatchObject({ email: "legacy@example.com", role: "ADMIN", onboardingComplete: true });

    const session = await new InterviewSessionRepository(db).findById(sessionId);
    expect(session).toMatchObject({ roundType: "system-design", status: "COMPLETED", timezone: "Asia/Kolkata" });

    const jds = await new JobDescriptionRepository(db).findAllActiveOrdered();
    expect(jds.map((j) => j.id)).toEqual([jdId]);
  });

  it("a refresh token issued by the Spring backend still rotates", async () => {
    const jwt = new JwtService("test-jwt-secret-that-is-at-least-32-bytes-long!!", 15);
    const service = new RefreshTokenService(db, jwt, 14);
    const { accessToken, newRefreshToken } = await service.refresh(legacyRefreshToken);
    expect((await jwt.verify(accessToken)).userId).toBe(userId);
    expect(newRefreshToken).not.toBe(legacyRefreshToken);
    await expect(service.refresh(legacyRefreshToken)).rejects.toThrow();
  });

  it("Spring-era Google users read as unverified Google-only accounts; password accounts have no google_sub", async () => {
    const repo = new UserRepository(db);
    const legacy = (await repo.findById(userId))!;
    expect(legacy).toMatchObject({ googleSub: "g-legacy", passwordHash: null, emailVerifiedAt: null });
    // google_sub stays UNIQUE, but many password-only accounts may have it NULL
    const a = await repo.insertWithPassword({ email: "pw-a@example.com", name: "A", passwordHash: "scrypt$x", role: "USER" });
    const b = await repo.insertWithPassword({ email: "pw-b@example.com", name: "B", passwordHash: "scrypt$y", role: "USER" });
    expect([a.googleSub, b.googleSub]).toEqual([null, null]);
    await expect(repo.upsertByGoogleSub({ googleSub: "g-legacy", email: "legacy@example.com", name: "Legacy User", promoteToAdmin: false })).resolves.toMatchObject({ id: userId });
  });

  it("writes new rows that satisfy Hibernate's CHECK constraints and FK", async () => {
    const repo = new UserRepository(db);
    const u = await repo.upsertByGoogleSub({ googleSub: "g-new", email: "new@example.com", name: "New", promoteToAdmin: false });
    expect(u.role).toBe("USER");
    const sessions = new InterviewSessionRepository(db);
    const s = await sessions.insert({
      candidateId: u.id,
      jobDescriptionId: jdId,
      company: "meesho",
      role: "software-engineer",
      level: "fresher",
      specialization: "backend",
      roundType: "hiring-manager",
      scheduledAt: new Date(Date.now() + 86_400_000),
      timezone: "UTC",
      status: "SCHEDULED",
    });
    const claimed = await sessions.transitionStatus(s.id, "SCHEDULED", "PREP_QUEUED");
    expect(claimed?.status).toBe("PREP_QUEUED");
  });
});
