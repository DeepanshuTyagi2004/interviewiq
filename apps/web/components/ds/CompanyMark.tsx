import * as React from "react";
import { cn } from "@/lib/utils/cn";
import { hueIndex } from "./palette";

/** One or two capital letters for a name: the first letters of two words, or the first two of one. */
export function markInitials(name: string): string {
  const words = name.trim().split(/[\s\-_.]+/).filter(Boolean);
  if (words.length === 0) return "?";
  const letters = words.length > 1 ? words[0][0] + words[1][0] : words[0].slice(0, 2);
  return letters.toUpperCase();
}

const INK = "#23211E";
const GOLD = "#C9A56A";
const GOLD_LIGHT = "#F0DCB0";

/** Eight small compositions on a 48px grid, picked by the seed. Ink, champagne and white only. */
const EMBLEMS: readonly React.ReactNode[] = [
  // orb and moon
  <>
    <circle cx="22" cy="26" r="13" fill={INK} />
    <circle cx="33" cy="15" r="6.5" fill={GOLD} />
  </>,
  // rising bars
  <>
    <rect x="10" y="22" width="8" height="18" rx="4" fill={INK} />
    <rect x="21" y="14" width="8" height="26" rx="4" fill={INK} />
    <rect x="32" y="8" width="8" height="32" rx="4" fill={GOLD} />
  </>,
  // overlapping discs
  <>
    <circle cx="19" cy="24" r="12" fill={INK} />
    <circle cx="30" cy="24" r="12" fill={GOLD} fillOpacity=".9" />
  </>,
  // quarter arcs
  <>
    <path d="M10 38V18a20 20 0 0 1 20 20Z" fill={INK} />
    <path d="M38 10v20a20 20 0 0 1-20-20Z" fill={GOLD} />
  </>,
  // dot grid
  <>
    {[0, 1, 2].flatMap((r) =>
      [0, 1, 2].map((c) => (
        <circle key={`${r}${c}`} cx={13 + c * 11} cy={13 + r * 11} r="4" fill={r === 1 && c === 2 ? GOLD : INK} />
      )),
    )}
  </>,
  // ring and core
  <>
    <circle cx="24" cy="24" r="14" fill="none" stroke={INK} strokeWidth="5" />
    <circle cx="24" cy="24" r="6" fill={GOLD} />
  </>,
  // diamond
  <>
    <rect x="12" y="12" width="24" height="24" rx="6" transform="rotate(45 24 24)" fill={INK} />
    <circle cx="24" cy="24" r="5" fill={GOLD_LIGHT} />
  </>,
  // stacked half discs
  <>
    <path d="M9 22a15 15 0 0 1 30 0Z" fill={GOLD} />
    <path d="M9 26a15 15 0 0 0 30 0Z" fill={INK} />
  </>,
];

export interface CompanyMarkProps {
  /** Seeds the emblem (a company slug or id), so the same company always gets the same one. */
  seed: string;
  /** Kept for callers that pass the name; the emblem is a drawing, not initials. */
  name?: string;
  /** Side length in px. */
  size?: number;
  className?: string;
}

/**
 * A small generated emblem for a company or role: ink and champagne shapes on a pearl tile, one of
 * eight compositions per seed. Decorative: the name is always shown beside it.
 */
export function CompanyMark({ seed, size = 40, className }: CompanyMarkProps) {
  const i = hueIndex(seed);
  return (
    <span
      aria-hidden
      data-mark={i}
      className={cn("iq-glass-tile inline-grid flex-none place-items-center", className)}
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.3),
      }}
    >
      <svg viewBox="0 0 48 48" width={size * 0.74} height={size * 0.74} style={{ filter: "drop-shadow(0 2px 2px rgb(60 45 25 / .25))" }}>
        {EMBLEMS[i]}
      </svg>
    </span>
  );
}
