"use client";

import { useTheme } from "next-themes";
import { cn } from "@/lib/utils/cn";

/**
 * Sun/moon pill switch from the design. The knob position and glyph colours are driven by the
 * `.dark` class (set before paint by next-themes), so it renders correctly without waiting for
 * hydration. A short-lived `theme-anim` class eases every colour across the swap.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();

  function toggle() {
    const root = document.documentElement;
    root.classList.add("theme-anim");
    setTheme(resolvedTheme === "dark" ? "light" : "dark");
    window.setTimeout(() => root.classList.remove("theme-anim"), 450);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Toggle theme"
      title="Toggle theme"
      className={cn(
        "relative flex h-8 w-[62px] flex-none cursor-pointer items-center justify-between rounded-full border border-line-4 bg-card p-0 text-[13px] text-faint",
        className,
      )}
    >
      <span
        aria-hidden
        className="absolute left-[3px] top-[3px] h-6 w-6 translate-x-0 rounded-full bg-brand transition-transform duration-[350ms] ease-iq dark:translate-x-[30px]"
      />
      <span aria-hidden className="relative w-[30px] text-center text-brand-foreground dark:text-faint">
        ☀
      </span>
      <span aria-hidden className="relative w-[30px] text-center text-faint dark:text-brand-foreground">
        ☾
      </span>
    </button>
  );
}
