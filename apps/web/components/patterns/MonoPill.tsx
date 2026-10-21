import * as React from "react";
import { cn } from "@/lib/utils/cn";

export type MonoPillTone = "brand" | "ink" | "soft" | "ghost" | "alert";

const TONES: Record<MonoPillTone, string> = {
  brand: "bg-ink text-background",
  ink: "bg-ink text-background",
  soft: "bg-surface-2 text-foreground",
  ghost: "bg-transparent text-ink-3",
  alert: "bg-destructive/10 text-destructive",
};

export interface MonoPillProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: MonoPillTone;
}

/** Small status pill ("Passed", "Oct 04", "Locked"). */
export function MonoPill({ tone = "soft", className, ...props }: MonoPillProps) {
  return <span className={cn("iq-pill rounded-full px-2.5 py-1 font-sans text-[11.5px] font-medium normal-case tracking-normal", TONES[tone], className)} {...props} />;
}
