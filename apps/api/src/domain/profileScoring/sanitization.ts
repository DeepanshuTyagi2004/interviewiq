import { canonicalize, sha256Hex } from "../../lib/canonicalJson.js";

export const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
export const hashJson = (value: unknown): string => sha256Hex(canonicalize(value));
export function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}
export function list(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
export function sortedUnique<T>(values: T[]): T[] {
  const entries = new Map(values.map((value) => [canonicalize(value), value]));
  return [...entries.entries()].sort(([a], [b]) => compare(a, b)).map(([, value]) => value);
}
/** Defense in depth. No links or secret-looking strings enter frozen scoring snapshots. */
export function cleanText(value: unknown, identities: string[] = []): string | null {
  if (typeof value !== "string") return null;
  if (/\b(?:bearer\s+|(?:api[_ -]?key|(?:access[_ -]?)?token|private[_ -]?key|password|secret)\s*[:=])|\b(?:gh[pousr]_|sk[_-]|glpat-)[\w-]+/i.test(value)) return null;
  let text = value.slice(0, 2000).replace(/(?:https?:\/\/|www\.)\S+|\b[a-z][a-z\d+.-]*:\/\/\S+|\b(?:javascript|vbscript|data|file|mailto|tel):\S+/gi, "")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "")
    .replace(/\b(?:\+?\d[\d ()-]{8,}\d)\b/g, "");
  for (const identity of identities.filter((item) => item.trim().length >= 2).sort((a, b) => b.length - a.length)) {
    const escaped = identity.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    text = text.replace(new RegExp(`(?<![\\w])${escaped}(?![\\w])`, "gi"), "[redacted]");
  }
  text = text.replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim();
  return text || null;
}
export function textList(value: unknown, identities: string[] = []): string[] {
  return sortedUnique(list(value).map((item) => cleanText(item, identities)).filter((item): item is string => item !== null));
}
export function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
