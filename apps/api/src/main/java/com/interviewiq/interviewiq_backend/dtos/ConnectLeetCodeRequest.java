package com.interviewiq.interviewiq_backend.dtos;

/** Body for POST /connections/leetcode — the username the user typed (URL/@ tolerated; normalized server-side). */
public record ConnectLeetCodeRequest(String username) {
}
