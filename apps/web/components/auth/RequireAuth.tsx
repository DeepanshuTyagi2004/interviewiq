"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth/AuthProvider";
import { ROUTES } from "@/lib/constants/routes";

/**
 * Client-side auth gate for protected route groups.
 *
 * The access token lives in memory, so Next.js middleware can't see it — gating
 * happens here instead. While the initial silent refresh is in flight we render
 * a spinner; if it resolves unauthenticated we redirect to /login with a `next`
 * param so the user returns to where they were after signing in.
 */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { status } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (status === "unauthenticated") {
      const next = encodeURIComponent(pathname);
      router.replace(`${ROUTES.login}?next=${next}`);
    }
  }, [status, pathname, router]);

  if (status !== "authenticated") {
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
