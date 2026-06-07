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

/** Optional right-aligned header actions. Surfaces may set this via the setter. */
const HeaderActionsContext = React.createContext<React.ReactNode>(null);

export function HeaderActions({ children }: { children: React.ReactNode }) {
  return (
    <HeaderActionsContext.Provider value={children}>
      {children}
    </HeaderActionsContext.Provider>
  );
}

export function SiteHeader() {
  const pathname = usePathname();
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
        <div className="ml-auto flex items-center gap-2" />
      </div>
    </header>
  );
}
