import * as React from "react";
import { cn } from "@/lib/utils/cn";

export interface PageHeaderProps {
  title: string;
  description?: string;
  /** Optional uppercase mono label above the title ("DASHBOARD"). */
  eyebrow?: string;
  actions?: React.ReactNode;
  className?: string;
}

/**
 * Consistent page top: optional mono eyebrow, a light, tightly-tracked <h1>, an optional muted
 * description and a right-aligned actions slot (stacks under the title on phones). Sizes follow
 * `--u`, so the header shrinks with a viewport-fit screen.
 */
export function PageHeader({
  title,
  description,
  eyebrow,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between",
        className,
      )}
    >
      <div className="min-w-0 space-y-[calc(8*var(--u))]">
        {eyebrow ? <p className="iq-eyebrow">{eyebrow}</p> : null}
        <h1 className="text-[length:calc(30*var(--u))] font-normal leading-[1.06] tracking-[-0.04em] text-balance sm:text-[length:calc(40*var(--u))]">
          {title}
        </h1>
        {description ? (
          <p className="max-w-2xl text-[length:calc(16*var(--u))] leading-[1.55] text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}
