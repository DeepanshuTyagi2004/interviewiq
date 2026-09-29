package com.interviewiq.interviewiq_backend.dtos;

public record JdResponse(
        String id,
        String role,
        String level,
        String specialization,
        String title,
        String jdUrl,
        String description,
        boolean enabled) {
}
