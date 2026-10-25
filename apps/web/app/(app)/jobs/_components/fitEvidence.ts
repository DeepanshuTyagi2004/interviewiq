"use client";

import { useCandidateProfile } from "@/features/onboarding";
import { useProfile } from "@/features/profile";

/**
 * False once we know the user has nothing a JD match could read: no resume, no skills, experience or
 * projects, and no connected source. A match then reads "0%", which says "you don't fit" rather than
 * "we don't know yet", so callers show a prompt instead. True while loading (no flash of the prompt).
 */
export function useHasFitEvidence(): boolean {
  const candidate = useCandidateProfile();
  const profile = useProfile();
  if (candidate.isLoading || profile.isLoading) return true;
  const c = candidate.data;
  const fromProfile = Boolean(
    c && (c.resumeFilename || c.skills.length || c.experience.length || c.projects.length),
  );
  const fromSources = Boolean(profile.data?.sources.some((s) => s.connected));
  return fromProfile || fromSources;
}
