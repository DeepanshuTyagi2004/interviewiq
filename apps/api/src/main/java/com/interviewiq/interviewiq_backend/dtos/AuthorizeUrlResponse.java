package com.interviewiq.interviewiq_backend.dtos;

/** Response for GET /connections/github/authorize: the GitHub OAuth URL to navigate to. */
public record AuthorizeUrlResponse(String url) {
}
