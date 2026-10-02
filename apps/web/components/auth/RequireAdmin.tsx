"use client";

import { useAuth } from "@/lib/auth/AuthProvider";
import { useCurrentUser } from "@/lib/hooks/useCurrentUser";
import { HudCard, HudEmpty } from "@/components/hud";
import { PAGE_SCAFFOLD } from "@/components/layout/page";

/**
 * Admin-only gate. Sits inside a route group that already enforces RequireAuth, so
 * by the time this renders the user is authenticated — we only resolve the role.
 * While the role is loading we show a spinner; non-admins get a quiet denial.
 */
export function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { status } = useAuth();
  const { isAdmin, isLoading } = useCurrentUser();

  if (status === "loading" || isLoading) {
    return (
      <div className="flex min-h-[calc(60vh/var(--hud-zoom,1))] flex-1 items-center justify-center">
        <span
          className="h-5 w-5 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent"
          aria-hidden
        />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className={PAGE_SCAFFOLD}>
        <HudCard aria-label="Admins only">
          <HudEmpty
            tag="Restricted"
            title="Admins only"
            hint="You don't have access to this area. Ask an administrator to grant you the admin role."
          />
        </HudCard>
      </div>
    );
  }

  return <>{children}</>;
}
