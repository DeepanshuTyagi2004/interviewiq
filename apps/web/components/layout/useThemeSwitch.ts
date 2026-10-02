"use client";

import { useCallback } from "react";
import { useTheme } from "next-themes";

export type AppTheme = "light" | "dark";

/** Where the reveal starts, in viewport pixels (e.g. the centre of the toggle that was clicked). */
export interface RevealOrigin {
  x: number;
  y: number;
}

const REVEAL_MS = 520;

/** Fallback: a short-lived `theme-anim` class on the root eases every colour across the swap. */
function fadeSwap(apply: () => void) {
  const root = document.documentElement;
  root.classList.add("theme-anim");
  apply();
  window.setTimeout(() => root.classList.remove("theme-anim"), 450);
}

/**
 * The resolved theme plus a setter that reveals the new theme as a circle growing from `origin`
 * (the View Transitions API snapshots the old page; the new one is clipped open over it). Browsers
 * without the API, and anyone who prefers reduced motion, get the quick colour fade instead.
 */
export function useThemeSwitch() {
  const { resolvedTheme, setTheme } = useTheme();

  const switchTo = useCallback(
    (next: AppTheme, origin?: RevealOrigin) => {
      const root = document.documentElement;
      // Apply the class ourselves so the new snapshot is guaranteed to be in the new theme;
      // next-themes then persists the choice (and re-applies the same class, a no-op).
      const apply = () => {
        root.classList.toggle("dark", next === "dark");
        root.style.colorScheme = next;
        setTheme(next);
      };

      const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      if (typeof document.startViewTransition !== "function" || reduceMotion) {
        fadeSwap(apply);
        return;
      }

      // Default origin: the top-right corner, where the theme controls live.
      const x = origin?.x ?? window.innerWidth - 48;
      const y = origin?.y ?? 32;
      const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));

      root.classList.add("theme-reveal");
      const transition = document.startViewTransition(apply);
      transition.ready
        .then(() => {
          root.animate(
            { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
            { duration: REVEAL_MS, easing: "cubic-bezier(0.22, 0.61, 0.36, 1)", pseudoElement: "::view-transition-new(root)" },
          );
        })
        .catch(() => {
          // The transition was skipped (e.g. tab hidden) — the theme is already applied.
        });
      transition.finished.finally(() => root.classList.remove("theme-reveal"));
    },
    [setTheme],
  );

  return { theme: (resolvedTheme === "dark" ? "dark" : "light") as AppTheme, switchTo };
}
