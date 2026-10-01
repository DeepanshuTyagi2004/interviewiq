import type { Database } from "../db/pg/client.js";
import { randomToken, sha256Base64Url } from "../lib/crypto.js";
import { RefreshTokenRepository, UserRepository } from "../repositories/pg.js";
import type { JwtService } from "./jwt.js";

export class InvalidRefreshTokenError extends Error {
  constructor(message = "Invalid refresh token") {
    super(message);
    this.name = "InvalidRefreshTokenError";
  }
}

/**
 * Opaque refresh tokens (64 random bytes, base64url) stored only as a SHA-256 hash — same scheme
 * as the Spring RefreshTokenService, so existing sessions survive the migration. Every refresh
 * rotates: the presented token is revoked and a new one issued, atomically.
 */
export class RefreshTokenService {
  constructor(
    private readonly db: Database,
    private readonly jwt: JwtService,
    private readonly refreshTokenDays: number,
  ) {}

  /** Issue a new refresh token for the user; returns the raw token (only its hash is stored). */
  async createRefreshToken(userId: string, db: Database = this.db): Promise<string> {
    const raw = randomToken(64);
    await new RefreshTokenRepository(db).insert({
      tokenHash: sha256Base64Url(raw),
      userId,
      expiresAt: new Date(Date.now() + this.refreshTokenDays * 24 * 60 * 60 * 1000),
    });
    return raw;
  }

  /** Rotate: consume the presented token, issue a new refresh + access token. */
  async refresh(rawToken: string): Promise<{ accessToken: string; newRefreshToken: string }> {
    return this.db.transaction(async (tx) => {
      const txDb = tx as unknown as Database;
      const userId = await new RefreshTokenRepository(txDb).consumeActive(sha256Base64Url(rawToken), new Date());
      if (!userId) throw new InvalidRefreshTokenError("Refresh token invalid, expired or revoked");
      const user = await new UserRepository(txDb).findById(userId);
      if (!user) throw new InvalidRefreshTokenError("Refresh token user no longer exists");
      const newRefreshToken = await this.createRefreshToken(user.id, txDb);
      const accessToken = await this.jwt.createAccessToken(user);
      return { accessToken, newRefreshToken };
    });
  }

  async revoke(rawToken: string): Promise<void> {
    await new RefreshTokenRepository(this.db).revoke(sha256Base64Url(rawToken), new Date());
  }
}
