"use client";

import { useEffect, useState, type RefObject } from "react";

export interface ScrollEdges {
  /** Content is scrolled past the top edge. */
  above: boolean;
  /** More content waits below the bottom edge. */
  below: boolean;
}

/** Leftover below this many px counts as "at the edge" (sub-pixel scroll positions on zoomed pages). */
const EDGE_SLACK_PX = 1;

/**
 * Which edges of a vertical scroll box hide content. Scrollbars are hidden site-wide, so this drives
 * the edge-fade cue instead. Re-measures on scroll and whenever the box or its children resize.
 */
export function useScrollEdges(ref: RefObject<HTMLElement | null>): ScrollEdges {
  const [edges, setEdges] = useState<ScrollEdges>({ above: false, below: false });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const measure = () => {
      const above = el.scrollTop > EDGE_SLACK_PX;
      const below = el.scrollHeight - el.clientHeight - el.scrollTop > EDGE_SLACK_PX;
      setEdges((prev) => (prev.above === above && prev.below === below ? prev : { above, below }));
    };

    measure();
    el.addEventListener("scroll", measure, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    for (const child of Array.from(el.children)) observer.observe(child);

    return () => {
      el.removeEventListener("scroll", measure);
      observer.disconnect();
    };
  }, [ref]);

  return edges;
}
