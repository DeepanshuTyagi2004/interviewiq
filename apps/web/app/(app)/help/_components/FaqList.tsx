"use client";

import { useId, useState } from "react";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { padCount } from "@/components/hud";

export interface FaqItem {
  question: string;
  answer: string;
}

/**
 * Disclosure list: each question opens on its own (several can be open at once). Collapsed
 * answers are `inert`, so they're neither focusable nor announced; the height eases open unless
 * the user prefers reduced motion.
 */
export function FaqList({ items }: { items: FaqItem[] }) {
  const [open, setOpen] = useState<Set<number>>(() => new Set());
  const baseId = useId();

  function toggle(i: number) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  return (
    <ul className="m-0 list-none p-0">
      {items.map((item, i) => {
        const isOpen = open.has(i);
        const buttonId = `${baseId}-q-${i}`;
        const panelId = `${baseId}-a-${i}`;
        return (
          <li key={item.question} className="border-b border-line last:border-b-0">
            <h3 className="m-0">
              <button
                id={buttonId}
                type="button"
                aria-expanded={isOpen}
                aria-controls={panelId}
                onClick={() => toggle(i)}
                className="flex w-full items-center justify-between gap-4 bg-transparent px-4 py-4 text-left text-[15px] tracking-[-0.01em] text-foreground transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none sm:px-5"
              >
                <span className="flex min-w-0 items-baseline gap-3">
                  <span aria-hidden className="flex-none font-mono text-[11px] tabular-nums text-faint">
                    Q.{padCount(i + 1)}
                  </span>
                  <span className="min-w-0">{item.question}</span>
                </span>
                <Plus
                  aria-hidden
                  data-motion
                  className={cn(
                    "h-4 w-4 flex-none text-faint transition-transform duration-300 ease-iq motion-reduce:transition-none",
                    isOpen && "rotate-45 text-foreground",
                  )}
                />
              </button>
            </h3>
            <div
              id={panelId}
              role="region"
              aria-labelledby={buttonId}
              inert={!isOpen}
              data-motion
              className={cn(
                "grid transition-[grid-template-rows] duration-300 ease-iq motion-reduce:transition-none",
                isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
              )}
            >
              <div className="overflow-hidden">
                <p className="m-0 max-w-[620px] px-4 pb-5 text-sm leading-[1.6] text-muted-foreground sm:px-5">
                  {item.answer}
                </p>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
