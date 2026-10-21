import * as React from "react";
import { cn } from "@/lib/utils/cn";

/** Keycap hint in Geist Mono. */
export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 flex-none items-center justify-center rounded-md border border-line bg-background px-1.5 font-mono text-[11px] font-medium text-ink-3",
        className,
      )}
    >
      {children}
    </kbd>
  );
}
