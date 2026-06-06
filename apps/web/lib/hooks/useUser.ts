"use client";

import { useAuth } from "@/lib/auth/AuthProvider";

/**
 * Thin compatibility wrapper over useAuth.
 *
 * `user` is intentionally null for now — there is no /me endpoint yet (user
 * display was deferred). When the backend exposes current-user data, fetch it
 * here (e.g. via TanStack Query) and populate `user`.
 */
export function useUser() {
  const { isAuthenticated, isLoading } = useAuth();
  return {
    user: null,
    isLoading,
    isAuthenticated,
  };
}
