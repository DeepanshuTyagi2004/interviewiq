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
 * The resume "connection": a parsed draft is saved straight to the candidate profile (the user
 * reviews or edits it on Profile afterwards). Shared by the Connections row and the profile's
 * resume file row so both behave identically.
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
      const request = formToRequest(responseToForm({ ...draft, level: profile?.level ?? null, targetJdId: profile?.targetJdId ?? null, targetRole: profile?.targetRole ?? draft.targetRole }), false);
      // A failed or unfinished profile read must not erase a previously saved user choice.
      if (profile === undefined || (profile?.level === null && profile.legacyLevel)) delete request.level;
      mutate(request, {
        onSuccess: () => toast.success("Resume saved to your profile."),
        onError: () => toast.error("Couldn’t save your resume. Please try again."),
      });
    },
    [mutate, profile],
  );

  return { profile, hasProfile, importDraft, saving: save.isPending };
}
