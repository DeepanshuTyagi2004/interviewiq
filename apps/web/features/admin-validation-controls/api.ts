import { apiFetch } from "@/lib/api-client/client";
import type {
  ValidationControlKey,
  ValidationControlSettings,
  ValidationControlsResponse,
} from "./types";

export const VALIDATION_CONTROLS_ENDPOINT = "/api/v1/admin/validation-controls";

export function getValidationControls() {
  return apiFetch<ValidationControlsResponse>(VALIDATION_CONTROLS_ENDPOINT);
}

export function patchValidationControl(key: ValidationControlKey, value: boolean) {
  return apiFetch<ValidationControlsResponse>(VALIDATION_CONTROLS_ENDPOINT, {
    method: "PATCH",
    retryAuth: false,
    json: { [key]: value } satisfies Partial<ValidationControlSettings>,
  });
}
