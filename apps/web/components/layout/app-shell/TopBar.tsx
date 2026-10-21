"use client";

import Link from "next/link";
import { Bell, PanelLeft, Search } from "lucide-react";
import { Kbd } from "@/components/ds";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ROUTES } from "@/lib/constants/shared";
import { cn } from "@/lib/utils/cn";
import { AccountMenu, type AccountMenuProps } from "./AccountMenu";
import { Breadcrumbs } from "./Breadcrumbs";
import type { BreadcrumbNames } from "./breadcrumbs";

const FOCUS =
  "outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-background";

/** The mockup's `.tb`: a 36px pill with a hairline ring. */
const pill =
  "inline-flex h-9 flex-none items-center justify-center gap-[7px] rounded-full border border-line bg-background px-3.5 text-[13.5px] font-medium text-ink shadow-ring transition-colors duration-150 hover:bg-surface data-[state=open]:bg-surface";

export interface TopBarProps {
  pathname: string;
  names: BreadcrumbNames;
  sidebarId: string;
  /** Whether the sidebar is showing (desktop: not the rail; phone: the sheet is open). */
  sidebarExpanded: boolean;
  onToggleSidebar: () => void;
  onOpenSearch: () => void;
  account: Omit<AccountMenuProps, "onOpenSearch" | "onToggleSidebar" | "trigger" | "triggerLabel" | "side" | "align">;
}

/**
 * 60px sticky bar: sidebar toggle and breadcrumbs, a pill search in the middle, then Feedback,
 * Help, notifications and the avatar orb. The theme switch lives in the account menu.
 */
export function TopBar({ pathname, names, sidebarId, sidebarExpanded, onToggleSidebar, onOpenSearch, account }: TopBarProps) {
  return (
    <header className="iq-topbar sticky top-0 z-20 flex h-[60px] flex-none items-center gap-3 border-b border-line px-4 sm:gap-3.5 sm:px-7">
      <div className="flex min-w-0 flex-1 items-center gap-1.5 sm:gap-2.5 md:flex-[0_1_auto]">
        <button
          type="button"
          onClick={onToggleSidebar}
          aria-label="Toggle sidebar"
          aria-expanded={sidebarExpanded}
          aria-controls={sidebarId}
          title="Toggle sidebar (M)"
          className={cn("flex h-9 w-9 flex-none items-center justify-center rounded-full text-ink-2 transition-colors duration-150 hover:bg-surface hover:text-ink", FOCUS)}
        >
          <PanelLeft aria-hidden strokeWidth={1.6} className="h-[18px] w-[18px]" />
        </button>
        <Breadcrumbs pathname={pathname} names={names} />
      </div>

      <button
        type="button"
        onClick={onOpenSearch}
        aria-keyshortcuts="Meta+K Control+K"
        className={cn(
          "hidden h-[38px] min-w-[200px] flex-[0_1_380px] items-center md:mx-auto gap-[9px] rounded-full border border-line bg-background pl-3.5 pr-2 text-left text-[13.5px] text-ink-3 shadow-ring transition-colors duration-150 hover:bg-surface md:flex",
          FOCUS,
        )}
      >
        <Search aria-hidden strokeWidth={1.8} className="h-4 w-4 flex-none" />
        <span className="min-w-0 flex-1 truncate">Search companies, roles, interviews…</span>
        <span aria-hidden className="flex flex-none gap-1">
          <Kbd>⌘</Kbd>
          <Kbd>K</Kbd>
        </span>
      </button>

      <div className="flex flex-none items-center justify-end gap-2">
        <button
          type="button"
          onClick={onOpenSearch}
          aria-label="Search"
          className={cn(pill, "w-9 px-0 md:hidden", FOCUS)}
        >
          <Search aria-hidden strokeWidth={1.7} className="h-4 w-4" />
        </button>
        <Link href={ROUTES.contact} className={cn(pill, "hidden xl:inline-flex", FOCUS)}>
          Feedback
        </Link>
        <Link href={ROUTES.help} className={cn(pill, "hidden xl:inline-flex", FOCUS)}>
          Help
        </Link>
        <Popover>
          <PopoverTrigger aria-label="Notifications" className={cn(pill, "w-9 px-0", FOCUS)}>
            <Bell aria-hidden strokeWidth={1.7} className="h-4 w-4" />
          </PopoverTrigger>
          <PopoverContent align="end" sideOffset={10} className="w-72">
            <p className="m-0 text-sm font-medium">Notifications</p>
            <p className="m-0 mt-2 text-sm">You&apos;re all caught up.</p>
            <p className="m-0 mt-1 text-[13px] leading-[1.5] text-ink-3">
              Interview reminders and new debriefs will show up here.
            </p>
          </PopoverContent>
        </Popover>
        <AccountMenu {...account} onOpenSearch={onOpenSearch} onToggleSidebar={onToggleSidebar} />
      </div>
    </header>
  );
}
