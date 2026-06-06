"use client";

import { useQuery } from "@tanstack/react-query";
import { getMyProfile } from "../api/getMyProfile";
import type { ProfileResponse } from "../types/profile";

export const PROFILE_QUERY_KEY = ["profile", "me"] as const;

export function useProfile() {
  return useQuery<ProfileResponse>({
    queryKey: PROFILE_QUERY_KEY,
    queryFn: getMyProfile,
  });
}
