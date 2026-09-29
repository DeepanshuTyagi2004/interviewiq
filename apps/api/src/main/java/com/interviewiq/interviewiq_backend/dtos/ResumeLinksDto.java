package com.interviewiq.interviewiq_backend.dtos;

/** Profile URLs detected in the résumé — used to prefill the connectors step. Any may be null. */
public record ResumeLinksDto(
        String github,
        String leetcode,
        String linkedin
) {
}
