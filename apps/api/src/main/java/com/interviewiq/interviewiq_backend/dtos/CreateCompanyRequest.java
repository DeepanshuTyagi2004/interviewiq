package com.interviewiq.interviewiq_backend.dtos;

import java.util.List;

/** Add a company and one or more JDs for it; the AI service then ingests interview data per JD. */
public record CreateCompanyRequest(String company, List<JdRequest> jds) {
}
