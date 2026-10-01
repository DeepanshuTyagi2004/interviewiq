import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { TokenCipher } from "../../src/lib/crypto.js";

/** Ported from crypto/TokenCipherTest.java, plus Java wire-format compatibility checks. */

// A deterministic 32-byte (256-bit) key, base64-encoded, for tests only (32 zero bytes).
const TEST_KEY_B64 = Buffer.alloc(32).toString("base64");

/**
 * Known-answer vector produced by the Java TokenCipher's exact JCE calls
 * (AES/GCM/NoPadding, 128-bit tag) with key = bytes 0x00..0x1f and a fixed IV 0xa0..0xab,
 * encrypting "gho_exampleAccessToken1234567890". Layout: [12-byte IV][ciphertext][16-byte tag].
 */
const JAVA_KEY_B64 = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=";
const JAVA_PLAINTEXT = "gho_exampleAccessToken1234567890";
const JAVA_CIPHERTEXT = "oKGio6SlpqeoqaqrgXATciCzY9ISCeKSZBmlrQP4Nnv32XNerzoTsEiTTDHNhU+6g6YMHytjxKwiep8e";

describe("TokenCipher (ported from TokenCipherTest)", () => {
  const cipher = new TokenCipher(TEST_KEY_B64);

  it("roundTrip_returnsOriginalPlaintext", () => {
    const plaintext = "gho_exampleAccessToken1234567890";
    const encrypted = cipher.encrypt(plaintext);
    expect(cipher.decrypt(encrypted)).toBe(plaintext);
  });

  it("encrypt_producesDifferentCiphertextEachTime_dueToRandomIv", () => {
    const plaintext = "same-secret";
    const first = cipher.encrypt(plaintext);
    const second = cipher.encrypt(plaintext);

    expect(first).not.toBe(second);
    // both still decrypt back to the same plaintext
    expect(cipher.decrypt(first)).toBe(plaintext);
    expect(cipher.decrypt(second)).toBe(plaintext);
  });

  it("decrypt_tamperedCiphertext_throwsAuthenticationFailure", () => {
    const encrypted = cipher.encrypt("secret");
    const raw = Buffer.from(encrypted, "base64");
    // flip the last byte of the GCM tag
    raw[raw.length - 1] ^= 0x01;
    const tampered = raw.toString("base64");

    let thrown: unknown;
    try {
      cipher.decrypt(tampered);
    } catch (err) {
      thrown = err;
    }
    // Java: IllegalStateException("Failed to decrypt token") caused by AEADBadTagException.
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe("Failed to decrypt token");
    const cause = (thrown as Error).cause as Error;
    expect(cause).toBeInstanceOf(Error);
    expect(cause.message).toMatch(/unable to authenticate data/i);
  });
});

describe("TokenCipher — Java wire format [12-byte IV][ciphertext][16-byte tag]", () => {
  it("output is base64 of IV(12) + ciphertext(len(plaintext)) + tag(16)", () => {
    const cipher = new TokenCipher(TEST_KEY_B64);
    const plaintext = "gho_exampleAccessToken1234567890";
    const raw = Buffer.from(cipher.encrypt(plaintext), "base64");
    // GCM is a stream mode: ciphertext length == plaintext length.
    expect(raw.length).toBe(12 + Buffer.byteLength(plaintext, "utf8") + 16);
  });

  it("decrypts a ciphertext produced by the Java TokenCipher (known-answer vector)", () => {
    const cipher = new TokenCipher(JAVA_KEY_B64);
    expect(cipher.decrypt(JAVA_CIPHERTEXT)).toBe(JAVA_PLAINTEXT);
  });

  it("the Java vector's first 12 bytes are the IV, in the clear", () => {
    const raw = Buffer.from(JAVA_CIPHERTEXT, "base64");
    expect(raw.subarray(0, 12)).toEqual(Buffer.from([0xa0, 0xa1, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xab]));
    expect(raw.length).toBe(12 + JAVA_PLAINTEXT.length + 16);
  });

  it("encrypt/decrypt is symmetric for arbitrary UTF-8 (incl. empty and multi-byte)", () => {
    const cipher = new TokenCipher(JAVA_KEY_B64);
    for (const p of ["", "a", "ghp_" + "x".repeat(200), "résumé 🔑 токен"]) {
      expect(cipher.decrypt(cipher.encrypt(p))).toBe(p);
    }
  });

  it("decrypting with the wrong key fails", () => {
    const encrypted = new TokenCipher(JAVA_KEY_B64).encrypt("secret");
    const other = new TokenCipher(randomBytes(32).toString("base64"));
    expect(() => other.decrypt(encrypted)).toThrow("Failed to decrypt token");
    // and the Java vector does not open under the all-zero key
    expect(() => new TokenCipher(TEST_KEY_B64).decrypt(JAVA_CIPHERTEXT)).toThrow("Failed to decrypt token");
  });

  it("tampering with the IV or ciphertext body is also rejected", () => {
    const cipher = new TokenCipher(JAVA_KEY_B64);
    for (const idx of [0, 11, 12, 20]) {
      const raw = Buffer.from(JAVA_CIPHERTEXT, "base64");
      raw[idx] ^= 0x01;
      expect(() => cipher.decrypt(raw.toString("base64"))).toThrow("Failed to decrypt token");
    }
  });

  it("a truncated input (shorter than IV + tag) is rejected, not crashed on", () => {
    const cipher = new TokenCipher(JAVA_KEY_B64);
    expect(() => cipher.decrypt(Buffer.alloc(27).toString("base64"))).toThrow("Failed to decrypt token");
    expect(() => cipher.decrypt("")).toThrow("Failed to decrypt token");
  });

  it("a key that does not decode to 32 bytes throws at construction", () => {
    expect(() => new TokenCipher(Buffer.alloc(16).toString("base64"))).toThrow(
      "GITHUB_TOKEN_KEY must decode to 32 bytes (AES-256); got 16",
    );
    expect(() => new TokenCipher(Buffer.alloc(31).toString("base64"))).toThrow(/got 31/);
    expect(() => new TokenCipher(Buffer.alloc(33).toString("base64"))).toThrow(/got 33/);
    expect(() => new TokenCipher("")).toThrow(/got 0/);
  });
});
