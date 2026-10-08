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

    // Intentional additive relaxations: password-only users and JD-independent practice sessions.
    const expectedCols = before.cols.map((c) => ((c.t === "app_user" && c.c === "google_sub") || (c.t === "interview_sessions" && c.c === "job_description_id") ? { ...c, n: "YES" } : c));
    expect(after.cols).toEqual(expect.arrayContaining(expectedCols));
    // Postgres 18 (PGlite) also lists NOT NULLs as constraints; nullability is compared on the columns above.
    const keyCons = (cons: typeof before.cons) => cons.filter((c) => c.ty !== "n");
    // 0004 intentionally extends the existing status check to permit cancellation.
    const expectedCons = keyCons(before.cons).map((c) => c.t === "interview_sessions" && c.ty === "c" && c.def.includes("SCHEDULED")
      ? { ...c, def: c.def.replace("'ABORTED_TECHNICAL'::character varying]", "'ABORTED_TECHNICAL'::character varying, 'CANCELLED'::character varying]") } : c);
    expect(keyCons(after.cons)).toEqual(expect.arrayContaining(expectedCons));
    expect(after.idx).toEqual(expect.arrayContaining(before.idx));

    // ...and the additions are password auth, catalogue enrichment, persisted practice workflows, coding-platform connections and blueprint prep state.
    const added = <T>(xs: T[], base: T[]) => xs.filter((x) => !base.some((b) => JSON.stringify(b) === JSON.stringify(x)));
    expect(added(after.cols, expectedCols).map((c) => `${c.t}.${c.c} ${c.ty} null=${c.n}`).sort()).toEqual([
      "app_user.email_verified_at timestamp with time zone null=YES",
      "app_user.password_hash character varying null=YES",
      "auth_token.created_at timestamp with time zone null=NO",
      "auth_token.expires_at timestamp with time zone null=NO",
      "auth_token.id uuid null=NO",
      "auth_token.purpose character varying null=NO",
      "auth_token.token_hash character varying null=NO",
      "auth_token.used_at timestamp with time zone null=YES",
      "auth_token.user_id uuid null=NO",
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
      "company_enrichments.company_id uuid null=NO",
      "company_enrichments.document jsonb null=NO",
      "company_enrichments.published_at timestamp with time zone null=YES",
      "company_enrichments.published_document jsonb null=YES",
      "company_enrichments.published_revision integer null=YES",
      "company_enrichments.revision integer null=NO",
      "company_enrichments.verified_by uuid null=YES",
      "interview_processes.created_at timestamp with time zone null=NO",
      "interview_processes.graph jsonb null=NO",
      "interview_processes.id uuid null=NO",
      "interview_processes.jd_id uuid null=YES",
      "interview_processes.level character varying null=NO",
      "interview_processes.name character varying null=NO",
      "interview_processes.updated_at timestamp with time zone null=NO",
      "interview_processes.user_id uuid null=NO",
      "interview_sessions.blueprint_version integer null=YES",
      "interview_sessions.loop_id uuid null=YES",
      "interview_sessions.node_id character varying null=YES",
      "interview_sessions.practice_prep jsonb null=YES",
      "interview_sessions.prep_briefing jsonb null=YES",
      "interview_sessions.prep_error_code character varying null=YES",
      "interview_sessions.prep_input_hash character varying null=YES",
      "interview_sessions.prep_refreshing boolean null=NO",
      "interview_sessions.prep_retry_count integer null=NO",
      "interview_sessions.prep_retry_window_start timestamp with time zone null=YES",
      "interview_sessions.prep_run_id character varying null=YES",
      "interview_sessions.prep_run_started_at timestamp with time zone null=YES",
      "interview_sessions.prepared_at timestamp with time zone null=YES",
      "job_descriptions.ctc_max_lpa numeric null=YES",
      "job_descriptions.ctc_min_lpa numeric null=YES",
      "job_descriptions.ctc_source_count integer null=YES",
      "job_descriptions.role_key character varying null=YES",
      "job_descriptions.yoe_max numeric null=YES",
      "job_descriptions.yoe_min numeric null=YES",
      "loops.confirmed_at timestamp with time zone null=NO",
      "loops.created_at timestamp with time zone null=NO",
      "loops.graph jsonb null=NO",
      "loops.id uuid null=NO",
      "loops.jd_id uuid null=YES",
      "loops.kind character varying null=NO",
      "loops.level character varying null=NO",
      "loops.name character varying null=NO",
      "loops.process_id uuid null=YES",
      "loops.status character varying null=NO",
      "loops.updated_at timestamp with time zone null=NO",
      "loops.user_id uuid null=NO",
      "manual_jd_briefs.brief jsonb null=NO",
      "manual_jd_briefs.company_id uuid null=NO",
      "manual_jd_briefs.jd_id uuid null=NO",
      "manual_jd_briefs.role_id uuid null=NO",
      "platform_connection.connected_at timestamp with time zone null=NO",
      "platform_connection.discovered_from character varying null=YES",
      "platform_connection.handle character varying null=NO",
      "platform_connection.id uuid null=NO",
      "platform_connection.last_refreshed_at timestamp with time zone null=YES",
      "platform_connection.platform character varying null=NO",
      "platform_connection.status character varying null=NO",
      "platform_connection.user_id uuid null=NO",
      "targets.created_at timestamp with time zone null=NO",
      "targets.jd_id uuid null=NO",
      "targets.user_id uuid null=NO",
    ]);
    expect(added(keyCons(after.cons), expectedCons).map((c) => `${c.t} ${c.def}`)).toEqual([
      "auth_token FOREIGN KEY (user_id) REFERENCES app_user(id)",
      "auth_token PRIMARY KEY (id)",
      "auth_token UNIQUE (token_hash)",
      "company_enrichments FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE",
      "company_enrichments PRIMARY KEY (company_id)",
      "interview_processes FOREIGN KEY (jd_id) REFERENCES job_descriptions(id) ON DELETE CASCADE",
      "interview_processes PRIMARY KEY (id)",
      "job_descriptions UNIQUE (company, role_key)",
      "loops FOREIGN KEY (jd_id) REFERENCES job_descriptions(id) ON DELETE CASCADE",
      "loops FOREIGN KEY (process_id) REFERENCES interview_processes(id) ON DELETE SET NULL",
      "loops PRIMARY KEY (id)",
      "manual_jd_briefs FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE",
      "manual_jd_briefs FOREIGN KEY (jd_id) REFERENCES job_descriptions(id) ON DELETE CASCADE",
      "manual_jd_briefs PRIMARY KEY (jd_id)",
      "manual_jd_briefs UNIQUE (company_id, role_id)",
      "platform_connection PRIMARY KEY (id)",
      "platform_connection UNIQUE (user_id, platform)",
      "targets FOREIGN KEY (jd_id) REFERENCES job_descriptions(id) ON DELETE CASCADE",
      "targets PRIMARY KEY (user_id, jd_id)",
    ]);
    expect(added(after.idx, before.idx).map((i) => i.i)).toEqual([
      "CREATE INDEX idx_auth_token_user_purpose ON public.auth_token USING btree (user_id, purpose)",
      "CREATE INDEX idx_loop_user ON public.loops USING btree (user_id)",
      "CREATE INDEX idx_process_user ON public.interview_processes USING btree (user_id)",
      "CREATE INDEX idx_session_loop ON public.interview_sessions USING btree (loop_id)",
      "CREATE UNIQUE INDEX auth_token_pkey ON public.auth_token USING btree (id)",
      "CREATE UNIQUE INDEX auth_token_token_hash_unique ON public.auth_token USING btree (token_hash)",
      "CREATE UNIQUE INDEX company_enrichments_pkey ON public.company_enrichments USING btree (company_id)",
      "CREATE UNIQUE INDEX interview_processes_pkey ON public.interview_processes USING btree (id)",
      "CREATE UNIQUE INDEX loops_pkey ON public.loops USING btree (id)",
      "CREATE UNIQUE INDEX manual_jd_briefs_pkey ON public.manual_jd_briefs USING btree (jd_id)",
      "CREATE UNIQUE INDEX platform_connection_pkey ON public.platform_connection USING btree (id)",
      "CREATE UNIQUE INDEX targets_user_id_jd_id_pk ON public.targets USING btree (user_id, jd_id)",
      "CREATE UNIQUE INDEX uq_jd_company_role_key ON public.job_descriptions USING btree (company, role_key)",
      "CREATE UNIQUE INDEX uq_loop_live ON public.loops USING btree (user_id, jd_id) WHERE ((status)::text = ANY ((ARRAY['active'::character varying, 'paused'::character varying])::text[]))",
      "CREATE UNIQUE INDEX uq_manual_company_role ON public.manual_jd_briefs USING btree (company_id, role_id)",
      "CREATE UNIQUE INDEX uq_platform_connection_user_platform ON public.platform_connection USING btree (user_id, platform)",
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
