"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils/cn";
import { PERSONAS } from "./content";

/** Card width (300) + trailing gap (28) — one carousel step. */
const STEP_PX = 328;
const SWIPE_THRESHOLD_PX = 40;

/**
 * "Who it's for" carousel. Steps one card at a time; the last reachable index adapts to how many
 * cards fit, so every card is reachable on a phone. Arrow buttons plus touch swipe.
 */
export function PersonaCarousel() {
  const viewportRef = useRef<HTMLDivElement>(null);
  const touchX = useRef<number | null>(null);
  const [index, setIndex] = useState(0);
  const [maxIndex, setMaxIndex] = useState(PERSONAS.length - 1);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const measure = () => {
      const visible = Math.max(1, Math.floor((el.clientWidth + 28) / STEP_PX));
      const max = Math.max(0, PERSONAS.length - visible);
      setMaxIndex(max);
      setIndex((i) => Math.min(i, max));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const go = (delta: number) => setIndex((i) => Math.min(maxIndex, Math.max(0, i + delta)));

  return (
    <section aria-roledescription="carousel" aria-label="Who InterviewIQ is for">
      <div
        ref={viewportRef}
        className="mt-12 overflow-hidden sm:mt-[72px]"
        onTouchStart={(e) => (touchX.current = e.touches[0]?.clientX ?? null)}
        onTouchEnd={(e) => {
          const start = touchX.current;
          const end = e.changedTouches[0]?.clientX;
          touchX.current = null;
          if (start == null || end == null) return;
          if (Math.abs(end - start) > SWIPE_THRESHOLD_PX) go(end < start ? 1 : -1);
        }}
      >
        <ul
          className="m-0 flex list-none p-0 transition-transform duration-700 ease-iq"
          style={{ transform: `translateX(-${index * STEP_PX}px)` }}
        >
          {PERSONAS.map((p, i) => (
            <li
              key={p.role}
              aria-roledescription="slide"
              aria-label={`${i + 1} of ${PERSONAS.length}: ${p.who}`}
              className="mr-7 flex min-h-[330px] flex-[0_0_300px] flex-col gap-3.5 border-r border-line-2 pr-7"
            >
              <p className="m-0 font-mono text-[10px] tracking-[0.08em] text-faint">{p.role}</p>
              <span
                aria-hidden
                className={cn(
                  "flex h-[88px] w-[88px] items-center justify-center rounded-md text-[30px] tracking-[-0.04em]",
                  p.featured ? "bg-brand text-brand-foreground" : "bg-panel text-foreground",
                )}
              >
                {p.mono}
              </span>
              <h3 className="m-0 text-lg font-normal tracking-[-0.02em]">{p.who}</h3>
              <p className="m-0 text-[13.5px] leading-[1.5] text-muted-foreground">{p.body}</p>
              <p className="m-0 mt-auto font-mono text-[11px] tracking-[0.06em]">{p.status}</p>
            </li>
          ))}
        </ul>
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <CarouselButton label="Previous" disabled={index === 0} onClick={() => go(-1)}>
          ←
        </CarouselButton>
        <CarouselButton label="Next" disabled={index >= maxIndex} onClick={() => go(1)}>
          →
        </CarouselButton>
      </div>
    </section>
  );
}

function CarouselButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="h-[34px] w-[34px] cursor-pointer rounded-full border border-line-4 bg-card text-sm text-foreground hover:border-faint-2 hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:cursor-default disabled:opacity-35 disabled:hover:bg-card"
    >
      <span aria-hidden>{children}</span>
    </button>
  );
}
