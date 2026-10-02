"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth/AuthProvider";

export { safeNextPath } from "@/lib/auth/next";

/** An already signed-in visitor on an auth page goes straight to `to`. */
export function useRedirectWhenSignedIn(to: string) {
  const router = useRouter();
  const { status } = useAuth();
  useEffect(() => {
    if (status === "authenticated") router.replace(to);
  }, [status, router, to]);
}
