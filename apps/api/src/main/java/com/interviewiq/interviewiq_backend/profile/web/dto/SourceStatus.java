package com.interviewiq.interviewiq_backend.profile.web.dto;

import com.fasterxml.jackson.annotation.JsonInclude;

import java.time.Instant;

@JsonInclude(JsonInclude.Include.NON_NULL)
public record SourceStatus(String source, boolean connected, Instant lastRefreshedAt) {
}
