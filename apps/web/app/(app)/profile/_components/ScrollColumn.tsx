"use client";

import { useRef } from "react";
import { cn } from "@/lib/utils/cn";
import { useScrollEdges } from "@/lib/hooks/useScrollEdges";

/**
 * A profile column. Below `lg` it dissolves (`contents`) so its cards join the single column in
 * their `order`. On desktop it scrolls on its own; scrollbars are hidden site-wide, so the edge
 * that hides content fades out instead (`.iq-scroll-fade`). The 4px inset on the sides and top
 * keeps focus rings and card edges clear of the scroll box's clip.
 */
export function ScrollColumn({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const { above, below } = useScrollEdges(ref);

  return (
    <div
      ref={ref}
      data-more-above={above || undefined}
      data-more-below={below || undefined}
      className={cn(
        "iq-scroll-fade contents",
        "lg:-mx-1 lg:-mt-1 lg:flex lg:min-h-0 lg:min-w-0 lg:flex-col lg:gap-3 lg:overflow-y-auto lg:overscroll-contain lg:px-1 lg:pb-8 lg:pt-1",
      )}
    >
      {children}
    </div>
  );
}
