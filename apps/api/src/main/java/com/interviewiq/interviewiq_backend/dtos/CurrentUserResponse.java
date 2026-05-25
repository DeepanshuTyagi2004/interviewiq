package com.interviewiq.interviewiq_backend.dtos;

import java.util.UUID;

public record CurrentUserResponse(
        UUID id,
        String email,
        String name
) {
}
