"use client";

import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth/AuthProvider";
import { ROUTES } from "@/lib/constants/shared";

/** Quiet escape hatch from onboarding — the only way out before it's finished. */
export function SignOutButton() {
  const { logout } = useAuth();
  const router = useRouter();

  async function handleClick() {
    await logout();
    router.replace(ROUTES.login);
  }

  return (
    <button
      type="button"
      onClick={() => void handleClick()}
      className="rounded-[5px] px-2.5 py-2 text-sm text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      Sign out
    </button>
  );
}
