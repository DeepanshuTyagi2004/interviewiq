package com.interviewiq.interviewiq_backend.dtos;

import java.util.List;

/**
 * A résumé project (personal/academic/side project) — distinct from work experience. Carries the
 * tech used and the detail bullets so the interview-prep pipeline can ground probes in what the
 * candidate actually built.
 */
public record ProjectDto(
        String name,
        String description,
        List<String> tech,
        List<String> bullets,
        String link
) {
}
