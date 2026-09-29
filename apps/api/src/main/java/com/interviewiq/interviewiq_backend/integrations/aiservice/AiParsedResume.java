package com.interviewiq.interviewiq_backend.integrations.aiservice;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;

/**
 * Deserialization target for the ai-service {@code POST /resumes/parse} response (snake_case on the
 * wire). Kept internal to the aiservice integration: the service layer maps it onto the camelCase
 * public DTOs. {@code ignoreUnknown} so a prompt/schema tweak on the AI side can't 500 the parse.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record AiParsedResume(
        @JsonProperty("full_name") String fullName,
        String email,
        String phone,
        String location,
        String headline,
        Links links,
        List<Education> education,
        List<Experience> experience,
        List<Project> projects,
        List<String> skills,
        List<String> achievements
) {

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Links(String github, String leetcode, String linkedin) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Project(
            String name,
            String description,
            List<String> tech,
            List<String> bullets,
            String link
    ) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Education(
            String institution,
            String degree,
            String field,
            @JsonProperty("start_year") String startYear,
            @JsonProperty("end_year") String endYear,
            String grade
    ) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Experience(
            String company,
            String title,
            @JsonProperty("start_date") String startDate,
            @JsonProperty("end_date") String endDate,
            String location,
            List<String> bullets
    ) {
    }
}
