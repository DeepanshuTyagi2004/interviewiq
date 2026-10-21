/** A transcript turn id from "turn:12", "12" or 12; null for anything else. */
export function parseTurnRef(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value !== "string") return null;
  const m = /^(?:turn:)?(\d+)$/.exec(value.trim());
  return m ? Number(m[1]) : null;
}
