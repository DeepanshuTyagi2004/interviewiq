import * as React from "react";
import { cn } from "@/lib/utils/cn";

export interface SectionLabelProps {
  children: React.ReactNode;
  className?: string;
}

/** Quiet label that heads a Section. */
export function SectionLabel({ children, className }: SectionLabelProps) {
  return (
    <p className={cn("m-0 text-[13px] font-medium text-ink-3", className)}>
      {children}
    </p>
  );
}

export interface SectionProps {
  title?: string;
  children: React.ReactNode;
  className?: string;
}

/**
 * Content block with hairline top separation and an optional quiet label. Use to group related panels under a quiet heading.
 */
export function Section({ title, children, className }: SectionProps) {
  return (
    <section className={cn("space-y-4 border-t border-line pt-6", className)}>
      {title ? <SectionLabel>{title}</SectionLabel> : null}
      {children}
    </section>
  );
}
