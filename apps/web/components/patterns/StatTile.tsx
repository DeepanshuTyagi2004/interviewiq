import * as React from "react";
import { Readout } from "@/components/hud/Readout";
import { cn } from "@/lib/utils/cn";

export interface StatTileProps {
  value: React.ReactNode;
  label: string;
  className?: string;
}

/**
 * A single KPI: the HUD readout (mono label over a large Geist Mono value). Descriptive only —
 * never a score, rank, or comparison.
 */
export function StatTile({ value, label, className }: StatTileProps) {
  return <Readout label={label} value={value} className={cn("px-5 py-5", className)} />;
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
        "grid grid-cols-2 divide-x divide-y divide-border overflow-hidden rounded-[14px] border border-border bg-card sm:grid-cols-4 sm:divide-y-0",
        className,
      )}
    >
      {children}
    </div>
  );
}
