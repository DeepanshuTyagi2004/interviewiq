import type { Database } from "../db/pg/client.js";
import type { AuthTokenPurpose } from "../db/pg/schema.js";
import { randomToken, sha256Base64Url } from "../lib/crypto.js";
import { AuthTokenRepository } from "../repositories/pg.js";

const HOUR_MS = 60 * 60 * 1000;

/** Lifetime of each email-token purpose. */
export const EMAIL_TOKEN_TTL_MS: Record<AuthTokenPurpose, number> = {
  verify_email: 24 * HOUR_MS,
  reset_password: 1 * HOUR_MS,
};

/**
 * Single-use tokens for email links (verify email, reset password). Same scheme as refresh tokens:
 * 32 random bytes (base64url) handed out once, only the SHA-256 hash stored. Issuing a new token
 * burns the user's older unused ones of that purpose, so only the newest link works.
 */
export class EmailTokenService {
  constructor(
    private readonly db: Database,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Issue a token; returns the raw value (only its hash is stored). */
  async issue(userId: string, purpose: AuthTokenPurpose, db: Database = this.db): Promise<string> {
    const raw = randomToken(32);
    const now = this.now();
    const repo = new AuthTokenRepository(db);
    await repo.invalidateActive(userId, purpose, now);
    await repo.insert({ userId, purpose, tokenHash: sha256Base64Url(raw), expiresAt: new Date(now.getTime() + EMAIL_TOKEN_TTL_MS[purpose]) });
    return raw;
  }

  /** Read-only: whose active token is this? (cheap pre-check before expensive work) */
  peek(raw: string, purpose: AuthTokenPurpose, db: Database = this.db): Promise<string | null> {
    return new AuthTokenRepository(db).findActiveUserId(sha256Base64Url(raw), purpose, this.now());
  }

  /** Atomically consume; the owning userId, or null if unknown/expired/used/wrong purpose. */
  consume(raw: string, purpose: AuthTokenPurpose, db: Database = this.db): Promise<string | null> {
    return new AuthTokenRepository(db).consumeActive(sha256Base64Url(raw), purpose, this.now());
  }
}
