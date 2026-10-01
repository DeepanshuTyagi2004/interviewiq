/**
 * LeetCode-specific failures the frontend needs to tell apart. Each reason carries the stable
 * `code` the UI keys on to render the right message.
 */
export const LEETCODE_REASONS = {
  /** The username does not exist on LeetCode (matchedUser was null). → 404 */
  USERNAME_NOT_FOUND: "leetcode_user_not_found",
  /** The profile exists but its stats are not publicly visible. → 422 */
  PROFILE_PRIVATE: "leetcode_profile_private",
  /** LeetCode rate-limited us (HTTP 429). Never surfaced raw to the user. → 503 */
  RATE_LIMITED: "leetcode_rate_limited",
  /** LeetCode was unreachable or returned an unexpected error. → 503 */
  UNREACHABLE: "leetcode_unreachable",
} as const;

export type LeetCodeReason = keyof typeof LEETCODE_REASONS;

export class LeetCodeProfileError extends Error {
  constructor(
    readonly reason: LeetCodeReason,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "LeetCodeProfileError";
  }

  get code(): string {
    return LEETCODE_REASONS[this.reason];
  }

  get httpStatus(): number {
    switch (this.reason) {
      case "USERNAME_NOT_FOUND":
        return 404;
      case "PROFILE_PRIVATE":
        return 422;
      case "RATE_LIMITED":
      case "UNREACHABLE":
        return 503;
    }
  }
}
