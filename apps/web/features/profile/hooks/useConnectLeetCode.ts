"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { connectLeetCode } from "../api/connectLeetCode";
import { PROFILE_QUERY_KEY } from "./useProfile";

/**
 * Connect LeetCode by username. On success the profile is invalidated so the card flips to the
 * SYNCING state; the connect call itself rejects (ApiFetchError) for not-found / private usernames.
 */
export function useConnectLeetCode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (username: string) => connectLeetCode(username),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PROFILE_QUERY_KEY });
    },
  });
}
