"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { PersonaArt, type PersonaKind } from "@/components/ds";
import { PERSONAS } from "./content";

/** Column width (296) + trailing gap (24) — one carousel step. */
const STEP_PX = 320;
const SWIPE_THRESHOLD_PX = 40;

/** Which drawn scene each audience gets. */
const KIND: Record<string, PersonaKind> = { ST: "student", TPO: "campus", PR: "professional", CO: "hiring", BC: "bootcamp" };

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
        className="mt-12 overflow-hidden sm:mt-[64px]"
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
              className="mr-6 flex min-h-[320px] flex-[0_0_296px] flex-col gap-3.5 border-l border-line-2 pl-6"
            >
              <PersonaArt kind={KIND[p.mono] ?? "student"} size={104} className="drop-shadow-[0_14px_16px_rgba(90,69,38,0.28)]" />
              <h3 className="m-0 text-xl font-semibold tracking-[-0.02em]">{p.who}</h3>
              <p className="m-0 -mt-2 text-sm text-ink-3">{p.role}</p>
              <p className="m-0 text-sm leading-[1.5] text-muted-foreground">{p.body}</p>
              <p className="m-0 mt-auto text-xs font-semibold tracking-[0.05em]">{p.status}</p>
            </li>
          ))}
        </ul>
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <CarouselButton label="Previous" disabled={index === 0} onClick={() => go(-1)}>
          <ChevronLeft className="h-4 w-4" />
        </CarouselButton>
        <CarouselButton label="Next" disabled={index >= maxIndex} onClick={() => go(1)}>
          <ChevronRight className="h-4 w-4" />
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
      className="h-11 w-11 cursor-pointer rounded-full bg-card text-sm text-foreground shadow-ring transition-shadow hover:shadow-float focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-default disabled:opacity-35 disabled:hover:bg-card"
    >
      <span aria-hidden>{children}</span>
    </button>
  );
}
