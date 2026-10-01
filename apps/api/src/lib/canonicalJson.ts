import { createHash } from "node:crypto";

/**
 * Deterministic JSON for content hashing: object keys sorted (UTF-16 code-unit order, the same as
 * Java's natural String order), arrays keep their order, no whitespace. Byte-compatible with the
 * Spring collectors' canonical form, so fragment hashes computed before the migration stay valid.
 */
export function canonicalize(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

export function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value !== null && typeof value === "object" && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = sortDeep((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/** Lower-case hex SHA-256 of the UTF-8 bytes. */
export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}
