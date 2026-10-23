import * as React from "react";
import { cn } from "@/lib/utils/cn";
import { HUES, hueIndex, type HueIndex } from "./palette";

export type OrbState = "still" | "breathing" | "listening" | "thinking" | "speaking";
export type OrbVariantIndex = HueIndex;

/** Stable hash of a seed onto one of the eight orb hues. The empty string is 0. */
export function orbVariant(seed: string): OrbVariantIndex {
  return hueIndex(seed);
}

/** A glass sphere: a soft body gradient, a deep pool low right, a specular highlight and a rim. */
const ORB_HUES = HUES;

function orbBackground(index: number): string {
  const [hi, mid, lo] = ORB_HUES[index % ORB_HUES.length].orb;
  return [
    "radial-gradient(circle at 30% 22%,rgb(255 255 255/.92) 0,rgb(255 255 255/.35) 13%,transparent 32%)",
    `radial-gradient(circle at 80% 88%,${lo} 0,transparent 58%)`,
    `radial-gradient(circle at 18% 82%,${hi} 0,transparent 52%)`,
    `linear-gradient(150deg,${hi},${mid} 52%,${lo})`,
  ].join(",");
}

function orbShadow(index: number, size: number): string {
  const mid = ORB_HUES[index % ORB_HUES.length].orb[1];
  const s = (n: number) => `${Math.max(0.5, +(size * n).toFixed(1))}px`;
  return [
    `inset 0 -${s(0.09)} ${s(0.18)} rgb(0 0 0/.2)`,
    `inset 0 ${s(0.035)} ${s(0.06)} rgb(255 255 255/.6)`,
    `inset 0 0 0 0.5px rgb(255 255 255/.25)`,
    `0 ${s(0.14)} ${s(0.36)} -${s(0.12)} ${mid}99`,
  ].join(",");
}

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

/** Glass orb in one of eight neutral materials: the signature decoration (avatars, interviewer, empty states). */
export function Orb({ seed, variant, size = 32, state = "still", className }: OrbProps) {
  const v = variant ?? orbVariant(seed ?? "");
  const motion = MOTION[state];
  return (
    <span
      aria-hidden
      data-motion={motion ? "" : undefined}
      data-orb={v}
      className={cn("inline-block flex-none rounded-full", motion, className)}
      style={{ width: size, height: size, background: orbBackground(v), boxShadow: orbShadow(v, size) }}
    />
  );
}
