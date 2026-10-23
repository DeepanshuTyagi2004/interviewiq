import * as React from "react";
import { cn } from "@/lib/utils/cn";

export type CardTone = "default" | "stone" | "surface" | "stage" | "ink";

const TONE: Record<CardTone, string> = {
  default: "bg-card text-foreground shadow-ring dark:bg-surface",
  stone: "bg-stone text-foreground shadow-ring",
  surface: "bg-surface text-foreground shadow-ring",
  // The colour-mesh stage surface (see .iq-stage): for hero-like cards that hold an orb or art.
  stage: "iq-stage text-foreground",
  // Inverted in both themes: ink background, page-coloured text.
  ink: "bg-ink text-background",
};

export interface CardProps {
  title?: React.ReactNode;
  meta?: React.ReactNode;
  action?: React.ReactNode;
  footer?: React.ReactNode;
  tone?: CardTone;
  /** Adds the 3px hover lift. */
  interactive?: boolean;
  as?: "section" | "article" | "div" | "li";
  titleAs?: "h1" | "h2" | "h3";
  className?: string;
  headerClassName?: string;
  /** Wraps the children in a div with these classes. */
  bodyClassName?: string;
  /** No outer padding: the header and footer pad themselves and the body brings its own. */
  flush?: boolean;
  "aria-label"?: string;
  /** Names the region by a heading inside the body instead of the title. */
  "aria-labelledby"?: string;
  children?: React.ReactNode;
}

export function Card({
  title,
  meta,
  action,
  footer,
  tone = "default",
  interactive = false,
  as: Tag = "section",
  titleAs: TitleTag = "h2",
  className,
  headerClassName,
  bodyClassName,
  flush = false,
  "aria-label": ariaLabel,
  "aria-labelledby": labelledBy,
  children,
}: CardProps) {
  const titleId = React.useId();
  const hasHead = title != null || meta != null || action != null;
  const named = Tag === "section" || Tag === "article";
  return (
    <Tag
      aria-labelledby={named ? (labelledBy ?? (title != null && !ariaLabel ? titleId : undefined)) : undefined}
      aria-label={named && !labelledBy ? ariaLabel : undefined}
      className={cn(
        "flex min-w-0 flex-col rounded-card",
        flush ? "overflow-hidden" : "p-[22px]",
        TONE[tone],
        interactive &&
          "transition-[transform,background-color] duration-200 ease-iq hover:-translate-y-[3px] motion-reduce:transition-none motion-reduce:hover:translate-y-0",
        className,
      )}
    >
      {hasHead ? (
        <div className={cn("flex items-start justify-between gap-3", flush ? "px-5 pb-1 pt-5" : "mb-4", headerClassName)}>
          <div className="min-w-0">
            {title != null ? (
              <TitleTag id={titleId} className="m-0 font-display text-[22px] font-normal leading-tight tracking-[-0.03em]">
                {title}
              </TitleTag>
            ) : null}
            {meta != null ? (
              <div className={cn("text-[13px]", tone === "ink" ? "text-background/70" : "text-ink-3", title != null && "mt-1")}>
                {meta}
              </div>
            ) : null}
          </div>
          {action ? <div className="flex-none">{action}</div> : null}
        </div>
      ) : null}
      {bodyClassName != null ? <div className={cn("min-w-0 flex-1", bodyClassName)}>{children}</div> : children}
      {footer ? (
        <div className={cn("border-t pt-4", flush ? "mx-5 mb-4 mt-2" : "mt-4", tone === "ink" ? "border-background/15" : "border-line")}>{footer}</div>
      ) : null}
    </Tag>
  );
}
