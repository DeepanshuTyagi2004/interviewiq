package com.interviewiq.interviewiq_backend.dtos;

import java.util.List;

/** A company and its JDs — the catalogue shape returned for the ingestion admin UI. */
public record CompanyWithJds(String company, List<JdResponse> jds) {
}
