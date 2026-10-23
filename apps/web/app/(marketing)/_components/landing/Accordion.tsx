"use client";

import { useId, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export interface AccordionItem {
  title: string;
  body: string;
}

export interface AccordionProps {
  items: AccordionItem[];
  /** Index open on first render; -1 for none. */
  defaultOpen?: number;
  /**
   * `sign` — larger titles with a +/− marker (Universities).
   * `plus` — body-size titles with a + that rotates into × (FAQ).
   */
  variant?: "sign" | "plus";
}

/**
 * Single-open disclosure list with the design's grid-rows height animation. Collapsed panels are
 * `inert`, so their text is neither focusable nor announced.
 */
export function Accordion({ items, defaultOpen = 0, variant = "plus" }: AccordionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const baseId = useId();

  return (
    <div className="flex min-w-0 flex-col">
      {items.map((item, i) => {
        const isOpen = open === i;
        const buttonId = `${baseId}-trigger-${i}`;
        const panelId = `${baseId}-panel-${i}`;
        return (
          <div key={item.title} className="border-b border-line">
            <h3 className="m-0">
              <button
                id={buttonId}
                type="button"
                aria-expanded={isOpen}
                aria-controls={panelId}
                onClick={() => setOpen(isOpen ? -1 : i)}
                className={cn(
                  "flex w-full cursor-pointer items-center justify-between gap-4 border-0 bg-transparent text-left text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  variant === "sign" ? "py-[22px] text-[17px] tracking-[-0.02em] sm:text-lg" : "py-5 text-[15px] sm:text-base",
                )}
              >
                {item.title}
                {variant === "sign" ? (
                  <span aria-hidden className="flex-none text-faint">
                    {isOpen ? <Minus className="h-[18px] w-[18px]" strokeWidth={1.6} /> : <Plus className="h-[18px] w-[18px]" strokeWidth={1.6} />}
                  </span>
                ) : (
                  <span
                    aria-hidden
                    className={cn("flex-none transition-transform duration-[350ms]", isOpen && "rotate-45")}
                  >
                    <Plus className="h-[18px] w-[18px]" strokeWidth={1.6} />
                  </span>
                )}
              </button>
            </h3>
            <div
              id={panelId}
              role="region"
              aria-labelledby={buttonId}
              inert={!isOpen}
              className={cn(
                "grid transition-[grid-template-rows] duration-[450ms] ease-iq",
                isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
              )}
            >
              <div className="overflow-hidden">
                <p
                  className={cn(
                    "m-0 mb-[22px] text-[15px] text-muted-foreground",
                    variant === "sign" ? "max-w-[520px] leading-[1.55]" : "max-w-[600px] leading-[1.6]",
                  )}
                >
                  {item.body}
                </p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
