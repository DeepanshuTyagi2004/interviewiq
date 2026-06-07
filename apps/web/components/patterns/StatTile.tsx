import * as React from "react";
import { cn } from "@/lib/utils/cn";

export interface StatTileProps {
  value: React.ReactNode;
  label: string;
  className?: string;
}

/**
 * A single KPI: large Geist Mono value over a muted label. Descriptive only —
 * never a score, rank, or comparison.
 */
export function StatTile({ value, label, className }: StatTileProps) {
  return (
    <div className={cn("flex flex-col gap-1 px-5 py-4", className)}>
      <span className="font-mono text-2xl font-semibold tracking-tight tabular-nums">
        {value}
      </span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

export interface StatRowProps {
  children: React.ReactNode;
  className?: string;
}

/**
 * Hairline-divided grid of StatTiles. Wraps the row in a card-bordered
 * container; vertical dividers between tiles via `divide-x`.
 */
export function StatRow({ children, className }: StatRowProps) {
  return (
    <div
      className={cn(
        "grid grid-cols-2 divide-x divide-y divide-border overflow-hidden rounded-xl border border-border bg-card sm:grid-cols-4 sm:divide-y-0",
        className,
      )}
    >
      {children}
    </div>
  );
}
