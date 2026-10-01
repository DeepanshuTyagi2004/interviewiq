"use client";

import { useMediaQuery } from "./useMediaQuery";

/** True when the visitor asked the OS to minimise motion. Timers and loops should stand still. */
export function useReducedMotion(): boolean {
  return useMediaQuery("(prefers-reduced-motion: reduce)");
}
