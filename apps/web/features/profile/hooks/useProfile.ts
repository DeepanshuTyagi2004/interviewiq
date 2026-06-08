"use client";

import { useQuery } from "@tanstack/react-query";
import { getMyProfile } from "../api/getMyProfile";
import type { ProfileResponse } from "../types/profile";

export const PROFILE_QUERY_KEY = ["profile", "me"] as const;

/**
 * @param options.refetchInterval poll the profile on this interval (ms). Used by the LeetCode card
 *   to watch an async sync flip to SYNCED/FAILED. The query is shared, so this only polls while a
 *   consumer requests it; pass `false` (default) for no polling.
 */
export function useProfile(options?: { refetchInterval?: number | false }) {
  return useQuery<ProfileResponse>({
    queryKey: PROFILE_QUERY_KEY,
    queryFn: getMyProfile,
    refetchInterval: options?.refetchInterval ?? false,
  });
}
