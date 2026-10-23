"use client";

import { useState } from "react";
import { cn } from "@/lib/utils/cn";
import { SmokedIcon, type SmokedIconName } from "@/components/ds";
import { useInterval } from "@/lib/hooks/useInterval";
import { useReducedMotion } from "@/lib/hooks/useReducedMotion";
import { SOURCE_STACK } from "./content";

const ROTATE_MS = 2000;
/** A custom icon per source (no brand logos). */
const ICON: Record<string, SmokedIconName> = { Resume: "resume", GitHub: "github", LeetCode: "practice", LinkedIn: "professional", Portfolio: "portfolio" };

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
                "absolute inset-x-0 top-1/2 -mt-[40px] flex h-20 items-center gap-3 rounded-[22px] bg-card px-3.5 sm:-mt-[46px] sm:h-[96px] sm:gap-[18px] sm:px-6",
                "transition-[transform,opacity,box-shadow] duration-[800ms] ease-iq",
                centred ? "shadow-float" : "shadow-ring",
              )}
              style={{
                transform: `translateY(calc(var(--step) * ${offset})) scale(${1 - distance * 0.09})`,
                opacity: distance > 1 ? 0.35 : distance === 1 ? 0.75 : 1,
                zIndex: 10 - distance,
              }}
            >
              <SmokedIcon name={ICON[source.name] ?? "portfolio"} size={52} className="h-10 w-10 flex-none sm:h-[52px] sm:w-[52px]" />
              <span className="min-w-0 flex-1 text-left">
                <span className="block text-lg font-semibold tracking-[-0.03em] sm:text-2xl">{source.name}</span>
                <span className="block truncate text-xs text-faint sm:text-[12.5px]">{source.detail}</span>
              </span>
              <span
                className={cn(
                  "flex-none rounded-full px-3 py-1.5 text-xs font-medium transition-colors duration-[600ms] sm:px-3.5 sm:text-[13px]",
                  centred ? "bg-brand text-brand-foreground" : "bg-surface-2 text-foreground",
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
