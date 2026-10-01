import { refresh } from "@/lib/auth/client";
import { getAccessToken } from "@/lib/auth/token-store";
import { toApiFetchError } from "./errors";

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

export type RequestOptions = RequestInit & { json?: unknown };

export { ApiFetchError } from "./errors";

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
  if (!res.ok) throw await toApiFetchError(res);
  if (res.status === 204) {
    return undefined as T;
  }
  return (await res.json()) as T;
}
