package com.interviewiq.interviewiq_backend.dtos;

public record RefreshResult(
        String accessToken,
        String newRefreshToken
) {

}
