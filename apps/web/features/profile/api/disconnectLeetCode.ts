import { apiFetch } from "@/lib/api-client/client";
import { PROFILE_ENDPOINTS } from "@/lib/constants/profile";

/** DELETE /api/v1/connections/leetcode → 204 (connection + LeetCode fragment removed). */
export function disconnectLeetCode(): Promise<void> {
  return apiFetch<void>(PROFILE_ENDPOINTS.leetcodeConnection, { method: "DELETE" });
}
