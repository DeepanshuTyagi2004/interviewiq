import { randomBytes, scrypt, type ScryptOptions, timingSafeEqual } from "node:crypto";

/**
 * Password hashing with scrypt (node:crypto, async — never `scryptSync`, which would block the
 * event loop for ~100 ms per call).
 *
 * Stored format is self-describing so the cost parameters can be raised later without breaking
 * existing hashes:
 *
 *   scrypt$<N>$<r>$<p>$<salt base64url>$<hash base64url>
 *
 * Passwords are Unicode-normalized (NFKC) before hashing, so the same password typed on keyboards
 * that emit composed vs decomposed characters still matches (NIST SP 800-63B).
 */
export const SCRYPT_PARAMS = { N: 2 ** 15, r: 8, p: 3, saltBytes: 16, keyBytes: 64, maxmem: 64 * 1024 * 1024 } as const;

const SCHEME = "scrypt";
const B64URL = /^[A-Za-z0-9_-]+$/;

interface Params {
  N: number;
  r: number;
  p: number;
}

function derive(password: string, salt: Buffer, keyBytes: number, params: Params): Promise<Buffer> {
  const opts: ScryptOptions = { N: params.N, r: params.r, p: params.p, maxmem: SCRYPT_PARAMS.maxmem };
  return new Promise((resolve, reject) => {
    scrypt(password.normalize("NFKC"), salt, keyBytes, opts, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SCRYPT_PARAMS.saltBytes);
  const key = await derive(password, salt, SCRYPT_PARAMS.keyBytes, SCRYPT_PARAMS);
  const { N, r, p } = SCRYPT_PARAMS;
  return [SCHEME, N, r, p, salt.toString("base64url"), key.toString("base64url")].join("$");
}

/**
 * Constant-time check of `password` against a stored hash. A malformed or tampered stored string
 * is a mismatch (false), never an exception — and its cost parameters are bounded so a corrupted
 * row can't make us burn unbounded CPU/memory.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = parse(stored);
  if (!parsed) return false;
  try {
    const key = await derive(password, parsed.salt, parsed.hash.length, parsed);
    return timingSafeEqual(key, parsed.hash);
  } catch {
    return false;
  }
}

/**
 * Spend the same work as a real verification and discard the result. Used when the account doesn't
 * exist (or has no password) so login timing doesn't reveal which emails are registered.
 */
export async function burnPasswordCheck(password: string): Promise<void> {
  await derive(password, randomBytes(SCRYPT_PARAMS.saltBytes), SCRYPT_PARAMS.keyBytes, SCRYPT_PARAMS);
}

function parse(stored: string): (Params & { salt: Buffer; hash: Buffer }) | null {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== SCHEME) return null;
  const [N, r, p] = parts.slice(1, 4).map((s) => (/^\d{1,10}$/.test(s!) ? Number(s) : NaN)) as [number, number, number];
  const saltB64 = parts[4]!;
  const hashB64 = parts[5]!;
  const powerOfTwo = Number.isInteger(N) && N >= 2 && (N & (N - 1)) === 0;
  if (!powerOfTwo || !(r >= 1 && r <= 32) || !(p >= 1 && p <= 16)) return null;
  // OpenSSL's memory need is 128·r·(N+2) + 128·r·p bytes; anything over `maxmem` is refused.
  if (128 * r * (N + 2) + 128 * r * p > SCRYPT_PARAMS.maxmem) return null;
  if (!B64URL.test(saltB64) || !B64URL.test(hashB64)) return null;
  const salt = Buffer.from(saltB64, "base64url");
  const hash = Buffer.from(hashB64, "base64url");
  // A truncated hash must not verify (scrypt output prefixes are stable across key lengths).
  if (salt.length < 16 || salt.length > 64 || hash.length < 32 || hash.length > 128) return null;
  return { N, r, p, salt, hash };
}
