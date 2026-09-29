import { apiFetch } from "@/lib/api-client/client";
import { PROFILE_ENDPOINTS } from "@/lib/constants/profile";
import type { ProfileResponse } from "../types/profile";

/** GET /api/v1/profile/me → consolidated, read-only profile. */
export function getMyProfile(): Promise<ProfileResponse> {
  return apiFetch<ProfileResponse>(PROFILE_ENDPOINTS.me);
}
