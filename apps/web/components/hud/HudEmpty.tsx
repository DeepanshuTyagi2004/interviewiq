import * as React from "react";
import { cn } from "@/lib/utils/cn";

/** Empty card body: a dashed mono tag ("NO DATA") over the existing title + hint copy. */
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
    <div className={cn("flex flex-col items-start gap-1.5 px-4 py-7 sm:px-5", className)}>
      <span aria-hidden className="iq-pill mb-1 border border-dashed border-line-4 text-muted-foreground">
        {tag}
      </span>
      <p className="m-0 text-sm">{title}</p>
      {hint ? <p className="m-0 max-w-md text-[13px] leading-[1.5] text-muted-foreground">{hint}</p> : null}
      {children ? <div className="pt-2">{children}</div> : null}
    </div>
  );
}
