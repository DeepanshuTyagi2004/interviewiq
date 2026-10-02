import * as React from "react";
import { cn } from "@/lib/utils/cn";

export interface ProfileCardProps {
  title: string;
  /** Faint text beside the title, e.g. "@asha". */
  meta?: React.ReactNode;
  /** Right-aligned control in the header row. */
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

/** The design's bordered card with a title row (`Connected sources`, `Preferences`). */
export function ProfileCard({ title, meta, action, children, className }: ProfileCardProps) {
  const id = React.useId();
  return (
    <section aria-labelledby={id} className={cn("min-w-0 overflow-hidden rounded-[14px] border border-line-2 bg-card", className)}>
      <div className="flex min-h-[53px] flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-4 py-3 sm:px-5">
        <h2 id={id} className="m-0 text-sm font-normal">
          {title}
        </h2>
        {meta ? <span className="min-w-0 truncate font-mono text-xs text-faint">{meta}</span> : null}
        {action ? <div className="ml-auto flex items-center gap-2">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

/** Quiet note for a card with nothing to show yet. */
export function CardEmpty({ title, hint, children }: { title: string; hint: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-1.5 px-4 py-6 sm:px-5">
      <p className="m-0 text-sm">{title}</p>
      <p className="m-0 max-w-md text-[13px] leading-[1.5] text-muted-foreground">{hint}</p>
      {children ? <div className="pt-2">{children}</div> : null}
    </div>
  );
}
