import { apiFetch } from "@/lib/api-client/client";
import { USER_ENDPOINTS } from "@/lib/constants/shared";
import type { CurrentUser } from "@/lib/hooks/useCurrentUser";
import type { AccountExport, DeleteAccountRequest, Preferences, PreferencesPatch } from "./types";

export const getPreferences = () => apiFetch<Preferences>(USER_ENDPOINTS.preferences);

export const updatePreferences = (patch: PreferencesPatch) => apiFetch<Preferences>(USER_ENDPOINTS.preferences, { method: "PATCH", json: patch });

export const renameUser = (name: string) => apiFetch<CurrentUser>(USER_ENDPOINTS.me, { method: "PATCH", json: { name } });

/** Revokes every refresh token, this device's included; the caller signs out locally afterwards. */
export const revokeAllSessions = () => apiFetch<void>(USER_ENDPOINTS.sessionsRevoke, { method: "POST", retryAuth: false });

export const exportAccount = () => apiFetch<AccountExport>(USER_ENDPOINTS.export);

/** Immediate hard delete; never retried automatically. */
export const deleteAccount = (body: DeleteAccountRequest) => apiFetch<void>(USER_ENDPOINTS.me, { method: "DELETE", json: body, retryAuth: false });
