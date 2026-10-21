"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ROUTES } from "@/lib/constants/shared";
import { cn } from "@/lib/utils/cn";

export const SETTINGS_TABS = [
  { href: ROUTES.settings.account, label: "Account" },
  { href: ROUTES.settings.notifications, label: "Notifications" },
  { href: ROUTES.settings.privacy, label: "Privacy & data" },
  { href: ROUTES.settings.billing, label: "Billing & plan" },
] as const;

/** The settings sections as route links (one page each): a left list from 1024px, a pill segment below. */
export function SettingsNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Settings sections"
      className="-mx-1 flex max-w-full gap-1 self-start overflow-x-auto px-1 py-1 lg:sticky lg:top-[60px] lg:mx-0 lg:w-full lg:flex-col lg:overflow-visible lg:p-0"
    >
      <div className="inline-flex h-10 items-center gap-0 rounded-full bg-surface-2 p-1 lg:flex lg:h-auto lg:w-full lg:flex-col lg:items-stretch lg:gap-1 lg:rounded-none lg:bg-transparent lg:p-0">
        {SETTINGS_TABS.map((tab) => {
          const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "inline-flex h-8 flex-none items-center whitespace-nowrap rounded-full px-4 text-sm font-medium transition-colors duration-150 ease-iq focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-background lg:h-10",
                active
                  ? "bg-background text-foreground shadow-ring lg:bg-surface-2 lg:shadow-none"
                  : "text-ink-2 hover:text-foreground lg:hover:bg-surface",
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
