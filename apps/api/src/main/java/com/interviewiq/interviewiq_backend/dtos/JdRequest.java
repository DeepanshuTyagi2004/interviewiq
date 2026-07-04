package com.interviewiq.interviewiq_backend.dtos;

/** One JD in an add-company request. {@code role} defaults to "software-engineer"; {@code level}
 *  is one of fresher/sde1/sde2/sde3; {@code specialization} (backend/frontend/fullstack/...) defaults
 *  to "general". {@code jdUrl} and {@code description} (full JD content) are optional; the description
 *  is stored and fed to Perplexity as search context. */
public record JdRequest(String title, String role, String level, String specialization,
                        String jdUrl, String description) {
}
