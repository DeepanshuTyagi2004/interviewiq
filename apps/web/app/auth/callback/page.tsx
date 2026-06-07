"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth/AuthProvider";
import { ROUTES } from "@/lib/constants/routes";

/**
 * OAuth landing page. The backend redirects here after setting the httpOnly
 * refresh-token cookie. AuthProvider (mounted at the root) runs a silent
 * refresh on mount, which consumes that cookie. We just wait for the resulting
 * auth status and route accordingly.
 */
export default function AuthCallbackPage() {
  return (
    <Suspense fallback={<CallbackSpinner />}>
      <AuthCallbackInner />
    </Suspense>
  );
}

function AuthCallbackInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { status } = useAuth();

  useEffect(() => {
    if (status === "authenticated") {
      const next = params.get("next");
      router.replace(next && next.startsWith("/") ? next : ROUTES.dashboard);
    } else if (status === "unauthenticated") {
      router.replace(`${ROUTES.login}?error=oauth`);
    }
  }, [status, params, router]);

  return <CallbackSpinner />;
}

function CallbackSpinner() {
  return (
    <main className="flex min-h-[60vh] flex-1 items-center justify-center">
      <div className="flex flex-col items-center gap-4 text-muted-foreground">
        <span
          className="h-6 w-6 animate-spin rounded-full border-2 border-current border-t-transparent"
          aria-hidden
        />
        <p role="status" className="font-mono text-xs uppercase tracking-[0.08em]">
          Signing you in…
        </p>
      </div>
    </main>
  );
}
