import * as React from "react";
import { cn } from "@/lib/utils/cn";

export interface SectionLabelProps {
  children: React.ReactNode;
  className?: string;
}

/** Uppercase Geist Mono 10.5px faint label that heads a Section (the design's eyebrow). */
export function SectionLabel({ children, className }: SectionLabelProps) {
  return (
    <p className={cn("iq-eyebrow", className)}>
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
 * Content block with hairline top separation and an optional uppercase mono
 * label. Use to group related panels under a quiet heading.
 */
export function Section({ title, children, className }: SectionProps) {
  return (
    <section className={cn("space-y-4 border-t border-border pt-6", className)}>
      {title ? <SectionLabel>{title}</SectionLabel> : null}
      {children}
    </section>
  );
}
