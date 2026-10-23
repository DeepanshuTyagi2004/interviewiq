"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import {
  Activity,
  Bell,
  CreditCard,
  LifeBuoy,
  Link2,
  LogOut,
  Mic,
  Moon,
  Send,
  ShieldCheck,
  Sun,
  UserCog,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Orb, StatusDot } from "@/components/ds";
import { useThemeSwitch, type AppTheme } from "@/components/layout/useThemeSwitch";
import { ROUTES } from "@/lib/constants/shared";
import { cn } from "@/lib/utils/cn";
import type { AccountMenuProps } from "./AccountMenu";

const TILES: { label: string; href: string; icon: LucideIcon }[] = [
  { label: "Profile", href: ROUTES.profile, icon: UserRound },
  { label: "Sources", href: ROUTES.connections, icon: Link2 },
  { label: "Interviews", href: ROUTES.interviews, icon: Mic },
  { label: "Account", href: ROUTES.settings.account, icon: UserCog },
  { label: "Notifications", href: ROUTES.settings.notifications, icon: Bell },
  { label: "Privacy", href: ROUTES.settings.privacy, icon: ShieldCheck },
];

const ROWS: { label: string; href: string; icon: LucideIcon }[] = [
  { label: "Billing & plan", href: ROUTES.settings.billing, icon: CreditCard },
  { label: "Help & FAQ", href: ROUTES.help, icon: LifeBuoy },
  { label: "Share an interview experience", href: ROUTES.shareExperience, icon: Send },
];

const ADMIN_ROWS: { label: string; href: string; icon: LucideIcon }[] = [
  { label: "Intelligence", href: ROUTES.intelligence, icon: Activity },
  { label: "Validation controls", href: ROUTES.admin.settings, icon: ShieldCheck },
];

const THEMES: { value: AppTheme; label: string; icon: LucideIcon }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
];

const rowClass =
  "flex min-h-11 items-center gap-3 rounded-[10px] px-1.5 text-[14.5px] outline-none transition-colors hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-brand [&_svg]:text-ink-3";

/**
 * The account menu on phones: a bottom sheet with the six everyday destinations as tiles, a few rows, and a footer with
 * the theme switch and Sign out. Desktop and tablet keep the dropdown (`AccountMenu`).
 */
export function AccountSheet({
  name,
  email,
  status,
  statusActive = false,
  isAdmin,
  seed,
  onSignOut,
  trigger,
  triggerLabel = "Account menu",
}: Pick<AccountMenuProps, "name" | "email" | "status" | "statusActive" | "isAdmin" | "seed" | "onSignOut" | "trigger" | "triggerLabel">) {
  const [open, setOpen] = useState(false);
  const { theme, switchTo } = useThemeSwitch();
  const close = () => setOpen(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        asChild={trigger != null}
        aria-label={triggerLabel}
        className={
          trigger != null
            ? undefined
            : "flex h-9 w-9 flex-none items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        }
      >
        {(trigger as ReactNode) ?? <Orb seed={seed ?? name} size={34} />}
      </SheetTrigger>

      <SheetContent side="bottom" className="max-h-[92dvh] overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
        <div aria-hidden className="mx-auto mb-3 h-1 w-9 rounded-full bg-line" />
        <SheetTitle className="sr-only">Account</SheetTitle>
        <SheetDescription className="sr-only">Your profile, settings and sign out</SheetDescription>

        <div className="flex items-center gap-3 pr-8">
          <Orb seed={seed ?? name} size={42} />
          <div className="min-w-0 flex-1">
            <p className="m-0 flex items-center gap-2 text-[14.5px] font-medium tracking-[-0.01em]">
              <span className="truncate">{name}</span>
              {isAdmin ? <span className="flex-none rounded-full bg-surface-2 px-2 py-px text-xs font-medium text-ink-2">Admin</span> : null}
            </p>
            {email ? <p className="m-0 mt-0.5 truncate text-xs text-ink-3">{email}</p> : null}
          </div>
        </div>
        <p className="m-0 mt-3 min-w-0 overflow-hidden rounded-[10px] bg-surface px-2.5 py-1.5 text-xs text-ink-2">
          <StatusDot state={statusActive ? "active" : "idle"} label={<span className="block truncate">{status}</span>} className="flex w-full min-w-0 items-center" />
        </p>

        <nav aria-label="Account" className="mt-3 grid grid-cols-3 gap-2">
          {TILES.map((t) => (
            <Link
              key={t.href}
              href={t.href}
              onClick={close}
              className="flex min-w-0 flex-col items-center gap-1.5 rounded-[14px] bg-surface px-1 py-3 text-[12.5px] text-ink outline-none transition-colors hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-brand"
            >
              <t.icon aria-hidden strokeWidth={1.6} className="h-[18px] w-[18px] text-ink-2" />
              <span className="max-w-full truncate">{t.label}</span>
            </Link>
          ))}
        </nav>

        <div className="mt-2 border-t border-line pt-1.5">
          {ROWS.map((r) => (
            <Link key={r.href} href={r.href} onClick={close} className={rowClass}>
              <r.icon aria-hidden strokeWidth={1.6} className="h-[18px] w-[18px] flex-none" />
              <span className="min-w-0 truncate">{r.label}</span>
            </Link>
          ))}
          {isAdmin
            ? ADMIN_ROWS.map((r) => (
                <Link key={r.href} href={r.href} onClick={close} className={rowClass}>
                  <r.icon aria-hidden strokeWidth={1.6} className="h-[18px] w-[18px] flex-none" />
                  <span className="min-w-0 truncate">{r.label}</span>
                  <span className="ml-auto text-xs text-ink-3">Admin</span>
                </Link>
              ))
            : null}
        </div>

        <div className="mt-1.5 flex items-center justify-between gap-3 border-t border-line pt-3">
          <div role="group" aria-label="Theme" className="inline-flex rounded-[10px] bg-surface p-[3px]">
            {THEMES.map((t) => (
              <button
                key={t.value}
                type="button"
                aria-pressed={theme === t.value}
                aria-label={`${t.label} theme`}
                onClick={() => switchTo(t.value)}
                className={cn(
                  "flex h-[30px] w-[34px] items-center justify-center rounded-lg text-ink-3 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand",
                  theme === t.value && "bg-background text-ink shadow-sm",
                )}
              >
                <t.icon aria-hidden strokeWidth={1.6} className="h-4 w-4" />
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => {
              close();
              onSignOut();
            }}
            className="flex h-10 items-center gap-2 rounded-[10px] border border-line bg-background px-4 text-sm text-ink outline-none transition-colors hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-brand"
          >
            <LogOut aria-hidden strokeWidth={1.6} className="h-4 w-4 text-ink-3" />
            Sign out
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
