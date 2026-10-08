"use client";

/**
 * Auth client for the backend-owned auth flow (Google OAuth or email + password → JWT).
 *
 * Flow:
 *  1. loginWithGoogle() redirects the browser to the backend, which owns the
 *     entire Google OAuth handshake; or registerWithPassword() / loginWithPassword()
 *     post credentials and get the access token back directly.
 *  2. Either way the backend sets an httpOnly `refresh_token` cookie (Google then
 *     redirects to `/auth/callback` on this frontend).
 *  3. The callback page (and AuthProvider on mount) calls refresh() to exchange
 *     the cookie for a short-lived access token held in memory.
 *  4. logout() revokes the refresh token server-side and clears local state.
 */

import { toApiFetchError } from "@/lib/api-client/errors";
import type { components } from "@/lib/api-client/generated/schema";
import { APP_CONFIG, AUTH_ENDPOINTS } from "@/lib/constants/shared";
import { rememberNext } from "./next";
import { clearAccessToken, setAccessToken } from "./token-store";

const API_URL = APP_CONFIG.apiUrl;

/**
 * Backend's Spring-default OAuth2 entry point for Google. `next` (same-origin only) is remembered
 * for this tab so the callback page can land the user back where they started.
 */
export function loginWithGoogle(next?: string | null): void {
  rememberNext(next);
  window.location.href = `${API_URL}/oauth2/authorization/google`;
}

type TokenResponse = components["schemas"]["TokenResponse"];
type RegisterRequest = components["schemas"]["RegisterRequest"];
type LoginRequest = components["schemas"]["LoginRequest"];
type ResetPasswordRequest = components["schemas"]["ResetPasswordRequest"];

/**
 * What a silent refresh found: a session ("ok"), no session ("signed-out": 204, no cookie at all, or
 * 401, a bad one), or no answer ("unreachable": offline, the API restarting, a 5xx or 429). An
 * unreachable API says nothing about the session, so it must never be treated as a sign-out.
 */
export type RefreshOutcome = "ok" | "signed-out" | "unreachable";

/**
 * Exchange the httpOnly refresh-token cookie for a new access token, held in memory on success.
 */
export async function refreshSession(): Promise<RefreshOutcome> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${AUTH_ENDPOINTS.refresh}`, {
      method: "POST",
      credentials: "include", // send + receive the refresh_token cookie
    });
  } catch {
    return "unreachable";
  }

  if (res.status >= 500 || res.status === 429) return "unreachable";
  if (!res.ok || res.status === 204) {
    clearAccessToken();
    return "signed-out";
  }

  const data = (await res.json()) as TokenResponse;
  setAccessToken(data.accessToken, data.expiresIn);
  return "ok";
}

/** refreshSession() as a yes/no, for retrying a request after a 401. */
export async function refresh(): Promise<boolean> {
  return (await refreshSession()) === "ok";
}

/** Revoke the refresh token server-side and clear the in-memory access token. */
export async function logout(): Promise<void> {
  try {
    await fetch(`${API_URL}${AUTH_ENDPOINTS.logout}`, {
      method: "POST",
      credentials: "include",
    });
  } finally {
    clearAccessToken();
  }
}

/**
 * POST JSON to a public auth endpoint with cookies enabled (so a refresh cookie can be set).
 * Throws ApiFetchError carrying the backend's `{ code, message }` on failure.
 */
async function postPublic(path: string, body: unknown): Promise<Response> {
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await toApiFetchError(res);
  return res;
}

async function startSession(res: Response): Promise<void> {
  const data = (await res.json()) as TokenResponse;
  setAccessToken(data.accessToken, data.expiresIn);
}

/** Create an email + password account and start a session. New accounts land in onboarding. */
export async function registerWithPassword(input: RegisterRequest): Promise<void> {
  await startSession(await postPublic(AUTH_ENDPOINTS.register, input));
}

/** Sign in with email + password and start a session. */
export async function loginWithPassword(input: LoginRequest): Promise<void> {
  await startSession(await postPublic(AUTH_ENDPOINTS.login, input));
}

/** Confirm an email address with the token from the verification link. */
export async function verifyEmail(token: string): Promise<void> {
  await postPublic(AUTH_ENDPOINTS.verifyEmail, { token });
}

/** Ask for a reset link. Always resolves the same way, whether or not the account exists. */
export async function requestPasswordReset(email: string): Promise<void> {
  await postPublic(AUTH_ENDPOINTS.forgotPassword, { email });
}

/** Set a new password with the token from the reset link. Signs out every other session. */
export async function resetPassword(input: ResetPasswordRequest): Promise<void> {
  await postPublic(AUTH_ENDPOINTS.resetPassword, input);
}
