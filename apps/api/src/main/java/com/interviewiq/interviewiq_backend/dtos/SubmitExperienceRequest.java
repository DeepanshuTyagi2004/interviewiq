package com.interviewiq.interviewiq_backend.dtos;

/**
 * A candidate's first-party interview experience submission. {@code level} is one of
 * fresher/sde1/sde2/sde3; {@code role} defaults to "software-engineer" when blank.
 * The AI service normalises company/role casing before storing.
 */
public record SubmitExperienceRequest(String company, String role, String level, String content) {
}
