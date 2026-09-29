package com.interviewiq.interviewiq_backend.dtos;

import java.util.List;

/** One work/internship entry. {@code bullets} are the résumé's own lines for the role. */
public record ExperienceDto(
        String company,
        String title,
        String startDate,
        String endDate,
        String location,
        List<String> bullets
) {
}
