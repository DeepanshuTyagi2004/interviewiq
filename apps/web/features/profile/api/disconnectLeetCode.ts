import { apiFetch } from "@/lib/api-client/client";

/** DELETE /api/v1/connections/leetcode → 204 (connection + LeetCode fragment removed). */
export function disconnectLeetCode(): Promise<void> {
  return apiFetch<void>("/api/v1/connections/leetcode", { method: "DELETE" });
}
