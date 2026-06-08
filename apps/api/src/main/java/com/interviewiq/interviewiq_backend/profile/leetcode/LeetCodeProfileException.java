package com.interviewiq.interviewiq_backend.profile.leetcode;

/**
 * Raised for the LeetCode-specific failure cases the frontend needs to distinguish.
 * Each reason carries a stable {@code code} the UI keys on to render the right message.
 */
public class LeetCodeProfileException extends RuntimeException {

    public enum Reason {
        /** The username does not exist on LeetCode (matchedUser was null). */
        USERNAME_NOT_FOUND("leetcode_user_not_found"),
        /** The profile exists but its stats are not publicly visible. */
        PROFILE_PRIVATE("leetcode_profile_private"),
        /** LeetCode rate-limited us (HTTP 429). Never surfaced raw to the user. */
        RATE_LIMITED("leetcode_rate_limited"),
        /** LeetCode was unreachable or returned an unexpected error. */
        UNREACHABLE("leetcode_unreachable");

        private final String code;

        Reason(String code) {
            this.code = code;
        }

        public String code() {
            return code;
        }
    }

    private final Reason reason;

    public LeetCodeProfileException(Reason reason, String message) {
        super(message);
        this.reason = reason;
    }

    public LeetCodeProfileException(Reason reason, String message, Throwable cause) {
        super(message, cause);
        this.reason = reason;
    }

    public Reason getReason() {
        return reason;
    }

    public String getCode() {
        return reason.code();
    }
}
