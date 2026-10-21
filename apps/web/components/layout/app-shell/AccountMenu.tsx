"use client";

import { useRef, type ReactNode } from "react";
import Link from "next/link";
import {
  Activity,
  Bell,
  CreditCard,
  Keyboard,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Orb, StatusDot } from "@/components/ds";
import { useThemeSwitch, type AppTheme } from "@/components/layout/useThemeSwitch";
import { ROUTES } from "@/lib/constants/shared";
import { cn } from "@/lib/utils/cn";

interface LinkEntry {
  label: string;
  href: string;
  icon: LucideIcon;
}

const YOU: LinkEntry[] = [
  { label: "Profile", href: ROUTES.profile, icon: UserRound },
  { label: "Connected sources", href: ROUTES.connections, icon: Link2 },
  { label: "Your interviews", href: ROUTES.interviews, icon: Mic },
];

const SETTINGS: LinkEntry[] = [
  { label: "Account", href: ROUTES.settings.account, icon: UserCog },
  { label: "Notifications", href: ROUTES.settings.notifications, icon: Bell },
  { label: "Privacy & data", href: ROUTES.settings.privacy, icon: ShieldCheck },
  { label: "Billing & plan", href: ROUTES.settings.billing, icon: CreditCard },
];

const SUPPORT: LinkEntry[] = [
  { label: "Help & FAQ", href: ROUTES.help, icon: LifeBuoy },
  { label: "Share an interview experience", href: ROUTES.shareExperience, icon: Send },
];

const THEMES: { value: AppTheme; label: string; icon: LucideIcon }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
];

const panel = "rounded-tile border-0 bg-popover p-1.5 shadow-float";
const item =
  "cursor-pointer gap-3 rounded-[10px] px-2.5 py-[7px] text-[13.5px] focus:bg-surface-2 focus:text-ink data-[state=open]:bg-surface-2 [&_svg]:text-ink-3 focus:[&_svg]:text-ink";
const groupLabel = "px-2.5 pb-1 pt-2 text-[12px] font-normal text-ink-3";
const separator = "-mx-1.5 my-1.5 bg-line";
const kbd = "ml-auto rounded-md border border-line px-1.5 py-0.5 font-mono text-[10.5px] leading-none text-ink-3";

export interface AccountMenuProps {
  name: string;
  email?: string;
  /** Secondary line, e.g. "Active track · Meesho · SDE I". */
  status: string;
  /** Lights the status dot; only true while a track is active. */
  statusActive?: boolean;
  isAdmin: boolean;
  /** Seeds the orb (the user id); the name when absent. */
  seed?: string;
  onOpenSearch: () => void;
  onToggleSidebar: () => void;
  onSignOut: () => void;
  /** Replaces the default avatar button (the sidebar's account row). Must be a single focusable element. */
  trigger?: ReactNode;
  /** Accessible name of the trigger. */
  triggerLabel?: string;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
}

/**
 * The account dropdown (top bar avatar and the sidebar's account row): who's signed in, quick links to their profile and settings, theme and
 * keyboard shortcuts, help, and sign out.
 */
