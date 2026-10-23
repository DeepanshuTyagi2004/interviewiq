"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils/cn";
import { useAuth } from "@/lib/auth/AuthProvider";
import { ROUTES } from "@/lib/constants/shared";
import { levelLabel } from "@/lib/constants/engineering-levels";
import { useCurrentUser } from "@/lib/hooks/useCurrentUser";
import { useCandidateProfile } from "@/features/onboarding/hooks";
import { readinessSummary, trackStatus, useLoops } from "@/features/loops";
import { useHudScope } from "@/components/hud/scope";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AnnouncementStrip } from "./AnnouncementStrip";
import { BreadcrumbNamesContext } from "./Breadcrumbs";
import type { BreadcrumbNames } from "./breadcrumbs";
import { CommandMenu } from "./CommandMenu";
import { navFor, navGroupsFor } from "./nav";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { useSidebarCollapsed } from "./useSidebarCollapsed";
import { VerifyEmailBanner } from "./VerifyEmailBanner";

const SIDEBAR_ID = "app-sidebar";

/** The live interview screen: no shell shortcut may fire there (M, ⌘K, Esc). */
const LIVE_INTERVIEW_PATH = /^\/interviews\/[^/]+\/live(\/|$)/;
/** Screens that fill the whole content area instead of sitting in the padded 1180px column. */
const FULL_BLEED_PATH = /^\/(interviews\/[^/]+\/live|processes\/[^/]+)(\/|$)/;

/** Keys typed into a field, or into an open dropdown (its typeahead), aren't shell shortcuts. */
function ownsKeys(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) ||
    target.closest('[role="menu"]') !== null
  );
}

const DESKTOP_QUERY = "(min-width: 1024px)";

/** True at 1024px and wider (and where matchMedia is missing, as in tests). Follows resizes. */
function useIsDesktop(): boolean {
  const [desktop, setDesktop] = useState(true);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(DESKTOP_QUERY);
    const update = () => setDesktop(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return desktop;
}

/**
 * Signed-in shell: a 248px left sidebar (a 64px rail when collapsed, a sheet below 1024px), and
 * to its right an optional announcement strip, the sticky top bar, the email reminder and the
 * page. M toggles the sidebar (opens the sheet on phones), ⌘K / Ctrl+K opens search, Esc closes
 * the sheet. None of them fire on the live interview screen or while typing.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  useHudScope();
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const { logout } = useAuth();
  const { user, isAdmin } = useCurrentUser();
  const candidate = useCandidateProfile();
  const loops = useLoops();

  const [collapsed, setCollapsed] = useSidebarCollapsed();
  const desktop = useIsDesktop();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  // The width transition only runs for user toggles, not for the saved choice loading in.
  const [animate, setAnimate] = useState(false);
  const [names, setNames] = useState<BreadcrumbNames>({});

  const setBreadcrumbNames = useCallback((patch: BreadcrumbNames | null) => setNames(patch ?? {}), []);

  useEffect(() => {
    const id = requestAnimationFrame(() => setAnimate(true));
    return () => cancelAnimationFrame(id);
  }, []);
  // A page change closes the phone sheet.
  useEffect(() => setSheetOpen(false), [pathname]);

  const groups = useMemo(() => navGroupsFor(isAdmin), [isAdmin]);
  const searchItems = useMemo(() => navFor(isAdmin), [isAdmin]);
  const name = user?.name ?? candidate.data?.fullName ?? "Your account";
  const level = candidate.data?.level ? levelLabel(candidate.data.level) : null;
  // From your real tracks; the onboarding target role alone never reads as "active".
  const track = trackStatus(loops.data ?? [], candidate.data?.targetRole);
  const readiness = readinessSummary(loops.data ?? []);

  const inLiveInterview = LIVE_INTERVIEW_PATH.test(pathname);
  const fullBleed = FULL_BLEED_PATH.test(pathname);

  const toggleSidebar = useCallback(() => {
    if (desktop) setCollapsed(!collapsed);
    else setSheetOpen((o) => !o);
  }, [desktop, collapsed, setCollapsed]);

  // Keyboard: M toggles the sidebar, Esc closes the sheet, ⌘K / Ctrl+K toggles search.
  useEffect(() => {
    if (inLiveInterview) return;
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSheetOpen(false);
        setSearchOpen((o) => !o);
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || ownsKeys(e.target) || searchOpen) return;
      if (e.key === "Escape") setSheetOpen(false);
      else if (e.key === "m" || e.key === "M") toggleSidebar();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [searchOpen, inLiveInterview, toggleSidebar]);

  async function signOut() {
    setSheetOpen(false);
    await logout();
    router.replace(ROUTES.login);
  }

  const account = {
    name,
    email: user?.email,
    seed: user?.id,
    status: track.text,
    statusActive: track.active,
    isAdmin,
    onSignOut: () => void signOut(),
  };
  const openSearch = () => {
    setSheetOpen(false);
    setSearchOpen(true);
  };
  const sidebarProps = { groups, level, readiness, account: { ...account, onOpenSearch: openSearch, onToggleSidebar: toggleSidebar } };

  return (
    <TooltipProvider delayDuration={150}>
      <BreadcrumbNamesContext.Provider value={setBreadcrumbNames}>
        <div className="flex h-dvh overflow-hidden text-foreground">
          <aside
            id={SIDEBAR_ID}
            aria-label="Sidebar"
            className={cn(
              "iq-glass hidden h-full flex-none overflow-hidden lg:block",
              collapsed ? "w-16" : "w-[248px]",
              animate && "transition-[width] duration-200 ease-iq motion-reduce:transition-none",
            )}
          >
            <Sidebar {...sidebarProps} collapsed={collapsed} />
          </aside>

          <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
            <SheetContent side="left" className="w-[280px] max-w-[85vw] rounded-r-card p-0 sm:max-w-[280px] lg:hidden [&>button]:right-3 [&>button]:top-4">
              <SheetTitle className="sr-only">Menu</SheetTitle>
              <SheetDescription className="sr-only">Navigate InterviewIQ</SheetDescription>
              <Sidebar {...sidebarProps} onNavigate={() => setSheetOpen(false)} />
            </SheetContent>
          </Sheet>

          <div className="relative isolate flex min-w-0 flex-1 flex-col overflow-y-auto">
            <div aria-hidden className="iq-app-wash" />
            <AnnouncementStrip />
            <TopBar
              pathname={pathname}
              names={names}
              sidebarId={SIDEBAR_ID}
              sidebarExpanded={desktop ? !collapsed : sheetOpen}
              onToggleSidebar={toggleSidebar}
              onOpenSearch={openSearch}
              account={account}
            />
            {user?.hasPassword && user.emailVerified === false ? <VerifyEmailBanner email={user.email} /> : null}

            <main
              id="main"
              className={cn(
                "flex flex-1 flex-col",
                fullBleed
                  ? "min-h-0 overflow-y-auto"
                  : "mx-auto w-full max-w-[1180px] px-5 py-7 sm:px-9 sm:py-9",
              )}
            >
              {children}
            </main>
          </div>
        </div>

        <CommandMenu open={searchOpen} onOpenChange={setSearchOpen} items={searchItems} />
      </BreadcrumbNamesContext.Provider>
    </TooltipProvider>
  );
}
