"use client";

import { useCallback } from "react";
import { useTheme } from "next-themes";

export type AppTheme = "light" | "dark";

/**
 * The resolved theme plus a setter that eases every colour across the swap: a short-lived
 * `theme-anim` class on the root turns on colour transitions just for the change.
 */
export function useThemeSwitch() {
  const { resolvedTheme, setTheme } = useTheme();

  const switchTo = useCallback(
    (next: AppTheme) => {
      const root = document.documentElement;
      root.classList.add("theme-anim");
      setTheme(next);
      window.setTimeout(() => root.classList.remove("theme-anim"), 450);
    },
    [setTheme],
  );

  return { theme: (resolvedTheme === "dark" ? "dark" : "light") as AppTheme, switchTo };
}
