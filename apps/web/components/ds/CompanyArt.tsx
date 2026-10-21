import * as React from "react";
import { cn } from "@/lib/utils/cn";
import { orbVariant } from "./Orb";

/**
 * Dark art-tile backgrounds, one per Orb variant (chosen by the company slug). Literal greyscale
 * gradients are allowed here under the same exception as the Orb gradients, and they match the
 * approved mockup's tiles: dark in both themes, white text.
 */
const ART = [
  "radial-gradient(120% 120% at 20% 10%,#6d6b66,#1b1a19 60%,#000)",
  "radial-gradient(120% 120% at 80% 0%,#d8d6d1,#7c7a75 50%,#2a2928)",
  "radial-gradient(130% 130% at 30% 90%,#9c9a95,#3a3936 55%,#0b0b0b)",
  "radial-gradient(130% 130% at 70% 80%,#85837e,#2f2e2c 55%,#0b0b0b)",
] as const;

export interface CompanyArtProps {
  /** Seeds the gradient, so a company always gets the same tile. */
  slug: string;
  name: string;
  className?: string;
}

/** A grainy dark gradient tile with the company name in white. Decorative: the name is always shown beside it. */
export function CompanyArt({ slug, name, className }: CompanyArtProps) {
  return (
    <span
      aria-hidden
      style={{ background: ART[orbVariant(slug)] }}
      className={cn(
        "iq-grain iq-grain-light relative grid place-items-center overflow-hidden rounded-[14px] p-3 text-center font-display text-[26px] font-medium leading-[1.05] tracking-[-0.04em] text-white",
        className,
      )}
    >
      <span className="relative z-[1] line-clamp-2 break-words">{name}</span>
    </span>
  );
}
