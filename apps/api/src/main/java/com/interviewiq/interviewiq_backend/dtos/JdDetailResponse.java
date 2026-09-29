package com.interviewiq.interviewiq_backend.dtos;

import tools.jackson.databind.JsonNode;

import java.util.List;

/**
 * Full JD detail for the student. {@code interviewProcess} is the brief's
 * {@code consolidated_process} for (company, role, level), embedded from the AI service;
 * {@code dataAvailability} is rich/available/limited/none.
 */
public record JdDetailResponse(
        String id,
        String company,
        String companyName,
        String role,
        String level,
        String title,
        String specialization,
        String description,
        List<String> techStack,
        String sourceUrl,
        String dataConfidence,
        String dataAvailability,
        JsonNode interviewProcess,
        List<String> sources
) {
}
