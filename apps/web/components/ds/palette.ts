/**
 * Shared art palette. The site is monochrome: black, white, warm greys and beige. Orbs come in
 * eight neutral "materials" (pearl, champagne, sand, stone, graphite, onyx, ivory, taupe), each
 * with highlight, body and shadow tones. Decorative art only, so literal values are allowed.
 */
export interface Hue {
  key: string;
  /** Highlight, body and shadow tones for the glass sphere. */
  orb: readonly [string, string, string];
}

export const HUES: readonly Hue[] = [
  { key: "pearl", orb: ["#FFFFFF", "#D9D6D0", "#8E8A83"] },
  { key: "champagne", orb: ["#FFF3DE", "#E2CBA2", "#9C7E52"] },
  { key: "sand", orb: ["#F7EBD9", "#CDB89A", "#7A6548"] },
  { key: "stone", orb: ["#F0EEEA", "#B5B0A6", "#5F5A51"] },
  { key: "graphite", orb: ["#E8E6E2", "#8A867F", "#2B2926"] },
  { key: "onyx", orb: ["#D8D5CF", "#5A5650", "#0E0D0C"] },
  { key: "ivory", orb: ["#FFFFFF", "#EFE7D8", "#B9A98B"] },
  { key: "taupe", orb: ["#EDE6DC", "#A99C8A", "#5A4F40"] },
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
