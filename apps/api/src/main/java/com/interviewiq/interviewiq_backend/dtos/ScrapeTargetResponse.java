package com.interviewiq.interviewiq_backend.dtos;

/**
 * One brief-generation target (a JD) served to interviewiq-ai-service over the internal
 * endpoint. {@code specialization} keys the per-role brief; {@code title}/{@code jdUrl}/
 * {@code description} give the AI service the JD context it feeds into the Perplexity search.
 */
public record ScrapeTargetResponse(
        String company, String role, String level, String specialization,
        String title, String jdUrl, String description) {
}
