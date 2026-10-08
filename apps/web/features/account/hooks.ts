"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth/AuthProvider";
import type { CurrentUser } from "@/lib/hooks/useCurrentUser";
import { deleteAccount, exportAccount, getPreferences, renameUser, revokeAllSessions, updatePreferences } from "./api";
import type { DeleteAccountRequest, Preferences, PreferencesPatch } from "./types";

export const PREFERENCES_KEY = ["account", "preferences"] as const;

export function usePreferences() {
  const { isAuthenticated } = useAuth();
  return useQuery<Preferences>({ queryKey: PREFERENCES_KEY, queryFn: getPreferences, enabled: isAuthenticated, staleTime: 60_000 });
}

/** Saves a partial change; the server answers with the full set, which replaces the cache. */
export function useUpdatePreferences() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: PreferencesPatch) => updatePreferences(patch),
    onSuccess: (prefs) => qc.setQueryData(PREFERENCES_KEY, prefs),
  });
}

export function useRenameUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => renameUser(name),
    onSuccess: (user: CurrentUser) => qc.setQueryData(["auth", "me"], user),
  });
}

/** "Sign out everywhere": revoke on the server, then clear this device too. */
export function useRevokeAllSessions() {
  const { logout } = useAuth();
  return useMutation({
    mutationFn: async () => {
      await revokeAllSessions();
      await logout();
    },
  });
}

export function useExportAccount() {
  return useMutation({
    mutationFn: async () => {
      const data = await exportAccount();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `interviewiq-export-${String(data.exportedAt).slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    },
  });
}

/** Deletes the account, then clears the signed-in state (the server already cleared the cookie). */
export function useDeleteAccount() {
  const { logout } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: DeleteAccountRequest) => {
      await deleteAccount(body);
      qc.clear();
      await logout().catch(() => undefined);
    },
  });
}
