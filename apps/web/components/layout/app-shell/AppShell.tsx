"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils/cn";
import { useAuth } from "@/lib/auth/AuthProvider";
import { ROUTES } from "@/lib/constants/shared";
import { useCurrentUser } from "@/lib/hooks/useCurrentUser";
import { useCandidateProfile } from "@/features/onboarding/hooks";
import { AppMenu } from "./AppMenu";
import { AppTopBar } from "./AppTopBar";
import { CommandMenu } from "./CommandMenu";
import { navFor, titleForPath } from "./nav";
import { VerifyEmailBanner } from "./VerifyEmailBanner";

const MENU_ID = "app-menu";
/** Card slides right (never further than leaves a sliver on phones) and shrinks to reveal the menu. */
const CARD_OPEN = "translate(min(300px, calc(100vw - 88px)), 7%) scale(0.84)";
const GHOST_OPEN = "translate(min(262px, calc(100vw - 118px)), 13%) scale(0.74)";

/** Keys typed into a field, or into an open dropdown (its typeahead), aren't shell shortcuts. */
function ownsKeys(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) ||
    target.closest('[role="menu"]') !== null
  );
}

/**
 * Signed-in shell from the design: a top bar on the grey frame (menu toggle, current screen,
 * search, account menu) and the page in a rounded card below it. The menu lives *behind* the
 * card — the 4-dot button (or the M key) slides the card aside to reveal it; clicking the card or
 * pressing Esc brings it back. ⌘K / Ctrl+K opens search.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { logout } = useAuth();
  const { user, isAdmin } = useCurrentUser();
  const candidate = useCandidateProfile();

  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const menuRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

  const items = navFor(isAdmin);
  const name = user?.name ?? candidate.data?.fullName ?? "Your account";
  const status = candidate.data?.targetRole ? `Active · ${candidate.data.targetRole}` : "Active";

  const closeMenu = useCallback(() => setMenuOpen(false), []);

  // Keyboard: M toggles the menu, Esc closes it, ⌘K / Ctrl+K toggles search.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setMenuOpen(false);
        setSearchOpen((o) => !o);
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || ownsKeys(e.target) || searchOpen) return;
      if (e.key === "Escape") setMenuOpen(false);
      else if (e.key === "m" || e.key === "M") setMenuOpen((o) => !o);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [searchOpen]);

  // Focus follows the menu: into the first link on open, back to the toggle on close.
  useEffect(() => {
    if (menuOpen) {
      menuRef.current?.querySelector<HTMLElement>("a[href]")?.focus({ preventScroll: true });
    } else if (wasOpen.current) {
      menuButtonRef.current?.focus({ preventScroll: true });
    }
    wasOpen.current = menuOpen;
  }, [menuOpen]);

  async function signOut() {
    setMenuOpen(false);
    await logout();
    router.replace(ROUTES.login);
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-frame text-foreground">
      <AppTopBar
        ref={menuButtonRef}
        title={titleForPath(pathname)}
        menuId={MENU_ID}
        menuOpen={menuOpen}
        onToggleMenu={() => setMenuOpen((o) => !o)}
        onOpenSearch={() => {
          setMenuOpen(false);
          setSearchOpen(true);
        }}
        account={{ name, email: user?.email, status, isAdmin, onSignOut: () => void signOut() }}
      />

      <div className="relative mx-2 mb-2 min-h-0 flex-1 overflow-hidden rounded-[14px] sm:mx-3 sm:mb-3">
        <AppMenu
          ref={menuRef}
          id={MENU_ID}
          open={menuOpen}
          items={items}
          name={name}
          status={status}
          onNavigate={closeMenu}
          onSignOut={() => void signOut()}
        />

        {/* A second, fainter card trailing behind the first — depth while the menu is open. */}
        <div
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-0 z-[1] origin-top-left rounded-[22px] bg-card transition-[transform,opacity] duration-700 ease-[cubic-bezier(.7,0,.2,1)] motion-reduce:transition-none",
            menuOpen ? "opacity-35" : "opacity-0",
          )}
          style={{ transform: menuOpen ? GHOST_OPEN : "none" }}
        />

        <div
          inert={menuOpen}
          className={cn(
            "absolute inset-0 z-[2] flex origin-top-left flex-col overflow-hidden border border-line-3 bg-card transition-[transform,border-radius,box-shadow] duration-700 ease-[cubic-bezier(.7,0,.2,1)] motion-reduce:transition-none",
            menuOpen
              ? "rounded-[26px] shadow-[0_50px_100px_-20px_rgba(0,0,0,.28)] dark:shadow-[0_50px_100px_-20px_rgba(0,0,0,.7)]"
              : "rounded-[14px]",
          )}
          style={{ transform: menuOpen ? CARD_OPEN : "none" }}
        >
          {user?.hasPassword && user.emailVerified === false ? <VerifyEmailBanner email={user.email} /> : null}

          <main id="main" className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            {children}
          </main>
        </div>

        {/* While the menu is open the whole card is one big "close" target. */}
        {menuOpen ? (
          <button
            type="button"
            aria-label="Close menu"
            onClick={closeMenu}
            className="absolute inset-0 z-[3] origin-top-left cursor-pointer rounded-[26px] focus-visible:outline-none"
            style={{ transform: CARD_OPEN }}
          />
        ) : null}
      </div>

      <CommandMenu open={searchOpen} onOpenChange={setSearchOpen} items={items} />
    </div>
  );
}
