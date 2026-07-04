package com.interviewiq.interviewiq_backend.dtos;

import com.interviewiq.interviewiq_backend.models.RoundType;

import java.time.Instant;
import java.util.UUID;

/**
 * Book an interview session: a JD + slot. Mirrors {@code CreateInterviewSessionRequest} in
 * {@code contracts/openapi.yaml}. {@code roundType} is OPTIONAL and normally {@code null} — the
 * candidate does not pick the round; the service assigns it (see {@code createSession}). It's still
 * parsed from its wire value by Jackson (see {@link RoundType}) when a trusted caller sends one.
 * {@code scheduledAt} is the absolute slot instant (UTC).
 */
public record CreateInterviewSessionRequest(
        UUID jobDescriptionId,
        RoundType roundType,
        Instant scheduledAt,
        String timezone
) {
}
