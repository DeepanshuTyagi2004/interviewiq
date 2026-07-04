"use client";

import { useMutation } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client/client";

const EXPERIENCES_ENDPOINT = "/api/v1/experiences";

export type SubmitExperienceInput = {
  company: string;
  /** Defaults to "software-engineer" on the backend when omitted. */
  role?: string;
  level: string;
  content: string;
};

/** POST a first-party interview experience. Any authenticated user may submit. */
export function submitExperience(input: SubmitExperienceInput): Promise<unknown> {
  return apiFetch(EXPERIENCES_ENDPOINT, { method: "POST", json: input });
}

export function useSubmitExperience() {
  return useMutation({ mutationFn: submitExperience });
}
