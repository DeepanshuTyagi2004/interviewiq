"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { useAuth } from "@/lib/auth/AuthProvider";
import { ROUTES } from "@/lib/constants/shared";

/** Same sign-out as the app menu, presented as a quiet pill beneath the profile cards. */
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
      className="flex h-10 w-full items-center justify-center gap-2 rounded-full bg-background px-[18px] text-sm font-medium text-foreground shadow-ring transition-colors duration-150 hover:bg-surface hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-progress disabled:opacity-60 sm:w-auto sm:self-start"
    >
      <LogOut aria-hidden className="h-4 w-4 shrink-0" />
      {pending ? "Logging out…" : "Log out"}
    </button>
  );
}
