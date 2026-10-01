"use client";

import * as React from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils/cn";

/**
 * One row of a hairline list that expands in place (single-open accordions of briefs and
 * combinations). The mono key wraps rather than truncates so the full JD key is always readable.
 */
export function ExpandableRow({
  label,
  pills,
  open,
  onToggle,
  children,
}: {
  label: string;
  pills?: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  const bodyId = React.useId();
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={open ? bodyId : undefined}
        className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none sm:items-center sm:px-5"
      >
        <ChevronRight
          aria-hidden
          className={cn(
            "mt-0.5 h-4 w-4 shrink-0 text-faint transition-transform duration-200 ease-iq motion-reduce:transition-none sm:mt-0",
            open && "rotate-90 text-foreground",
          )}
        />
        {/* Pills drop under the key on phones so the key keeps the full row width. */}
        <span className="flex min-w-0 flex-1 flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
          <span className="min-w-0 font-mono text-[13px] leading-5 [overflow-wrap:anywhere]">{label}</span>
          {pills ? <span className="flex shrink-0 flex-wrap gap-1.5 sm:justify-end">{pills}</span> : null}
        </span>
      </button>
      {open ? (
        <div id={bodyId} className="space-y-6 border-t border-line px-4 pb-6 pt-5 sm:pl-12 sm:pr-5">
          {children}
        </div>
      ) : null}
    </div>
  );
}
