import * as React from "react";
import { cn } from "@/lib/utils/cn";
import { Orb } from "./Orb";

export interface EmptyStateProps {
  title: React.ReactNode;
  hint?: React.ReactNode;
  children?: React.ReactNode;
  /** Show the orb above the line. Default true. */
  orb?: boolean;
  className?: string;
}

export function EmptyState({ title, hint, children, orb = true, className }: EmptyStateProps) {
  const seed = typeof title === "string" ? title : "";
  return (
    <div className={cn("flex flex-col items-center gap-2 px-6 py-12 text-center", className)}>
      {orb ? <Orb seed={seed} size={44} state="breathing" className="mb-3" /> : null}
      <p className="m-0 font-display text-[20px] font-normal leading-snug tracking-[-0.02em]">{title}</p>
      {hint ? <p className="m-0 max-w-sm text-[14px] leading-[1.55] text-ink-3">{hint}</p> : null}
      {children ? <div className="pt-3">{children}</div> : null}
    </div>
  );
}
