"use client";

import { forwardRef } from "react";
import { Bell, Search } from "lucide-react";
import { Logo } from "@/components/layout/Logo";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ROUTES } from "@/lib/constants/shared";
import { cn } from "@/lib/utils/cn";
import { AccountMenu, type AccountMenuProps } from "./AccountMenu";

/** Borderless icon control inside the bar: a soft fill on hover, never its own box. */
const iconButton =
  "relative flex h-9 w-9 flex-none items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring data-[state=open]:bg-accent data-[state=open]:text-foreground";

export interface AppTopBarProps {
  /** The current screen's name, shown after the logo. */
  title: string;
  menuId: string;
  menuOpen: boolean;
  onToggleMenu: () => void;
  onOpenSearch: () => void;
  account: Omit<AccountMenuProps, "onOpenSearch" | "onToggleMenu">;
}

/**
 * One floating bar above the page card — the same white, hairline-bordered, rounded surface as
 * the card — holding the menu toggle, brand and current screen on the left, ⌘K search in the
 * middle, and theme, notifications and the account menu on the right as borderless controls.
 * The ref is the menu toggle, so the shell can hand focus back to it when the menu closes.
 */
export const AppTopBar = forwardRef<HTMLButtonElement, AppTopBarProps>(function AppTopBar(
  { title, menuId, menuOpen, onToggleMenu, onOpenSearch, account },
  menuButtonRef,
) {
  return (
    <header className="flex-none px-2 pb-2 pt-2 sm:px-3 sm:pb-3 sm:pt-3">
      <div className="flex h-14 items-center gap-3 rounded-[18px] border border-line-3 bg-card px-2.5 shadow-[0_1px_2px_rgba(0,0,0,.04),0_10px_30px_-18px_rgba(0,0,0,.18)] dark:shadow-none sm:gap-5 sm:px-2.5">
      <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
        <button
          ref={menuButtonRef}
          type="button"
          onClick={onToggleMenu}
          aria-label="Open menu"
          aria-expanded={menuOpen}
          aria-controls={menuId}
          title="Menu (M)"
          className={cn(
            "grid h-9 w-9 flex-none grid-cols-[repeat(2,4px)] place-content-center gap-1 rounded-full transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            menuOpen && "bg-accent",
          )}
        >
          <span aria-hidden className="h-1 w-1 rounded-full bg-foreground" />
          <span aria-hidden className="h-1 w-1 rounded-full bg-foreground" />
          <span aria-hidden className="h-1 w-1 rounded-full bg-foreground" />
          <span aria-hidden className="h-1 w-1 rounded-full bg-brand" />
        </button>
        <Logo href={ROUTES.dashboard} wordmarkClassName="hidden sm:inline" />
        <svg aria-hidden viewBox="0 0 16 16" className="h-4 w-4 flex-none text-faint-2">
          <path d="M10.5 2 5.5 14" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
        <span className="min-w-0 truncate text-[14.5px] tracking-[-0.01em]">{title}</span>
      </div>

      <button
        type="button"
        onClick={onOpenSearch}
        className="hidden h-9 min-w-0 flex-[0_1_440px] items-center gap-2.5 rounded-full bg-panel px-4 text-left text-[13.5px] text-faint transition-colors hover:bg-line-2 hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring md:flex"
      >
        <Search aria-hidden className="h-3.5 w-3.5 flex-none" />
        <span className="flex-1 truncate">Search companies, roles, debriefs</span>
        <kbd className="rounded-full border border-line-3 bg-card px-2 py-0.5 font-mono text-[11px]">⌘K</kbd>
      </button>

      <div className="flex flex-none items-center justify-end gap-1 sm:gap-1.5 md:flex-1">
        <button type="button" onClick={onOpenSearch} aria-label="Search" className={cn(iconButton, "md:hidden")}>
          <Search aria-hidden className="h-4 w-4" />
        </button>
        <ThemeToggle className="mr-1 border-transparent bg-panel" />
        <Popover>
          <PopoverTrigger aria-label="Notifications" className={cn(iconButton, "hidden sm:flex")}>
            <Bell aria-hidden strokeWidth={1.6} className="h-4 w-4" />
          </PopoverTrigger>
          <PopoverContent align="end" className="w-72 rounded-[14px] border-line-2 p-4">
            <p className="iq-eyebrow m-0">Notifications</p>
            <p className="m-0 mt-2 text-sm">You&apos;re all caught up.</p>
            <p className="m-0 mt-1 text-[13px] leading-[1.5] text-muted-foreground">
              Interview reminders and new debriefs will show up here.
            </p>
          </PopoverContent>
        </Popover>
        <AccountMenu {...account} onOpenSearch={onOpenSearch} onToggleMenu={onToggleMenu} />
      </div>
      </div>
    </header>
  );
});
