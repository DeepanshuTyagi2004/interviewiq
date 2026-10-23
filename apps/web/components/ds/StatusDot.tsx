import * as React from "react";
import { cn } from "@/lib/utils/cn";

/**
 * `live` = really running right now and the only state that pulses. `active` = on but steady.
 * `idle` = off or not started. `warn` and `error` flag trouble (never colour alone: add a label).
 */
export type DotState = "live" | "active" | "idle" | "warn" | "error";

const DOT: Record<DotState, string> = {
  live: "bg-ink iq-breathe",
  active: "bg-ink",
  idle: "bg-transparent shadow-[inset_0_0_0_1.5px_hsl(var(--ink-3))]",
  warn: "bg-ink-2 shadow-[0_0_0_2px_hsl(var(--background)),0_0_0_3.5px_hsl(var(--ink-2))]",
  error: "bg-destructive",
};

/** The dot's classes for a state. Only `live` pulses (and only when motion is allowed). */
export function dotClass(state: DotState): string {
  return DOT[state];
}

export interface StatusDotProps {
  state: DotState;
  /** Visible label, or screen-reader-only text when `srOnly` is set. */
  label?: React.ReactNode;
  srOnly?: boolean;
  className?: string;
}

export function StatusDot({ state, label, srOnly, className }: StatusDotProps) {
  return (
    <span className={cn("inline-flex items-center gap-2 whitespace-nowrap text-[12.5px] text-ink-2", className)}>
      <span
        aria-hidden
        data-motion={state === "live" ? "" : undefined}
        className={cn("h-1.5 w-1.5 flex-none rounded-full", DOT[state])}
      />
      {label != null ? <span className={srOnly ? "sr-only" : "min-w-0"}>{label}</span> : null}
    </span>
  );
}
