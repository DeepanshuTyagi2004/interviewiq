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

/** The settings sections as route tabs (one page each), styled like the tracks hub's tabs. */
export function SettingsNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Settings sections" className="mt-5 flex w-full gap-6 border-b border-line-2">
      {SETTINGS_TABS.map((tab) => {
        const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-0 pb-3 text-[14px] transition-colors",
              active ? "border-foreground text-foreground" : "border-transparent text-faint hover:text-foreground",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
