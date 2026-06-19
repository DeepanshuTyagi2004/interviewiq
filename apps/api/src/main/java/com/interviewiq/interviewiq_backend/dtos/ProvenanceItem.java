package com.interviewiq.interviewiq_backend.dtos;

import java.time.Instant;

public record ProvenanceItem(String source, String fragmentHash, Instant fetchedAt) {
}
