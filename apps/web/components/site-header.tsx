"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";

const TITLES: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/profile": "Profile",
  "/connections": "Connections",
};

function titleFor(pathname: string): string {
  if (TITLES[pathname]) return TITLES[pathname];
  const match = Object.keys(TITLES).find((p) => pathname.startsWith(`${p}/`));
  return match ? TITLES[match] : "InterviewIQ";
}

// ---------------------------------------------------------------------------
// Header actions slot — module-level store so SiteHeader (rendered in the
// layout) can display actions set by any descendant page via <HeaderActions>.
// Using useSyncExternalStore keeps the subscription React-friendly.
// ---------------------------------------------------------------------------

type Listener = () => void;
let _actions: React.ReactNode = null;
const _listeners = new Set<Listener>();

function subscribe(listener: Listener) {
  _listeners.add(listener);
  return () => _listeners.delete(listener);
}

function getSnapshot(): React.ReactNode {
  return _actions;
}

function setActions(node: React.ReactNode) {
  _actions = node;
  _listeners.forEach((l) => l());
}

/**
 * Wrap a page's action buttons/controls with this component to have them
 * appear in the right side of the site header bar. Does NOT render children
 * inline — it only registers them into the header slot.
 */
export function HeaderActions({ children }: { children: React.ReactNode }) {
  React.useEffect(() => {
    setActions(children);
    return () => setActions(null);
  }, [children]);

  // No children pass-through — content is surfaced only in the header slot.
  return null;
}

export function SiteHeader() {
  const pathname = usePathname();
  const actions = React.useSyncExternalStore(subscribe, getSnapshot, () => null);

  return (
    <header className="flex h-[--header-height] shrink-0 items-center gap-2 border-b border-border transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
      <div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
        <SidebarTrigger className="-ml-1" />
        <Separator
          orientation="vertical"
          className="mx-2 data-[orientation=vertical]:h-4"
        />
        <h1 className="text-base font-medium tracking-tight">
          {titleFor(pathname)}
        </h1>
        <div className="ml-auto flex items-center gap-2">{actions}</div>
      </div>
    </header>
  );
}
