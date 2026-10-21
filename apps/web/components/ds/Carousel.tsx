"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils/cn";

const PILL =
  "inline-flex h-9 w-9 items-center justify-center rounded-full bg-background text-ink shadow-ring outline-none transition-[opacity,background-color] duration-150 hover:bg-surface focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-40";

export interface CarouselProps {
  label: string;
  children: React.ReactNode;
  className?: string;
  /** Heading shown on the left of the prev/next row, so the arrows sit inline with it. */
  header?: React.ReactNode;
}

/** Horizontal scroll-snap row with prev/next pills that move one card width. */
export function Carousel({ label, children, className, header }: CarouselProps) {
  const ref = React.useRef<HTMLUListElement>(null);
  const [edge, setEdge] = React.useState({ start: true, end: true });

  const measure = React.useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setEdge({
      start: el.scrollLeft <= 1,
      end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 1,
    });
  }, []);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => {
      el.removeEventListener("scroll", measure);
      ro?.disconnect();
    };
  }, [measure, children]);

  function by(dir: 1 | -1) {
    const el = ref.current;
    if (!el) return;
    const first = el.firstElementChild as HTMLElement | null;
    const gap = parseFloat(getComputedStyle(el).columnGap) || 0;
    const step = first ? first.getBoundingClientRect().width + gap : el.clientWidth;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el.scrollBy({ left: dir * step, behavior: reduce ? "auto" : "smooth" });
  }

  return (
    <div role="region" aria-roledescription="carousel" aria-label={label} className={cn("relative", className)}>
      <div className={cn("mb-3.5 flex items-center gap-1.5", header ? "justify-between" : "justify-end")}>
        {header}
        <div className="flex gap-1.5">
        <button type="button" aria-label={`Previous ${label}`} disabled={edge.start} onClick={() => by(-1)} className={PILL}>
          <ChevronLeft aria-hidden className="h-4 w-4" strokeWidth={1.8} />
        </button>
        <button type="button" aria-label={`Next ${label}`} disabled={edge.end} onClick={() => by(1)} className={PILL}>
          <ChevronRight aria-hidden className="h-4 w-4" strokeWidth={1.8} />
        </button>
        </div>
      </div>
      <ul
        ref={ref}
        className="m-0 flex list-none snap-x snap-mandatory gap-4 overflow-x-auto p-0 pb-1 [&>*]:flex-none [&>*]:snap-start"
      >
        {children}
      </ul>
    </div>
  );
}
