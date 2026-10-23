/**
 * Shared art palette. The site is monochrome (black, white, greys; beige and gold only in subtle
 * background gradients). Colour lives in orbs: seven hues plus a neutral pearl, each with
 * highlight, body and shadow tones for the glass sphere. Decorative art only, so literal values
 * are allowed.
 */
export interface Hue {
  key: string;
  /** Highlight, body and shadow tones for the glass sphere. */
  orb: readonly [string, string, string];
}

export const HUES: readonly Hue[] = [
  { key: "azure", orb: ["#BFE0FF", "#4F8CFF", "#2230C8"] },
  { key: "violet", orb: ["#E4CCFF", "#9A6BFF", "#5B2BC0"] },
  { key: "rose", orb: ["#FFC6D9", "#FF5C8A", "#B3205E"] },
  { key: "amber", orb: ["#FFE0A8", "#FFA43D", "#D2541B"] },
  { key: "emerald", orb: ["#C2F5D8", "#34D399", "#0B8A63"] },
  { key: "cyan", orb: ["#BDF1FF", "#38BDF8", "#0E7FB0"] },
  { key: "fuchsia", orb: ["#F5C6FF", "#D946EF", "#8E1FA3"] },
  { key: "pearl", orb: ["#FFFFFF", "#D9D6D0", "#8E8A83"] },
] as const;

export const HUE_COUNT = HUES.length;
export type HueIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** Stable, non-cryptographic string hash (FNV-1a) mod the number of hues. The empty string is 0. */
export function hueIndex(seed: string): HueIndex {
  if (!seed) return 0;
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ((h >>> 0) % HUE_COUNT) as HueIndex;
}

/** Three graphite shades, so neighbouring tiles differ a little without any hue. */
const GRAPHITE: readonly (readonly [string, string])[] = [
  ["#3b3834", "#151311"],
  ["#48443f", "#1c1a18"],
  ["#312e2a", "#100f0d"],
];

/** The graphite-glass a tile paints: a soft top-left sheen over a two-stop dark base. */
export function tileBackground(index: number): string {
  const [from, to] = GRAPHITE[index % GRAPHITE.length];
  return [
    "radial-gradient(90% 70% at 14% 0%,rgb(255 255 255/.22),transparent 62%)",
    `linear-gradient(150deg,${from},${to})`,
  ].join(",");
}

/** Hairline highlight + ring + contact shadow shared by every graphite tile (reads on light and dark). */
export const TILE_SHADOW =
  "inset 0 1px 0 rgb(255 255 255/.2),inset 0 0 0 0.5px rgb(255 255 255/.1),0 6px 14px -8px rgb(0 0 0/.5)";
