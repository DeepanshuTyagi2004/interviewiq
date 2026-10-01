"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client/client";
import { useAuth } from "@/lib/auth/AuthProvider";
import { USER_ENDPOINTS } from "@/lib/constants/shared";
import type { components } from "@/lib/api-client/generated/schema";

export type Role = components["schemas"]["Role"];

/** GET /api/v1/users/me — generated from the contract (incl. onboardingComplete, emailVerified, hasPassword). */
export type CurrentUser = components["schemas"]["CurrentUser"];

/**
 * The authenticated user's profile incl. role. Fetched once authenticated (the
 * access token is set), cached for the session. Drives admin-only UI: the
 * intelligence nav item and the RequireAdmin gate.
 */
export function useCurrentUser() {
  const { isAuthenticated } = useAuth();
  const query = useQuery<CurrentUser>({
    queryKey: ["auth", "me"],
    queryFn: () => apiFetch<CurrentUser>(USER_ENDPOINTS.me),
    enabled: isAuthenticated,
    staleTime: 5 * 60_000,
  });

  return {
    user: query.data ?? null,
    isAdmin: query.data?.role === "ADMIN",
    // true only while actually fetching (disabled query reports not-loading in v5)
    isLoading: query.isLoading && isAuthenticated,
  };
}
