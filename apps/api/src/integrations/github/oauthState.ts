import { createHmac } from "node:crypto";
import { InvalidArgumentError } from "../../lib/errors.js";
import { secureEquals } from "../../lib/crypto.js";

const MAX_AGE_SECONDS = 10 * 60;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Stateless CSRF state for the GitHub OAuth handshake.
 * Format (base64url, no padding): "{userId}:{epochSeconds}:{hmac}" — the HMAC (keyed with the JWT
 * secret) binds the user + timestamp so a tampered or forged state is rejected. Same format as the
 * Java OAuthStateService.
 */
export class OAuthStateService {
  constructor(
    private readonly secret: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  issue(userId: string): string {
    const payload = `${userId}:${Math.floor(this.now().getTime() / 1000)}`;
    return Buffer.from(`${payload}:${this.sign(payload)}`, "utf8").toString("base64url");
  }

  /** Returns the userId if the state is valid and unexpired; throws otherwise. */
  verify(state: string): string {
    const parts = Buffer.from(state, "base64url").toString("utf8").split(":");
    if (parts.length !== 3) throw new InvalidArgumentError("Malformed OAuth state");
    const [userId, issuedAtRaw, sig] = parts as [string, string, string];
    if (!secureEquals(this.sign(`${userId}:${issuedAtRaw}`), sig)) {
      throw new InvalidArgumentError("OAuth state signature mismatch");
    }
    const issuedAt = Number(issuedAtRaw);
    if (!Number.isInteger(issuedAt) || Math.floor(this.now().getTime() / 1000) - issuedAt > MAX_AGE_SECONDS) {
      throw new InvalidArgumentError("OAuth state expired");
    }
    if (!UUID_RE.test(userId)) throw new InvalidArgumentError("Malformed OAuth state");
    return userId.toLowerCase();
  }

  private sign(payload: string): string {
    return createHmac("sha256", Buffer.from(this.secret, "utf8")).update(payload, "utf8").digest("base64url");
  }
}
