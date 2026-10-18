"use client";

import { useState } from "react";
import { ROUND_MINUTES_LABEL } from "@/lib/constants/interview";
import { cn } from "@/lib/utils/cn";
import { useInterval } from "@/lib/hooks/useInterval";
import { useReducedMotion } from "@/lib/hooks/useReducedMotion";

const ROUNDS = [
  { n: "01", title: "Online Assessment", meta: `Coding · ${ROUND_MINUTES_LABEL} · medium` },
  { n: "02", title: "Problem Solving", meta: `Live coding · ${ROUND_MINUTES_LABEL} · medium–hard` },
  { n: "03", title: "System Design", meta: `Whiteboard · ${ROUND_MINUTES_LABEL} · hard` },
  { n: "04", title: "Hiring Manager", meta: `Behavioural · ${ROUND_MINUTES_LABEL}` },
];
const ROTATE_MS = 2200;

/**
 * "What you'll practise" — an example company process whose rounds rotate through the "Up next"
 * slot. Decorative: hidden from assistive tech, with a one-line summary instead.
 */
export function RoundsPanel() {
  const [active, setActive] = useState(0);
  const reduced = useReducedMotion();
  useInterval(() => setActive((i) => (i + 1) % ROUNDS.length), reduced ? null : ROTATE_MS);

  return (
    <aside
      aria-label="What you'll practise"
      className="m-3 flex min-h-[420px] min-w-0 flex-none flex-col overflow-hidden rounded-lg bg-panel lg:min-h-0 lg:flex-1"
    >
      <p className="iq-eyebrow m-0 p-5 sm:p-7">What you&apos;ll practise</p>
      <div aria-hidden className="relative mx-auto w-[min(420px,88%)] flex-1 [--step:58px] sm:[--step:66px]">
        {ROUNDS.map((round, i) => {
          let offset = i - active;
          if (offset > 1) offset -= ROUNDS.length;
          if (offset < -2) offset += ROUNDS.length;
          const distance = Math.abs(offset);
          const centred = offset === 0;
          return (
            <div
              key={round.n}
              className={cn(
                "absolute inset-x-0 top-1/2 -mt-10 flex h-20 items-center gap-3 rounded-[14px] bg-card px-3.5 sm:-mt-11 sm:h-[88px] sm:gap-4 sm:px-[18px]",
                "transition-[transform,opacity,box-shadow] duration-[800ms] ease-iq",
                centred ? "shadow-hero" : "shadow-hairline",
              )}
              style={{
                transform: `translateY(calc(var(--step) * ${offset})) scale(${1 - distance * 0.08})`,
                opacity: distance > 1 ? 0.3 : distance === 1 ? 0.7 : 1,
                zIndex: 10 - distance,
              }}
            >
              <span className="flex h-10 w-10 flex-none items-center justify-center rounded-[12px] bg-primary font-mono text-xs text-primary-foreground sm:h-12 sm:w-12">
                {round.n}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-base tracking-[-0.025em] sm:text-[19px]">{round.title}</span>
                <span className="block truncate text-xs text-faint sm:text-[12.5px]">{round.meta}</span>
              </span>
              <span
                className={cn(
                  "flex-none rounded-[8px] px-2.5 py-[5px] text-xs transition-colors duration-[600ms]",
                  centred ? "bg-brand text-brand-foreground" : "bg-panel text-foreground",
                )}
              >
                {centred ? "Up next" : `Round ${i + 1}`}
              </span>
            </div>
          );
        })}
      </div>
      <p className="m-0 max-w-[420px] p-5 text-sm leading-[1.5] text-muted-foreground sm:p-7">
        Meesho · SDE I Backend —{" "}
        <span className="text-foreground">four rounds, researched from candidates’ own accounts of the process.</span>
      </p>
    </aside>
  );
}
