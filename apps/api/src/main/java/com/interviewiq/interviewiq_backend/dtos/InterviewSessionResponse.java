package com.interviewiq.interviewiq_backend.dtos;

import com.interviewiq.interviewiq_backend.models.InterviewSession;
import com.interviewiq.interviewiq_backend.models.RoundType;
import com.interviewiq.interviewiq_backend.models.SessionStatus;

import java.time.Instant;
import java.util.UUID;

/**
 * Candidate-facing view of a session. Mirrors {@code InterviewSession} in
 * {@code contracts/openapi.yaml}. {@code planReady} (status == PREP_READY) is the only prep signal
 * exposed — plan CONTENTS are the interviewer's material and are never returned here.
 */
public record InterviewSessionResponse(
        UUID id,
        UUID candidateId,
        UUID jobDescriptionId,
        String company,
        String companyName,
        String role,
        String level,
        String specialization,
        RoundType roundType,
        Instant scheduledAt,
        String timezone,
        SessionStatus status,
        boolean planReady,
        String planVersion,
        String inputHash,
        String prepError,
        Instant createdAt,
        Instant updatedAt
) {
    public static InterviewSessionResponse from(InterviewSession s, String companyName) {
        return new InterviewSessionResponse(
                s.getId(), s.getCandidateId(), s.getJobDescriptionId(),
                s.getCompany(), companyName, s.getRole(), s.getLevel(), s.getSpecialization(),
                s.getRoundType(), s.getScheduledAt(), s.getTimezone(), s.getStatus(),
                s.isPlanReady(), s.getPlanVersion(), s.getInputHash(), s.getPrepError(),
                s.getCreatedAt(), s.getUpdatedAt());
    }
}
