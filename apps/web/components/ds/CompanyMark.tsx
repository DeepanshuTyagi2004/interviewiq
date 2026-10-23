import * as React from "react";
import { cn } from "@/lib/utils/cn";
import { TILE_SHADOW, hueIndex, tileBackground } from "./palette";

/** One or two capital letters for a name: the first letters of two words, or the first two of one. */
export function markInitials(name: string): string {
  const words = name.trim().split(/[\s\-_.]+/).filter(Boolean);
  if (words.length === 0) return "?";
  const letters = words.length > 1 ? words[0][0] + words[1][0] : words[0].slice(0, 2);
  return letters.toUpperCase();
}

export interface CompanyMarkProps {
  /** Seeds the hue (a company slug or id), so the same company always gets the same tile. */
  seed: string;
  name: string;
  /** Side length in px. */
  size?: number;
  className?: string;
}

/** A graphite-glass monogram tile for a company or role. Decorative: the name is always shown beside it. */
export function CompanyMark({ seed, name, size = 40, className }: CompanyMarkProps) {
  return (
    <span
      aria-hidden
      data-mark={hueIndex(seed)}
      className={cn(
        "inline-grid flex-none place-items-center font-semibold leading-none tracking-[-0.03em] text-white",
        className,
      )}
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.3),
        fontSize: Math.round(size * 0.38),
        background: tileBackground(hueIndex(seed)),
        boxShadow: TILE_SHADOW,
      }}
    >
      {markInitials(name)}
    </span>
  );
}
