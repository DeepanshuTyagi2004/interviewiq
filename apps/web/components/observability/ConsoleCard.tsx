import * as React from "react";
import { MonoPill } from "@/components/patterns";
import { cn } from "@/lib/utils/cn";
import type { PillLook } from "./status";

export interface ConsoleCardProps {
  /** Header title (kept light: 14px, normal weight). */
  title: React.ReactNode;
  /** Right side of the header row: a count, a status pill or a small control. */
  meta?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  /** Accessible name for the region when the title isn't plain text. */
  "aria-label"?: string;
}

/**
 * The admin consoles' section frame: a hairline card with a header row, matching the dashboard's
 * list cards (`rounded-[14px] border-line-2`, header `px-4 sm:px-5 py-4 border-b border-line`).
 */
export function ConsoleCard({
  title,
  meta,
  children,
  className,
  bodyClassName,
  "aria-label": ariaLabel,
}: ConsoleCardProps) {
  return (
    <section
      aria-label={ariaLabel ?? (typeof title === "string" ? title : undefined)}
      className={cn("min-w-0 overflow-hidden rounded-[14px] border border-line-2 bg-card", className)}
    >
      <div className="flex min-h-[53px] flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-line px-4 py-3 text-sm sm:px-5">
        <h2 className="m-0 min-w-0 text-sm font-normal">{title}</h2>
        {meta ? <div className="flex flex-wrap items-center gap-2 text-xs text-faint">{meta}</div> : null}
      </div>
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

/** Mono count for a card header ("12 briefs"). */
export function HeaderCount({ children }: { children: React.ReactNode }) {
  return <span className="font-mono text-[11.5px] tabular-nums text-faint">{children}</span>;
}

/** A MonoPill rendered from a {@link PillLook}. */
export function LookPill({
  look,
  className,
  children,
  ...props
}: { look: PillLook } & React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <MonoPill tone={look.tone} className={cn(look.className, className)} {...props}>
      {children}
    </MonoPill>
  );
}

/** Quiet placeholder for an empty card body (title + one muted line), like the dashboard's lists. */
export function CardEmpty({ title, hint }: { title: string; hint?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 px-4 py-8 sm:px-5">
      <p className="m-0 text-sm">{title}</p>
      {hint ? <p className="m-0 max-w-md text-[13px] leading-[1.5] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
