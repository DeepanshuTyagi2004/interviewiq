import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, lt, lte, ne, or, sql } from "drizzle-orm";
import type { Database } from "../db/pg/client.js";
import {
  authTokens,
  companies,
  companyRoleConfigs,
  githubConnections,
  interviewProcesses,
  interviewSessions,
  jobDescriptions,
  leetcodeConnections,
  loops,
  platformConnections,
  refreshTokens,
  targets,
  users,
  type AuthTokenPurpose,
  type CompanyRoleConfigRow,
  type CompanyRow,
  type GitHubConnectionRow,
  type InterviewProcessRow,
  type InterviewSessionRow,
  type JobDescriptionRow,
  type LeetCodeConnectionRow,
  type PlatformConnectionRow,
  type LoopRow,
  type TargetRow,
  type UserRow,
} from "../db/pg/schema.js";
import type { CodingPlatform, Role, SessionStatus } from "../domain/enums.js";

/**
 * Postgres repositories (Drizzle). Method names mirror the Spring Data repositories they replace,
 * so the service code reads the same as before.
 */

type Insert<T extends { $inferInsert: unknown }> = T["$inferInsert"];

const one = <T>(rows: T[]): T | null => rows[0] ?? null;

/** `coalesce(column, now)` — set a timestamp only if it isn't set yet. `now` goes through the column encoder. */
const coalesceNow = (column: typeof users.emailVerifiedAt, now: Date) => sql`coalesce(${column}, ${sql.param(now, column)})`;

export class UserRepository {
  constructor(private readonly db: Database) {}

  findById(id: string): Promise<UserRow | null> {
    return this.db.select().from(users).where(eq(users.id, id)).then(one);
  }

