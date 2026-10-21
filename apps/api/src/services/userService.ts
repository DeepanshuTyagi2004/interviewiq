import type { Database } from "../db/pg/client.js";
import type { UserRow } from "../db/pg/schema.js";
import type { Role } from "../domain/enums.js";
import { ApiError } from "../lib/errors.js";
import { RefreshTokenRepository, UserRepository } from "../repositories/pg.js";

export interface UserResponse {
  id: string;
  email: string;
  name: string;
  role: Role;
  onboardingComplete: boolean;
  /** The user has proved control of `email` (verify link, reset link, or Google). */
  emailVerified: boolean;
  /** The account can sign in with email + password (false = Google-only). */
  hasPassword: boolean;
  /** A Google account is linked (can sign in with Google). */
  hasGoogle: boolean;
}

export function toUserResponse(u: UserRow): UserResponse {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    onboardingComplete: u.onboardingComplete,
    emailVerified: u.emailVerifiedAt !== null,
    hasPassword: u.passwordHash !== null,
    hasGoogle: u.googleSub !== null,
  };
}

export interface GoogleIdentity {
  sub: string;
  email: string;
  name: string;
  /** Google's `email_verified` claim. Only a verified Google email may claim an existing account. */
  emailVerified: boolean;
}

/** The email belongs to an account already linked to a DIFFERENT Google subject. */
export class GoogleAccountConflictError extends Error {
  constructor(message = "email is already linked to a different Google account") {
    super(message);
    this.name = "GoogleAccountConflictError";
  }
}

/** Google didn't verify the email, and an account with that email already exists — refuse to link. */
export class GoogleEmailUnverifiedError extends Error {
  constructor(message = "Google has not verified this email; refusing to link it to an existing account") {
    super(message);
    this.name = "GoogleEmailUnverifiedError";
  }
}

export class UserService {
  /** Emails promoted to ADMIN on sign-in — the bootstrap for the very first admins. */
  private readonly bootstrapAdminEmails: Set<string>;

  constructor(
    private readonly db: Database,
    private readonly users: UserRepository,
    adminEmails: string[],
  ) {
    this.bootstrapAdminEmails = new Set(adminEmails.map((e) => e.toLowerCase()));
  }

  isBootstrapAdmin(email: string): boolean {
    return this.bootstrapAdminEmails.has(email.toLowerCase());
  }

  /**
   * Create/update the user from a Google login. Bootstrap-promotes; never auto-demotes.
   *
   * Account linking — "Google claims the email":
   *   1. known Google subject → update it (today's behaviour);
   *   2. else an account with that email (case-insensitive) and no Google subject → link it, but
   *      only if Google says `email_verified`. If that account's email was NEVER verified, its
   *      password is cleared and its refresh tokens revoked: whoever registered it hadn't proved
   *      they own the inbox (defeats account pre-hijacking);
   *   3. the email belongs to a different Google subject → fail the login;
   *   4. otherwise create a new Google account (verified iff Google says so).
   */
  async upsertFromGoogle(identity: GoogleIdentity): Promise<UserRow> {
    const promoteToAdmin = this.isBootstrapAdmin(identity.email);
    const now = new Date();
    const known = await this.users.findByGoogleSub(identity.sub);
    if (!known) {
      const byEmail = await this.users.findByEmailInsensitive(identity.email);
      if (byEmail) return this.linkGoogle(byEmail, identity, promoteToAdmin, now);
    }
    return this.users.upsertByGoogleSub({
      googleSub: identity.sub,
      email: identity.email,
      name: identity.name,
      promoteToAdmin,
      emailVerified: identity.emailVerified,
      now,
    });
  }

  private async linkGoogle(existing: UserRow, identity: GoogleIdentity, promoteToAdmin: boolean, now: Date): Promise<UserRow> {
    if (existing.googleSub !== null) throw new GoogleAccountConflictError();
    if (!identity.emailVerified) throw new GoogleEmailUnverifiedError();
    const neverVerified = existing.emailVerifiedAt === null;
    return this.db.transaction(async (tx) => {
      const txDb = tx as unknown as Database;
      const linked = await new UserRepository(txDb).linkGoogle(existing.id, {
        googleSub: identity.sub,
        email: identity.email,
        name: identity.name,
        promoteToAdmin,
        clearPassword: neverVerified,
        now,
      });
      if (!linked) throw new GoogleAccountConflictError("account was linked to Google concurrently");
      if (neverVerified) await new RefreshTokenRepository(txDb).revokeAllForUser(existing.id, now);
      return linked;
    });
  }

  getById(id: string): Promise<UserRow | null> {
    return this.users.findById(id);
  }

  listUsers(): Promise<UserRow[]> {
    return this.users.findAll();
  }

  async updateRole(id: string, role: Role): Promise<UserRow | null> {
    if (role !== "ADMIN") {
      const current = await this.users.findById(id);
      if (current?.role === "ADMIN" && (await this.users.countByRole("ADMIN")) <= 1) {
        throw new ApiError(409, "last_admin", "Cannot remove the last admin");
      }
    }
    return this.users.updateRole(id, role);
  }

  rename(id: string, name: string): Promise<UserRow | null> {
    return this.users.updateName(id, name);
  }
}
