/**
 * Series slots for part-to-whole bars, in a fixed order (never cycled): the theme's grey `--chart-*`
 * ramp from ink to line, largest share darkest. Series are told apart by shade, the 2px gaps between
 * segments and the legend, never by hue. Anything past the last slot folds into a striped "Other".
 */
export const SHARE_SLOTS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
] as const;

export const OTHER_COLOR = "hsl(var(--faint-2))";

/** The folded "Other" bucket is hatched on top of its grey so it never reads as another series. */
export const OTHER_PATTERN =
  "repeating-linear-gradient(135deg, transparent 0 2px, hsl(var(--background) / 0.55) 2px 4px)";

export interface Share {
  name: string;
  value: number;
  color: string;
  /** True for the folded "Other" bucket. */
  other?: boolean;
}

/**
 * Keep the largest `max` items (by value) with their own colour; fold the rest into one "Other"
 * item. Zero and negative values are dropped. Order is largest first, "Other" last.
 */
export function foldShares<T>(
  items: T[],
  getName: (item: T) => string,
  getValue: (item: T) => number,
  max: number = SHARE_SLOTS.length,
): Share[] {
  const sorted = items
    .map((item) => ({ name: getName(item), value: getValue(item) }))
    .filter((s) => s.value > 0)
    .sort((a, b) => b.value - a.value);

  const limit = Math.max(0, Math.min(max, SHARE_SLOTS.length));
  const kept: Share[] = sorted.slice(0, limit).map((s, i) => ({ ...s, color: SHARE_SLOTS[i] }));
  const rest = sorted.slice(limit);
  if (rest.length === 0) return kept;
  const otherValue = rest.reduce((sum, s) => sum + s.value, 0);
  return [...kept, { name: rest.length === 1 ? rest[0].name : "Other", value: otherValue, color: OTHER_COLOR, other: true }];
}

/** "48%", "4.5%", "<1%": one decimal only for small shares, never "0%". */
export function formatPct(pct: number): string {
  if (pct <= 0) return "0%";
  if (pct < 1) return "<1%";
  if (pct < 10) return `${Math.round(pct * 10) / 10}%`;
  return `${Math.round(pct)}%`;
}
