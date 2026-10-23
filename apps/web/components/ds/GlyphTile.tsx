import * as React from "react";
import { cn } from "@/lib/utils/cn";
import { TILE_SHADOW, tileBackground } from "./palette";

export interface GlyphTileProps {
  /** Picks one of three graphite shades (any number; it wraps). */
  tone: number;
  /** The glyph: a lucide icon or a short string. Rendered white. */
  children: React.ReactNode;
  /** Side length in px. */
  size?: number;
  className?: string;
}

/** A graphite-glass tile holding one white glyph, like an app icon. Decorative. */
export function GlyphTile({ tone, children, size = 44, className }: GlyphTileProps) {
  return (
    <span
      aria-hidden
      data-tone={tone % 3}
      className={cn(
        "relative inline-grid flex-none place-items-center overflow-hidden text-white",
        className,
      )}
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.28), background: tileBackground(tone), boxShadow: TILE_SHADOW }}
    >
      <span className="relative grid place-items-center">{children}</span>
    </span>
  );
}
