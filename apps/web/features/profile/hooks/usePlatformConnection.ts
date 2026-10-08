"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { connectPlatform, disconnectPlatform } from "../api/platformConnections";
import type { CodingPlatformKind } from "../types/profile";
import { PROFILE_QUERY_KEYS } from "@/lib/constants/profile";

/** Connect a coding platform by handle; the profile is invalidated so the row flips to SYNCING. */
export function useConnectPlatform(platform: CodingPlatformKind) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (handle: string) => connectPlatform(platform, handle),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PROFILE_QUERY_KEYS.profile });
    },
  });
}

export function useDisconnectPlatform(platform: CodingPlatformKind) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => disconnectPlatform(platform),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PROFILE_QUERY_KEYS.profile });
    },
  });
}
