"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useCurrentUser } from "@/lib/hooks/useCurrentUser";
import { ROUTES } from "@/lib/constants/shared";

/**
 * Onboarding gate for the app route group. Sits inside {@link RequireAuth}, so by the time it runs
 * the user is authenticated and {@code useCurrentUser} is enabled.
 *
 * - A user who hasn't finished onboarding is pushed to /onboarding (from any app route).
 * - A user who HAS finished is pushed off /onboarding to the dashboard.
 *
 * Fails open: if the /me lookup errors (no user, not loading) we render children rather than hang —
 * the worst case is a not-yet-onboarded user briefly seeing the app, never a bricked shell.
 */
export function OnboardingGate({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useCurrentUser();
  const pathname = usePathname();
  const router = useRouter();

  const onOnboarding =
    pathname === ROUTES.onboarding || pathname.startsWith(`${ROUTES.onboarding}/`);
  const mustOnboard = Boolean(user && !user.onboardingComplete && !onOnboarding);
  const alreadyDone = Boolean(user && user.onboardingComplete && onOnboarding);

  useEffect(() => {
    if (mustOnboard) router.replace(ROUTES.onboarding);
    else if (alreadyDone) router.replace(ROUTES.dashboard);
  }, [mustOnboard, alreadyDone, router]);

  if (isLoading || mustOnboard || alreadyDone) {
    return (
      <div className="flex min-h-[60vh] flex-1 items-center justify-center">
        <span
          className="h-5 w-5 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent"
          aria-hidden
        />
      </div>
    );
  }

  return <>{children}</>;
}
