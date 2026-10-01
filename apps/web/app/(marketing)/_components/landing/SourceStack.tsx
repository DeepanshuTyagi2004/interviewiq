"use client";

import { useState } from "react";
import { cn } from "@/lib/utils/cn";
import { useInterval } from "@/lib/hooks/useInterval";
import { useReducedMotion } from "@/lib/hooks/useReducedMotion";
import { SOURCE_STACK } from "./content";

const ROTATE_MS = 2000;

/**
 * Hero illustration: a vertical carousel of source cards. The centred card is "Connected" and
 * lifted; neighbours scale down and fade. Purely decorative (hidden from assistive tech, with a
 * text summary instead).
 */
export function SourceStack() {
  const [active, setActive] = useState(0);
  const reduced = useReducedMotion();
  const count = SOURCE_STACK.length;

  useInterval(() => setActive((i) => (i + 1) % count), reduced ? null : ROTATE_MS);

  return (
    <div className="relative h-full w-[min(460px,94%)] [--step:58px] sm:w-[min(460px,86%)] sm:[--step:70px]">
      <p className="sr-only">
        Example connected sources: {SOURCE_STACK.map((s) => s.name).join(", ")}.
      </p>
      <ul aria-hidden className="m-0 list-none p-0">
        {SOURCE_STACK.map((source, i) => {
          // Signed distance from the active card, wrapped into [-2, 2].
          let offset = i - active;
          if (offset > count / 2) offset -= count;
          if (offset < -count / 2) offset += count;
          const distance = Math.abs(offset);
          const centred = offset === 0;

          return (
            <li
              key={source.name}
              className={cn(
                "absolute inset-x-0 top-1/2 -mt-[40px] flex h-20 items-center gap-3 rounded-[10px] bg-card px-3.5 sm:-mt-[46px] sm:h-[92px] sm:gap-[18px] sm:px-5",
                "transition-[transform,opacity,box-shadow] duration-[800ms] ease-iq",
                centred ? "shadow-hero" : "shadow-hairline",
              )}
              style={{
                transform: `translateY(calc(var(--step) * ${offset})) scale(${1 - distance * 0.09})`,
                opacity: distance > 1 ? 0.35 : distance === 1 ? 0.75 : 1,
                zIndex: 10 - distance,
              }}
            >
              <span className="flex h-10 w-10 flex-none items-center justify-center rounded-[9px] bg-primary font-mono text-xs text-primary-foreground sm:h-[52px] sm:w-[52px] sm:text-[13px]">
                {source.icon}
              </span>
              <span className="min-w-0 flex-1 text-left">
                <span className="block text-lg tracking-[-0.03em] sm:text-2xl">{source.name}</span>
                <span className="block truncate text-xs text-faint sm:text-[12.5px]">{source.detail}</span>
              </span>
              <span
                className={cn(
                  "flex-none rounded-[5px] px-2.5 py-1.5 text-xs transition-colors duration-[600ms] sm:px-3 sm:text-[13px]",
                  centred ? "bg-brand text-brand-foreground" : "bg-line text-foreground",
                )}
              >
                {centred ? "Connected" : "Connect"}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
