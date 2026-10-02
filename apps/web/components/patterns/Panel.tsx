import * as React from "react";
import { cn } from "@/lib/utils/cn";

export interface PanelProps {
  /** Uppercase mono label in the panel's top-left. */
  eyebrow?: string;
  /** Optional right-aligned control in the header row (e.g. a "View all" link). */
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  /** Accessible name for the region; defaults to the eyebrow. */
  "aria-label"?: string;
}

/**
 * The design's grey "panel": a soft fill that white floating cards sit on. Use it to group a
 * page section; put `iq-float` cards (or Cards) inside.
 */
export function Panel({ eyebrow, action, children, className, "aria-label": ariaLabel }: PanelProps) {
  return (
    <section
      aria-label={ariaLabel ?? eyebrow}
      className={cn("flex min-w-0 flex-col gap-4 rounded-[14px] bg-panel p-4 sm:p-5", className)}
    >
      {eyebrow || action ? (
        <div className="flex min-h-5 items-center justify-between gap-3">
          {eyebrow ? <p className="iq-eyebrow m-0">{eyebrow}</p> : <span />}
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}
