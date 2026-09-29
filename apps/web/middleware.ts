import { NextResponse, type NextRequest } from "next/server";

/**
 * Auth gating is handled client-side (see components/auth/RequireAuth.tsx),
 * because the access token lives in memory and the refresh cookie is scoped to
 * `/api/v1/auth` — neither is visible to middleware. This middleware is a
 * pass-through kept as a hook point for future edge concerns (headers, locale,
 * redirects). Remove the file entirely if it stays empty.
 */
export function middleware(_req: NextRequest) {
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|images|icons|fonts).*)"],
};
