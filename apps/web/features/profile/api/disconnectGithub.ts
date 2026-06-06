import { apiFetch } from "@/lib/api-client/client";

/** DELETE /api/v1/connections/github → 204 (token + GitHub fragment removed). */
export function disconnectGithub(): Promise<void> {
  return apiFetch<void>("/api/v1/connections/github", { method: "DELETE" });
}
