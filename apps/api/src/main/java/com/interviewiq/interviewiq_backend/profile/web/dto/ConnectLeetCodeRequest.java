package com.interviewiq.interviewiq_backend.profile.web.dto;

/** Body for POST /connections/leetcode — the username the user typed (URL/@ tolerated; normalized server-side). */
public record ConnectLeetCodeRequest(String username) {
}
