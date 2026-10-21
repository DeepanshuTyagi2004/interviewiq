import * as React from "react";
import { cn } from "@/lib/utils/cn";

export interface StatProps {
  label: React.ReactNode;
  value: React.ReactNode;
  unit?: React.ReactNode;
  note?: React.ReactNode;
  size?: "sm" | "lg";
  className?: string;
}

/** A big light number over a quiet label. */
export function Stat({ label, value, unit, note, size = "lg", className }: StatProps) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="text-[13px] text-ink-3">{label}</div>
      <div
        className={cn(
          "mt-1 font-display font-light tabular-nums leading-none tracking-[-0.035em]",
          size === "lg" ? "text-[48px]" : "text-[28px]",
        )}
      >
        {value}
        {unit != null ? (
          <span className={cn("ml-1 font-sans font-normal tracking-normal text-ink-3", size === "lg" ? "text-[15px]" : "text-[12.5px]")}>
            {unit}
          </span>
        ) : null}
      </div>
      {note != null ? <div className="mt-2 text-[12.5px] text-ink-3">{note}</div> : null}
    </div>
  );
}
