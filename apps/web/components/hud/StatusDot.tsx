import * as React from "react";
import { cn } from "@/lib/utils/cn";

/**
 * `live` = really running right now (a live session, a sync in flight) and the only state that
 * pulses. `active` = on but steady (connected, ready). `idle` = off, not started, not available.
 */
export type DotState = "live" | "active" | "idle" | "warn" | "error";

const DOT: Record<DotState, string> = {
  live: "bg-brand shadow-[0_0_0_3px_hsl(var(--brand)/0.18)] motion-safe:animate-[iq-breathe_1.4s_ease-in-out_infinite]",
  active: "bg-brand",
  idle: "bg-faint-2",
  warn: "bg-[hsl(var(--color-lc-medium))]",
  error: "bg-destructive",
};

/** The dot's classes for a state. Only `live` pulses (and only when motion is allowed). */
export function dotClass(state: DotState): string {
  return DOT[state];
}

export interface StatusDotProps {
  state: DotState;
  /** Visible mono label ("LIVE", "OK"). */
  label?: React.ReactNode;
  /** Screen-reader text when there's no visible label. Colour is never the only signal. */
  srLabel?: string;
  className?: string;
}

/** Status dot + optional mono label. Never decorative: it always reflects a real state. */
export function StatusDot({ state, label, srLabel, className }: StatusDotProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap font-mono text-[10.5px] uppercase leading-none tracking-[0.08em]",
        className,
      )}
    >
      <span
        aria-hidden
        data-motion={state === "live" ? "" : undefined}
        className={cn("h-1.5 w-1.5 flex-none rounded-full", DOT[state])}
      />
      {label ?? (srLabel ? <span className="sr-only">{srLabel}</span> : null)}
    </span>
  );
}
