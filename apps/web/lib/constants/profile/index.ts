/**
 * Constants for the Profile module. One grouped `as const` object per category;
 * import per group, e.g. `import { PROFILE_ENDPOINTS } from "@/lib/constants/profile";`
 */

export const PROFILE_ENDPOINTS = {
  me: "/api/v1/profile/me",
  leetcodeConnection: "/api/v1/connections/leetcode", // POST connect, DELETE disconnect
  githubConnection: "/api/v1/connections/github", // DELETE disconnect
  githubAuthorize: "/api/v1/connections/github/authorize",
  /** POST {handle} connect, DELETE disconnect; e.g. /api/v1/connections/platforms/CODEFORCES */
  platformConnection: (platform: string) => `/api/v1/connections/platforms/${platform}`,
} as const;

export const PROFILE_QUERY_KEYS = {
  profile: ["profile", "me"] as const,
} as const;

export const PROFILE_POLLING = {
  /** LeetCode card polls the shared profile query at this cadence while a sync is in flight. */
  syncIntervalMs: 5000,
} as const;

export const PROFILE_SYNC_STATUS = {
  syncing: "SYNCING",
  synced: "SYNCED",
  failed: "FAILED",
  degraded: "DEGRADED",
} as const;
