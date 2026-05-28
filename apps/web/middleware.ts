import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth/config";

const APP_PREFIXES = [
  "/dashboard",
  "/practice",
  "/leaderboard",
  "/help",
  "/onboarding",
  "/profile",
  "/jobs",
  "/loops",
  "/interviews",
  "/settings",
];

const ADMIN_PREFIXES = ["/admin"];

function matches(pathname: string, prefixes: string[]): boolean {
  return prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const needsAppAuth = matches(pathname, APP_PREFIXES);
  const needsAdmin = matches(pathname, ADMIN_PREFIXES);

  if (!needsAppAuth && !needsAdmin) {
    return NextResponse.next();
  }

  const session = await auth();
  if (!session?.user) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // TODO: enforce admin role check once role is on the session
  // if (needsAdmin && session.user.role !== "admin") {
  //   return NextResponse.redirect(new URL("/dashboard", req.url));
  // }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|images|icons|fonts).*)"],
};
