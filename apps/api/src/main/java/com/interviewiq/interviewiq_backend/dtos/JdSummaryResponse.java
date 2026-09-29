package com.interviewiq.interviewiq_backend.dtos;

/** A JD card in the browse list (shown experience-level-wise). {@code dataAvailability}
 *  is rich/available/limited/none, derived from the brief for (company, role, level). */
public record JdSummaryResponse(
        String id,
        String company,
        String companyName,
        String role,
        String level,
        String title,
        String specialization,
        String dataConfidence,
        String dataAvailability
) {
}
