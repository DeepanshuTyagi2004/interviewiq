"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth/AuthProvider";
import { ROUTES } from "@/lib/constants/shared";

/**
 * Client-side auth gate for protected route groups.
 *
 * The access token lives in memory, so Next.js middleware can't see it — gating
 * happens here instead. While the initial silent refresh is in flight we render
 * a spinner; if it resolves unauthenticated we redirect to /login with a `next`
 * param so the user returns to where they were after signing in. If the API can't be reached the
 * provider keeps retrying, and after a few seconds the spinner says so.
 */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { status } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    if (status !== "loading") return;
    const timer = setTimeout(() => setSlow(true), 6_000);
    return () => clearTimeout(timer);
  }, [status]);

  useEffect(() => {
    if (status === "unauthenticated") {
      const next = encodeURIComponent(pathname);
      router.replace(`${ROUTES.login}?next=${next}`);
    }
  }, [status, pathname, router]);

  if (status !== "authenticated") {
    return (
      <div className="flex min-h-[calc(60vh/var(--hud-zoom,1))] flex-1 flex-col items-center justify-center gap-3">
        <span
          className="h-5 w-5 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent"
          aria-hidden
        />
        {slow && status === "loading" ? (
          <p role="status" className="m-0 text-[13px] text-muted-foreground">
            Still connecting to InterviewIQ. We&apos;ll keep trying.
          </p>
        ) : null}
      </div>
    );
  }

  return <>{children}</>;
}
