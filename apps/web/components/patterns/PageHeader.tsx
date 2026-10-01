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
 * description and a right-aligned actions slot (stacks under the title on phones).
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
      <div className="min-w-0 space-y-2">
        {eyebrow ? <p className="iq-eyebrow">{eyebrow}</p> : null}
        <h1 className="text-[28px] font-normal leading-[1.06] tracking-[-0.04em] text-balance sm:text-[34px]">
          {title}
        </h1>
        {description ? (
          <p className="max-w-xl text-[14.5px] leading-[1.55] text-muted-foreground">
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