export function AccountMenu({
  name,
  email,
  status,
  statusActive = false,
  isAdmin,
  seed,
  onOpenSearch,
  onToggleSidebar,
  onSignOut,
  trigger,
  triggerLabel = "Account menu",
  side = "bottom",
  align = "end",
}: AccountMenuProps) {
  const { theme, switchTo } = useThemeSwitch();
  // Actions that move focus elsewhere (search, the side menu) run once the dropdown has closed,
  // so its focus-return to the avatar doesn't steal focus straight back.
  const afterClose = useRef<(() => void) | null>(null);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        asChild={trigger != null}
        aria-label={triggerLabel}
        className={
          trigger != null
            ? undefined
            : "flex h-9 w-9 flex-none items-center justify-center rounded-full outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-background data-[state=open]:ring-2 data-[state=open]:ring-ink data-[state=open]:ring-offset-2 data-[state=open]:ring-offset-background"
        }
      >
        {trigger ?? <Orb seed={seed ?? name} size={34} />}
      </DropdownMenuTrigger>

      <DropdownMenuContent
        side={side}
        align={align}
        sideOffset={10}
        collisionPadding={12}
        className={cn("w-[288px]", panel)}
        onCloseAutoFocus={(e) => {
          const run = afterClose.current;
          if (!run) return;
          e.preventDefault();
          afterClose.current = null;
          run();
        }}
      >
        <div className="flex items-center gap-3 px-2.5 pb-3 pt-2.5">
          <Orb seed={seed ?? name} size={40} />
          <div className="min-w-0 flex-1">
            <p className="m-0 flex items-center gap-2 text-sm font-medium tracking-[-0.01em]">
              <span className="truncate">{name}</span>
              {isAdmin ? (
                <span className="flex-none rounded-full bg-surface-2 px-2 py-px text-[11px] font-medium text-ink-2">
                  Admin
                </span>
              ) : null}
            </p>
            {email ? <p className="m-0 mt-0.5 truncate text-xs text-ink-3">{email}</p> : null}
          </div>
        </div>
        <p className="m-0 mx-1 mb-1 rounded-[10px] bg-surface px-2.5 py-2 text-xs text-ink-2">
          <StatusDot state={statusActive ? "active" : "idle"} label={<span className="truncate">{status}</span>} className="max-w-full" />
        </p>

        <DropdownMenuSeparator className={separator} />
        <DropdownMenuGroup>
          {YOU.map((entry) => (
            <LinkItem key={entry.href} entry={entry} />
          ))}
        </DropdownMenuGroup>

        <DropdownMenuSeparator className={separator} />
        <DropdownMenuGroup>
          <DropdownMenuLabel className={groupLabel}>Settings</DropdownMenuLabel>
          {SETTINGS.map((entry) => (
            <LinkItem key={entry.href} entry={entry} />
          ))}
        </DropdownMenuGroup>

        <DropdownMenuSeparator className={separator} />
        <DropdownMenuGroup>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className={item}>
              {theme === "dark" ? <Moon aria-hidden strokeWidth={1.6} /> : <Sun aria-hidden strokeWidth={1.6} />}
              Theme
              <span className="ml-auto text-xs capitalize text-ink-3">{theme}</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent sideOffset={8} className={cn("w-[168px]", panel)}>
              <DropdownMenuRadioGroup value={theme} onValueChange={(v) => switchTo(v as AppTheme)}>
                {THEMES.map((t) => (
                  <DropdownMenuRadioItem
                    key={t.value}
                    value={t.value}
                    className="cursor-pointer gap-3 rounded-[10px] py-[7px] text-[13.5px] focus:bg-surface-2 focus:text-ink [&>span>svg]:text-ink"
                  >
                    <t.icon aria-hidden strokeWidth={1.6} className="h-4 w-4 text-ink-3" />
                    {t.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className={item}>
              <Keyboard aria-hidden strokeWidth={1.6} />
              Keyboard shortcuts
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent sideOffset={8} className={cn("w-[244px]", panel)}>
              <DropdownMenuItem className={item} onSelect={() => {
                  afterClose.current = onOpenSearch;
                }}>
                Search
                <kbd className={kbd}>⌘K</kbd>
              </DropdownMenuItem>
              <DropdownMenuItem className={item} onSelect={() => {
                  afterClose.current = onToggleSidebar;
                }}>
                Toggle sidebar
                <kbd className={kbd}>M</kbd>
              </DropdownMenuItem>
              <DropdownMenuItem disabled className={cn(item, "data-[disabled]:opacity-100")}>
                <span className="text-ink-3">Close menu or search</span>
                <kbd className={kbd}>Esc</kbd>
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuGroup>

        <DropdownMenuSeparator className={separator} />
        <DropdownMenuGroup>
          {SUPPORT.map((entry) => (
            <LinkItem key={entry.href} entry={entry} />
          ))}
        </DropdownMenuGroup>

        {isAdmin ? (
          <>
            <DropdownMenuSeparator className={separator} />
            <DropdownMenuGroup>
              <DropdownMenuLabel className={groupLabel}>Admin</DropdownMenuLabel>
              <LinkItem entry={{ label: "Intelligence", href: ROUTES.intelligence, icon: Activity }} />
              <LinkItem entry={{ label: "Validation controls", href: ROUTES.admin.settings, icon: ShieldCheck }} />
            </DropdownMenuGroup>
          </>
        ) : null}

        <DropdownMenuSeparator className={separator} />
        <DropdownMenuItem className={item} onSelect={onSignOut}>
          <LogOut aria-hidden strokeWidth={1.6} />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function LinkItem({ entry }: { entry: LinkEntry }) {
  return (
    <DropdownMenuItem asChild className={item}>
      <Link href={entry.href}>
        <entry.icon aria-hidden strokeWidth={1.6} />
        {entry.label}
      </Link>
    </DropdownMenuItem>
  );
}
