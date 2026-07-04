package com.interviewiq.interviewiq_backend.dtos;

import java.util.List;

/** The candidate's sessions. Mirrors {@code InterviewSessionListResponse} in the contract. */
public record InterviewSessionListResponse(List<InterviewSessionResponse> sessions) {
}
