import * as React from "react";
import { EmptyState as DsEmptyState } from "@/components/ds/EmptyState";
import { cn } from "@/lib/utils/cn";

export interface EmptyStateProps {
  /** Replaces the orb when given. */
  icon?: React.ReactNode;
  title: string;
  hint?: string;
  action?: React.ReactNode;
  className?: string;
}

/** Not-connected / no-data state. Forwards to `ds/EmptyState`, on a surface tile. */
export function EmptyState({ icon, title, hint, action, className }: EmptyStateProps) {
  return (
    <div className={cn("rounded-tile bg-surface", className)}>
      {icon ? <div className="flex justify-center pt-10 text-ink-3 [&_svg]:h-6 [&_svg]:w-6">{icon}</div> : null}
      <DsEmptyState title={title} hint={hint} orb={!icon} className={icon ? "pt-3" : undefined}>
        {action}
      </DsEmptyState>
    </div>
  );
}
