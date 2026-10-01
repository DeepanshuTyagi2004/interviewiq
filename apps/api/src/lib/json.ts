/**
 * Small helpers for walking untyped JSON, with the same forgiving semantics the Java code got from
 * Jackson's `JsonNode.path(..).asInt(0)` / `asString("")`: missing or mistyped values fall back to
 * a default instead of throwing.
 */

export type JsonObject = Record<string, unknown>;

export function isObject(v: unknown): v is JsonObject {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** `node.path(a).path(b)...` — undefined when any step is missing or not an object. */
export function path(v: unknown, ...keys: string[]): unknown {
  let cur: unknown = v;
  for (const k of keys) {
    if (!isObject(cur)) return undefined;
    cur = cur[k];
  }
  return cur;
}

/** Iterate like a JsonNode: arrays yield their items, anything else yields nothing. */
export function items(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

export function asInt(v: unknown, def = 0): number {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "string" && /^\s*[-+]?\d+(\.\d+)?\s*$/.test(v)) return Math.trunc(Number(v));
  return def;
}

export function asDouble(v: unknown, def = 0): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return def;
}

export function asBoolean(v: unknown, def = false): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "true") return true;
    if (s === "false") return false;
  }
  return def;
}

/** Scalar → string (numbers/booleans stringified); null/missing/containers → `def`. */
export function asString(v: unknown, def = ""): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return def;
}

/** Jackson `textOrNull`: null/missing → null, scalar → its string form. */
export function textOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return asString(v, "");
}

export function isBlank(s: string | null | undefined): s is null | undefined | "" {
  return s === null || s === undefined || s.trim() === "";
}

export function trimToNull(s: string | null | undefined): string | null {
  if (s === null || s === undefined) return null;
  const t = s.trim();
  return t === "" ? null : t;
}

/** First non-blank of the given values, else null. */
export function firstNonBlank(...values: (string | null | undefined)[]): string | null {
  for (const v of values) if (!isBlank(v)) return v;
  return null;
}
