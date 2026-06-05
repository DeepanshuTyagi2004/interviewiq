package com.interviewiq.interviewiq_backend.profile.web.dto;

import java.time.Instant;

public record ProvenanceItem(String source, String fragmentHash, Instant fetchedAt) {
}
