"use client";

import { useCallback } from "react";
import { toast } from "sonner";
import {
  formToRequest,
  responseToForm,
  useCandidateProfile,
  useSaveCandidateProfile,
  type CandidateProfileResponse,
} from "@/features/onboarding";

/**
 * The résumé "connection": a parsed draft is saved straight to the candidate profile (the user
 * reviews or edits it on Profile afterwards). Shared by the Connections row and the profile's
 * résumé file row so both behave identically.
 */
export function useResumeImport() {
  const { data: profile } = useCandidateProfile();
  const save = useSaveCandidateProfile();
  const { mutate } = save;

  const hasProfile = Boolean(
    profile &&
      (profile.resumeFilename ||
        profile.experience.length ||
        profile.education.length ||
        profile.projects.length ||
        profile.skills.length),
  );

  const importDraft = useCallback(
    (draft: CandidateProfileResponse) => {
      mutate(formToRequest(responseToForm(draft), false), {
        onSuccess: () => toast.success("Résumé saved to your profile."),
        onError: () => toast.error("Couldn’t save your résumé. Please try again."),
      });
    },
    [mutate],
  );

  return { profile, hasProfile, importDraft, saving: save.isPending };
}
