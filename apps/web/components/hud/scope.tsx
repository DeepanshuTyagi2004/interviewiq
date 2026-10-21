"use client";

import { useLayoutEffect } from "react";

/**
 * Class on <html> that the `hud:` Tailwind variant still keys on (two old call sites). The HUD
 * look itself is gone, so the scope no longer changes tokens, zoom or decorations.
 */
export const HUD_CLASS = "iq-hud";

let scopes = 0;

/**
 * Keeps the class on <html> while the calling layout is mounted (ref-counted). Nothing else
 * depends on it now; it stays only until the `hud:` variant users are migrated.
 */
export function useHudScope(): void {
  useLayoutEffect(() => {
    scopes += 1;
    document.documentElement.classList.add(HUD_CLASS);
    return () => {
      scopes -= 1;
      if (scopes <= 0) {
        scopes = 0;
        document.documentElement.classList.remove(HUD_CLASS);
      }
    };
  }, []);
}

/** For server layouts (admin): renders nothing, just holds the scope. */
export function HudScope(): null {
  useHudScope();
  return null;
}

/** No-op: there is no zoom to turn off any more. */
export function HudZoomOff(): null {
  return null;
}
