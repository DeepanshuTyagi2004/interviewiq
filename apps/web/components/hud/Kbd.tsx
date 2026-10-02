import * as React from "react";
import { cn } from "@/lib/utils/cn";

/** Keycap in Geist Mono. `label` is what a screen reader hears instead of the glyphs. */
export function Kbd({
  children,
  label,
  size = "md",
  className,
}: {
  children: React.ReactNode;
  label?: string;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <kbd
      className={cn(
        "inline-flex flex-none items-center justify-center rounded-md border border-line-3 bg-card font-mono text-foreground",
        size === "md" ? "h-6 min-w-6 px-1.5 text-[11px]" : "h-5 min-w-5 px-1 text-[10.5px]",
        className,
      )}
    >
      {label ? (
        <>
          <span aria-hidden>{children}</span>
          <span className="sr-only">{label}</span>
        </>
      ) : (
        children
      )}
    </kbd>
  );
}
