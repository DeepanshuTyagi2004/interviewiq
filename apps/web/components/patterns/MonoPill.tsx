import * as React from "react";
import { cn } from "@/lib/utils/cn";

export type MonoPillTone = "brand" | "ink" | "soft" | "ghost" | "alert";

const TONES: Record<MonoPillTone, string> = {
  brand: "bg-brand text-brand-foreground",
  ink: "bg-primary text-primary-foreground",
  soft: "bg-line-2 text-foreground",
  ghost: "bg-transparent text-faint",
  alert: "bg-destructive/10 text-destructive",
};

export interface MonoPillProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: MonoPillTone;
}

/** Tiny uppercase mono status tag ("PASSED", "OCT 04", "LOCKED") from the design. */
export function MonoPill({ tone = "soft", className, ...props }: MonoPillProps) {
  return <span className={cn("iq-pill", TONES[tone], className)} {...props} />;
}
