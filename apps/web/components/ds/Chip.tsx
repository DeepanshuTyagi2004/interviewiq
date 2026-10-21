import * as React from "react";
import { cn } from "@/lib/utils/cn";

export type ChipTone = "default" | "ink" | "outline";
export type ChipDot = "filled" | "hollow" | "live";

const TONE: Record<ChipTone, string> = {
  default: "bg-surface-2 text-ink-2",
  ink: "bg-ink text-background",
  outline: "bg-transparent text-ink-2 shadow-[inset_0_0_0_1px_hsl(var(--line))]",
};

export function Chip({
  tone = "default",
  dot,
  children,
  className,
}: {
  tone?: ChipTone;
  dot?: ChipDot;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-[26px] items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-[12.5px] font-medium",
        TONE[tone],
        className,
      )}
    >
      {dot ? (
        <span
          aria-hidden
          data-motion={dot === "live" ? "" : undefined}
          className={cn(
            "h-1.5 w-1.5 flex-none rounded-full",
            dot === "hollow" ? "shadow-[inset_0_0_0_1.5px_currentColor] opacity-70" : "bg-current",
            dot === "live" && "iq-breathe",
          )}
        />
      ) : null}
      {children}
    </span>
  );
}
