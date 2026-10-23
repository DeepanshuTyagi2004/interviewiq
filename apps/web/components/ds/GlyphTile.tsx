import * as React from "react";
import { cn } from "@/lib/utils/cn";

export interface GlyphTileProps {
  /** Kept for callers that pass a shade; every tile is the same glass. */
  tone?: number;
  /** The glyph: a lucide icon. */
  children: React.ReactNode;
  /** Side length in px. */
  size?: number;
  className?: string;
}

/**
 * A liquid-glass icon tile: a translucent plate (`.iq-glass-tile`) with the glyph drawn twice, a
 * soft grey copy offset below for depth and the ink glyph on top with a lit lower edge.
 * Decorative.
 */
export function GlyphTile({ children, size = 44, className }: GlyphTileProps) {
  return (
    <span
      aria-hidden
      className={cn("iq-glass-tile inline-grid flex-none place-items-center", className)}
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.3) }}
    >
      <span className="relative grid place-items-center">
        <span className="absolute inset-0 grid translate-y-[2px] place-items-center text-black/20 blur-[1px] dark:text-white/30">
          {children}
        </span>
        <span className="relative grid place-items-center text-[#2a2723] [filter:drop-shadow(0_1px_0_rgb(255_255_255/0.9))] dark:text-white dark:[filter:drop-shadow(0_1px_2px_rgb(0_0_0/0.5))]">
          {children}
        </span>
      </span>
    </span>
  );
}
