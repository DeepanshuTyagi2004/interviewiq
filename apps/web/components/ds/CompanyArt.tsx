import * as React from "react";
import { cn } from "@/lib/utils/cn";
import { hueIndex, tileBackground } from "./palette";

export interface CompanyArtProps {
  /** Seeds the gradient, so a company always gets the same tile. */
  slug: string;
  name: string;
  className?: string;
}

/**
 * A grainy graphite-glass tile with the company name in white, one of three shades per company
 * (see `palette`). Decorative: the name is always shown beside it. Both stops hold 4.5:1 against white.
 */
export function CompanyArt({ slug, name, className }: CompanyArtProps) {
  return (
    <span
      aria-hidden
      style={{ background: tileBackground(hueIndex(slug)) }}
      className={cn(
        "iq-grain iq-grain-light relative grid place-items-center overflow-hidden rounded-[20px] p-3 text-center font-display text-[26px] font-semibold leading-[1.05] tracking-[-0.04em] text-white shadow-[inset_0_1px_0_rgb(255_255_255/.2),inset_0_0_0_0.5px_rgb(255_255_255/.1)]",
        className,
      )}
    >
      <span aria-hidden className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-white/15 blur-2xl" />
      <span className="relative z-[1] line-clamp-2 break-words">{name}</span>
    </span>
  );
}
