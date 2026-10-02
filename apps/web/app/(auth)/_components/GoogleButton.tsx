"use client";

import { useAuth } from "@/lib/auth/AuthProvider";

/** Hands off to the backend's Google OAuth flow; returns to `next` afterwards. */
export function GoogleButton({ next }: { next?: string | null }) {
  const { login, status } = useAuth();
  return (
    <button
      type="button"
      onClick={() => login(next)}
      disabled={status === "loading"}
      className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-[5px] border border-line-3 bg-card text-[13.5px] text-foreground transition-colors hover:border-faint-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
    >
      <GoogleGlyph />
      Continue with Google
    </button>
  );
}

/** Monochrome Google "G" — inherits currentColor (no brand hues). */
function GoogleGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden fill="currentColor">
      <path d="M12 11v2.8h3.97c-.16 1.03-1.18 3.02-3.97 3.02-2.39 0-4.34-1.98-4.34-4.42S9.61 7.98 12 7.98c1.36 0 2.27.58 2.79 1.08l1.9-1.83C15.47 6.09 13.9 5.4 12 5.4 8.13 5.4 5 8.53 5 12.4s3.13 7 7 7c4.04 0 6.72-2.84 6.72-6.84 0-.46-.05-.81-.11-1.16H12Z" />
    </svg>
  );
}

/** "or" divider between Google and the email form. */
export function OrDivider() {
  return (
    <div className="flex items-center gap-3 text-xs text-faint" role="separator">
      <span aria-hidden className="h-px flex-1 bg-line-2" />
      or
      <span aria-hidden className="h-px flex-1 bg-line-2" />
    </div>
  );
}
