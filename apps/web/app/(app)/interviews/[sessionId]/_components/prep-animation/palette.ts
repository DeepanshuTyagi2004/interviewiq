import type { CSSProperties } from "react";

/** The cat's illustration tokens (`--cat-*` in app/globals.css, with a dark-mode set). */
export type Tone =
  | "stage"
  | "shadow"
  | "fur"
  | "fur-mid"
  | "fur-dark"
  | "fur-deep"
  | "belly"
  | "pink"
  | "ink"
  | "shine"
  | "line"
  | "paper"
  | "paper-edge"
  | "paper-back"
  | "rule"
  | "rule-strong"
  | "gold"
  | "highlight"
  | "cream"
  | "sky"
  | "wood"
  | "metal"
  | "bubble"
  | "bubble-ink";

export const c = (tone: Tone) => `hsl(var(--cat-${tone}))`;

/**
 * Colours go in `style` (not presentation attributes) so the CSS variables resolve everywhere.
 * Anything a scene animates (opacity, transform, dash offset) stays an attribute, which `style` would
 * override.
 */
export const fill = (tone: Tone, extra?: CSSProperties): CSSProperties => ({ fill: c(tone), ...extra });

export const stroke = (tone: Tone, width: number, extra?: CSSProperties): CSSProperties => ({
  fill: "none",
  stroke: c(tone),
  strokeWidth: width,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  ...extra,
});

/** A filled shape with an outline. */
export const shape = (tone: Tone, edge: Tone, width: number, extra?: CSSProperties): CSSProperties => ({
  fill: c(tone),
  stroke: c(edge),
  strokeWidth: width,
  strokeLinejoin: "round",
  ...extra,
});
