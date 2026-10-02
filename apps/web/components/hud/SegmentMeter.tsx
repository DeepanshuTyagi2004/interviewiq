import { cn } from "@/lib/utils/cn";

/** Whole segments to fill: rounded, clamped to 0…segments; NaN and empty meters → 0. */
export function clampFilled(filled: number, segments: number): number {
  if (!Number.isFinite(filled) || segments <= 0) return 0;
  return Math.max(0, Math.min(segments, Math.round(filled)));
}

export interface SegmentMeterProps {
  segments: number;
  filled: number;
  /** Fill colour: ink (default, data) or brand (progress the user drives). */
  tone?: "ink" | "brand";
  size?: "sm" | "md";
  /** Accessible label. Without one the meter is decorative (a text label sits beside it). */
  label?: string;
  className?: string;
}

/** The HUD's segmented bar: data depth, readiness, sources linked. */
export function SegmentMeter({ segments, filled, tone = "ink", size = "sm", label, className }: SegmentMeterProps) {
  const on = clampFilled(filled, segments);
  return (
    <span
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn("grid gap-[3px]", className)}
      style={{ gridTemplateColumns: `repeat(${Math.max(segments, 1)}, minmax(0, 1fr))` }}
    >
      {Array.from({ length: Math.max(segments, 0) }, (_, i) => (
        <span
          key={i}
          data-seg={i < on ? "on" : "off"}
          className={cn(
            "rounded-[2px] transition-colors duration-300",
            size === "sm" ? "h-1" : "h-1.5",
            i < on ? (tone === "brand" ? "bg-brand" : "bg-foreground") : "bg-line-3",
          )}
        />
      ))}
    </span>
  );
}
