"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

/** Storage key shared with the original landing-page design, so a visitor's choice carries over. */
export const THEME_STORAGE_KEY = "iq-theme";

/**
 * Light by default (per the design), with a persisted light/dark toggle. next-themes injects a
 * pre-paint script, so the saved theme applies without a flash. Class-based to match Tailwind's
 * `darkMode: ["class"]`.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="light"
      enableSystem={false}
      storageKey={THEME_STORAGE_KEY}
    >
      {children}
    </NextThemesProvider>
  );
}

export { useTheme } from "next-themes";
