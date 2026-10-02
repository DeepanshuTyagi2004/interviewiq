"use client";

import * as React from "react";
import { cn } from "@/lib/utils/cn";

/** Moves the hover spotlight. Percentages, so it stays under the cursor at any zoom. */
export function spotlightMove(e: React.PointerEvent<HTMLElement>): void {
  if (e.pointerType !== "mouse") return;
  const el = e.currentTarget;
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return;
  el.style.setProperty("--mx", `${((e.clientX - r.left) / r.width) * 100}%`);
  el.style.setProperty("--my", `${((e.clientY - r.top) / r.height) * 100}%`);
}

export interface HudCardProps {
  title?: React.ReactNode;
  /** Right of the leader line: a count, a status, a short readout. */
  meta?: React.ReactNode;
  /** Right-most control in the header (a "View all" link, an edit button). */
  action?: React.ReactNode;
  /** Mono readout strip under the body. */
  footer?: React.ReactNode;
  /** 45° top-right cut, the HUD signature. Hero/stat cards and ⌘K only. */
  notch?: boolean;
  /** `inverse` = the dark card in both themes (Up next). */
  tone?: "default" | "inverse";
  as?: "section" | "article" | "div" | "li";
  titleAs?: "h1" | "h2" | "h3";
  /** Brightens the corner ticks (e.g. a live company). */
  active?: boolean;
  spotlight?: boolean;
  className?: string;
  headerClassName?: string;
  bodyClassName?: string;
  "aria-label"?: string;
  /** Names the region by a heading inside the body instead of the header title. */
  "aria-labelledby"?: string;
  children?: React.ReactNode;
}

/**
 * The one bordered card of the signed-in app: hairline frame, a mono header readout
 * (TITLE ──── meta · action), optional footer strip, corner ticks and a cursor spotlight.
 * Decorations only draw inside `.iq-hud`, so the card reads as a plain card anywhere else.
 */
export function HudCard({
  title,
  meta,
  action,
  footer,
  notch = false,
  tone = "default",
  as: Tag = "section",
  titleAs: Title = "h2",
  active = false,
  spotlight = true,
  className,
  headerClassName,
  bodyClassName,
  "aria-label": ariaLabel,
  "aria-labelledby": labelledBy,
  children,
}: HudCardProps) {
  const titleId = React.useId();
  const inverse = tone === "inverse";
  const hasHeader = title != null || meta != null || action != null;
  const named = Tag === "section" || Tag === "article";

  return (
    <Tag
      aria-labelledby={named ? (labelledBy ?? (title != null && !ariaLabel ? titleId : undefined)) : undefined}
      aria-label={named && !labelledBy ? ariaLabel : undefined}
      data-active={active ? "" : undefined}
      onPointerMove={spotlight ? spotlightMove : undefined}
      className={cn(
        "hud-card relative isolate flex min-w-0 flex-col overflow-hidden rounded-[14px]",
        inverse ? "bg-inv text-white dark:ring-1 dark:ring-inset dark:ring-line-2" : "border border-line-2 bg-card",
        notch && "hud-notch",
        className,
      )}
    >
      {spotlight ? <span aria-hidden className="hud-spot" /> : null}
      <span aria-hidden className="hud-ticks" data-notch={notch ? "" : undefined} />
      {notch ? <span aria-hidden className="hud-notch-line" data-inverse={inverse ? "" : undefined} /> : null}

      {hasHeader ? (
        <div
          data-hud-header
          className={cn(
            "flex min-h-[48px] flex-wrap items-center gap-x-3 gap-y-1.5 border-b px-4 py-3 sm:px-5",
            inverse ? "border-white/10" : "border-line",
            headerClassName,
          )}
        >
          {title != null ? (
            <Title
              id={titleId}
              className={cn(
                "m-0 min-w-0 font-mono text-[11px] font-normal uppercase leading-normal tracking-[0.08em]",
                inverse ? "text-white/60" : "text-muted-foreground",
              )}
            >
              {title}
            </Title>
          ) : null}
          <span aria-hidden className={cn("h-px min-w-4 flex-1", inverse ? "bg-white/10" : "bg-line-2")} />
          {meta != null ? (
            <div
              className={cn(
                "flex flex-wrap items-center gap-2 font-mono text-[11px] tabular-nums",
                inverse ? "text-white/60" : "text-faint",
              )}
            >
              {meta}
            </div>
          ) : null}
          {action != null ? <div className="flex items-center gap-2">{action}</div> : null}
        </div>
      ) : null}

      <div className={cn("min-w-0 flex-1", bodyClassName)}>{children}</div>

      {footer != null ? (
        <div
          className={cn(
            "flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t px-4 py-2.5 font-mono text-[10.5px] uppercase tracking-[0.08em] sm:px-5",
            inverse ? "border-white/10 text-white/50" : "border-line text-faint",
          )}
        >
          {footer}
        </div>
      ) : null}
    </Tag>
  );
}
