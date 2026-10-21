"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client/client";
import { useAuth } from "@/lib/auth/AuthProvider";
import { USER_ENDPOINTS } from "@/lib/constants/shared";
import type { components } from "@/lib/api-client/generated/schema";

export type Role = components["schemas"]["Role"];

/** GET /api/v1/users/me — generated from the contract (incl. onboardingComplete, emailVerified, hasPassword). */
export type CurrentUser = components["schemas"]["CurrentUser"];

/** Only candidates and admins may book, reschedule, retry prep or join interviews. */
export function canInterviewRole(role: Role | undefined | null): boolean {
  return role === "CANDIDATE" || role === "ADMIN";
}

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
    // false while the user is still loading, so no action flashes on before we know
    canInterview: canInterviewRole(query.data?.role),
    // true only once the user has loaded and has no interview access: show the "ask an admin" note only then
    interviewBlocked: query.data !== undefined && !canInterviewRole(query.data.role),
    // true only while actually fetching (disabled query reports not-loading in v5)
    isLoading: query.isLoading && isAuthenticated,
  };
}
