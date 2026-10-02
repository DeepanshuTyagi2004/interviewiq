import * as React from "react";
import { cn } from "@/lib/utils/cn";

/** Empty card body: a mono tag ("NO DATA") over the title + hint copy. Sizes follow `--u`. */
export function HudEmpty({
  title,
  hint,
  tag = "No data",
  children,
  className,
}: {
  title: React.ReactNode;
  hint?: React.ReactNode;
  tag?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-start gap-[calc(8*var(--u))] px-[calc(18*var(--u))] py-[calc(26*var(--u))] sm:px-[calc(26*var(--u))]",
        className,
      )}
    >
      <span
        aria-hidden
        className="mb-[calc(8*var(--u))] inline-flex items-center whitespace-nowrap rounded-[calc(6*var(--u))] border border-line-3 px-[calc(10*var(--u))] py-[calc(5*var(--u))] font-mono text-[length:calc(11.5*var(--u))] uppercase leading-none tracking-[0.16em] text-muted-foreground"
      >
        {tag}
      </span>
      <p className="m-0 text-[length:calc(17.5*var(--u))] leading-snug tracking-[-0.01em]">{title}</p>
      {hint ? (
        <p className="m-0 max-w-md text-[length:calc(15*var(--u))] leading-[1.55] text-muted-foreground">{hint}</p>
      ) : null}
      {children ? <div className="pt-[calc(8*var(--u))]">{children}</div> : null}
    </div>
  );
}
