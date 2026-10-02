"use client";

import { cn } from "@/lib/utils/cn";
import { useThemeSwitch } from "./useThemeSwitch";

/**
 * Sun/moon pill switch from the design. The knob position and glyph colours are driven by the
 * `.dark` class (set before paint by next-themes), so it renders correctly without waiting for
 * hydration. `useThemeSwitch` eases every colour across the swap.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, switchTo } = useThemeSwitch();

  function toggle() {
    switchTo(theme === "dark" ? "light" : "dark");
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
