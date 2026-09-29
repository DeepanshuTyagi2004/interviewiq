package com.interviewiq.interviewiq_backend.dtos;

import java.util.List;

/**
 * Upsert payload for the candidate profile (PUT /users/me/candidate-profile).
 *
 * <p>{@code complete=true} marks onboarding finished (flips {@code User.onboardingComplete}) — the
 * wizard sends it on Finish; later profile edits send false. {@code resumeFilename} is the name of
 * the last parsed résumé, if any (the file itself is never stored); {@code resumeParsedAt} is
 * stamped server-side when the filename changes.
 */
public record CandidateProfileRequest(
        String fullName,
        String email,
        String phone,
        String location,
        String headline,
        String targetRole,
        List<EducationDto> education,
        List<ExperienceDto> experience,
        List<ProjectDto> projects,
        List<String> skills,
        List<String> achievements,
        ResumeLinksDto detectedLinks,
        String resumeFilename,
        boolean complete
) {
}
