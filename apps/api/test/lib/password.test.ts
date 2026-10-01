import { describe, expect, it } from "vitest";
import { hashPassword, SCRYPT_PARAMS, verifyPassword } from "../../src/lib/password.js";

describe("scrypt password hashing", () => {
  it("round-trips and stores a self-describing string with the configured params", async () => {
    const stored = await hashPassword("correct horse battery staple");
    const parts = stored.split("$");
    expect(parts).toHaveLength(6);
    expect(parts.slice(0, 4)).toEqual(["scrypt", String(SCRYPT_PARAMS.N), String(SCRYPT_PARAMS.r), String(SCRYPT_PARAMS.p)]);
    expect(SCRYPT_PARAMS).toMatchObject({ N: 32768, r: 8, p: 3, saltBytes: 16, keyBytes: 64 });
    expect(Buffer.from(parts[4]!, "base64url")).toHaveLength(16);
    expect(Buffer.from(parts[5]!, "base64url")).toHaveLength(64);
    expect(stored).not.toContain("correct horse");
    await expect(verifyPassword("correct horse battery staple", stored)).resolves.toBe(true);
  });

  it("salts every hash (same password → different strings)", async () => {
    const [a, b] = await Promise.all([hashPassword("same-password"), hashPassword("same-password")]);
    expect(a).not.toBe(b);
  });

  it("rejects a wrong password", async () => {
    const stored = await hashPassword("s3cret-password");
    await expect(verifyPassword("s3cret-passwore", stored)).resolves.toBe(false);
    await expect(verifyPassword("", stored)).resolves.toBe(false);
  });

  it("treats a tampered or malformed stored string as a mismatch, never an exception", async () => {
    const stored = await hashPassword("s3cret-password");
    const parts = stored.split("$");
    const flip = (s: string) => (s[0] === "A" ? "B" : "A") + s.slice(1);
    const tampered = [
      [parts[0], parts[1], parts[2], parts[3], parts[4], flip(parts[5]!)].join("$"), // hash changed
      [parts[0], parts[1], parts[2], parts[3], flip(parts[4]!), parts[5]].join("$"), // salt changed
      [parts[0], "16384", parts[2], parts[3], parts[4], parts[5]].join("$"), // N changed
      [parts[0], parts[1], parts[2], parts[3], parts[4], parts[5]!.slice(0, 20)].join("$"), // truncated hash
      ["bcrypt", ...parts.slice(1)].join("$"), // unknown scheme
      [parts[0], "12345", parts[2], parts[3], parts[4], parts[5]].join("$"), // N not a power of two
      [parts[0], String(2 ** 30), parts[2], parts[3], parts[4], parts[5]].join("$"), // absurd cost (DoS guard)
      [parts[0], parts[1], "abc", parts[3], parts[4], parts[5]].join("$"),
      "scrypt$32768$8$3",
      "not-a-hash",
      "",
    ];
    for (const t of tampered) {
      await expect(verifyPassword("s3cret-password", t), t).resolves.toBe(false);
    }
  });

  it("normalizes Unicode (composed and decomposed forms are the same password)", async () => {
    const composed = "café-password";
    const decomposed = "café-password";
    const stored = await hashPassword(composed);
    await expect(verifyPassword(decomposed, stored)).resolves.toBe(true);
  });
});
