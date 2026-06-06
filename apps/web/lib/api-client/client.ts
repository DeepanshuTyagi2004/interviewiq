import { refresh } from "@/lib/auth/client";
import { getAccessToken } from "@/lib/auth/token-store";

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

export type RequestOptions = RequestInit & { json?: unknown };

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

  return fetch(`${BASE_URL}${path}`, {
    ...rest,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(headers ?? {}),
    },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status} ${res.statusText}`);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return (await res.json()) as T;
}
