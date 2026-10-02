import * as React from "react";
import { HudCard, HudEmpty } from "@/components/hud";
import { MonoPill } from "@/components/patterns";
import { cn } from "@/lib/utils/cn";
import type { PillLook } from "./status";

export interface ConsoleCardProps {
  /** Header title, shown as the card's mono readout label. */
  title: React.ReactNode;
  /** Right side of the header row: a count, a status pill or a small control. */
  meta?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  /** Accessible name for the region when the title isn't plain text. */
  "aria-label"?: string;
}

/**
 * The admin consoles' section frame: the shared HUD card (hairline frame, mono header readout
 * with the title, a leader line and `meta` on the right).
 */
export function ConsoleCard({
  title,
  meta,
  children,
  className,
  bodyClassName,
  "aria-label": ariaLabel,
}: ConsoleCardProps) {
  return (
    <HudCard
      title={title}
      meta={meta}
      aria-label={ariaLabel ?? (typeof title === "string" ? title : undefined)}
      className={className}
      bodyClassName={bodyClassName}
    >
      {children}
    </HudCard>
  );
}

/** Mono count for a card header ("12 briefs"). */
export function HeaderCount({ children }: { children: React.ReactNode }) {
  return <span className="font-mono text-[11.5px] tabular-nums text-faint">{children}</span>;
}

/** A MonoPill rendered from a {@link PillLook}. */
export function LookPill({
  look,
  className,
  children,
  ...props
}: { look: PillLook } & React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <MonoPill tone={look.tone} className={cn(look.className, className)} {...props}>
      {children}
    </MonoPill>
  );
}

/** Quiet placeholder for an empty card body: the HUD empty block (tag + title + one muted line). */
export function CardEmpty({ title, hint }: { title: string; hint?: React.ReactNode }) {
  return <HudEmpty title={title} hint={hint} />;
}
