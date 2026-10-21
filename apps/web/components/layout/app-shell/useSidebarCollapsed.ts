"use client";

import { useCallback, useEffect, useState } from "react";

export const SIDEBAR_COLLAPSED_KEY = "iq.sidebar.collapsed";

/** Only the exact value "1" means collapsed; anything else (old values, null) means expanded. */
export function parseCollapsed(raw: string | null): boolean {
  return raw === "1";
}

function read(): boolean {
  try {
    return parseCollapsed(window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY));
  } catch {
    return false;
  }
}

/**
 * Whether the desktop sidebar is the 64px rail. Starts expanded (also on the server), reads the
 * saved choice after mount, and survives storage that throws.
 */
export function useSidebarCollapsed(): [collapsed: boolean, setCollapsed: (v: boolean) => void] {
  const [collapsed, set] = useState(false);

  useEffect(() => {
    set(read());
  }, []);

  const setCollapsed = useCallback((v: boolean) => {
    set(v);
    try {
      window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, v ? "1" : "0");
    } catch {
      /* not remembered; still collapsed for this visit */
    }
  }, []);

  return [collapsed, setCollapsed];
}
