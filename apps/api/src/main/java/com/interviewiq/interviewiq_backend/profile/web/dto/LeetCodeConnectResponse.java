package com.interviewiq.interviewiq_backend.profile.web.dto;

/**
 * Response for a successful POST /connections/leetcode. Collection runs in the background, so this
 * returns immediately with {@code status = SYNCING}; the UI polls the profile for the terminal state.
 */
public record LeetCodeConnectResponse(String username, String status) {
}
