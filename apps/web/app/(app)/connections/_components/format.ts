const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * "12 Sep" for dates in the current year, "12 Sep 2025" otherwise — the short date the design
 * uses in source rows ("Uploaded 12 Sep · parsed"). Returns null for a missing or invalid date.
 */
export function sourceDate(input: string | null | undefined, now: Date = new Date()): string | null {
  if (!input) return null;
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return null;
  const dayMonth = `${date.getDate()} ${MONTHS[date.getMonth()]}`;
  return date.getFullYear() === now.getFullYear() ? dayMonth : `${dayMonth} ${date.getFullYear()}`;
}

/** Join the truthy parts of a detail line with the design's middle dot. */
export function joinDetail(parts: (string | null | undefined | false)[]): string {
  return parts.filter(Boolean).join(" · ");
}
