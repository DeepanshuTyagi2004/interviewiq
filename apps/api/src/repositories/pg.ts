import { and, asc, desc, eq, gt, inArray, isNull, lte, notInArray, sql } from "drizzle-orm";
import type { Database } from "../db/pg/client.js";
import {
  authTokens,
  companies,
  companyRoleConfigs,
  githubConnections,
  interviewSessions,
  jobDescriptions,
  leetcodeConnections,
  refreshTokens,
  users,
  type AuthTokenPurpose,
  type CompanyRoleConfigRow,
  type CompanyRow,
  type GitHubConnectionRow,
  type InterviewSessionRow,
  type JobDescriptionRow,
  type LeetCodeConnectionRow,
  type UserRow,
} from "../db/pg/schema.js";
import type { Role, SessionStatus } from "../domain/enums.js";

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
      await tx.delete(interviewSessions).where(eq(interviewSessions.candidateId, userId));
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

  findBySlug(slug: string): Promise<CompanyRow | null> {
    return this.db.select().from(companies).where(eq(companies.slug, slug)).then(one);
  }

  findAllBySlug(slugs: string[]): Promise<CompanyRow[]> {
    if (slugs.length === 0) return Promise.resolve([]);
    return this.db.select().from(companies).where(inArray(companies.slug, [...new Set(slugs)]));
  }

  async insert(row: Insert<typeof companies>): Promise<void> {
    await this.db.insert(companies).values(row);
  }

  async deleteBySlug(slug: string): Promise<void> {
    await this.db.delete(companies).where(eq(companies.slug, slug));
  }

  /** Delete every company whose slug is NOT in `keep`. Returns the number removed. */
  deleteAllExceptSlugs(keep: string[]): Promise<number> {
    return this.db
      .delete(companies)
      .where(notInArray(companies.slug, keep))
      .returning({ id: companies.id })
      .then((r) => r.length);
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

  deleteAllExceptCompanies(keep: string[]): Promise<number> {
    return this.db
      .delete(companyRoleConfigs)
      .where(notInArray(companyRoleConfigs.company, keep))
      .returning({ id: companyRoleConfigs.id })
      .then((r) => r.length);
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

  insert(row: Insert<typeof jobDescriptions>): Promise<JobDescriptionRow> {
    return this.db
      .insert(jobDescriptions)
      .values(row)
      .returning()
      .then((r) => r[0]!);
  }

  /** Remove ALL of a company's JDs (used on re-seed and on catalogue delete). */
  async deleteByCompany(company: string): Promise<void> {
    await this.db.delete(jobDescriptions).where(eq(jobDescriptions.company, company));
  }

  deleteAllExceptCompanies(keep: string[]): Promise<number> {
    return this.db
      .delete(jobDescriptions)
      .where(notInArray(jobDescriptions.company, keep))
      .returning({ id: jobDescriptions.id })
      .then((r) => r.length);
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

export class InterviewSessionRepository {
  constructor(private readonly db: Database) {}

  insert(row: Insert<typeof interviewSessions>): Promise<InterviewSessionRow> {
    return this.db
      .insert(interviewSessions)
      .values(row)
      .returning()
      .then((r) => r[0]!);
  }

  findById(id: string): Promise<InterviewSessionRow | null> {
    return this.db.select().from(interviewSessions).where(eq(interviewSessions.id, id)).then(one);
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

  /** Sessions in `status` whose slot is at or before `cutoff` — the prep poller's due-set. */
  findByStatusAndScheduledAtLessThanEqual(status: SessionStatus, cutoff: Date): Promise<InterviewSessionRow[]> {
    return this.db
      .select()
      .from(interviewSessions)
      .where(and(eq(interviewSessions.status, status), lte(interviewSessions.scheduledAt, cutoff)))
      .orderBy(asc(interviewSessions.scheduledAt));
  }

  update(id: string, patch: Partial<Insert<typeof interviewSessions>>): Promise<InterviewSessionRow | null> {
    return this.db.update(interviewSessions).set(patch).where(eq(interviewSessions.id, id)).returning().then(one);
  }

  /**
   * Compare-and-set the status (e.g. claim a SCHEDULED session for prep). Returns the updated row,
   * or null when the session was no longer in `from` — so two API instances polling at once never
   * both prepare the same session.
   */
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

