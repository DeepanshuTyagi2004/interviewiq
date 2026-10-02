"use client";

import { forwardRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { initialsOf } from "@/lib/utils/format";
import { isActivePath, type AppNavItem } from "./nav";

const READINESS_SEGMENTS = 4;

export interface AppMenuProps {
  id: string;
  open: boolean;
  items: AppNavItem[];
  name: string;
  /** Secondary line under the name, e.g. the target role. */
  status: string;
  onNavigate: () => void;
  onSignOut: () => void;
}

/**
 * The navigation revealed behind the page card: who you are, every destination (staggering in
 * as the card slides away), readiness and sign out. Hidden from assistive tech while closed.
 */
export const AppMenu = forwardRef<HTMLElement, AppMenuProps>(function AppMenu(
  { id, open, items, name, status, onNavigate, onSignOut },
  ref,
) {
  const pathname = usePathname();

  return (
    <nav
      ref={ref}
      id={id}
      aria-label="Main"
      aria-hidden={!open}
      inert={!open}
      className="absolute inset-y-0 left-0 flex w-[300px] max-w-[calc(100%-72px)] flex-col px-6 pb-6 pt-8 text-foreground sm:px-[30px] sm:pb-[26px]"
    >
      <div
        className={cn(
          "flex items-center gap-3.5 transition-[opacity,transform] delay-100 duration-500 ease-iq",
          open ? "translate-y-0 opacity-100" : "-translate-y-2.5 opacity-0",
        )}
      >
        <span
          aria-hidden
          className="flex h-[52px] w-[52px] flex-none items-center justify-center rounded-full bg-brand text-[17px] font-medium text-brand-foreground"
        >
          {initialsOf(name)}
        </span>
        <div className="min-w-0">
          <p className="m-0 truncate text-[17px] tracking-[-0.02em]">{name}</p>
          <p className="m-0 mt-[3px] flex items-center gap-1.5 truncate text-[12.5px] text-muted-foreground">
            <span aria-hidden className="h-1.5 w-1.5 flex-none rounded-full bg-brand" />
            {status}
          </p>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden py-5">
        <ul className="m-0 my-auto flex list-none flex-col gap-0.5 p-0">
          {items.map((item, i) => {
            const active = isActivePath(pathname, item.href);
            return (
              <li
                key={item.href}
                className={cn(
                  "transition-[opacity,transform] duration-500 ease-iq motion-reduce:transition-none",
                  open ? "translate-x-0 opacity-100" : "-translate-x-7 opacity-0",
                )}
                style={{ transitionDelay: open ? `${140 + i * 45}ms` : "0ms" }}
              >
                <Link
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-4 rounded-md py-2.5 text-lg tracking-[-0.02em] outline-none transition-colors duration-200 hover:text-ink-hover focus-visible:ring-1 focus-visible:ring-ring dark:hover:text-brand",
                    active ? "font-medium text-foreground dark:text-brand" : "font-normal text-foreground",
                  )}
                >
                  <item.icon
                    aria-hidden
                    strokeWidth={1.6}
                    className={cn("h-[22px] w-[22px] flex-none", active && "text-brand")}
                  />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>

      <div
        className={cn(
          "flex flex-none flex-col gap-4 transition-opacity delay-300 duration-500",
          open ? "opacity-100" : "opacity-0",
        )}
      >
        {/* Readiness isn't computed yet — show the empty meter, never a made-up level. */}
        <div className="flex max-w-[220px] flex-col gap-2 rounded-[14px] bg-foreground/[0.07] p-3.5">
          <p className="m-0 font-mono text-[9.5px] uppercase tracking-[0.08em] text-muted-foreground">Readiness</p>
          <div aria-hidden className="grid grid-cols-4 gap-[3px]">
            {Array.from({ length: READINESS_SEGMENTS }, (_, i) => (
              <span key={i} className="h-1 rounded-sm bg-foreground/[0.14]" />
            ))}
          </div>
          <p className="m-0 text-xs text-muted-foreground">No official loop started yet</p>
        </div>
        <button
          type="button"
          onClick={onSignOut}
          className="flex items-center gap-4 self-start rounded-md text-base text-foreground outline-none transition-colors hover:text-ink-hover focus-visible:ring-1 focus-visible:ring-ring dark:hover:text-brand"
        >
          <LogOut aria-hidden strokeWidth={1.6} className="h-[22px] w-[22px]" />
          Sign out
        </button>
      </div>
    </nav>
  );
});
