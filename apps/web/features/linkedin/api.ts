import { apiFetch } from "@/lib/api-client/client";
import type { LinkedInImportConfirmation, LinkedInImportDraft, LinkedInImportStatus } from "./types";

export const LINKEDIN_ENDPOINT = "/api/v1/users/me/linkedin";
export const LINKEDIN_STATUS_KEY = ["linkedin", "status"] as const;

export function getLinkedInStatus() {
  return apiFetch<LinkedInImportStatus>(LINKEDIN_ENDPOINT);
}

/** Upload the LinkedIn "Save to PDF" file with explicit consent. Returns a review draft only. */
export function importLinkedInPdf(file: File, signal: AbortSignal) {
  const body = new FormData();
  body.append("consent", "true");
  body.append("file", file);
  return apiFetch<LinkedInImportDraft>(`${LINKEDIN_ENDPOINT}/imports`, {
    method: "POST", body, signal, retryAuth: false,
  });
}

export function confirmLinkedIn(id: string, sections: string[], mergeProfile: boolean) {
  return apiFetch<LinkedInImportConfirmation>(`${LINKEDIN_ENDPOINT}/imports/${encodeURIComponent(id)}/confirm`, {
    method: "POST", json: { sections, mergeProfile }, retryAuth: false,
  });
}

export function removeLinkedIn() {
  return apiFetch<void>(LINKEDIN_ENDPOINT, { method: "DELETE", retryAuth: false });
}
