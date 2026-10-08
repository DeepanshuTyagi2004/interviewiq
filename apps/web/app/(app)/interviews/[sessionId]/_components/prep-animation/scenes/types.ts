import type { ReactNode } from "react";
import type { Accessory } from "../Cat";
import type { Stage } from "../stage";

/**
 * One looping chapter of the prep animation. The player renders the layers once and calls `frame` with
 * the scene time every animation frame. Back to front: `back` (scene), the cat with `held` hugged to its
 * tummy, its arm, `front` (scene), `inHand` (in the paw), the paw, `over` (scene). `held` and `inHand`
 * are in the cat's own coordinates and move with it; the rest are in scene coordinates (x -30..330,
 * floor at y≈222). The cat walks over to whatever it touches: its arm never stretches (pose.ts).
 * Status lines are playful and generic: never topics, problems or difficulty (spec §9.4).
 */
export interface Scene {
  id: string;
  /** Seconds the chapter plays before the next one. */
  duration: number;
  /** The scene time shown under reduced motion: one characteristic still. */
  still: number;
  accessory: Accessory;
  /** `uid` keeps SVG ids unique when more than one player is on a page. */
  back(uid: string): ReactNode;
  front?(uid: string): ReactNode;
  held?(uid: string): ReactNode;
  inHand?(uid: string): ReactNode;
  over?(uid: string): ReactNode;
  frame(t: number, s: Stage): void;
  status(t: number): string;
}
