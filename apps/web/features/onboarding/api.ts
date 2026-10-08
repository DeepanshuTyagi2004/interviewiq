import { apiFetch } from "@/lib/api-client/client";
import { ONBOARDING_ENDPOINTS } from "@/lib/constants/onboarding";
import { isEngineeringLevel } from "@/lib/constants/engineering-levels";
import type {
  CandidateProfileRequest,
  CandidateProfileResponse,
  ResumeParseRunResponse,
} from "./types";

/** POST the resume PDF (multipart) → unsaved draft profile. Synchronous (blocks on the LLM). */
export function parseResume(file: File): Promise<CandidateProfileResponse> {
  const form = new FormData();
  form.append("file", file);
  return apiFetch<CandidateProfileResponse>(ONBOARDING_ENDPOINTS.resumeParse, {
    method: "POST",
    body: form,
  });
}

/** POST the resume PDF (multipart) → {run_id} — starts an async parse (fire-and-poll). */
export function startResumeParse(file: File): Promise<{ run_id: string; status: string }> {
  const form = new FormData();
  form.append("file", file);
  return apiFetch(ONBOARDING_ENDPOINTS.resumeParseStart, { method: "POST", body: form });
}

/** GET the status of an async parse run — {status, profile? (completed), error? (failed)}. */
export function getResumeParseRun(runId: string): Promise<ResumeParseRunResponse> {
  return apiFetch<ResumeParseRunResponse>(ONBOARDING_ENDPOINTS.resumeParseRun(runId));
}

/** GET the saved candidate profile, or null when the user hasn't created one yet (204). */
export async function getCandidateProfile(): Promise<CandidateProfileResponse | null> {
  const res = await apiFetch<CandidateProfileResponse | undefined>(
    ONBOARDING_ENDPOINTS.candidateProfile,
  );
  return res ?? null;
}

/** PUT (upsert) the candidate profile. */
export function saveCandidateProfile(
  request: CandidateProfileRequest,
): Promise<CandidateProfileResponse> {
  if (request.level != null && !isEngineeringLevel(request.level)) return Promise.reject(new Error("Choose a valid engineering level"));
  if (request.complete && !isEngineeringLevel(request.level)) return Promise.reject(new Error("Choose your engineering level"));
  return apiFetch<CandidateProfileResponse>(ONBOARDING_ENDPOINTS.candidateProfile, {
    method: "PUT",
    json: request,
  });
}
