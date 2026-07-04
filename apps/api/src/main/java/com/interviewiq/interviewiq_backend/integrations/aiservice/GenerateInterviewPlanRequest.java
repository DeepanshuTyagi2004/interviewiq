package com.interviewiq.interviewiq_backend.integrations.aiservice;

import com.interviewiq.interviewiq_backend.dtos.EducationDto;
import com.interviewiq.interviewiq_backend.dtos.ExperienceDto;
import com.interviewiq.interviewiq_backend.dtos.ProjectDto;
import com.interviewiq.interviewiq_backend.dtos.ResumeLinksDto;
import com.interviewiq.interviewiq_backend.models.RoundType;
import tools.jackson.databind.JsonNode;

import java.util.List;
import java.util.UUID;

/**
 * The body the backend POSTs to the ai-service {@code /interview-plans} endpoint. Mirrors
 * {@code GenerateInterviewPlanRequest} in {@code contracts/openapi.yaml}; record component names
 * serialize to the contract's camelCase, and {@link RoundType} serializes to its wire value.
 *
 * <p>Reuses the onboarding DTOs ({@link EducationDto}/{@link ExperienceDto}/{@link ResumeLinksDto})
 * for the profile part — their shapes already match the contract's Plan* profile schemas.
 */
public record GenerateInterviewPlanRequest(
        PlanSessionContext session,
        PlanJobDescription jobDescription,
        PlanCandidateProfile candidateProfile
) {
    public record PlanSessionContext(
            UUID sessionId,
            UUID candidateId,
            String company,
            String role,
            String level,
            String specialization,
            RoundType roundType
    ) {
    }

    public record PlanJobDescription(
            UUID id,
            String title,
            String description,
            String techStack
    ) {
    }

    public record PlanCandidateProfile(
            String fullName,
            String headline,
            String targetRole,
            List<EducationDto> education,
            List<ExperienceDto> experience,
            List<ProjectDto> projects,
            List<String> skills,
            List<String> achievements,
            ResumeLinksDto links,
            PlanCodingProfile codingProfile
    ) {
    }

    /**
     * Curated coding-platform signals from the Profile Builder fragments (GitHub + LeetCode), the
     * richest grounding for coding rounds. Each is the compact, stable sub-set of the fragment
     * (languages/topRepos, solved/byTopic/contest) — the volatile contribution grid is dropped so
     * it doesn't thrash the plan's input-hash cache. Either may be null if that source isn't connected.
     */
    public record PlanCodingProfile(
            JsonNode github,
            JsonNode leetcode
    ) {
    }
}
