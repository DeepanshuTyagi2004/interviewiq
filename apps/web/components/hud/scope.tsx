"use client";

import { useLayoutEffect } from "react";

/** Class on <html> that switches on the HUD look (tokens, zoom, decorations). */
export const HUD_CLASS = "iq-hud";

let scopes = 0;

/**
 * Puts the HUD class on <html> while the calling layout is mounted. On <html> rather than a
 * wrapper so Radix portals (menus, dialogs, ⌘K) inherit it. Ref-counted so overlapping mounts
 * during a route change never drop it early. A layout effect, so the first painted frame already
 * has the HUD scale (these only run client-side, behind RequireAuth).
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

/**
 * Turns the 90% zoom off while mounted. The live room's editors (Monaco, Excalidraw) map pointer
 * coordinates themselves and misplace clicks under CSS zoom.
 */
export function HudZoomOff(): null {
  useLayoutEffect(() => {
    const el = document.documentElement;
    el.setAttribute("data-hud-zoom", "off");
    return () => el.removeAttribute("data-hud-zoom");
  }, []);
  return null;
}
