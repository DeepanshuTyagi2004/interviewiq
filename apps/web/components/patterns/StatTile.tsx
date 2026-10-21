import * as React from "react";
import { Stat } from "@/components/ds/Stat";
import { cn } from "@/lib/utils/cn";

export interface StatTileProps {
  value: React.ReactNode;
  label: string;
  className?: string;
}

/** A single KPI: a big light number over a quiet label. Descriptive only, never a score, rank or comparison. */
export function StatTile({ value, label, className }: StatTileProps) {
  return <Stat label={label} value={value} size="sm" className={cn("px-5 py-5", className)} />;
}

export interface StatRowProps {
  children: React.ReactNode;
  className?: string;
}

/** Hairline-divided grid of StatTiles inside a ringed tile. */
export function StatRow({ children, className }: StatRowProps) {
  return (
    <div
      className={cn(
        "grid grid-cols-2 divide-x divide-y divide-line overflow-hidden rounded-tile bg-background shadow-ring sm:grid-cols-4 sm:divide-y-0",
        className,
      )}
    >
      {children}
    </div>
  );
}
