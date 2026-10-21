import * as React from "react";
import { cn } from "@/lib/utils/cn";

export type OrbState = "still" | "breathing" | "listening" | "thinking" | "speaking";
export type OrbVariantIndex = 0 | 1 | 2 | 3;

/** Stable, non-cryptographic string hash (FNV-1a) mod 4. The empty string is 0. */
export function orbVariant(seed: string): OrbVariantIndex {
  if (!seed) return 0;
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ((h >>> 0) % 4) as OrbVariantIndex;
}

// Orb gradients are the one place literal colours are allowed (plan exception); all greyscale.
const GRADIENTS: Record<OrbVariantIndex, string> = {
  0: "radial-gradient(circle at 30% 28%,#fff 0,#d9d9d6 18%,#8d8b86 48%,#2b2a28 78%,#0d0d0c 100%)",
  1: "radial-gradient(circle at 70% 25%,#f4f4f2 0,#b9b7b1 25%,#5b5955 55%,#141413 90%)",
  2: "radial-gradient(circle at 35% 70%,#fafaf9 0,#cfcdc8 22%,#76746f 52%,#1c1b1a 88%)",
  3: "radial-gradient(circle at 62% 66%,#ededeb 0,#c4c2bd 20%,#6a6863 50%,#191918 86%)",
};

const MOTION: Record<OrbState, string | undefined> = {
  still: undefined,
  breathing: "iq-orb-breathing",
  listening: "iq-orb-listening",
  thinking: "iq-orb-thinking",
  speaking: "iq-orb-speaking",
};

export interface OrbProps {
  /** Any stable id (company, session, user): the same seed always gives the same orb. */
  seed?: string;
  variant?: OrbVariantIndex;
  /** Diameter in px. */
  size?: number;
  state?: OrbState;
  className?: string;
}

/** Greyscale voice-orb: the signature decoration (avatars, interviewer, track and result rows). */
export function Orb({ seed, variant, size = 32, state = "still", className }: OrbProps) {
  const v = variant ?? orbVariant(seed ?? "");
  const motion = MOTION[state];
  return (
    <span
      aria-hidden
      data-motion={motion ? "" : undefined}
      data-orb={v}
      className={cn(
        "inline-block flex-none rounded-full shadow-[inset_0_0_0_0.5px_hsl(var(--foreground)/0.2)]",
        motion,
        className,
      )}
      style={{ width: size, height: size, background: GRADIENTS[v] }}
    />
  );
}
