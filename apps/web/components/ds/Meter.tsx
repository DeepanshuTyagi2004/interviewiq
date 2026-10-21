import * as React from "react";
import { cn } from "@/lib/utils/cn";

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0);

export interface MeterProps {
  /** 0..1, clamped. */
  value: number;
  /** 0..1 pass-mark tick. */
  mark?: number;
  label?: string;
  className?: string;
}

/** A thin continuous bar with an optional pass-mark tick. */
export function Meter({ value, mark, label, className }: MeterProps) {
  const v = clamp01(value);
  return (
    <div
      role={label ? "meter" : undefined}
      aria-label={label}
      aria-valuemin={label ? 0 : undefined}
      aria-valuemax={label ? 1 : undefined}
      aria-valuenow={label ? v : undefined}
      aria-hidden={label ? undefined : true}
      className={cn("relative h-1.5 w-full rounded-full bg-surface-2", className)}
    >
      <div
        className="h-full rounded-full bg-ink transition-[width] duration-500 ease-iq motion-reduce:transition-none"
        style={{ width: `${v * 100}%` }}
      />
      {mark != null ? (
        <span
          aria-hidden
          data-mark=""
          className="absolute -top-[3px] h-[12px] w-[2px] -translate-x-1/2 rounded-full bg-ink shadow-[0_0_0_2px_hsl(var(--background))]"
          style={{ left: `${clamp01(mark) * 100}%` }}
        />
      ) : null}
    </div>
  );
}
