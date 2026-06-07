package com.interviewiq.interviewiq_backend.profile.web.dto;

/** Response for GET /connections/github/authorize: the GitHub OAuth URL to navigate to. */
public record AuthorizeUrlResponse(String url) {
}
