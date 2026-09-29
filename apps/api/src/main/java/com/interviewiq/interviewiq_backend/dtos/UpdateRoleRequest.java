package com.interviewiq.interviewiq_backend.dtos;

/** Body for promoting/demoting a user. {@code role} must be "USER" or "ADMIN". */
public record UpdateRoleRequest(String role) {
}
