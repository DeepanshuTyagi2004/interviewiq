package com.interviewiq.interviewiq_backend.dtos;

/**
 * One education entry. Years are strings (verbatim from the résumé — "2021", "2021-2025", or
 * null); the user edits them freely in the stepper, so we don't impose a numeric shape.
 */
public record EducationDto(
        String institution,
        String degree,
        String field,
        String startYear,
        String endYear,
        String grade
) {
}
