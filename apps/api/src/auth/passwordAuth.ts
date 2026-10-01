import type { Database } from "../db/pg/client.js";
import type { UserRow } from "../db/pg/schema.js";
import type { BackgroundTasks } from "../lib/background.js";
import { isUniqueViolation, safeErrorMessage } from "../lib/errors.js";
import type { Logger } from "../lib/logger.js";
import { burnPasswordCheck, hashPassword, verifyPassword } from "../lib/password.js";
import { AuthTokenRepository, RefreshTokenRepository, UserRepository } from "../repositories/pg.js";
import type { UserService } from "../services/userService.js";
import type { EmailTokenService } from "./emailTokens.js";
import type { JwtService } from "./jwt.js";
import type { Mailer } from "./mailer.js";
import type { RefreshTokenService } from "./refreshTokens.js";

/** Sign-up on an email that already has a (password) account. */
export class EmailTakenError extends Error {
  constructor() {
    super("email already registered");
    this.name = "EmailTakenError";
  }
}

/** Sign-up on an email owned by a Google account — the user should continue with Google. */
export class UseGoogleError extends Error {
  constructor() {
    super("email belongs to a Google account");
    this.name = "UseGoogleError";
  }
}

/** Unknown email, wrong password, or an account without a password. Deliberately indistinguishable. */
export class InvalidCredentialsError extends Error {
  constructor() {
    super("invalid credentials");
    this.name = "InvalidCredentialsError";
  }
}

/** A verify/reset token that is unknown, expired, already used, or for the other purpose. */
export class InvalidAuthTokenError extends Error {
  constructor() {
    super("invalid or expired token");
    this.name = "InvalidAuthTokenError";
  }
}

export interface IssuedSession {
  user: UserRow;
  accessToken: string;
  /** Raw refresh token for the httpOnly cookie (only its hash is stored). */
  refreshToken: string;
}

/**
 * Email/password accounts: register, login, email verification and password reset. Inputs arrive
 * already validated and normalized by the router (email trimmed + lowercased, name trimmed).
 *
 * Emails are handed to the Mailer in the background, so a slow provider never slows a request and
 * forgot-password takes the same time whether or not the account exists.
 */
export class PasswordAuthService {
  private readonly users: UserRepository;

  constructor(
    private readonly db: Database,
    private readonly userService: UserService,
    private readonly emailTokens: EmailTokenService,
    private readonly refreshTokens: RefreshTokenService,
    private readonly jwt: JwtService,
    private readonly mailer: Mailer,
    private readonly background: BackgroundTasks,
    private readonly log: Logger,
    private readonly frontendUrl: string,
  ) {
    this.users = new UserRepository(db);
  }

  async register(input: { name: string; email: string; password: string }): Promise<IssuedSession> {
    const existing = await this.users.findByEmailInsensitive(input.email);
    if (existing) throw existing.googleSub !== null ? new UseGoogleError() : new EmailTakenError();

    const passwordHash = await hashPassword(input.password);
    let user: UserRow;
    try {
      user = await this.users.insertWithPassword({
        email: input.email,
        name: input.name,
        passwordHash,
        role: this.userService.isBootstrapAdmin(input.email) ? "ADMIN" : "USER",
      });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      // Lost a race with a concurrent sign-up / first Google login for the same email.
      const winner = await this.users.findByEmailInsensitive(input.email);
      throw winner?.googleSub ? new UseGoogleError() : new EmailTakenError();
    }

    // The account exists now; a failure to queue the link must not fail sign-up (they can resend).
    await this.sendVerification(user).catch((err: unknown) => {
      this.log.warn({ userId: user.id }, `verification email not queued: ${safeErrorMessage(err)}`);
    });
    return this.startSession(user);
  }

