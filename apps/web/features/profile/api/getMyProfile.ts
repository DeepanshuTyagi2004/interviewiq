import { apiFetch } from "@/lib/api-client/client";
import type { ProfileResponse } from "../types/profile";

/** GET /api/v1/profile/me → consolidated, read-only profile. */
export function getMyProfile(): Promise<ProfileResponse> {
  return apiFetch<ProfileResponse>("/api/v1/profile/me");
}
