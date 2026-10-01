import * as React from "react";
import { cn } from "@/lib/utils/cn";

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  hint?: string;
  action?: React.ReactNode;
  className?: string;
}

/**
 * Not-connected / no-data state: centered icon, title, muted hint, optional
 * action slot. Hairline-dashed card.
 */
export function EmptyState({
  icon,
  title,
  hint,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-[10px] border border-dashed border-line-4 bg-card px-6 py-12 text-center",
        className,
      )}
    >
      {icon ? (
        <div className="text-faint [&_svg]:h-6 [&_svg]:w-6">
          {icon}
        </div>
      ) : null}
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {hint ? (
          <p className="max-w-sm text-sm text-muted-foreground">{hint}</p>
        ) : null}
      </div>
      {action ? <div className="pt-1">{action}</div> : null}
    </div>
  );
}
