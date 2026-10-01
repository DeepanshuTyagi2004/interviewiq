/**
 * Thrown on a non-2xx response. Carries the HTTP status and the backend error `code`
 * (from the `{ code, message }` ApiError envelope) so callers can branch on it — e.g. the
 * LeetCode card distinguishing `leetcode_user_not_found` from `leetcode_profile_private`.
 */
export class ApiFetchError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
    message: string,
  ) {
    super(message);
    this.name = "ApiFetchError";
  }
}

/** Build an ApiFetchError from a failed response, reading the `{ code, message }` envelope. */
export async function toApiFetchError(res: Response): Promise<ApiFetchError> {
  let code: string | undefined;
  let message = `Request failed: ${res.status} ${res.statusText}`;
  try {
    const body = (await res.json()) as { code?: string; message?: string };
    if (body?.code) code = body.code;
    if (body?.message) message = body.message;
  } catch {
    // non-JSON error body — keep the default message
  }
  return new ApiFetchError(res.status, code, message);
}
