"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth/AuthProvider";
import { ROUTES } from "@/lib/constants/routes";

export default function LoginPage() {
  return (
    <Suspense fallback={<section className="w-full" />}>
      <LoginContent />
    </Suspense>
  );
}

function LoginContent() {
  const router = useRouter();
  const params = useSearchParams();
  const { status, login } = useAuth();

  // Already signed in → bounce to the app.
  useEffect(() => {
    if (status === "authenticated") {
      router.replace(ROUTES.dashboard);
    }
  }, [status, router]);

  const error = params.get("error");

  return (
    <section className="w-full">
      <div className="rounded-xl border border-border bg-card p-8 shadow-sm">
        <div className="mb-8 text-center">
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            Sign in to InterviewIQ
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Practice interviews with an AI interviewer.
          </p>
        </div>

        {error ? (
          <p className="mb-4 flex items-center justify-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-center text-sm text-destructive">
            <span
              aria-hidden
              className="h-1.5 w-1.5 shrink-0 rounded-full bg-destructive"
            />
            Sign-in failed. Please try again.
          </p>
        ) : null}

        <button
          type="button"
          onClick={login}
          disabled={status === "loading"}
          className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-border bg-background px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
        >
          <GoogleGlyph />
          Continue with Google
        </button>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          By continuing you agree to our Terms and Privacy Policy.
        </p>
      </div>
    </section>
  );
}

/** Monochrome Google "G" — inherits the button's currentColor (no brand hues). */
function GoogleGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden fill="currentColor">
      <path d="M12 11v2.8h3.97c-.16 1.03-1.18 3.02-3.97 3.02-2.39 0-4.34-1.98-4.34-4.42S9.61 7.98 12 7.98c1.36 0 2.27.58 2.79 1.08l1.9-1.83C15.47 6.09 13.9 5.4 12 5.4 8.13 5.4 5 8.53 5 12.4s3.13 7 7 7c4.04 0 6.72-2.84 6.72-6.84 0-.46-.05-.81-.11-1.16H12Z" />
    </svg>
  );
}
