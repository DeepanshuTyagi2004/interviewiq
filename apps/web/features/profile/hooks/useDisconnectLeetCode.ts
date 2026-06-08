"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { disconnectLeetCode } from "../api/disconnectLeetCode";
import { PROFILE_QUERY_KEY } from "./useProfile";

export function useDisconnectLeetCode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: disconnectLeetCode,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PROFILE_QUERY_KEY });
    },
  });
}
