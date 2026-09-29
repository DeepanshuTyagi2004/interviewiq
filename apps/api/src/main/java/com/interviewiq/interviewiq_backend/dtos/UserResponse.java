package com.interviewiq.interviewiq_backend.dtos;

/** Current-user / user-listing shape. {@code role} is "USER" or "ADMIN". */
public record UserResponse(String id, String email, String name, String role, boolean onboardingComplete) {
}
