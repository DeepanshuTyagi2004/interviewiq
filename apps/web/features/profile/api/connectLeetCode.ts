import { apiFetch } from "@/lib/api-client/client";
import { PROFILE_ENDPOINTS } from "@/lib/constants/profile";

export interface LeetCodeConnectResponse {
  username: string;
  status: string;
}

/**
 * POST /api/v1/connections/leetcode → 202 Accepted. Validates the username synchronously
 * (throws ApiFetchError with a `code` for not-found / private) and starts background collection.
 */
export function connectLeetCode(username: string): Promise<LeetCodeConnectResponse> {
  return apiFetch<LeetCodeConnectResponse>(PROFILE_ENDPOINTS.leetcodeConnection, {
    method: "POST",
    json: { username },
  });
}
