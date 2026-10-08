import { apiFetch } from "@/lib/api-client/client";
import { PROFILE_ENDPOINTS } from "@/lib/constants/profile";
import type { CodingPlatformKind } from "../types/profile";

export interface PlatformConnectResponse {
  platform: CodingPlatformKind;
  handle: string;
  status: string;
}

/**
 * POST /api/v1/connections/platforms/{platform} → 202 Accepted. Validates the handle synchronously
 * (ApiFetchError `platform_user_not_found` / `platform_handle_invalid`) and starts background collection.
 */
export function connectPlatform(platform: CodingPlatformKind, handle: string): Promise<PlatformConnectResponse> {
  return apiFetch<PlatformConnectResponse>(PROFILE_ENDPOINTS.platformConnection(platform), { method: "POST", json: { handle } });
}

/** DELETE /api/v1/connections/platforms/{platform} → 204 (connection + fragment removed). */
export function disconnectPlatform(platform: CodingPlatformKind): Promise<void> {
  return apiFetch<void>(PROFILE_ENDPOINTS.platformConnection(platform), { method: "DELETE" });
}
