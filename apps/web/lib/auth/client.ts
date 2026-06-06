"use client";

/**
 * Auth client for the backend-owned OAuth + JWT flow (Path A).
 *
 * Flow:
 *  1. loginWithGoogle() redirects the browser to the backend, which owns the
 *     entire Google OAuth handshake.
 *  2. Backend sets an httpOnly `refresh_token` cookie and redirects to
 *     `/auth/callback` on this frontend.
 *  3. The callback page (and AuthProvider on mount) calls refresh() to exchange
 *     the cookie for a short-lived access token held in memory.
 *  4. logout() revokes the refresh token server-side and clears local state.
 */

import { APP_CONFIG } from "@/lib/constants/config";
import { clearAccessToken, setAccessToken } from "./token-store";

const API_URL = APP_CONFIG.apiUrl;

/** Backend's Spring-default OAuth2 entry point for Google. */
export function loginWithGoogle(): void {
  window.location.href = `${API_URL}/oauth2/authorization/google`;
}

type TokenResponse = {
  accessToken: string;
  tokenType: string;
  expiresIn: number; // seconds
};

/**
 * Exchange the httpOnly refresh-token cookie for a new access token.
 * Stores the token in memory on success. Returns false when there is no valid
 * session (401) — the caller should treat that as "logged out".
 */
export async function refresh(): Promise<boolean> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api/v1/auth/refresh`, {
      method: "POST",
      credentials: "include", // send + receive the refresh_token cookie
    });
  } catch {
    return false; // network error — treat as unauthenticated
  }

  if (!res.ok) {
    clearAccessToken();
    return false;
  }

  const data = (await res.json()) as TokenResponse;
  setAccessToken(data.accessToken, data.expiresIn);
  return true;
}

/** Revoke the refresh token server-side and clear the in-memory access token. */
export async function logout(): Promise<void> {
  try {
    await fetch(`${API_URL}/api/v1/auth/logout`, {
      method: "POST",
      credentials: "include",
    });
  } finally {
    clearAccessToken();
  }
}
