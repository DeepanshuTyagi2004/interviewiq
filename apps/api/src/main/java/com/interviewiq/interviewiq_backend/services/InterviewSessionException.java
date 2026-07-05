package com.interviewiq.interviewiq_backend.services;

import org.springframework.http.HttpStatus;

/**
 * A booking/session error carrying the HTTP status + a stable {@code code} the frontend keys on
 * (surfaced as an {@link com.interviewiq.interviewiq_backend.dtos.ApiError} by the controller).
 */
public class InterviewSessionException extends RuntimeException {

    private final HttpStatus status;
    private final String code;

    public InterviewSessionException(HttpStatus status, String code, String message) {
        super(message);
        this.status = status;
        this.code = code;
    }

    public HttpStatus status() {
        return status;
    }

    public String code() {
        return code;
    }

    public static InterviewSessionException notFound() {
        return new InterviewSessionException(HttpStatus.NOT_FOUND, "session_not_found",
                "interview session not found");
    }

    public static InterviewSessionException badRequest(String code, String message) {
        return new InterviewSessionException(HttpStatus.BAD_REQUEST, code, message);
    }

    public static InterviewSessionException conflict(String code, String message) {
        return new InterviewSessionException(HttpStatus.CONFLICT, code, message);
    }
}
