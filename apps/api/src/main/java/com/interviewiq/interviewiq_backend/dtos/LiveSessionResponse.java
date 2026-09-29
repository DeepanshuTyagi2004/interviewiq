package com.interviewiq.interviewiq_backend.dtos;

import com.interviewiq.interviewiq_backend.models.SessionStatus;

/** Returned by the go-live / resume endpoints. `token`/`livekitUrl` are null when the session
 *  is not (yet) live (GET on a PREP_READY session). */
public record LiveSessionResponse(
        String livekitUrl,
        String token,
        String roomName,
        SessionStatus status
) {
}
