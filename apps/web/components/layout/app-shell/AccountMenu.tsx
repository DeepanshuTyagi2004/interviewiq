"use client";

import { useRef } from "react";
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
import { useThemeSwitch, type AppTheme } from "@/components/layout/useThemeSwitch";
import { ROUTES } from "@/lib/constants/shared";
import { cn } from "@/lib/utils/cn";
import { initialsOf } from "@/lib/utils/format";

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

const panel =
  "rounded-[16px] border-line-2 bg-popover p-1.5 shadow-[0_24px_60px_-24px_rgba(0,0,0,.35)] dark:shadow-[0_24px_60px_-24px_rgba(0,0,0,.8)]";
const item =
  "cursor-pointer gap-3 rounded-md px-2.5 py-[7px] text-[13.5px] focus:bg-foreground/[0.06] focus:text-foreground data-[state=open]:bg-foreground/[0.06] [&_svg]:text-muted-foreground focus:[&_svg]:text-foreground";
const groupLabel = "px-2.5 pb-1 pt-2 font-mono text-[9.5px] font-normal uppercase tracking-[0.08em] text-faint";
const separator = "-mx-1.5 my-1.5 bg-line-2";
const kbd = "ml-auto rounded border border-line-3 px-1.5 py-0.5 font-mono text-[10.5px] leading-none text-faint";

export interface AccountMenuProps {
  name: string;
  email?: string;
  /** Secondary line, e.g. "Active · Meesho SDE I". */
  status: string;
  isAdmin: boolean;
  onOpenSearch: () => void;
  onToggleMenu: () => void;
  onSignOut: () => void;
}

/**
 * The avatar's dropdown: who's signed in, quick links to their profile and settings, theme and
 * keyboard shortcuts, help, and sign out.
 */
export function AccountMenu({
  name,
  email,
  status,
  isAdmin,
  onOpenSearch,
  onToggleMenu,
  onSignOut,
}: AccountMenuProps) {
  const { theme, switchTo } = useThemeSwitch();
  // Actions that move focus elsewhere (search, the side menu) run once the dropdown has closed,
  // so its focus-return to the avatar doesn't steal focus straight back.
  const afterClose = useRef<(() => void) | null>(null);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Account menu"
        className="ml-1 flex h-[34px] w-[34px] flex-none items-center justify-center rounded-full bg-brand text-[12.5px] text-brand-foreground transition-[background-color,box-shadow] hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card data-[state=open]:ring-2 data-[state=open]:ring-brand/35 data-[state=open]:ring-offset-2 data-[state=open]:ring-offset-card"
      >
        {initialsOf(name)}
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="end"
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
          <span
            aria-hidden
            className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-brand text-sm font-medium text-brand-foreground"
          >
            {initialsOf(name)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="m-0 flex items-center gap-2 text-sm font-medium tracking-[-0.01em]">
              <span className="truncate">{name}</span>
              {isAdmin ? (
                <span className="flex-none rounded border border-line-3 px-1.5 py-px font-mono text-[9.5px] uppercase tracking-[0.08em] text-muted-foreground">
                  Admin
                </span>
              ) : null}
            </p>
            {email ? <p className="m-0 mt-0.5 truncate text-xs text-muted-foreground">{email}</p> : null}
          </div>
        </div>
        <p className="m-0 mx-1 mb-1 flex items-center gap-2 rounded-md bg-foreground/[0.05] px-2.5 py-2 text-xs text-muted-foreground">
          <span aria-hidden className="h-1.5 w-1.5 flex-none rounded-full bg-brand" />
          <span className="truncate">{status}</span>
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
              <span className="ml-auto text-xs capitalize text-faint">{theme}</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent sideOffset={8} className={cn("w-[168px]", panel)}>
              <DropdownMenuRadioGroup value={theme} onValueChange={(v) => switchTo(v as AppTheme)}>
                {THEMES.map((t) => (
                  <DropdownMenuRadioItem
                    key={t.value}
                    value={t.value}
                    className="cursor-pointer gap-3 rounded-md py-[7px] text-[13.5px] focus:bg-foreground/[0.06] focus:text-foreground [&>span>svg]:text-brand"
                  >
                    <t.icon aria-hidden strokeWidth={1.6} className="h-4 w-4 text-muted-foreground" />
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
                  afterClose.current = onToggleMenu;
                }}>
                Open menu
                <kbd className={kbd}>M</kbd>
              </DropdownMenuItem>
              <DropdownMenuItem disabled className={cn(item, "data-[disabled]:opacity-100")}>
                <span className="text-muted-foreground">Close menu or search</span>
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
