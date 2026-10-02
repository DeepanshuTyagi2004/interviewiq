import * as React from "react";
import { cn } from "@/lib/utils/cn";

export interface ReadoutProps {
  label: React.ReactNode;
  value: React.ReactNode;
  unit?: React.ReactNode;
  note?: React.ReactNode;
  size?: "sm" | "lg";
  className?: string;
}

/** Mono label over a tabular value (+ unit, + note): the HUD's KPI readout. Descriptive only. */
export function Readout({ label, value, unit, note, size = "lg", className }: ReadoutProps) {
  return (
    <div className={cn("flex min-w-0 flex-col", size === "lg" ? "gap-2" : "gap-1", className)}>
      <span className="iq-eyebrow">{label}</span>
      <span
        className={cn(
          "flex items-baseline gap-1 font-mono tabular-nums leading-none",
          size === "lg" ? "text-[28px] tracking-[-0.04em] sm:text-[32px]" : "text-base tracking-[-0.02em]",
        )}
      >
        {value}
        {unit ? <span className="font-mono text-[11px] tracking-normal text-faint">{unit}</span> : null}
      </span>
      {note ? <span className="text-xs leading-[1.4] text-muted-foreground">{note}</span> : null}
    </div>
  );
}
