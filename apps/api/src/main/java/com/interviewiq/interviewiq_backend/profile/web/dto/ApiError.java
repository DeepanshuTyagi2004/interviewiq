package com.interviewiq.interviewiq_backend.profile.web.dto;

/** Stable error envelope: {@code code} is keyed on by the frontend, {@code message} is human-readable. */
public record ApiError(String code, String message) {
}
