"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Orb, SegmentBar } from "@/components/ds";
import { Logo } from "@/components/layout/Logo";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ROUTES } from "@/lib/constants/shared";
import { cn } from "@/lib/utils/cn";
import { AccountMenu, type AccountMenuProps } from "./AccountMenu";
import { HELP_NAV, isActivePath, type AppNavItem, type NavGroupId } from "./nav";
import { SidebarInvite } from "./SidebarInvite";

const READINESS_SEGMENTS = 4;

const FOCUS =
  "outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-background";

function filledSegments(r: { completed: number; total: number } | null): number {
  return r && r.total > 0 ? Math.round((r.completed / r.total) * READINESS_SEGMENTS) : 0;
}

function NavLink({
  item,
  active,
  collapsed,
  onNavigate,
}: {
  item: AppNavItem;
  active: boolean;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const link = (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      aria-label={collapsed ? item.label : undefined}
      className={cn(
        "flex items-center rounded-[10px] text-[14px] transition-colors duration-150",
        FOCUS,
        collapsed ? "h-10 w-10 justify-center" : "gap-[11px] px-2.5 py-2",
        active ? "bg-card font-medium text-ink shadow-ring" : "text-ink-2 hover:bg-surface-2 hover:text-ink",
      )}
    >
      <item.icon aria-hidden strokeWidth={1.6} className="h-[17px] w-[17px] flex-none" />
      {collapsed ? null : <span className="min-w-0 truncate">{item.label}</span>}
    </Link>
  );
  if (!collapsed) return link;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right" sideOffset={12}>
        {item.label}
      </TooltipContent>
    </Tooltip>
  );
}

export interface SidebarProps {
  /** The 64px icon rail (desktop only; the sheet is always expanded). */
  collapsed?: boolean;
  groups: { id: NavGroupId; label: string | null; items: AppNavItem[] }[];
  /** Level label under the name, e.g. "SDE I"; null when the user has none yet. */
  level: string | null;
  /** Rounds completed across unedited (official) tracks; null when there are none. */
  readiness: { completed: number; total: number } | null;
  account: Omit<AccountMenuProps, "trigger" | "triggerLabel" | "side" | "align">;
  onNavigate?: () => void;
}

/**
 * The left navigation: logo, grouped destinations, then the readiness summary, the dismissible
 * college invite, Help and the account row. Renders in the desktop aside and in the mobile sheet.
 */
export function Sidebar({ collapsed = false, groups, level, readiness, account, onNavigate }: SidebarProps) {
  const pathname = usePathname() ?? "";
  const helpActive = isActivePath(pathname, HELP_NAV.href);
  const seed = account.seed ?? account.name;

  return (
    <div className={cn("flex h-full min-h-0 flex-col py-[18px]", collapsed ? "items-center px-3" : "px-3")}>
      <Logo
        href={ROUTES.dashboard}
        wordmark={!collapsed}
        className={cn("mb-[14px] rounded-[10px]", FOCUS, collapsed ? "h-10 w-10 justify-center" : "px-2.5 py-1")}
      />

      <nav aria-label="Main" className={cn("flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden", collapsed && "items-center")}>
        {groups.map((group, gi) => (
          <div key={group.id} className={cn(collapsed && "flex flex-col items-center")}>
            {group.label ? (
              collapsed ? (
                <div role="separator" className="mx-auto my-2.5 h-px w-6 bg-line" />
              ) : (
                <p className="m-0 px-2.5 pb-1.5 pt-[18px] text-[12.5px] text-ink-3">{group.label}</p>
              )
            ) : null}
            <ul
              aria-label={group.label ?? undefined}
              className={cn("m-0 flex list-none flex-col gap-0.5 p-0", gi === 0 && "mt-0")}
            >
              {group.items.map((item) => (
                <li key={item.href}>
                  <NavLink item={item} active={isActivePath(pathname, item.href)} collapsed={collapsed} onNavigate={onNavigate} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className={cn("flex flex-none flex-col gap-0.5 pt-2", collapsed && "items-center")}>
        {collapsed ? null : (
          <div className="px-2.5 pb-1 pt-1">
            <p className="m-0 text-[12.5px] text-ink-3">Readiness</p>
            <p className="m-0 mb-2 mt-0.5 text-[12.5px] text-ink-2">
              {readiness ? `${readiness.completed} of ${readiness.total} rounds completed` : "No official track started yet"}
            </p>
            <SegmentBar segments={READINESS_SEGMENTS} filled={filledSegments(readiness)} />
          </div>
        )}
        {collapsed ? null : <SidebarInvite />}
        <NavLink item={HELP_NAV} active={helpActive} collapsed={collapsed} onNavigate={onNavigate} />

        <div className={cn("mt-1.5 border-t border-line pt-2", collapsed ? "flex w-full justify-center" : "")}>
          <AccountMenu
            {...account}
            triggerLabel="Account menu"
            side={collapsed ? "right" : "top"}
            align={collapsed ? "end" : "start"}
            trigger={
              collapsed ? (
                <button type="button" className={cn("flex h-10 w-10 items-center justify-center rounded-full", FOCUS)}>
                  <Orb seed={seed} size={30} />
                </button>
              ) : (
                <button
                  type="button"
                  className={cn("flex w-full items-center gap-2.5 rounded-[12px] p-2 text-left transition-colors duration-150 hover:bg-surface-2 data-[state=open]:bg-surface-2", FOCUS)}
                >
                  <Orb seed={seed} size={30} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-medium text-ink">{account.name}</span>
                    <span className="block truncate text-[12px] text-ink-3">{level ?? "Set your level"}</span>
                  </span>
                </button>
              )
            }
          />
        </div>
      </div>
    </div>
  );
}
