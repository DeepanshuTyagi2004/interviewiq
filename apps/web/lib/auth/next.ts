import { ROUTES } from "@/lib/constants/shared";

/** Survives the full-page Google OAuth round trip (same tab only). */
const NEXT_KEY = "iq-auth-next";

/**
 * Only same-origin paths are honoured for `?next=` — never an absolute URL, a protocol-relative
 * `//host`, or a backslash variant browsers normalise into one (`/\host`).
 */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return ROUTES.dashboard;
  return next;
}

/** Remember where to land after Google sign-in (called right before redirecting to Google). */
export function rememberNext(next: string | null | undefined): void {
  try {
    if (next) sessionStorage.setItem(NEXT_KEY, safeNextPath(next));
    else sessionStorage.removeItem(NEXT_KEY);
  } catch {
    // storage unavailable (private mode) — fall back to the dashboard
  }
}

/** Read and forget the remembered destination. */
export function consumeNext(): string | null {
  try {
    const next = sessionStorage.getItem(NEXT_KEY);
    sessionStorage.removeItem(NEXT_KEY);
    return next;
  } catch {
    return null;
  }
}
