import * as React from "react";
import { cn } from "@/lib/utils/cn";
import { Orb } from "./Orb";

export interface EmptyStateProps {
  title: React.ReactNode;
  hint?: React.ReactNode;
  children?: React.ReactNode;
  /** Show the orb above the line. Default true. */
  orb?: boolean;
  /** Orb diameter in px (default 60). */
  orbSize?: number;
  /** Lay the orb beside the text (for short cards). */
  inline?: boolean;
  className?: string;
}

export function EmptyState({ title, hint, children, orb = true, orbSize = 60, inline = false, className }: EmptyStateProps) {
  const seed = typeof title === "string" ? title : "";
  if (inline) {
    return (
      <div className={cn("flex items-center gap-4 px-5 py-4 text-left", className)}>
        {orb ? <Orb seed={seed} size={orbSize} state="breathing" className="flex-none" /> : null}
        <div className="min-w-0">
          <p className="m-0 font-display text-[18px] font-medium leading-snug tracking-[-0.02em]">{title}</p>
          {hint ? <p className="m-0 mt-1 text-[13.5px] leading-[1.5] text-ink-3">{hint}</p> : null}
          {children ? <div className="pt-2.5">{children}</div> : null}
        </div>
      </div>
    );
  }
  return (
    <div className={cn("flex flex-col items-center gap-2 px-6 py-12 text-center", className)}>
      {orb ? <Orb seed={seed} size={orbSize} state="breathing" className="mb-2" /> : null}
      <p className="m-0 font-display text-[20px] font-normal leading-snug tracking-[-0.02em]">{title}</p>
      {hint ? <p className="m-0 max-w-sm text-[14px] leading-[1.55] text-ink-3">{hint}</p> : null}
      {children ? <div className="pt-3">{children}</div> : null}
    </div>
  );
}
