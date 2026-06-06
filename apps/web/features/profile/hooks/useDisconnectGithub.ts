"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { disconnectGithub } from "../api/disconnectGithub";
import { PROFILE_QUERY_KEY } from "./useProfile";

export function useDisconnectGithub() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: disconnectGithub,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PROFILE_QUERY_KEY });
    },
  });
}
