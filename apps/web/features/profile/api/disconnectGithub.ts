import { apiFetch } from "@/lib/api-client/client";
import { PROFILE_ENDPOINTS } from "@/lib/constants/profile";

/** DELETE /api/v1/connections/github → 204 (token + GitHub fragment removed). */
export function disconnectGithub(): Promise<void> {
  return apiFetch<void>(PROFILE_ENDPOINTS.githubConnection, { method: "DELETE" });
}
