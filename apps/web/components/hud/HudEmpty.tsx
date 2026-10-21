import * as React from "react";
import { EmptyState } from "@/components/ds/EmptyState";

/** Shim over `ds/EmptyState`. `tag` is ignored. */
export function HudEmpty({
  title,
  hint,
  tag: _tag,
  children,
  className,
}: {
  title: React.ReactNode;
  hint?: React.ReactNode;
  tag?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  void _tag;
  return (
    <EmptyState title={title} hint={hint} className={className}>
      {children}
    </EmptyState>
  );
}