  async login(input: { email: string; password: string }): Promise<IssuedSession> {
    const user = await this.users.findByEmailInsensitive(input.email);
    if (!user || user.passwordHash === null) {
      await burnPasswordCheck(input.password); // same cost as a real check: timing doesn't reveal the account
      throw new InvalidCredentialsError();
    }
    if (!(await verifyPassword(input.password, user.passwordHash))) throw new InvalidCredentialsError();
    return this.startSession(user);
  }

  async verifyEmail(rawToken: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const txDb = tx as unknown as Database;
      const userId = await this.emailTokens.consume(rawToken, "verify_email", txDb);
      if (!userId) throw new InvalidAuthTokenError();
      await new UserRepository(txDb).markEmailVerified(userId, new Date());
    });
  }

  /** Re-send the verification link. A no-op when already verified. */
  async resendVerification(userId: string): Promise<void> {
    const user = await this.users.findById(userId);
    if (!user || user.emailVerifiedAt !== null) return;
    await this.sendVerification(user);
  }

  /**
   * Always "succeeds" (no account enumeration). The lookup, token and email all happen in the
   * background so the response time is the same either way. Any account qualifies — for a
   * Google-only account, resetting simply adds a password.
   */
  forgotPassword(email: string): void {
    this.background.run("forgot-password", async () => {
      try {
        const user = await this.users.findByEmailInsensitive(email);
        if (!user || (user.passwordHash === null && user.googleSub === null)) return;
        const raw = await this.emailTokens.issue(user.id, "reset_password");
        await this.deliver("password reset", user.id, () =>
          this.mailer.sendPasswordResetEmail({ to: user.email, name: user.name, link: this.link("/reset-password", raw) }),
        );
      } catch (err) {
        // Not rethrown: BackgroundTasks would log the raw error, and Drizzle's carries the email.
        this.log.warn(`forgot-password failed: ${safeErrorMessage(err)}`);
      }
    });
  }

  /**
   * Set a new password from a reset link: new hash, email marked verified (they proved inbox
   * access), token consumed, and EVERY refresh token revoked (sign out everywhere).
   */
  async resetPassword(rawToken: string, newPassword: string): Promise<void> {
    // Cheap pre-check so a garbage token never costs a scrypt hash; the CAS below is the real check.
    if (!(await this.emailTokens.peek(rawToken, "reset_password"))) throw new InvalidAuthTokenError();
    const passwordHash = await hashPassword(newPassword);
    await this.db.transaction(async (tx) => {
      const txDb = tx as unknown as Database;
      const now = new Date();
      const userId = await this.emailTokens.consume(rawToken, "reset_password", txDb);
      if (!userId) throw new InvalidAuthTokenError();
      await new UserRepository(txDb).setPasswordAndMarkVerified(userId, passwordHash, now);
      await new RefreshTokenRepository(txDb).revokeAllForUser(userId, now);
      await new AuthTokenRepository(txDb).invalidateActive(userId, "reset_password", now);
    });
  }

  private async startSession(user: UserRow): Promise<IssuedSession> {
    const [accessToken, refreshToken] = await Promise.all([this.jwt.createAccessToken(user), this.refreshTokens.createRefreshToken(user.id)]);
    return { user, accessToken, refreshToken };
  }

  private async sendVerification(user: UserRow): Promise<void> {
    const raw = await this.emailTokens.issue(user.id, "verify_email");
    this.background.run("verification email", () =>
      this.deliver("verification", user.id, () =>
        this.mailer.sendVerificationEmail({ to: user.email, name: user.name, link: this.link("/verify-email", raw) }),
      ),
    );
  }

  /** Mailer failures are logged by user id only — provider errors can echo the address or the link. */
  private async deliver(kind: string, userId: string, send: () => Promise<void>): Promise<void> {
    try {
      await send();
    } catch (err) {
      this.log.warn({ userId, reason: err instanceof Error ? err.name : "unknown" }, `${kind} email could not be sent`);
    }
  }

  private link(path: string, rawToken: string): string {
    return `${this.frontendUrl}${path}?token=${encodeURIComponent(rawToken)}`;
  }
}
