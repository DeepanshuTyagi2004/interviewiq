package com.interviewiq.interviewiq_backend.profile.web.dto;

import com.fasterxml.jackson.annotation.JsonInclude;

import java.time.Instant;

/**
 * Per-source connection status for the connections UI. {@code status} carries the background-sync
 * lifecycle (SYNCING / SYNCED / FAILED / DEGRADED) for sources that collect asynchronously; it is
 * null (and omitted from JSON) for sources that don't, keeping the shape backward-compatible.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record SourceStatus(String source, boolean connected, Instant lastRefreshedAt, String status) {
}
