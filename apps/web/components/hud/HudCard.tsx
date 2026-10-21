"use client";

import * as React from "react";
import { Card, type CardTone } from "@/components/ds/Card";

/** Compatibility shim: the cursor spotlight is gone, so this does nothing. */
export function spotlightMove(e: React.PointerEvent<HTMLElement>): void {
  void e;
}

/** Kept so old call sites compile; the ember glow no longer exists. */
export type HudGlow = "tl" | "tr" | "bl" | "br" | "t" | "r" | "none";

export interface HudCardProps {
  title?: React.ReactNode;
  meta?: React.ReactNode;
  action?: React.ReactNode;
  footer?: React.ReactNode;
  /** Ignored: notches are gone. */
  notch?: boolean;
  /** `inverse` maps to the ink card, `sunken` to the surface card. */
  tone?: "default" | "inverse" | "sunken";
  /** Ignored. */
  glow?: HudGlow;
  as?: "section" | "article" | "div" | "li";
  titleAs?: "h1" | "h2" | "h3";
  /** Ignored. */
  active?: boolean;
  /** Ignored. */
  spotlight?: boolean;
  className?: string;
  headerClassName?: string;
  bodyClassName?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  children?: React.ReactNode;
}

const TONE: Record<NonNullable<HudCardProps["tone"]>, CardTone> = {
  default: "default",
  inverse: "ink",
  sunken: "surface",
};

/**
 * Shim over `ds/Card` for the pages that still import `components/hud`. A card that passes
 * `bodyClassName` brings its own body padding, so it renders flush.
 */
export function HudCard({
  tone = "default",
  bodyClassName,
  // Dropped props, accepted so call sites compile unchanged.
  notch: _notch,
  glow: _glow,
  active: _active,
  spotlight: _spotlight,
  ...rest
}: HudCardProps) {
  void _notch;
  void _glow;
  void _active;
  void _spotlight;
  return <Card {...rest} tone={TONE[tone]} bodyClassName={bodyClassName} flush={bodyClassName != null} />;
}
