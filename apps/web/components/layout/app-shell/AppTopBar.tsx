"use client";

import Link from "next/link";
import { Bell, Search } from "lucide-react";
import { Logo } from "@/components/layout/Logo";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ROUTES } from "@/lib/constants/shared";
import { cn } from "@/lib/utils/cn";
import { initialsOf } from "@/lib/utils/format";

const iconButton =
  "relative flex h-[34px] w-[34px] flex-none items-center justify-center rounded-md border border-line-4 bg-card text-foreground transition-colors hover:border-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

/** Frame-level bar above the page card: brand, ⌘K search, theme, notifications, avatar. */
export function AppTopBar({ name, onOpenSearch }: { name: string; onOpenSearch: () => void }) {
  return (
    <header className="flex h-16 flex-none items-center gap-3 pl-4 pr-3 sm:gap-6 sm:pl-7 sm:pr-5">
      <Logo href={ROUTES.dashboard} className="md:w-[196px]" />

      <button
        type="button"
        onClick={onOpenSearch}
        className="hidden h-[38px] min-w-0 max-w-[440px] flex-1 items-center gap-2.5 rounded-md border border-line-4 bg-card px-3 text-left text-[13.5px] text-faint transition-colors hover:border-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring md:flex"
      >
        <Search aria-hidden className="h-3.5 w-3.5 flex-none" />
        <span className="flex-1 truncate">Search companies, roles, debriefs</span>
        <kbd className="rounded border border-line-3 px-1.5 py-0.5 font-mono text-[11px]">⌘K</kbd>
      </button>

      <div className="ml-auto flex flex-none items-center gap-2 sm:gap-3">
        <button type="button" onClick={onOpenSearch} aria-label="Search" className={cn(iconButton, "md:hidden")}>
          <Search aria-hidden className="h-4 w-4" />
        </button>
        <ThemeToggle />
        <Popover>
          <PopoverTrigger aria-label="Notifications" className={cn(iconButton, "hidden sm:flex")}>
            <Bell aria-hidden strokeWidth={1.6} className="h-4 w-4" />
          </PopoverTrigger>
          <PopoverContent align="end" className="w-72 rounded-[10px] border-line-2 p-4">
            <p className="iq-eyebrow m-0">Notifications</p>
            <p className="m-0 mt-2 text-sm">You&apos;re all caught up.</p>
            <p className="m-0 mt-1 text-[13px] leading-[1.5] text-muted-foreground">
              Interview reminders and new debriefs will show up here.
            </p>
          </PopoverContent>
        </Popover>
        <Link
          href={ROUTES.profile}
          aria-label="Your profile"
          className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-full bg-brand text-[12.5px] text-brand-foreground transition-colors hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-frame"
        >
          {initialsOf(name)}
        </Link>
      </div>
    </header>
  );
}
