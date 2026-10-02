/**
 * Error types. Routers map these onto the stable `{ code, message }` ApiError envelope the
 * frontend keys on — per router, the same way the Spring controllers each had their own
 * `@ExceptionHandler`s (e.g. a bad request is `resume_bad_request` on the resume endpoints but
 * `session_bad_request` on the interview endpoints).
 */

/** Wire shape of every error body. */
export interface ApiErrorBody {
  code: string;
  message: string;
}

/** An error that already carries its HTTP status + stable code. Rendered as-is. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }

  body(): ApiErrorBody {
    return { code: this.code, message: this.message };
  }
}

/**
 * Invalid input detected by a service (the Java code's IllegalArgumentException). Carries no code
 * of its own — the router that catches it decides which `*_bad_request` code to use.
 */
export class InvalidArgumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidArgumentError";
  }
}

/** A request-shape problem found while parsing params/body (bad UUID, bad number, ...). */
export class BadRequestError extends ApiError {
  constructor(message: string, code = "bad_request") {
    super(400, code, message);
    this.name = "BadRequestError";
  }
}

/** Uploaded resume over the 6 MB cap. */
export const resumeTooLarge = () => new ApiError(413, "resume_too_large", "The resume must be 6 MB or smaller.");

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** A Postgres unique-constraint violation (SQLSTATE 23505), possibly wrapped (Drizzle wraps driver errors). */
export function isUniqueViolation(err: unknown): boolean {
  let e: unknown = err;
  for (let depth = 0; e && depth < 5; depth++) {
    if ((e as { code?: unknown }).code === "23505") return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * An error message that is safe to log. Drizzle's DrizzleQueryError embeds the query PARAMETERS
 * (emails, password hashes, token hashes) in its message, so for those only the driver's own
 * message is kept.
 */
export function safeErrorMessage(err: unknown): string {
  if (err instanceof Error && "params" in err && "query" in err) {
    return `database query failed${err.cause instanceof Error ? `: ${err.cause.message}` : ""}`;
  }
  return errorMessage(err);
}
