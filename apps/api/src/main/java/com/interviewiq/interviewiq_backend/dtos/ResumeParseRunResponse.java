package com.interviewiq.interviewiq_backend.dtos;

/**
 * Status of an async résumé-parse run (fire-and-poll). {@code status} is {@code running},
 * {@code completed}, or {@code failed}. {@code profile} is the parsed draft (present only when
 * completed); {@code error} is a user-facing message (present only when failed).
 */
public record ResumeParseRunResponse(
        String status,
        CandidateProfileResponse profile,
        String error
) {
}
