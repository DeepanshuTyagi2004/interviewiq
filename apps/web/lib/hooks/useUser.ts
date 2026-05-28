"use client";

import { useSession } from "next-auth/react";

export function useUser() {
  const { data, status } = useSession();
  return {
    user: data?.user ?? null,
    isLoading: status === "loading",
    isAuthenticated: status === "authenticated",
  };
}
