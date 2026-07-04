import { refresh } from "@/lib/auth/client";
import { getAccessToken } from "@/lib/auth/token-store";

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

export type RequestOptions = RequestInit & { json?: unknown };

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

/**
 * Authenticated fetch against the backend.
 *
 * Attaches the in-memory access token as a Bearer header. On a 401 it attempts
 * a single silent refresh (using the httpOnly refresh cookie) and retries once.
 * If the refresh fails, the original 401 propagates and the AuthProvider's
 * scheduled refresh will eventually flip the app to "unauthenticated".
 */
export async function apiFetch<T = unknown>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const res = await doFetch(path, options);

  if (res.status === 401) {
    const refreshed = await refresh();
    if (refreshed) {
      const retry = await doFetch(path, options);
      return handleResponse<T>(retry);
    }
  }

  return handleResponse<T>(res);
}

function doFetch(path: string, options: RequestOptions): Promise<Response> {
  const { json, headers, ...rest } = options;
  const token = getAccessToken();
  // For multipart/binary uploads (FormData bodies) the browser MUST set Content-Type itself so it
  // can add the multipart boundary — so we omit the default JSON content type in that case.
  const isFormData =
    typeof FormData !== "undefined" && rest.body instanceof FormData;

  return fetch(`${BASE_URL}${path}`, {
    ...rest,
    headers: {
      ...(isFormData ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(headers ?? {}),
    },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    // Backend errors use the { code, message } ApiError envelope — parse it so callers
    // can read the stable code. Fall back to a generic message for non-JSON bodies.
    let code: string | undefined;
    let message = `Request failed: ${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as { code?: string; message?: string };
      if (body?.code) code = body.code;
      if (body?.message) message = body.message;
    } catch {
      // non-JSON error body — keep the default message
    }
    throw new ApiFetchError(res.status, code, message);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return (await res.json()) as T;
}
