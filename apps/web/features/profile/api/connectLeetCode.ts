import { apiFetch } from "@/lib/api-client/client";

export interface LeetCodeConnectResponse {
  username: string;
  status: string;
}

/**
 * POST /api/v1/connections/leetcode → 202 Accepted. Validates the username synchronously
 * (throws ApiFetchError with a `code` for not-found / private) and starts background collection.
 */
export function connectLeetCode(username: string): Promise<LeetCodeConnectResponse> {
  return apiFetch<LeetCodeConnectResponse>("/api/v1/connections/leetcode", {
    method: "POST",
    json: { username },
  });
}