  /**
   * Account deletion, Postgres half: every row that references the user, then the user — one
   * transaction, user row last. Idempotent (a retry after a partial failure just finishes).
   */
  async deleteCascade(userId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(refreshTokens).where(eq(refreshTokens.userId, userId));
      await tx.delete(authTokens).where(eq(authTokens.userId, userId));
      await tx.delete(githubConnections).where(eq(githubConnections.userId, userId));
      await tx.delete(leetcodeConnections).where(eq(leetcodeConnections.userId, userId));
      await tx.delete(platformConnections).where(eq(platformConnections.userId, userId));
      await tx.delete(interviewSessions).where(eq(interviewSessions.candidateId, userId));
      await tx.delete(loops).where(eq(loops.userId, userId));
      await tx.delete(interviewProcesses).where(eq(interviewProcesses.userId, userId));
      await tx.delete(targets).where(eq(targets.userId, userId));
      await tx.delete(users).where(eq(users.id, userId));
    });
  }

  findAllById(ids: string[]): Promise<UserRow[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.db.select().from(users).where(inArray(users.id, ids));
  }

  findAll(): Promise<UserRow[]> {
    return this.db.select().from(users).orderBy(asc(users.createdAt));
  }

  findByGoogleSub(googleSub: string): Promise<UserRow | null> {
    return this.db.select().from(users).where(eq(users.googleSub, googleSub)).then(one);
  }

  /** Case-insensitive email lookup (Google rows keep Google's spelling; password rows are lowercase). */
  findByEmailInsensitive(email: string): Promise<UserRow | null> {
    return this.db
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = ${email.toLowerCase()}`)
      .orderBy(asc(users.createdAt))
      .limit(1)
      .then(one);
  }

  /** A new email/password account (unverified, onboarding not started). Throws on a duplicate email. */
  insertWithPassword(input: { email: string; name: string; passwordHash: string; role: Role }): Promise<UserRow> {
    return this.db
      .insert(users)
      .values({ email: input.email, name: input.name, passwordHash: input.passwordHash, role: input.role })
      .returning()
      .then((r) => r[0]!);
  }

  /**
   * Insert-or-update by Google subject in one statement (no read-then-write race on first login).
   * Email/name follow Google; the role is only ever PROMOTED here (bootstrap admins) — demotion is
   * an explicit admin action. When Google vouches for the email, `email_verified_at` is stamped
   * (and never cleared).
   */
  async upsertByGoogleSub(input: {
    googleSub: string;
    email: string;
    name: string;
    promoteToAdmin: boolean;
    emailVerified?: boolean;
    now?: Date;
  }): Promise<UserRow> {
    const now = input.now ?? new Date();
    const rows = await this.db
      .insert(users)
      .values({
        googleSub: input.googleSub,
        email: input.email,
        name: input.name,
        role: input.promoteToAdmin ? "ADMIN" : "USER",
        emailVerifiedAt: input.emailVerified ? now : null,
      })
      .onConflictDoUpdate({
        target: users.googleSub,
        // `name` is set once, at sign-up: afterwards it's the user's own display name (Settings → Account).
        set: {
          email: input.email,
          updatedAt: now,
          ...(input.promoteToAdmin ? { role: "ADMIN" as const } : {}),
          ...(input.emailVerified ? { emailVerifiedAt: coalesceNow(users.emailVerifiedAt, now) } : {}),
        },
      })
      .returning();
    return rows[0]!;
  }

  /**
   * Attach a Google subject to an existing account that has none (compare-and-set on
   * `google_sub IS NULL`, so a concurrent link can't overwrite another). Marks the email verified;
   * `clearPassword` drops the password hash (anti pre-hijacking — see UserService.upsertFromGoogle).
   * Returns null when the account no longer qualifies.
   */
  linkGoogle(
    id: string,
    input: { googleSub: string; email: string; name: string; promoteToAdmin: boolean; clearPassword: boolean; now: Date },
  ): Promise<UserRow | null> {
    return this.db
      .update(users)
      .set({
        googleSub: input.googleSub,
        email: input.email,
        // Only an unverified account (clearPassword) takes Google's name: it may come from a squatter. Otherwise the user owns it.
        ...(input.clearPassword ? { name: input.name } : {}),
        updatedAt: input.now,
        emailVerifiedAt: coalesceNow(users.emailVerifiedAt, input.now),
        ...(input.clearPassword ? { passwordHash: null } : {}),
        ...(input.promoteToAdmin ? { role: "ADMIN" as const } : {}),
      })
      .where(and(eq(users.id, id), isNull(users.googleSub)))
      .returning()
      .then(one);
  }

  /** Stamp `email_verified_at` if it isn't set yet (idempotent). */
  async markEmailVerified(id: string, now: Date): Promise<void> {
    await this.db
      .update(users)
      .set({ emailVerifiedAt: coalesceNow(users.emailVerifiedAt, now), updatedAt: now })
      .where(eq(users.id, id));
  }

  /** Password reset: new hash + verified email (the reset link proved inbox access). */
  async setPasswordAndMarkVerified(id: string, passwordHash: string, now: Date): Promise<void> {
    await this.db
      .update(users)
      .set({ passwordHash, emailVerifiedAt: coalesceNow(users.emailVerifiedAt, now), updatedAt: now })
      .where(eq(users.id, id));
  }

  updateRole(id: string, role: Role): Promise<UserRow | null> {
    return this.db.update(users).set({ role }).where(eq(users.id, id)).returning().then(one);
  }

  updateName(id: string, name: string): Promise<UserRow | null> {
    return this.db.update(users).set({ name }).where(eq(users.id, id)).returning().then(one);
  }

  markOnboardingComplete(id: string): Promise<UserRow | null> {
    return this.db.update(users).set({ onboardingComplete: true }).where(eq(users.id, id)).returning().then(one);
  }
}

export class RefreshTokenRepository {
  constructor(private readonly db: Database) {}

  async insert(row: Insert<typeof refreshTokens>): Promise<void> {
    await this.db.insert(refreshTokens).values(row);
  }

  /**
   * Atomically consume an active token (the JPA version took a PESSIMISTIC_WRITE lock, then
   * revoked). Returns the owning userId, or null when the token is unknown, expired or already
   * used — so two concurrent refreshes with the same token can never both succeed.
   */
  consumeActive(tokenHash: string, now: Date, tx: Database = this.db): Promise<string | null> {
    return tx
      .update(refreshTokens)
      .set({ revokedAt: now })
      .where(and(eq(refreshTokens.tokenHash, tokenHash), isNull(refreshTokens.revokedAt), gt(refreshTokens.expiresAt, now)))
      .returning({ userId: refreshTokens.userId })
      .then((rows) => rows[0]?.userId ?? null);
  }

  async revoke(tokenHash: string, now: Date): Promise<void> {
    await this.db
      .update(refreshTokens)
      .set({ revokedAt: now })
      .where(and(eq(refreshTokens.tokenHash, tokenHash), isNull(refreshTokens.revokedAt)));
  }

  /** Revoke every live refresh token the user has (password reset, account takeover defence). */
  async revokeAllForUser(userId: string, now: Date): Promise<void> {
    await this.db
      .update(refreshTokens)
      .set({ revokedAt: now })
      .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
  }
}

/** Single-use email tokens (verify email / reset password), stored as SHA-256 hashes. */
export class AuthTokenRepository {
  constructor(private readonly db: Database) {}

  async insert(row: Insert<typeof authTokens>): Promise<void> {
    await this.db.insert(authTokens).values(row);
  }

  /** The owner of an unused, unexpired token — a read-only peek (consumeActive is the real check). */
  findActiveUserId(tokenHash: string, purpose: AuthTokenPurpose, now: Date): Promise<string | null> {
    return this.db
      .select({ userId: authTokens.userId })
      .from(authTokens)
      .where(and(eq(authTokens.tokenHash, tokenHash), eq(authTokens.purpose, purpose), isNull(authTokens.usedAt), gt(authTokens.expiresAt, now)))
      .then((rows) => rows[0]?.userId ?? null);
  }

  /**
   * Atomically consume an active token (compare-and-set on `used_at IS NULL AND expires_at > now`),
   * like RefreshTokenRepository.consumeActive. Returns the owning userId, or null when the token is
   * unknown, for another purpose, expired or already used — two concurrent uses can't both win.
   */
  consumeActive(tokenHash: string, purpose: AuthTokenPurpose, now: Date): Promise<string | null> {
    return this.db
      .update(authTokens)
      .set({ usedAt: now })
      .where(and(eq(authTokens.tokenHash, tokenHash), eq(authTokens.purpose, purpose), isNull(authTokens.usedAt), gt(authTokens.expiresAt, now)))
      .returning({ userId: authTokens.userId })
      .then((rows) => rows[0]?.userId ?? null);
  }

  /** Burn every unused token of `purpose` for the user (marked used), e.g. before issuing a new one. */
  async invalidateActive(userId: string, purpose: AuthTokenPurpose, now: Date): Promise<void> {
    await this.db
      .update(authTokens)
      .set({ usedAt: now })
      .where(and(eq(authTokens.userId, userId), eq(authTokens.purpose, purpose), isNull(authTokens.usedAt)));
  }
}

export class CompanyRepository {
  constructor(private readonly db: Database) {}

  findAll(): Promise<CompanyRow[]> {
    return this.db.select().from(companies).orderBy(asc(companies.createdAt));
  }

  findById(id: string): Promise<CompanyRow | null> {
    return this.db.select().from(companies).where(eq(companies.id, id)).then(one);
  }

  findBySlug(slug: string): Promise<CompanyRow | null> {
    return this.db.select().from(companies).where(eq(companies.slug, slug)).then(one);
  }

  findAllBySlug(slugs: string[]): Promise<CompanyRow[]> {
    if (slugs.length === 0) return Promise.resolve([]);
    return this.db.select().from(companies).where(inArray(companies.slug, [...new Set(slugs)]));
  }

  /** What students see: approved (published) and not archived. */
  findPublished(): Promise<CompanyRow[]> {
    return this.db
      .select()
      .from(companies)
      .where(and(isNotNull(companies.publishedAt), eq(companies.status, "active")))
      .orderBy(asc(companies.createdAt));
  }

  /** Research targets: every non-archived company, published or not. */
  findActive(): Promise<CompanyRow[]> {
    return this.db.select().from(companies).where(eq(companies.status, "active")).orderBy(asc(companies.createdAt));
  }

  async insert(row: Insert<typeof companies>): Promise<void> {
    await this.db.insert(companies).values(row);
  }

  create(row: Insert<typeof companies>): Promise<CompanyRow> {
    return this.db
      .insert(companies)
      .values(row)
      .returning()
      .then((r) => r[0]!);
  }

  update(id: string, patch: Partial<Insert<typeof companies>>): Promise<CompanyRow | null> {
    return this.db.update(companies).set(patch).where(eq(companies.id, id)).returning().then(one);
  }

  async deleteById(id: string): Promise<void> {
    await this.db.delete(companies).where(eq(companies.id, id));
  }

  async deleteBySlug(slug: string): Promise<void> {
    await this.db.delete(companies).where(eq(companies.slug, slug));
  }
}

export class CompanyRoleConfigRepository {
  constructor(private readonly db: Database) {}

  findByCompanyAndRoleAndLevel(company: string, role: string, level: string): Promise<CompanyRoleConfigRow | null> {
    return this.db
      .select()
      .from(companyRoleConfigs)
      .where(and(eq(companyRoleConfigs.company, company), eq(companyRoleConfigs.role, role), eq(companyRoleConfigs.level, level)))
      .then(one);
  }

  async insert(row: Insert<typeof companyRoleConfigs>): Promise<void> {
    await this.db.insert(companyRoleConfigs).values(row);
  }

  async update(id: string, patch: Partial<Insert<typeof companyRoleConfigs>>): Promise<void> {
    await this.db.update(companyRoleConfigs).set(patch).where(eq(companyRoleConfigs.id, id));
  }

  async deleteByCompany(company: string): Promise<void> {
    await this.db.delete(companyRoleConfigs).where(eq(companyRoleConfigs.company, company));
  }
}

export class JobDescriptionRepository {
  constructor(private readonly db: Database) {}

  findById(id: string): Promise<JobDescriptionRow | null> {
    return this.db.select().from(jobDescriptions).where(eq(jobDescriptions.id, id)).then(one);
  }

  /** Active JDs ordered company asc, level asc (creation order as a stable tiebreak). */
  findAllActiveOrdered(): Promise<JobDescriptionRow[]> {
    return this.db
      .select()
      .from(jobDescriptions)
      .where(eq(jobDescriptions.active, true))
      .orderBy(asc(jobDescriptions.company), asc(jobDescriptions.level), asc(jobDescriptions.createdAt));
  }

  /** One company's active JDs (the role list and JD fit filter by company far more often than not). */
  findActiveByCompany(company: string): Promise<JobDescriptionRow[]> {
    return this.db
      .select()
      .from(jobDescriptions)
      .where(and(eq(jobDescriptions.active, true), sql`lower(${jobDescriptions.company}) = ${company.toLowerCase()}`))
      .orderBy(asc(jobDescriptions.level), asc(jobDescriptions.createdAt));
  }

  insert(row: Insert<typeof jobDescriptions>): Promise<JobDescriptionRow> {
    return this.db
      .insert(jobDescriptions)
      .values(row)
      .returning()
      .then((r) => r[0]!);
  }

  /** Refresh a starter posting in place; manual publications and booked JD identities survive. */
  async refreshSeed(row: Insert<typeof jobDescriptions>): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.select().from(companies).where(eq(companies.slug, row.company)).for("update");
      const matches = await tx.select().from(jobDescriptions).where(and(
        eq(jobDescriptions.company, row.company), eq(jobDescriptions.role, row.role), eq(jobDescriptions.level, row.level),
        row.specialization == null ? isNull(jobDescriptions.specialization) : eq(jobDescriptions.specialization, row.specialization),
      ));
      if (matches.some((j) => j.source === "manual")) return;
      const seed = matches.find((j) => j.source === "seed");
      if (seed) await tx.update(jobDescriptions).set(row).where(eq(jobDescriptions.id, seed.id));
      else await tx.insert(jobDescriptions).values(row);
    });
  }

  /** Remove ALL of a company's JDs (catalogue delete only). */
  async deleteByCompany(company: string): Promise<void> {
    await this.db.delete(jobDescriptions).where(eq(jobDescriptions.company, company));
  }
}

export class GitHubConnectionRepository {
  constructor(private readonly db: Database) {}

  findAll(): Promise<GitHubConnectionRow[]> {
    return this.db.select().from(githubConnections);
  }

  findByUserId(userId: string): Promise<GitHubConnectionRow | null> {
    return this.db.select().from(githubConnections).where(eq(githubConnections.userId, userId)).then(one);
  }

  /** Create or replace the user's connection (login/token/scope), keeping connectedAt on update. */
  upsert(input: { userId: string; githubLogin: string; accessTokenEnc: string; scope: string }): Promise<GitHubConnectionRow> {
    return this.db
      .insert(githubConnections)
      .values(input)
      .onConflictDoUpdate({
        target: githubConnections.userId,
        set: { githubLogin: input.githubLogin, accessTokenEnc: input.accessTokenEnc, scope: input.scope },
      })
      .returning()
      .then((r) => r[0]!);
  }

  async touchRefreshed(id: string, at: Date): Promise<void> {
    await this.db.update(githubConnections).set({ lastRefreshedAt: at }).where(eq(githubConnections.id, id));
  }

  async deleteByUserId(userId: string): Promise<void> {
    await this.db.delete(githubConnections).where(eq(githubConnections.userId, userId));
  }
}

export class LeetCodeConnectionRepository {
  constructor(private readonly db: Database) {}

  findAll(): Promise<LeetCodeConnectionRow[]> {
    return this.db.select().from(leetcodeConnections);
  }

  findById(id: string): Promise<LeetCodeConnectionRow | null> {
    return this.db.select().from(leetcodeConnections).where(eq(leetcodeConnections.id, id)).then(one);
  }

  findByUserId(userId: string): Promise<LeetCodeConnectionRow | null> {
    return this.db.select().from(leetcodeConnections).where(eq(leetcodeConnections.userId, userId)).then(one);
  }

  /** Create or re-point the user's connection at `username`, back in SYNCING. */
  upsertSyncing(userId: string, username: string): Promise<LeetCodeConnectionRow> {
    return this.db
      .insert(leetcodeConnections)
      .values({ userId, username, status: "SYNCING" })
      .onConflictDoUpdate({ target: leetcodeConnections.userId, set: { username, status: "SYNCING" } })
      .returning()
      .then((r) => r[0]!);
  }

  async update(id: string, patch: Partial<Pick<LeetCodeConnectionRow, "status" | "lastRefreshedAt">>): Promise<void> {
    await this.db.update(leetcodeConnections).set(patch).where(eq(leetcodeConnections.id, id));
  }

  async deleteByUserId(userId: string): Promise<void> {
    await this.db.delete(leetcodeConnections).where(eq(leetcodeConnections.userId, userId));
  }
}

export class PlatformConnectionRepository {
  constructor(private readonly db: Database) {}

  findAll(): Promise<PlatformConnectionRow[]> {
    return this.db.select().from(platformConnections);
  }

  findById(id: string): Promise<PlatformConnectionRow | null> {
    return this.db.select().from(platformConnections).where(eq(platformConnections.id, id)).then(one);
  }

  findByUserId(userId: string): Promise<PlatformConnectionRow[]> {
    return this.db.select().from(platformConnections).where(eq(platformConnections.userId, userId)).orderBy(asc(platformConnections.platform));
  }

  findByUserAndPlatform(userId: string, platform: CodingPlatform): Promise<PlatformConnectionRow | null> {
    return this.db.select().from(platformConnections)
      .where(and(eq(platformConnections.userId, userId), eq(platformConnections.platform, platform))).then(one);
  }

  /** Create or re-point the user's connection for `platform` at `handle`, back in SYNCING. */
  upsertSyncing(userId: string, platform: CodingPlatform, handle: string, discoveredFrom: string | null = null): Promise<PlatformConnectionRow> {
    return this.db
      .insert(platformConnections)
      .values({ userId, platform, handle, status: "SYNCING", discoveredFrom })
      .onConflictDoUpdate({ target: [platformConnections.userId, platformConnections.platform], set: { handle, status: "SYNCING", discoveredFrom, connectedAt: new Date() } })
      .returning()
      .then((r) => r[0]!);
  }

  /** Insert only when the user has no connection for `platform` (automatic discovery never replaces one). */
  insertIfAbsent(userId: string, platform: CodingPlatform, handle: string, discoveredFrom: string): Promise<PlatformConnectionRow | null> {
    return this.db
      .insert(platformConnections)
      .values({ userId, platform, handle, status: "SYNCING", discoveredFrom })
      .onConflictDoNothing({ target: [platformConnections.userId, platformConnections.platform] })
      .returning()
      .then((r) => r[0] ?? null);
  }

  async update(id: string, patch: Partial<Pick<PlatformConnectionRow, "status" | "lastRefreshedAt">>): Promise<void> {
    await this.db.update(platformConnections).set(patch).where(eq(platformConnections.id, id));
  }

  async deleteByUserAndPlatform(userId: string, platform: CodingPlatform): Promise<void> {
    await this.db.delete(platformConnections).where(and(eq(platformConnections.userId, userId), eq(platformConnections.platform, platform)));
  }
}

/** Automatic evaluation re-runs after a transient failure: this many per rolling window (spec §11.3). */
export const EVAL_RETRY_CAP = 2;
export const EVAL_RETRY_WINDOW_MS = 60 * 60 * 1000;

export class InterviewSessionRepository {
  constructor(private readonly db: Database) {}

  insert(row: Insert<typeof interviewSessions>): Promise<InterviewSessionRow> {
    return this.db
      .insert(interviewSessions)
      .values(row)
      .returning()
      .then((r) => r[0]!);
  }

  /**
   * Insert unless the candidate already has a non-cancelled interview within `slotMinutes` of
   * `row.scheduledAt` (so two interviews can never share a slot). Serialised per candidate with an
   * advisory lock, so two parallel bookings cannot both pass the check. Returns null on a clash.
   */
  insertIfSlotFree(row: Insert<typeof interviewSessions>, slotMinutes: number, ignoreId?: string): Promise<InterviewSessionRow | null> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${row.candidateId}))`);
      if (await this.slotTaken(tx, row.candidateId, row.scheduledAt, slotMinutes, ignoreId)) return null;
      const [inserted] = await tx.insert(interviewSessions).values(row).returning();
      return inserted!;
    });
  }

  /** Move a session to a new slot under the same per-candidate lock; null when the slot is taken. */
  rescheduleIfSlotFree(id: string, candidateId: string, scheduledAt: Date, timezone: string, slotMinutes: number): Promise<InterviewSessionRow | null> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${candidateId}))`);
      if (await this.slotTaken(tx, candidateId, scheduledAt, slotMinutes, id)) return null;
      const [updated] = await tx
        .update(interviewSessions)
        .set({ scheduledAt, timezone })
        .where(eq(interviewSessions.id, id))
        .returning();
      return updated ?? null;
    });
  }

  private async slotTaken(
    tx: Pick<Database, "select">, candidateId: string, at: Date, slotMinutes: number, ignoreId?: string,
  ): Promise<boolean> {
    const ms = slotMinutes * 60_000;
    const rows = await tx
      .select({ id: interviewSessions.id })
      .from(interviewSessions)
      .where(and(
        eq(interviewSessions.candidateId, candidateId),
        ne(interviewSessions.status, "CANCELLED"),
        ne(interviewSessions.status, "ABORTED_TECHNICAL"),
        ne(interviewSessions.status, "COMPLETED"),
        gt(interviewSessions.scheduledAt, new Date(at.getTime() - ms)),
        lte(interviewSessions.scheduledAt, new Date(at.getTime() + ms - 1)),
        ...(ignoreId ? [ne(interviewSessions.id, ignoreId)] : []),
      ))
      .limit(1);
    return rows.length > 0;
  }

  findAllByLoopIds(loopIds: string[]): Promise<InterviewSessionRow[]> {
    if (loopIds.length === 0) return Promise.resolve([]);
    return this.db.select().from(interviewSessions).where(inArray(interviewSessions.loopId, loopIds));
  }

  findById(id: string): Promise<InterviewSessionRow | null> {
    return this.db.select().from(interviewSessions).where(eq(interviewSessions.id, id)).then(one);
  }

  /** The candidate's most recent session for a loop node (by slot), whatever its state. */
  findLatestForNode(candidateId: string, loopId: string, nodeId: string): Promise<InterviewSessionRow | null> {
    return this.db
      .select()
      .from(interviewSessions)
      .where(and(eq(interviewSessions.candidateId, candidateId), eq(interviewSessions.loopId, loopId), eq(interviewSessions.nodeId, nodeId)))
      .orderBy(desc(interviewSessions.scheduledAt))
      .limit(1)
      .then(one);
  }

  /**
   * The evaluation job's work: COMPLETED sessions awaiting or in an evaluation run (including a dispute re-check of a ready report), plus failed ones with
   * automatic retries left (under `retryCap` attempts inside the rolling `retryWindowMs`; an old window
   * resets the count, so a stale failure is eligible again).
   */
  findEvaluationWork(now: Date = new Date(), retryCap = EVAL_RETRY_CAP, retryWindowMs = EVAL_RETRY_WINDOW_MS): Promise<InterviewSessionRow[]> {
    const windowStart = new Date(now.getTime() - retryWindowMs);
    return this.db
      .select()
      .from(interviewSessions)
      .where(and(
        eq(interviewSessions.status, "COMPLETED"),
        or(
          inArray(interviewSessions.evalStatus, ["pending", "running"]),
          and(eq(interviewSessions.evalStatus, "ready"), isNotNull(interviewSessions.evalRunId)), // a dispute re-check in flight
          and(
            eq(interviewSessions.evalStatus, "failed"),
            or(
              lt(interviewSessions.evalAttempts, retryCap),
              isNull(interviewSessions.evalRetryWindowStart),
              lt(interviewSessions.evalRetryWindowStart, windowStart),
            ),
          ),
        ),
      ))
      .orderBy(asc(interviewSessions.scheduledAt));
  }

  /**
   * The evaluation-run claim: attach the run only to a completed round still waiting for one (pending, or failed and
   * being retried) with no other run attached meanwhile. A round that turned out to be a technical end (unscorable) or
   * that already has a report is never revived.
   */
  attachEvalRun(id: string, runId: string): Promise<InterviewSessionRow | null> {
    return this.db
      .update(interviewSessions)
      .set({ evalRunId: runId, evalRunStartedAt: new Date(), evalStatus: "running" })
      .where(and(
        eq(interviewSessions.id, id),
        isNull(interviewSessions.evalRunId),
        eq(interviewSessions.status, "COMPLETED"),
        inArray(interviewSessions.evalStatus, ["pending", "failed"]),
      ))
      .returning()
      .then(one);
  }

  /** Write the evaluation fields (status, score, outcome, retakeAfter, run bookkeeping...). */
  applyEvaluation(id: string, patch: Partial<Insert<typeof interviewSessions>>): Promise<InterviewSessionRow | null> {
    return this.db.update(interviewSessions).set(patch).where(eq(interviewSessions.id, id)).returning().then(one);
  }

  /** Live sessions that went live before `before`: the stuck-session sweep's candidates. */
  findLiveStartedBefore(before: Date): Promise<InterviewSessionRow[]> {
    return this.db
      .select()
      .from(interviewSessions)
      .where(and(eq(interviewSessions.status, "LIVE_IN_PROGRESS"), lt(interviewSessions.liveStartedAt, before)));
  }

  /** One session, scoped to its owner — the ownership check. */
  findByIdAndCandidateId(id: string, candidateId: string): Promise<InterviewSessionRow | null> {
    return this.db
      .select()
      .from(interviewSessions)
      .where(and(eq(interviewSessions.id, id), eq(interviewSessions.candidateId, candidateId)))
      .then(one);
  }

  /** A candidate's sessions, newest slot first. */
  findAllByCandidateIdOrderByScheduledAtDesc(candidateId: string): Promise<InterviewSessionRow[]> {
    return this.db
      .select()
      .from(interviewSessions)
      .where(eq(interviewSessions.candidateId, candidateId))
      .orderBy(desc(interviewSessions.scheduledAt));
  }

  /**
   * The blueprint reconcile job's work: sessions with an active prep run, and sessions waiting for
   * one (SCHEDULED or PREP_QUEUED) whose slot is still ahead (or only just passed).
   */
  findPrepWork(slotAfter: Date): Promise<InterviewSessionRow[]> {
    return this.db
      .select()
      .from(interviewSessions)
      .where(sql`${interviewSessions.prepRunId} is not null or (${interviewSessions.status} in ('SCHEDULED', 'PREP_QUEUED') and ${interviewSessions.scheduledAt} > ${slotAfter})`)
      .orderBy(asc(interviewSessions.scheduledAt));
  }

  /** Ready sessions far enough ahead to refresh, with no run active. */
  findRefreshCandidates(slotAfter: Date): Promise<InterviewSessionRow[]> {
    return this.db
      .select()
      .from(interviewSessions)
      .where(and(eq(interviewSessions.status, "PREP_READY"), gt(interviewSessions.scheduledAt, slotAfter), isNull(interviewSessions.prepRunId)))
      .orderBy(asc(interviewSessions.scheduledAt));
  }

  /** The prep-run claim: set the run only if no other run was attached meanwhile. */
  attachRun(id: string, runId: string, patch: Partial<Insert<typeof interviewSessions>> = {}): Promise<InterviewSessionRow | null> {
    return this.db
      .update(interviewSessions)
      .set({ ...patch, prepRunId: runId, prepRunStartedAt: new Date() })
      .where(and(eq(interviewSessions.id, id), isNull(interviewSessions.prepRunId)))
      .returning()
      .then(one);
  }

  update(id: string, patch: Partial<Insert<typeof interviewSessions>>): Promise<InterviewSessionRow | null> {
    return this.db.update(interviewSessions).set(patch).where(eq(interviewSessions.id, id)).returning().then(one);
  }

  /**
   * Compare-and-set the status (e.g. claim a SCHEDULED session for prep). Returns the updated row,
   * or null when the session was no longer in `from` — so two API instances polling at once never
   * both prepare the same session.
   */
  /** Writes the interviewer's own account over a round the candidate's End fallback already closed: that row
   * carries no live summary, an interviewer's report always does, so the summary being null is the test. */
  completeLiveEnd(
    id: string,
    patch: Pick<Insert<typeof interviewSessions>, "status" | "endedReason" | "liveSummary">,
  ): Promise<InterviewSessionRow | null> {
    return this.db
      .update(interviewSessions)
      .set(patch)
      .where(and(eq(interviewSessions.id, id), isNotNull(interviewSessions.liveEndedAt), isNull(interviewSessions.liveSummary)))
      .returning()
      .then(one);
  }

  transitionStatus(
    id: string,
    from: SessionStatus,
    to: SessionStatus,
    patch: Partial<Insert<typeof interviewSessions>> = {},
  ): Promise<InterviewSessionRow | null> {
    return this.db
      .update(interviewSessions)
      .set({ ...patch, status: to })
      .where(and(eq(interviewSessions.id, id), eq(interviewSessions.status, from)))
      .returning()
      .then(one);
  }
}

export class ProcessRepository {
  constructor(private readonly db: Database) {}

  insert(row: Insert<typeof interviewProcesses>): Promise<InterviewProcessRow> {
    return this.db.insert(interviewProcesses).values(row).returning().then((r) => r[0]!);
  }

  findAllByUser(userId: string): Promise<InterviewProcessRow[]> {
    return this.db.select().from(interviewProcesses).where(eq(interviewProcesses.userId, userId)).orderBy(desc(interviewProcesses.updatedAt));
  }

  findOwned(id: string, userId: string): Promise<InterviewProcessRow | null> {
    return this.db.select().from(interviewProcesses).where(and(eq(interviewProcesses.id, id), eq(interviewProcesses.userId, userId))).then(one);
  }

  update(id: string, patch: Partial<Insert<typeof interviewProcesses>>): Promise<InterviewProcessRow | null> {
    return this.db.update(interviewProcesses).set({ ...patch, updatedAt: new Date() }).where(eq(interviewProcesses.id, id)).returning().then(one);
  }

  delete(id: string): Promise<void> {
    return this.db.delete(interviewProcesses).where(eq(interviewProcesses.id, id)).then(() => undefined);
  }
}

export class LoopRepository {
  constructor(private readonly db: Database) {}

  /** Null when the user already has a live (active/paused) loop for this JD. */
  async insertIfNoLiveLoop(row: Insert<typeof loops>): Promise<LoopRow | null> {
    const inserted = await this.db.insert(loops).values(row).onConflictDoNothing().returning();
    return inserted[0] ?? null;
  }

  findAllByUser(userId: string): Promise<LoopRow[]> {
    return this.db.select().from(loops).where(eq(loops.userId, userId)).orderBy(desc(loops.confirmedAt));
  }

  findOwned(id: string, userId: string): Promise<LoopRow | null> {
    return this.db.select().from(loops).where(and(eq(loops.id, id), eq(loops.userId, userId))).then(one);
  }

  update(id: string, patch: Partial<Insert<typeof loops>>): Promise<LoopRow | null> {
    return this.db.update(loops).set({ ...patch, updatedAt: new Date() }).where(eq(loops.id, id)).returning().then(one);
  }
}

export class TargetRepository {
  constructor(private readonly db: Database) {}

  findAllByUser(userId: string): Promise<TargetRow[]> {
    return this.db.select().from(targets).where(eq(targets.userId, userId)).orderBy(desc(targets.createdAt));
  }

  add(userId: string, jdId: string): Promise<void> {
    return this.db.insert(targets).values({ userId, jdId }).onConflictDoNothing().then(() => undefined);
  }

  remove(userId: string, jdId: string): Promise<void> {
    return this.db.delete(targets).where(and(eq(targets.userId, userId), eq(targets.jdId, jdId))).then(() => undefined);
  }
}
