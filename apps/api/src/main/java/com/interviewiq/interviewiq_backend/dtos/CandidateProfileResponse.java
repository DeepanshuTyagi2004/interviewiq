package com.interviewiq.interviewiq_backend.dtos;

import java.time.Instant;
import java.util.List;

/**
 * The candidate profile as returned to the frontend. Also used as the unsaved <em>draft</em>
 * shape produced by résumé parsing (in which case {@code onboardingComplete} is false and
 * {@code resumeParsedAt} is null — nothing is persisted until the user saves).
 */
public record CandidateProfileResponse(
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
        Instant resumeParsedAt,
        boolean onboardingComplete
) {
}
