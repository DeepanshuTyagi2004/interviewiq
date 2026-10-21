import * as React from "react";
import { cn } from "@/lib/utils/cn";

/** Whole segments to fill: rounded, clamped to 0…segments; NaN and empty bars → 0. */
export function clampFilled(filled: number, segments: number): number {
  if (!Number.isFinite(filled) || segments <= 0) return 0;
  return Math.max(0, Math.min(segments, Math.round(filled)));
}

export interface SegmentBarProps {
  segments: number;
  filled: number;
  size?: "sm" | "md" | "lg";
  /** Accessible label. Without one the bar is decorative (a text label sits beside it). */
  label?: string;
  className?: string;
}

const H = { sm: "h-1", md: "h-1.5", lg: "h-2" } as const;

/** Readiness / progress segment bar: ink fills on a surface-2 track. */
export function SegmentBar({ segments, filled, size = "sm", label, className }: SegmentBarProps) {
  const total = Math.max(segments, 0);
  const on = clampFilled(filled, total);
  return (
    <span
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn("grid gap-[3px]", className)}
      style={{ gridTemplateColumns: `repeat(${Math.max(total, 1)}, minmax(0, 1fr))` }}
    >
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          data-seg={i < on ? "on" : "off"}
          className={cn(
            "rounded-full transition-colors duration-300",
            H[size],
            i < on ? "bg-ink" : "bg-surface-2",
          )}
        />
      ))}
    </span>
  );
}
