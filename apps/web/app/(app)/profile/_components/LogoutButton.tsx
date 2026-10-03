"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { useAuth } from "@/lib/auth/AuthProvider";
import { ROUTES } from "@/lib/constants/shared";

/** Same sign-out as the app menu, presented as a HUD action beneath the profile cards. */
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
      aria-busy={pending}
      className="flex w-full items-center justify-center gap-2 rounded-[14px] border border-line-2 bg-card px-4 py-3 text-[13.5px] font-medium text-foreground shadow-float transition-colors hover:border-destructive/40 hover:bg-destructive/5 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-progress disabled:opacity-60 sm:w-auto sm:self-start"
    >
      <LogOut aria-hidden className="h-4 w-4 shrink-0" />
      {pending ? "Logging out…" : "Log out"}
    </button>
  );
}
