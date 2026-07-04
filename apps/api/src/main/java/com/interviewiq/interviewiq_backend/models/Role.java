package com.interviewiq.interviewiq_backend.models;

/**
 * Coarse authorization role. USER is the default for every account; ADMIN unlocks
 * internal/ops surfaces (e.g. the interview-intelligence live ingestion console).
 * Mapped into the access-token's {@code role} claim and onto a {@code ROLE_ADMIN}
 * Spring authority.
 */
public enum Role {
    USER,
    ADMIN
}
