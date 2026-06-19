package com.interviewiq.interviewiq_backend.dtos;

/** Stable error envelope: {@code code} is keyed on by the frontend, {@code message} is human-readable. */
public record ApiError(String code, String message) {
}
