import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";

const IV_LENGTH_BYTES = 12;
const TAG_LENGTH_BYTES = 16;

/**
 * AES-256-GCM encryption for the GitHub access token at rest.
 *
 * Format of the base64 output: [12-byte random IV][ciphertext][16-byte GCM tag] — identical to the
 * Java TokenCipher (JCE appends the tag to the ciphertext), so tokens encrypted by the Spring
 * backend decrypt here unchanged. A fresh IV is generated per encryption.
 */
export class TokenCipher {
  private readonly key: Buffer;

  constructor(base64Key: string) {
    const key = Buffer.from(base64Key, "base64");
    if (key.length !== 32) {
      throw new Error(`GITHUB_TOKEN_KEY must decode to 32 bytes (AES-256); got ${key.length}`);
    }
    this.key = key;
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_LENGTH_BYTES);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return Buffer.concat([iv, ciphertext, cipher.getAuthTag()]).toString("base64");
  }

  decrypt(encrypted: string): string {
    try {
      const combined = Buffer.from(encrypted, "base64");
      if (combined.length < IV_LENGTH_BYTES + TAG_LENGTH_BYTES) throw new Error("ciphertext too short");
      const iv = combined.subarray(0, IV_LENGTH_BYTES);
      const tag = combined.subarray(combined.length - TAG_LENGTH_BYTES);
      const ciphertext = combined.subarray(IV_LENGTH_BYTES, combined.length - TAG_LENGTH_BYTES);
      const decipher = createDecipheriv("aes-256-gcm", this.key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    } catch (err) {
      throw new Error("Failed to decrypt token", { cause: err });
    }
  }
}

/** SHA-256 → base64url (no padding). Used for refresh-token hashes (same encoding as the Java code). */
export function sha256Base64Url(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("base64url");
}

/** Random URL-safe token of `bytes` random bytes. */
export function randomToken(bytes: number): string {
  return randomBytes(bytes).toString("base64url");
}

/** Constant-time string equality (hashes first so differing lengths don't short-circuit). */
export function secureEquals(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a, "utf8").digest();
  const hb = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(ha, hb) && a.length === b.length;
}
