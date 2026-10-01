"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth/AuthProvider";
import { ROUTES } from "@/lib/constants/shared";

/** Only same-origin paths are honoured for `?next=` — never an absolute or protocol-relative URL. */
export function safeNextPath(next: string | null): string {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : ROUTES.dashboard;
}

/** An already signed-in visitor on an auth page goes straight to `to`. */
export function useRedirectWhenSignedIn(to: string) {
  const router = useRouter();
  const { status } = useAuth();
  useEffect(() => {
    if (status === "authenticated") router.replace(to);
  }, [status, router, to]);
}
