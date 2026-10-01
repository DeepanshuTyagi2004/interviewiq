"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth/AuthProvider";
import { ROUTES } from "@/lib/constants/shared";

/** The design's quiet "Log out" link under the profile cards. Same sign-out as the app menu. */
export function LogoutButton() {
  const { logout } = useAuth();
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function signOut() {
    setPending(true);
    await logout();
    router.replace(ROUTES.login);
  }

  return (
    <button
      type="button"
      onClick={() => void signOut()}
      disabled={pending}
      className="self-start rounded-sm text-[13.5px] text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-60"
    >
      {pending ? "Logging out…" : "Log out"}
    </button>
  );
}
