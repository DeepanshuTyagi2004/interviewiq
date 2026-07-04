"use client";

import { useAuth } from "@/lib/auth/AuthProvider";
import { useCurrentUser } from "@/lib/hooks/useCurrentUser";
import { EmptyState } from "@/components/patterns";

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
      <div className="flex min-h-[60vh] flex-1 items-center justify-center">
        <span
          className="h-5 w-5 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent"
          aria-hidden
        />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="flex-1 p-6">
        <EmptyState
          title="Admins only"
          hint="You don't have access to this area. Ask an administrator to grant you the admin role."
        />
      </div>
    );
  }

  return <>{children}</>;
}
